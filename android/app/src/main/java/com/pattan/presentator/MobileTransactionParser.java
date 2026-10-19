package com.pattan.presentator;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class MobileTransactionParser {
    private static final String PREF_NAME = "pattan_expenses_native_store";
    private static final String KEY_TXNS_ENC = "captured_transactions_enc_v2";
    private static final String KEY_EXPENSE_STORE_MAP_ENC = "expense_memory_store_map_enc_v1";
    private static final String KEY_TXNS_LEGACY = "captured_transactions_json";
    private static final String KEYSTORE_ALIAS = "PattanExpenseMemoryAesKey";

    public static final Set<String> ALLOWED_PAYMENT_PACKAGES = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "com.google.android.apps.nbu.paisa.user",
        "com.phonepe.app",
        "net.one97.paytm",
        "in.org.npci.upiapp",
        "in.amazon.mShop.android.shopping",
        "com.dreamplug.androidapp",
        "com.whatsapp",
        "com.csam.icici.bank.imobile",
        "com.snapwork.hdfc",
        "com.sbi.lotusintouch",
        "com.sbi.SBIFreedomPlus",
        "com.axis.mobile",
        "com.msf.kbank.mobile",
        "com.infrasofttech.CentralBank",
        "com.infrasoft.uboi",
        "com.canarabank.mobility",
        "com.Version1",
        "com.bob.world",
        "com.idfcfirstbank.optimus",
        "com.indusind.indie",
        "com.rblbank.mobank",
        "com.yesbank",
        "com.federalbank.fedmobile"
    )));

    private static final Pattern AMOUNT_PATTERN_PREFIX = Pattern.compile(
        "(?i)(?:₹|rs\\.?|inr|amt)\\s*[:\\-]?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)"
    );
    private static final Pattern AMOUNT_PATTERN_SUFFIX = Pattern.compile(
        "(?i)([0-9,]+(?:\\.[0-9]{1,2})?)\\s*(?:rs\\.?|inr|₹)"
    );
    private static final Pattern REF_PATTERN = Pattern.compile(
        "(?i)(?:upi\\s*(?:ref)?(?:\\s*no\\.?|\\s*id)?|utr|ref(?:erence)?(?:\\s*no\\.?)?|txn\\s*(?:id|no\\.?)?)\\s*[:\\-/]?\\s*([0-9]{9,14})"
    );
    private static final Pattern UPI_SLASH_PATTERN = Pattern.compile(
        "(?i)UPI/(?:CR/|DR/)?([0-9]{9,14})(?:/([^/\\n\\r]{2,40}))?(?:/([^/\\n\\r]{2,60}))?"
    );
    private static final Pattern NOTE_EXPLICIT_PATTERN = Pattern.compile(
        "(?i)(?:note|remarks?|purpose|for|comment|message|description)\\s*[:\\-]\\s*([^\\n\\r.;]{2,80})"
    );
    private static final Pattern MERCHANT_PATTERN = Pattern.compile(
        "(?i)(?:paid\\s+to|sent\\s+to|trf\\s+to|transferred\\s+to|to\\s+vpa|received\\s+from|from\\s+vpa|at|towards|to)\\s+([A-Za-z0-9@._\\-\\s&]{2,38}?)(?=\\s+(?:on|ref|upi|utr|txn|via|for|note|remarks|a/c|ac|acct|avl|bal|using|from|\\.|,|\\n|$))"
    );

    private MobileTransactionParser() {}

    public static boolean isAllowedPaymentPackage(String packageName) {
        if (packageName == null) return false;
        String clean = packageName.trim();
        return !clean.isEmpty() && ALLOWED_PAYMENT_PACKAGES.contains(clean);
    }

    public static JSONObject parseSmsOrNotification(
        String senderOrPkg,
        String title,
        String body,
        long timestampMs,
        String sourceType
    ) {
        try {
            // When called from notification listener, enforce package allow-list
            if ("mobile-notification".equalsIgnoreCase(sourceType) && !isAllowedPaymentPackage(senderOrPkg)) {
                return null;
            }

            String fullText = ((title != null ? title + " " : "") + (body != null ? body : "")).trim();
            if (fullText.length() < 6) return null;

            String lower = fullText.toLowerCase(Locale.ROOT);

            // Never parse or store OTPs, PIN prompts, or password messages
            boolean hasOtpWord = lower.contains("otp")
                || lower.contains("one time password")
                || lower.contains("verification code")
                || lower.contains("upi pin")
                || lower.contains("never share your pin");
            boolean hasCompletionWord = lower.contains("debited") || lower.contains("credited")
                || lower.contains("paid") || lower.contains("sent ")
                || lower.contains("received") || lower.contains("spent")
                || lower.contains("withdrawn") || lower.contains("transferred")
                || lower.contains("refund") || lower.contains("reversed")
                || lower.contains("failed") || lower.contains("declined");

            if (hasOtpWord && !hasCompletionWord) return null;

            // Ignore promotional offers / loan spam
            if ((lower.contains("pre-approved") || lower.contains("apply now") || lower.contains("loan up to")
                || lower.contains("get flat") || lower.contains("win up to") || lower.contains("click http"))
                && !lower.contains("debited") && !lower.contains("credited")) {
                return null;
            }

            if (!hasCompletionWord && !lower.contains("upi/") && !lower.contains("vpa")) {
                return null;
            }

            // 1. Parse Amount
            double amount = 0.0;
            Matcher mPrefix = AMOUNT_PATTERN_PREFIX.matcher(fullText);
            if (mPrefix.find()) {
                amount = parseDoubleSafe(mPrefix.group(1));
            } else {
                Matcher mSuffix = AMOUNT_PATTERN_SUFFIX.matcher(fullText);
                if (mSuffix.find()) {
                    amount = parseDoubleSafe(mSuffix.group(1));
                }
            }
            if (amount <= 0.0 || amount > 100000000.0) return null;

            // 2. Determine Transaction Status (completed, failed, reversed, pending)
            String status = "completed";
            if (lower.contains("failed") || lower.contains("declined") || lower.contains("unsuccessful") || lower.contains("could not be processed")) {
                status = "failed";
            } else if (lower.contains("reversed") || lower.contains("reversal")) {
                status = "reversed";
            } else if (lower.contains("pending") || lower.contains("processing") || lower.contains("initiated") || lower.contains("requested")) {
                status = "pending";
            }

            // 3. Determine Type: debit (expense), credit (income), refund, transfer
            boolean isRefund = lower.contains("refund") || lower.contains("reversed") || lower.contains("reversal") || lower.contains("cashback");
            boolean isSelfTransfer = lower.contains("self transfer") || lower.contains("to self") || lower.contains("own account") || lower.contains("between your accounts");
            boolean isCredit = lower.contains("credited") || lower.contains("received")
                || lower.contains("deposited") || lower.contains("added to your") || lower.contains("upi/cr/");
            boolean isDebit = lower.contains("debited") || lower.contains("spent")
                || lower.contains("paid") || lower.contains("sent")
                || lower.contains("withdrawn") || lower.contains("deducted")
                || lower.contains("trf to") || lower.contains("upi/dr/");

            String type = "debit";
            if (isSelfTransfer) {
                type = "transfer";
            } else if (isRefund) {
                type = "refund";
            } else if (isCredit && !isDebit) {
                type = "credit";
            }

            // 4. Extract UPI Slash Info (UPI/<Ref>/<Payee>/<Remark>)
            String refId = "";
            String upiSlashMerchant = "";
            String upiSlashNote = "";
            Matcher mUpiSlash = UPI_SLASH_PATTERN.matcher(fullText);
            if (mUpiSlash.find()) {
                refId = safeTrim(mUpiSlash.group(1));
                upiSlashMerchant = safeTrim(mUpiSlash.group(2));
                upiSlashNote = safeTrim(mUpiSlash.group(3));
            }

            if (refId.isEmpty()) {
                Matcher mRef = REF_PATTERN.matcher(fullText);
                if (mRef.find()) {
                    refId = safeTrim(mRef.group(1));
                }
            }

            // 5. Extract Merchant / Payee
            String merchant = "";
            boolean merchantUncertain = false;
            Matcher mMerch = MERCHANT_PATTERN.matcher(fullText);
            if (mMerch.find()) {
                merchant = cleanMerchantName(mMerch.group(1));
            }
            if (merchant.isEmpty() && !upiSlashMerchant.isEmpty()) {
                merchant = cleanMerchantName(upiSlashMerchant);
            }
            if (merchant.isEmpty() && title != null && !title.trim().isEmpty()) {
                String cleanTitle = title.trim();
                if (!cleanTitle.equalsIgnoreCase("Google Pay")
                    && !cleanTitle.equalsIgnoreCase("PhonePe")
                    && !cleanTitle.equalsIgnoreCase("Paytm")
                    && !cleanTitle.equalsIgnoreCase("BHIM")) {
                    merchant = cleanMerchantName(cleanTitle);
                }
            }
            if (merchant.isEmpty()) {
                merchantUncertain = true;
                if ("refund".equals(type)) merchant = "Refund / Reversal";
                else if ("transfer".equals(type)) merchant = "Self Account Transfer";
                else if ("credit".equals(type)) merchant = "Bank / UPI Credit";
                else merchant = "UPI / Merchant Payment";
            }

            // 6. Extract Original Payment Remark (never fabricated if missing!)
            String originalRemark = "";
            Matcher mNote = NOTE_EXPLICIT_PATTERN.matcher(fullText);
            if (mNote.find()) {
                originalRemark = cleanNoteText(mNote.group(1));
            }
            if (originalRemark.isEmpty() && !upiSlashNote.isEmpty()) {
                String candidate = cleanNoteText(upiSlashNote);
                if (!candidate.equalsIgnoreCase("upi")
                    && !candidate.equalsIgnoreCase("na")
                    && !candidate.equalsIgnoreCase("nil")
                    && !candidate.equalsIgnoreCase("payment")
                    && !candidate.matches("^[0-9]+$")) {
                    originalRemark = candidate;
                }
            }

            // 7. Identify Payment Method & App
            String app = detectPaymentApp(senderOrPkg, fullText);
            String paymentMethod = detectPaymentMethod(app, fullText);

            // 8. Auto-detect Category
            String category = detectCategory(merchant, originalRemark, fullText, type);

            // 9. Format Date & Time
            long ts = timestampMs > 0 ? timestampMs : System.currentTimeMillis();
            Date dt = new Date(ts);
            SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            isoFmt.setTimeZone(TimeZone.getDefault());
            SimpleDateFormat timeFmt = new SimpleDateFormat("HH:mm", Locale.US);
            timeFmt.setTimeZone(TimeZone.getDefault());

            String dateIso = isoFmt.format(dt);
            String timeHHMM = timeFmt.format(dt);

            // Deterministic ID using reference ID when available, or 2-minute bucket + amount + source
            String uniqueKey = !refId.isEmpty()
                ? "mob_ref_" + refId + "_" + Math.round(amount)
                : "mob_ts_" + (ts / 120000L) + "_" + Math.round(amount * 100);

            String reconciliationStatus = (merchantUncertain || !"completed".equals(status))
                ? "needs_review"
                : "auto_detected";

            JSONObject tx = new JSONObject();
            tx.put("id", uniqueKey);
            tx.put("currency", "INR");
            tx.put("amount", amount);
            tx.put("type", type);
            tx.put("status", status);
            tx.put("reconciliationStatus", reconciliationStatus);
            tx.put("merchant", merchant);
            tx.put("originalMerchant", merchant);
            tx.put("originalRemark", originalRemark);
            tx.put("paymentRemark", originalRemark);
            tx.put("note", originalRemark);
            tx.put("category", category);
            tx.put("app", app);
            tx.put("paymentMethod", paymentMethod);
            tx.put("refId", refId);
            tx.put("date", dateIso);
            tx.put("time", timeHHMM);
            tx.put("timestampMs", ts);
            tx.put("source", sourceType != null ? sourceType : "mobile-notification");
            // Privacy requirement: never persist full raw notification text
            tx.put("rawText", "");
            tx.put("updatedAtMs", ts);
            return tx;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static SecretKey getOrCreateAesKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEYSTORE_ALIAS)) {
            KeyStore.Entry entry = ks.getEntry(KEYSTORE_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(
            KEYSTORE_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return kg.generateKey();
    }

    public static String encryptJsonString(String plainText) {
        if (plainText == null) return "";
        try {
            SecretKey key = getOrCreateAesKey();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            byte[] iv = cipher.getIV();
            byte[] cipherBytes = cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8));
            return Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(cipherBytes, Base64.NO_WRAP);
        } catch (Exception ignored) {
            // Fail closed: never return plaintext if Android Keystore encryption fails
            return "";
        }
    }

    public static String decryptJsonString(String stored, String fallbackEmpty) {
        if (stored == null || stored.isEmpty()) return fallbackEmpty;
        try {
            int sep = stored.indexOf(':');
            if (sep <= 0) return fallbackEmpty;
            byte[] iv = Base64.decode(stored.substring(0, sep), Base64.NO_WRAP);
            byte[] cipherBytes = Base64.decode(stored.substring(sep + 1), Base64.NO_WRAP);
            SecretKey key = getOrCreateAesKey();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] plain = cipher.doFinal(cipherBytes);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            return fallbackEmpty;
        }
    }

    public static String loadEncryptedExpenseStoreJson(Context context) {
        if (context == null) return "{}";
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String encMap = prefs.getString(KEY_EXPENSE_STORE_MAP_ENC, "");
            if (encMap != null && !encMap.isEmpty()) {
                return decryptJsonString(encMap, "{}");
            }
            // Migrate any captured notification array into the encrypted map if present
            JSONArray captured = getSavedCapturedTransactions(context);
            if (captured.length() > 0) {
                JSONObject migrated = new JSONObject();
                for (int i = 0; i < captured.length(); i++) {
                    JSONObject item = captured.optJSONObject(i);
                    if (item == null) continue;
                    String id = item.optString("id", "");
                    if (!id.isEmpty()) {
                        item.put("rawText", "");
                        migrated.put(id, item);
                    }
                }
                saveEncryptedExpenseStoreJson(context, migrated.toString());
                return migrated.toString();
            }
            return "{}";
        } catch (Exception ignored) {
            return "{}";
        }
    }

    public static boolean saveEncryptedExpenseStoreJson(Context context, String plainJson) {
        if (context == null || plainJson == null) return false;
        try {
            String encrypted = encryptJsonString(plainJson);
            if (encrypted.isEmpty()) return false;
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                .putString(KEY_EXPENSE_STORE_MAP_ENC, encrypted)
                .remove(KEY_TXNS_LEGACY)
                .apply();
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    public static void saveCapturedTransaction(Context context, JSONObject tx) {
        if (context == null || tx == null) return;
        try {
            tx.put("rawText", "");
            JSONArray arr = getSavedCapturedTransactions(context);
            String id = tx.optString("id", "");
            String refId = tx.optString("refId", "");
            JSONArray next = new JSONArray();
            next.put(tx);
            for (int i = 0; i < arr.length() && next.length() < 500; i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) continue;
                item.put("rawText", "");
                boolean sameId = !id.isEmpty() && id.equals(item.optString("id", ""));
                boolean sameRef = !refId.isEmpty() && refId.equals(item.optString("refId", ""))
                    && Math.abs(tx.optDouble("amount", 0) - item.optDouble("amount", 0)) < 0.01;
                if (sameId || sameRef) {
                    if (tx.optString("note", "").isEmpty() && !item.optString("note", "").isEmpty()) {
                        tx.put("note", item.optString("note", ""));
                    }
                    if (tx.optString("originalRemark", "").isEmpty() && !item.optString("originalRemark", "").isEmpty()) {
                        tx.put("originalRemark", item.optString("originalRemark", ""));
                    }
                    continue;
                }
                next.put(item);
            }
            String encrypted = encryptJsonString(next.toString());
            if (!encrypted.isEmpty()) {
                SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                prefs.edit()
                    .putString(KEY_TXNS_ENC, encrypted)
                    .remove(KEY_TXNS_LEGACY)
                    .apply();
            }

            // Also merge into the encrypted Expense Memory map
            String currentMapJson = loadEncryptedExpenseStoreJson(context);
            JSONObject mapObj = new JSONObject(currentMapJson != null && !currentMapJson.isEmpty() ? currentMapJson : "{}");
            if (!id.isEmpty()) {
                mapObj.put(id, tx);
                saveEncryptedExpenseStoreJson(context, mapObj.toString());
            }
        } catch (Exception ignored) {}
    }

    public static JSONArray getSavedCapturedTransactions(Context context) {
        if (context == null) return new JSONArray();
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String enc = prefs.getString(KEY_TXNS_ENC, "");
            if (enc != null && !enc.isEmpty()) {
                return new JSONArray(decryptJsonString(enc, "[]"));
            }
            return new JSONArray();
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    public static void clearAllSavedTransactions(Context context) {
        if (context == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                .remove(KEY_TXNS_ENC)
                .remove(KEY_EXPENSE_STORE_MAP_ENC)
                .remove(KEY_TXNS_LEGACY)
                .apply();
        } catch (Exception ignored) {}
    }

    private static double parseDoubleSafe(String raw) {
        if (raw == null) return 0.0;
        try {
            return Double.parseDouble(raw.replace(",", "").trim());
        } catch (Exception e) {
            return 0.0;
        }
    }

    private static String safeTrim(String s) {
        return s == null ? "" : s.trim();
    }

    private static String cleanMerchantName(String raw) {
        if (raw == null) return "";
        String cleaned = raw.replaceAll("(?i)^(mr\\.?|mrs\\.?|ms\\.?|m/s)\\s+", "")
            .replaceAll("[\\r\\n]+", " ")
            .replaceAll("\\s{2,}", " ")
            .trim();
        if (cleaned.length() > 36) {
            cleaned = cleaned.substring(0, 36).trim();
        }
        return cleaned;
    }

    private static String cleanNoteText(String raw) {
        if (raw == null) return "";
        String cleaned = raw.replaceAll("[\\r\\n]+", " ")
            .replaceAll("\\s{2,}", " ")
            .trim();
        if (cleaned.length() > 80) {
            cleaned = cleaned.substring(0, 80).trim();
        }
        return cleaned;
    }

    private static String detectPaymentMethod(String app, String fullText) {
        String lower = (fullText != null ? fullText : "").toLowerCase(Locale.ROOT);
        if (lower.contains("credit card") || lower.contains("debit card") || lower.contains("pos ") || lower.contains("card ending")) {
            return "Card";
        }
        if (lower.contains("atm") || lower.contains("cash withdrawal")) {
            return "Cash / ATM";
        }
        if (lower.contains("neft") || lower.contains("imps") || lower.contains("rtgs")) {
            return "Bank Transfer";
        }
        if (app.contains("GPay") || app.contains("PhonePe") || app.contains("Paytm") || app.contains("BHIM") || lower.contains("upi") || lower.contains("vpa")) {
            return "UPI";
        }
        return "Bank Account";
    }

    private static String detectPaymentApp(String senderOrPkg, String fullText) {
        String s = ((senderOrPkg != null ? senderOrPkg : "") + " " + (fullText != null ? fullText : "")).toLowerCase(Locale.ROOT);
        if (s.contains("nbu.paisa") || s.contains("google pay") || s.contains("gpay") || s.contains("okaxis") || s.contains("okhdfcbank") || s.contains("okicici") || s.contains("oksbi")) {
            return "GPay";
        }
        if (s.contains("com.phonepe") || s.contains("phonepe") || s.contains("@ybl") || s.contains("@ibl") || s.contains("@axl")) {
            return "PhonePe";
        }
        if (s.contains("one97.paytm") || s.contains("paytm")) {
            return "Paytm";
        }
        if (s.contains("npci.upiapp") || s.contains("bhim")) {
            return "BHIM UPI";
        }
        if (s.contains("dreamplug") || s.contains("cred")) {
            return "CRED";
        }
        if (s.contains("amazon")) {
            return "Amazon Pay";
        }
        if (s.contains("hdfc")) return "HDFC Bank";
        if (s.contains("sbi")) return "SBI Bank";
        if (s.contains("icici")) return "ICICI Bank";
        if (s.contains("axis")) return "Axis Bank";
        if (s.contains("kotak")) return "Kotak Bank";
        if (s.contains("union")) return "Union Bank";
        if (s.contains("canara")) return "Canara Bank";
        if (s.contains("pnb")) return "PNB Bank";
        if (s.contains("bob") || s.contains("baroda")) return "Bank of Baroda";
        if (s.contains("upi")) return "UPI";
        return "Bank Notice";
    }

    private static String detectCategory(String merchant, String note, String fullText, String type) {
        if ("transfer".equalsIgnoreCase(type)) return "transfer";
        if ("refund".equalsIgnoreCase(type)) return "refund";
        if ("credit".equalsIgnoreCase(type)) {
            String c = (merchant + " " + note + " " + fullText).toLowerCase(Locale.ROOT);
            if (c.contains("salary") || c.contains("payroll")) return "salary";
            return "income";
        }
        String combined = (merchant + " " + note + " " + fullText).toLowerCase(Locale.ROOT);
        if (combined.matches(".*(swiggy|zomato|restaurant|cafe|tea|coffee|snack|bakery|hotel|food|lunch|dinner|breakfast|biryani|pizza|kfc|dominos|burger|tiffin|canteen).*")) {
            return "food";
        }
        if (combined.matches(".*(blinkit|zepto|instamart|bigbasket|dmart|reliance|supermarket|kirana|milk|vegetable|fruit|grocery|mart|dairy|meat|chicken).*")) {
            return "groceries";
        }
        if (combined.matches(".*(petrol|diesel|fuel|hpcl|bpcl|iocl|indian oil|bharat petroleum|shell|uber|ola|rapido|metro|irctc|bus|train|toll|fastag|auto|cab|parking|travel).*")) {
            return "fuel";
        }
        if (combined.matches(".*(amazon|flipkart|myntra|meesho|ajio|nykaa|zudio|shopping|mall|store|cloth|shoe|dress|fashion).*")) {
            return "shopping";
        }
        if (combined.matches(".*(jio|airtel|vi |bsnl|electricity|power|water|gas|cylinder|broadband|wifi|recharge|bill|dth|rent|emi|insurance).*")) {
            return "bills";
        }
        if (combined.matches(".*(apollo|medplus|pharmacy|medical|hospital|clinic|doctor|medicine|1mg|netmeds|health|lab).*")) {
            return "medical";
        }
        if (combined.matches(".*(netflix|spotify|youtube|bookmyshow|movie|cinema|hotstar|prime|game).*")) {
            return "entertainment";
        }
        if (combined.matches(".*(atm|cash withdrawal).*")) {
            return "cash";
        }
        return "transfer";
    }
}
