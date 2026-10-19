package com.pattan.presentator;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
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
    private static final String PERMANENT_VAULT_FILE = "permanent_expense_vault.enc";
    private static final String KEYSTORE_ALIAS = "PattanExpenseMemoryAesKey";

    public static final Set<String> ALLOWED_PAYMENT_PACKAGES = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "com.google.android.apps.nbu.paisa.user",
        "com.phonepe.app",
        "net.one97.paytm",
        "in.org.npci.upiapp",
        "money.super.payments",
        "com.dreamplug.androidapp",
        "com.naviapp",
        "in.amazon.mShop.android.shopping",
        "in.amazon.mshop.android.shopping",
        "com.whatsapp",
        "com.whatsapp.w4b",
        "com.mobikwik_new",
        "com.freecharge.android",
        "indwin.c3.shareapp",
        "com.fampay.in",
        "money.jupiter",
        "com.epifi.paisa",
        "com.tatadigital.tcp",
        "org.altruist.BajajExperia",
        "org.altruist.bajajexperia",
        "com.samsung.android.spay",
        "com.samsung.android.spaymini",
        "com.myairtelapp",
        "com.airtel.PaymentsBank",
        "com.airtel.paymentsbank",
        "com.jio.myjio",
        "com.csam.icici.bank.imobile",
        "com.snapwork.hdfc",
        "com.Snapwork.hdfc",
        "com.sbi.lotusintouch",
        "com.sbi.SBIFreedomPlus",
        "com.sbi.sbifreedomplus",
        "com.axis.mobile",
        "com.msf.kbank.mobile",
        "com.bankofbaroda.mconnect",
        "com.bob.world",
        "com.infrasofttech.CentralBank",
        "com.infrasofttech.centralbank",
        "com.infrasoft.uboi",
        "com.canarabank.mobility",
        "com.Version1",
        "com.version1",
        "com.idfcfirstbank.optimus",
        "com.indusind.indie",
        "com.finopaymentbank.mobile",
        "com.rblbank.mobank",
        "com.yesbank",
        "com.iris.yesbank",
        "com.fedmobile",
        "com.federalbank.fedmobile",
        "com.ippb.mobilebanking",
        "com.google.android.apps.messaging",
        "com.samsung.android.messaging",
        "com.android.mms"
    )));

    private static final Pattern AMOUNT_PATTERN_PREFIX = Pattern.compile(
        "(?i)(?:₹|rs\\.?|inr|amt)\\s*[:\\-]?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)"
    );
    private static final Pattern AMOUNT_PATTERN_SUFFIX = Pattern.compile(
        "(?i)([0-9,]+(?:\\.[0-9]{1,2})?)\\s*(?:rs\\.?|inr|₹)"
    );
    private static final Pattern AMOUNT_PATTERN_VERB = Pattern.compile(
        "(?i)(?:debited|credited|paid|sent|received|spent|transferred|deducted)\\s+(?:by|for|with|of)?\\s*(?:₹|rs\\.?|inr)?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)"
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
        "(?i)(?:paid\\s+to|sent\\s+to|trf\\s+to|transferred\\s+to|to\\s+vpa|received\\s+from|from\\s+vpa|at|towards|to)\\s+([A-Za-z0-9@._\\-\\s&]{2,38}?)(?=\\s+(?:is\\s+pending|on|ref|upi|utr|txn|via|for|note|remarks|a/c|ac|acct|avl|bal|using|from|\\.|,|\\n|$))"
    );

    private MobileTransactionParser() {}

    public static boolean isAllowedPaymentPackage(String packageName) {
        if (packageName == null) return false;
        String clean = packageName.trim();
        if (clean.isEmpty()) return false;
        return ALLOWED_PAYMENT_PACKAGES.contains(clean) || ALLOWED_PAYMENT_PACKAGES.contains(clean.toLowerCase(Locale.ROOT));
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
                || lower.contains("paid") || lower.contains("sent")
                || lower.contains("received") || lower.contains("spent")
                || lower.contains("withdrawn") || lower.contains("transferred")
                || lower.contains("deducted") || lower.contains("trf to")
                || lower.contains("payment of") || lower.contains("payment to")
                || lower.contains("payment successful") || lower.contains("payment completed")
                || lower.contains("money sent") || lower.contains("money received")
                || lower.contains("refund") || lower.contains("reversed")
                || lower.contains("failed") || lower.contains("declined")
                || lower.contains("pending") || lower.contains("processing");

            if (hasOtpWord && !hasCompletionWord) return null;

            // Ignore promotional offers / loan spam
            if ((lower.contains("pre-approved") || lower.contains("apply now") || lower.contains("loan up to")
                || lower.contains("get flat") || lower.contains("win up to") || lower.contains("click http"))
                && !lower.contains("debited") && !lower.contains("credited") && !lower.contains("paid")) {
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
                } else {
                    Matcher mVerb = AMOUNT_PATTERN_VERB.matcher(fullText);
                    if (mVerb.find()) {
                        amount = parseDoubleSafe(mVerb.group(1));
                    }
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
                || lower.contains("deposited") || lower.contains("added to your") || lower.contains("upi/cr/")
                || lower.contains("money received");
            boolean isDebit = lower.contains("debited") || lower.contains("spent")
                || lower.contains("paid") || lower.contains("sent")
                || lower.contains("withdrawn") || lower.contains("deducted")
                || lower.contains("trf to") || lower.contains("upi/dr/")
                || lower.contains("payment of") || lower.contains("payment to") || lower.contains("money sent");

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

            // 5. Identify Payment App & Method
            String app = detectPaymentApp(senderOrPkg, fullText);
            String paymentMethod = detectPaymentMethod(app, fullText);

            // 6. Extract Merchant / Payee
            String merchant = "";
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
                    && !cleanTitle.equalsIgnoreCase("GPay")
                    && !cleanTitle.equalsIgnoreCase("PhonePe")
                    && !cleanTitle.equalsIgnoreCase("Paytm")
                    && !cleanTitle.equalsIgnoreCase("BHIM")
                    && !cleanTitle.equalsIgnoreCase("Super.money")
                    && !cleanTitle.equalsIgnoreCase("CRED")
                    && !cleanTitle.equalsIgnoreCase("Navi")) {
                    merchant = cleanMerchantName(cleanTitle);
                }
            }
            if (merchant.isEmpty()) {
                if ("refund".equals(type)) merchant = "Refund / Reversal";
                else if ("transfer".equals(type)) merchant = "Self Account Transfer";
                else if ("credit".equals(type)) merchant = !app.equals("Bank Notice") ? app + " Received" : "UPI / Bank Credit";
                else merchant = !app.equals("Bank Notice") ? app + " Payment" : "UPI Payment";
            }

            // 7. Extract Original Payment Remark (never fabricated if missing!)
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

            String reconciliationStatus = !"completed".equals(status)
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

    private static String readPermanentVaultEncrypted(Context context) {
        if (context == null) return "";
        try {
            File f = new File(context.getNoBackupFilesDir(), PERMANENT_VAULT_FILE);
            if (!f.exists() || f.length() <= 0) return "";
            byte[] buf = new byte[(int) f.length()];
            try (FileInputStream fis = new FileInputStream(f)) {
                int read = fis.read(buf);
                if (read > 0) {
                    return new String(buf, 0, read, StandardCharsets.UTF_8);
                }
            }
        } catch (Exception ignored) {}
        return "";
    }

    private static void writePermanentVaultEncrypted(Context context, String encrypted) {
        if (context == null || encrypted == null || encrypted.isEmpty()) return;
        try {
            File f = new File(context.getNoBackupFilesDir(), PERMANENT_VAULT_FILE);
            try (FileOutputStream fos = new FileOutputStream(f, false)) {
                fos.write(encrypted.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
        } catch (Exception ignored) {}
    }

    private static void mergeCleanJsonIntoMap(JSONObject target, String plainJson) {
        if (target == null || plainJson == null || plainJson.isEmpty()) return;
        try {
            JSONObject rawObj = new JSONObject(plainJson);
            java.util.Iterator<String> keys = rawObj.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                if (k == null || k.startsWith("demo_tx_")) continue;
                JSONObject v = rawObj.optJSONObject(k);
                if (v != null && !"demo-preview".equals(v.optString("source", ""))) {
                    v.put("_deleted", false);
                    v.put("rawText", "");
                    if (target.has(k)) {
                        JSONObject existing = target.optJSONObject(k);
                        if (existing != null) {
                            // Preserve existing note/purpose if incoming is empty
                            if (v.optString("personalNote", "").isEmpty() && !existing.optString("personalNote", "").isEmpty()) {
                                v.put("personalNote", existing.optString("personalNote", ""));
                            }
                            if (v.optString("note", "").isEmpty() && !existing.optString("note", "").isEmpty()) {
                                v.put("note", existing.optString("note", ""));
                            }
                        }
                    }
                    target.put(k, v);
                }
            }
        } catch (Exception ignored) {}
    }

    public static String loadEncryptedExpenseStoreJson(Context context) {
        if (context == null) return "{}";
        try {
            JSONObject mapObj = new JSONObject();

            // 1. Load from permanent file vault first
            String fileEnc = readPermanentVaultEncrypted(context);
            if (fileEnc != null && !fileEnc.isEmpty()) {
                mergeCleanJsonIntoMap(mapObj, decryptJsonString(fileEnc, "{}"));
            }

            // 2. Load from SharedPreferences encrypted map
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String encMap = prefs.getString(KEY_EXPENSE_STORE_MAP_ENC, "");
            if (encMap != null && !encMap.isEmpty()) {
                mergeCleanJsonIntoMap(mapObj, decryptJsonString(encMap, "{}"));
            }

            // 3. Merge any captured notification array into the encrypted map
            JSONArray captured = getSavedCapturedTransactions(context);
            boolean changed = false;
            for (int i = 0; i < captured.length(); i++) {
                JSONObject item = captured.optJSONObject(i);
                if (item == null) continue;
                String id = item.optString("id", "");
                if (!id.isEmpty() && !id.startsWith("demo_tx_") && !mapObj.has(id)) {
                    item.put("rawText", "");
                    item.put("_deleted", false);
                    mapObj.put(id, item);
                    changed = true;
                }
            }
            if (changed) {
                saveEncryptedExpenseStoreJson(context, mapObj.toString());
            }
            return mapObj.toString();
        } catch (Exception ignored) {
            return "{}";
        }
    }

    public static boolean saveEncryptedExpenseStoreJson(Context context, String plainJson) {
        if (context == null || plainJson == null) return false;
        try {
            // Permanent append-/update-only ledger: never delete existing transactions
            JSONObject merged = new JSONObject();
            String fileEnc = readPermanentVaultEncrypted(context);
            if (fileEnc != null && !fileEnc.isEmpty()) {
                mergeCleanJsonIntoMap(merged, decryptJsonString(fileEnc, "{}"));
            }
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String existingPrefEnc = prefs.getString(KEY_EXPENSE_STORE_MAP_ENC, "");
            if (existingPrefEnc != null && !existingPrefEnc.isEmpty()) {
                mergeCleanJsonIntoMap(merged, decryptJsonString(existingPrefEnc, "{}"));
            }
            mergeCleanJsonIntoMap(merged, plainJson);

            String encrypted = encryptJsonString(merged.toString());
            if (encrypted.isEmpty()) return false;
            prefs.edit()
                .putString(KEY_EXPENSE_STORE_MAP_ENC, encrypted)
                .remove(KEY_TXNS_LEGACY)
                .apply();
            writePermanentVaultEncrypted(context, encrypted);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    public static void saveCapturedTransaction(Context context, JSONObject tx) {
        if (context == null || tx == null) return;
        try {
            tx.put("rawText", "");
            tx.put("_deleted", false);
            JSONArray arr = getSavedCapturedTransactions(context);
            String id = tx.optString("id", "");
            String refId = tx.optString("refId", "");
            JSONArray next = new JSONArray();
            next.put(tx);
            for (int i = 0; i < arr.length() && next.length() < 500; i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) continue;
                item.put("rawText", "");
                item.put("_deleted", false);
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
            JSONObject singleMap = new JSONObject();
            if (!id.isEmpty()) {
                singleMap.put(id, tx);
                saveEncryptedExpenseStoreJson(context, singleMap.toString());
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
            // Never delete real transactions — only remove legacy plaintext key if present
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            prefs.edit()
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
        if (app.contains("GPay") || app.contains("PhonePe") || app.contains("Paytm") || app.contains("BHIM")
            || app.contains("Super.money") || app.contains("CRED") || app.contains("Navi")
            || app.contains("Amazon Pay") || app.contains("WhatsApp") || app.contains("MobiKwik")
            || app.contains("Freecharge") || app.contains("slice") || app.contains("FamPay")
            || app.contains("Jupiter") || app.contains("Fi Money") || app.contains("Tata Neu")
            || app.contains("Bajaj") || app.contains("Samsung Pay") || app.contains("JioPay")
            || lower.contains("upi") || lower.contains("vpa")) {
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
        if (s.contains("money.super") || s.contains("super.money") || s.contains("supermoney")) {
            return "Super.money";
        }
        if (s.contains("dreamplug") || s.contains("cred")) {
            return "CRED";
        }
        if (s.contains("naviapp") || s.contains("navi ")) {
            return "Navi UPI";
        }
        if (s.contains("amazon")) {
            return "Amazon Pay";
        }
        if (s.contains("whatsapp")) {
            return "WhatsApp Pay";
        }
        if (s.contains("mobikwik")) {
            return "MobiKwik";
        }
        if (s.contains("freecharge")) {
            return "Freecharge";
        }
        if (s.contains("indwin") || s.contains("slice")) {
            return "slice UPI";
        }
        if (s.contains("fampay")) {
            return "FamPay";
        }
        if (s.contains("jupiter")) {
            return "Jupiter";
        }
        if (s.contains("epifi") || s.contains("fi money")) {
            return "Fi Money";
        }
        if (s.contains("tatadigital") || s.contains("tata neu")) {
            return "Tata Neu";
        }
        if (s.contains("bajaj")) {
            return "Bajaj Pay";
        }
        if (s.contains("spay") || s.contains("samsung pay")) {
            return "Samsung Pay";
        }
        if (s.contains("myjio") || s.contains("jiopay")) {
            return "JioPay";
        }
        if (s.contains("airtel")) return "Airtel Pay";
        if (s.contains("hdfc")) return "HDFC Bank";
        if (s.contains("sbi")) return "SBI Bank";
        if (s.contains("icici")) return "ICICI Bank";
        if (s.contains("axis")) return "Axis Bank";
        if (s.contains("kotak")) return "Kotak Bank";
        if (s.contains("union") || s.contains("uboi")) return "Union Bank";
        if (s.contains("canara")) return "Canara Bank";
        if (s.contains("pnb") || s.contains("version1")) return "PNB Bank";
        if (s.contains("bob") || s.contains("baroda")) return "Bank of Baroda";
        if (s.contains("idfc")) return "IDFC FIRST Bank";
        if (s.contains("indusind")) return "IndusInd Bank";
        if (s.contains("fedmobile") || s.contains("federal")) return "Federal Bank";
        if (s.contains("yesbank")) return "YES Bank";
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
