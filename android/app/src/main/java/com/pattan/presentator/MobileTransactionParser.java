package com.pattan.presentator;

import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class MobileTransactionParser {
    private static final String PREF_NAME = "pattan_expenses_native_store";
    private static final String KEY_TXNS = "captured_transactions_json";

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

    public static JSONObject parseSmsOrNotification(
        String senderOrPkg,
        String title,
        String body,
        long timestampMs,
        String sourceType
    ) {
        try {
            String fullText = ((title != null ? title + " " : "") + (body != null ? body : "")).trim();
            if (fullText.length() < 6) return null;

            String lower = fullText.toLowerCase(Locale.ROOT);

            // Ignore pure OTP / verification messages that are not real completed transactions
            boolean hasOtpWord = lower.contains("otp") || lower.contains("one time password") || lower.contains("verification code");
            boolean hasCompletionWord = lower.contains("debited") || lower.contains("credited")
                || lower.contains("paid") || lower.contains("sent ")
                || lower.contains("received") || lower.contains("spent")
                || lower.contains("withdrawn") || lower.contains("transferred");

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

            // 2. Determine Debit (Spent) vs Credit (Received)
            String type = "debit";
            boolean isCredit = lower.contains("credited") || lower.contains("received")
                || lower.contains("deposited") || lower.contains("refund")
                || lower.contains("added to your") || lower.contains("upi/cr/");
            boolean isDebit = lower.contains("debited") || lower.contains("spent")
                || lower.contains("paid") || lower.contains("sent")
                || lower.contains("withdrawn") || lower.contains("deducted")
                || lower.contains("trf to") || lower.contains("upi/dr/");
            if (isCredit && !isDebit) {
                type = "credit";
            }

            // 3. Extract UPI Slash Info (UPI/<Ref>/<Payee>/<Note>)
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

            // 4. Extract Merchant / Payee
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
                    && !cleanTitle.equalsIgnoreCase("PhonePe")
                    && !cleanTitle.equalsIgnoreCase("Paytm")) {
                    merchant = cleanMerchantName(cleanTitle);
                }
            }
            if (merchant.isEmpty()) {
                merchant = type.equals("credit") ? "Bank / UPI Credit" : "UPI / Merchant Spend";
            }

            // 5. Extract Transaction Note / Remark written during the transaction
            String note = "";
            Matcher mNote = NOTE_EXPLICIT_PATTERN.matcher(fullText);
            if (mNote.find()) {
                note = cleanNoteText(mNote.group(1));
            }
            if (note.isEmpty() && !upiSlashNote.isEmpty()) {
                String candidate = cleanNoteText(upiSlashNote);
                if (!candidate.equalsIgnoreCase("upi")
                    && !candidate.equalsIgnoreCase("na")
                    && !candidate.equalsIgnoreCase("nil")
                    && !candidate.matches("^[0-9]+$")) {
                    note = candidate;
                }
            }

            // 6. Identify Payment App / Bank Channel
            String app = detectPaymentApp(senderOrPkg, fullText);

            // 7. Auto-detect Category
            String category = detectCategory(merchant, note, fullText, type);

            // 8. Format Date & Time
            long ts = timestampMs > 0 ? timestampMs : System.currentTimeMillis();
            Date dt = new Date(ts);
            SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            isoFmt.setTimeZone(TimeZone.getDefault());
            SimpleDateFormat timeFmt = new SimpleDateFormat("HH:mm", Locale.US);
            timeFmt.setTimeZone(TimeZone.getDefault());

            String dateIso = isoFmt.format(dt);
            String timeHHMM = timeFmt.format(dt);

            // Deterministic ID so re-scanning never duplicates the same transaction
            String uniqueKey = !refId.isEmpty()
                ? "mob_ref_" + refId + "_" + Math.round(amount)
                : "mob_ts_" + (ts / 60000L) + "_" + Math.round(amount * 100);

            JSONObject tx = new JSONObject();
            tx.put("id", uniqueKey);
            tx.put("amount", amount);
            tx.put("type", type);
            tx.put("merchant", merchant);
            tx.put("note", note);
            tx.put("category", category);
            tx.put("app", app);
            tx.put("refId", refId);
            tx.put("date", dateIso);
            tx.put("time", timeHHMM);
            tx.put("timestampMs", ts);
            tx.put("source", sourceType != null ? sourceType : "mobile-sms");
            tx.put("rawText", fullText.length() > 280 ? fullText.substring(0, 280) : fullText);
            tx.put("updatedAtMs", ts);
            return tx;
        } catch (Exception ignored) {
            return null;
        }
    }

    public static void saveCapturedTransaction(Context context, JSONObject tx) {
        if (context == null || tx == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String existingRaw = prefs.getString(KEY_TXNS, "[]");
            JSONArray arr = new JSONArray(existingRaw);
            String id = tx.optString("id", "");
            JSONArray next = new JSONArray();
            next.put(tx);
            for (int i = 0; i < arr.length() && next.length() < 400; i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) continue;
                if (!id.isEmpty() && id.equals(item.optString("id", ""))) {
                    // Preserve user's custom note if already present
                    if (tx.optString("note", "").isEmpty() && !item.optString("note", "").isEmpty()) {
                        tx.put("note", item.optString("note", ""));
                    }
                    continue;
                }
                next.put(item);
            }
            prefs.edit().putString(KEY_TXNS, next.toString()).apply();
        } catch (Exception ignored) {}
    }

    public static JSONArray getSavedCapturedTransactions(Context context) {
        if (context == null) return new JSONArray();
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            return new JSONArray(prefs.getString(KEY_TXNS, "[]"));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    public static JSONArray scanSmsInbox(Context context, int daysBack) {
        JSONArray results = new JSONArray();
        if (context == null) return results;
        Cursor cursor = null;
        try {
            long cutoffMs = System.currentTimeMillis() - (Math.max(1, daysBack) * 86400000L);
            Uri uri = Uri.parse("content://sms/inbox");
            String[] projection = new String[]{"_id", "address", "body", "date"};
            String selection = "date >= ?";
            String[] selectionArgs = new String[]{String.valueOf(cutoffMs)};
            cursor = context.getContentResolver().query(uri, projection, selection, selectionArgs, "date DESC LIMIT 600");
            if (cursor != null) {
                int addrIdx = cursor.getColumnIndex("address");
                int bodyIdx = cursor.getColumnIndex("body");
                int dateIdx = cursor.getColumnIndex("date");
                while (cursor.moveToNext()) {
                    String address = addrIdx >= 0 ? cursor.getString(addrIdx) : "";
                    String body = bodyIdx >= 0 ? cursor.getString(bodyIdx) : "";
                    long dateMs = dateIdx >= 0 ? cursor.getLong(dateIdx) : System.currentTimeMillis();
                    JSONObject parsed = parseSmsOrNotification(address, "", body, dateMs, "mobile-sms");
                    if (parsed != null) {
                        results.put(parsed);
                    }
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) {
                try { cursor.close(); } catch (Exception ignored) {}
            }
        }
        return results;
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
        return "Bank SMS";
    }

    private static String detectCategory(String merchant, String note, String fullText, String type) {
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
