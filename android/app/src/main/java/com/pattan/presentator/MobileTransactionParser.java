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
    private static final String KEY_BANK_BALANCE_ENC = "bank_account_balance_enc_v1";
    private static final String KEY_TXNS_LEGACY = "captured_transactions_json";
    private static final String PERMANENT_VAULT_FILE = "permanent_expense_vault.enc";
    private static final String PERMANENT_BANK_BALANCE_FILE = "permanent_bank_balance.enc";
    private static final String PERMANENT_CAPTURED_ARRAY_FILE = "permanent_captured_txns.enc";
    private static final String KEYSTORE_ALIAS = "PattanExpenseMemoryAesKey";

    public static final Set<String> ALLOWED_PAYMENT_PACKAGES = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "com.google.android.apps.nbu.paisa.user",
        "com.google.android.apps.nbu.paisa.merchant",
        "com.phonepe.app",
        "com.phonepe.app.business",
        "net.one97.paytm",
        "net.one97.paytm.business",
        "in.org.npci.upiapp",
        "money.super.payments",
        "com.dreamplug.androidapp",
        "com.naviapp",
        "in.amazon.mShop.android.shopping",
        "in.amazon.mshop.android.shopping",
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
        "com.icicibank.imobile",
        "com.snapwork.hdfc",
        "com.Snapwork.hdfc",
        "com.hdfcbank.payzapp",
        "com.sbi.lotusintouch",
        "com.sbi.SBIFreedomPlus",
        "com.sbi.sbifreedomplus",
        "com.sbi.yono",
        "com.sbi.yonolite",
        "com.axis.mobile",
        "com.msf.kbank.mobile",
        "com.kotak811",
        "com.bankofbaroda.mconnect",
        "com.bob.world",
        "com.infrasofttech.CentralBank",
        "com.infrasofttech.centralbank",
        "com.infrasoft.uboi",
        "com.unionbank.ecommerce.mobile.android",
        "com.canarabank.mobility",
        "com.Version1",
        "com.version1",
        "com.pnb.one",
        "com.idfcfirstbank.optimus",
        "com.indusind.indie",
        "com.finopaymentbank.mobile",
        "com.rblbank.mobank",
        "com.yesbank",
        "com.iris.yesbank",
        "com.fedmobile",
        "com.federalbank.fedmobile",
        "com.ippb.mobilebanking",
        "com.indianbank.indall",
        "com.boi.mobile",
        "com.uco.mbs",
        "com.mahamobile",
        "com.kvb.mobilebanking",
        "com.cub.plus",
        "com.southindianbank.sibmirrorplus",
        "com.bandhan.mbandhan",
        "com.aubank.aumobile",
        "com.equitasbank.equitasmobile",
        "com.ujjivan.mobilebanking",
        "com.paytmbank.app",
        "com.google.android.apps.messaging",
        "com.samsung.android.messaging",
        "com.android.mms",
        "com.android.mms.service",
        "com.miui.smsextra",
        "com.coloros.mms",
        "com.oplus.mms",
        "com.oneplus.mms",
        "com.vivo.message",
        "com.asus.message",
        "com.motorola.messaging",
        "com.sonyericsson.conversations",
        "com.google.android.ims"
    )));

    private static final Pattern BALANCE_PATTERN = Pattern.compile(
        "(?i)(?:avl\\.?\\s*bal(?:ance)?|available\\s*bal(?:ance)?|avbl\\.?\\s*bal(?:ance)?|clear\\s*bal(?:ance)?|updated\\s*bal(?:ance)?|closing\\s*bal(?:ance)?|new\\s*bal(?:ance)?|a/c\\s*bal(?:ance)?|acct\\s*bal(?:ance)?|total\\s*bal(?:ance)?|\\bbal(?:ance)?\\s*(?:is|:|=))\\s*(?:is)?\\s*[:\\-=]?\\s*(?:₹|rs\\.?|inr)?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)"
    );
    private static final Pattern ACCOUNT_MASK_PATTERN = Pattern.compile(
        "(?i)(?:a/c|ac|acct|account)\\s*(?:no\\.?|ending|linked|with)?\\s*[xX*\\.\\-#]*([0-9]{3,6})\\b"
    );
    private static final Pattern AMOUNT_PATTERN_VERB = Pattern.compile(
        "(?i)(?:debited|credited|paid|sent|received|spent|transferred|deducted|deposited|withdrawn|added|deposit\\s+of|credit\\s+of|debit\\s+of|payment\\s+of)\\s+(?:by|for|with|of|to|from|in)?\\s*(?:₹|rs\\.?|inr)?\\s*[:\\-]?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)"
    );
    private static final Pattern AMOUNT_PATTERN_VERB_AFTER = Pattern.compile(
        "(?i)(?:₹|rs\\.?|inr)?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)\\s+(?:has\\s+been\\s+|is\\s+|was\\s+)?(?:debited|credited|paid|sent|received|spent|transferred|deducted|deposited|withdrawn|added)"
    );
    private static final Pattern AMOUNT_PATTERN_PREFIX = Pattern.compile(
        "(?i)(?:₹|rs\\.?|inr|amt)\\s*[:\\-]?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)"
    );
    private static final Pattern AMOUNT_PATTERN_SUFFIX = Pattern.compile(
        "(?i)([0-9,]+(?:\\.[0-9]{1,2})?)\\s*(?:rs\\.?|inr|₹)"
    );
    private static final Pattern REF_PATTERN = Pattern.compile(
        "(?i)(?:upi\\s*(?:ref)?(?:\\s*no\\.?|\\s*id)?|utr|ref(?:erence)?(?:\\s*no\\.?)?|txn\\s*(?:id|no\\.?)?|rrn)\\s*[:\\-/]?\\s*([0-9]{9,14})"
    );
    private static final Pattern UPI_SLASH_PATTERN = Pattern.compile(
        "(?i)UPI/(?:CR/|DR/)?([0-9]{9,14})(?:/([^/\\n\\r]{2,40}))?(?:/([^/\\n\\r]{2,60}))?"
    );
    private static final Pattern NOTE_EXPLICIT_PATTERN = Pattern.compile(
        "(?i)(?:note|remarks?|purpose|for|comment|message|description)\\s*[:\\-]\\s*([^\\n\\r.;]{2,80})"
    );
    private static final Pattern MERCHANT_PATTERN = Pattern.compile(
        "(?i)(?:paid\\s+to|sent\\s+to|trf\\s+to|transferred\\s+to|to\\s+vpa|received\\s+from|from\\s+vpa|deposited\\s+by|deposited\\s+at|credited\\s+by|at|towards|from|to)\\s+([A-Za-z0-9@._\\-\\s&]{2,38}?)(?=\\s+(?:is\\s+pending|on|ref|upi|utr|txn|via|for|note|remarks|a/c|ac|acct|avl|bal|using|from|in\\s+your|\\.|,|\\n|$))"
    );

    private MobileTransactionParser() {}

    public static boolean isAllowedPaymentPackage(String packageName) {
        if (packageName == null) return false;
        String clean = packageName.trim();
        if (clean.isEmpty()) return false;
        String lower = clean.toLowerCase(Locale.ROOT);
        if (ALLOWED_PAYMENT_PACKAGES.contains(clean) || ALLOWED_PAYMENT_PACKAGES.contains(lower)) {
            return true;
        }
        // Reject non-financial / social / entertainment / gaming packages
        if (lower.contains("instagram") || lower.contains("facebook") || lower.contains("snapchat")
            || lower.contains("youtube") || lower.contains("game") || lower.contains("spotify")
            || lower.contains("netflix") || lower.contains("twitter") || lower.contains("telegram")
            || lower.contains("discord") || lower.contains("linkedin")) {
            return false;
        }
        // Allow OEM SMS / Messaging / Banking / UPI packages
        return lower.endsWith(".mms")
            || lower.contains(".mms.")
            || lower.contains("messaging")
            || lower.contains("smsextra")
            || lower.contains("paisa")
            || lower.contains("phonepe")
            || lower.contains("paytm")
            || lower.contains("upiapp")
            || lower.contains("bhim")
            || lower.contains("imobile")
            || lower.contains("hdfc")
            || lower.contains("sbi.")
            || lower.contains("icici")
            || lower.contains("axis")
            || lower.contains("kotak")
            || lower.contains("baroda")
            || lower.contains("canarabank")
            || lower.contains("unionbank")
            || lower.contains("idfc")
            || lower.contains("indusind")
            || lower.contains("yesbank")
            || lower.contains("federalbank")
            || lower.contains("fedmobile")
            || lower.contains("rblbank")
            || lower.contains("finopayment")
            || lower.contains("ippb");
    }

    public static boolean looksLikeFinancialNotification(String packageName, String title, String body) {
        if (packageName == null) return false;
        String lowerPkg = packageName.trim().toLowerCase(Locale.ROOT);
        if (lowerPkg.contains("whatsapp") || lowerPkg.contains("instagram") || lowerPkg.contains("facebook") || lowerPkg.contains("snapchat")
            || lowerPkg.contains("youtube") || lowerPkg.contains("game") || lowerPkg.contains("spotify")
            || lowerPkg.contains("netflix")) {
            return false;
        }
        String text = ((title != null ? title : "") + " " + (body != null ? body : "")).toLowerCase(Locale.ROOT);
        boolean hasCurrencyOrBank = text.contains("₹") || text.contains("rs.") || text.contains("rs ")
            || text.contains("inr ") || text.contains("a/c") || text.contains("acct") || text.contains("upi");
        boolean hasTxnVerb = text.contains("debited") || text.contains("credited")
            || text.contains("deposited") || text.contains("paid to") || text.contains("received from")
            || text.contains("money sent") || text.contains("money received") || text.contains("avl bal")
            || text.contains("available balance") || text.contains("upi/");
        return hasCurrencyOrBank && hasTxnVerb;
    }

    public static JSONObject parseSmsOrNotification(
        String senderOrPkg,
        String title,
        String body,
        long timestampMs,
        String sourceType
    ) {
        try {
            if (senderOrPkg != null && senderOrPkg.toLowerCase(Locale.ROOT).contains("whatsapp")) {
                return null;
            }
            // When called from notification listener, enforce package allow-list
            if ("mobile-notification".equalsIgnoreCase(sourceType) && !isAllowedPaymentPackage(senderOrPkg)) {
                return null;
            }

            String fullText = ((title != null ? title + " " : "") + (body != null ? body : "")).trim();
            if (fullText.length() < 6) return null;

            String lower = fullText.toLowerCase(Locale.ROOT);
            if (lower.contains("whatsapp") || lower.contains("daily ot") || lower.contains("today's shift")
                || lower.contains("worked time") || lower.contains("today's payment details")
                || lower.contains("attendance statement") || lower.contains("your time is completed")) {
                return null;
            }

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
                || lower.contains("deducted") || lower.contains("trf to") || lower.contains("trf from")
                || lower.contains("deposited") || lower.contains("deposit of") || lower.contains("cash deposit")
                || lower.contains("added to") || lower.contains("money added")
                || lower.contains("credit of") || lower.contains("debit of")
                || lower.contains("payment of") || lower.contains("payment to") || lower.contains("payment from")
                || lower.contains("payment received") || lower.contains("payment successful") || lower.contains("payment completed")
                || lower.contains("money sent") || lower.contains("money received")
                || lower.contains("you paid") || lower.contains("you received")
                || lower.contains("refund") || lower.contains("reversed")
                || lower.contains("failed") || lower.contains("declined")
                || lower.contains("pending") || lower.contains("processing");

            if (hasOtpWord && !hasCompletionWord) return null;

            // Ignore promotional offers / loan spam
            if ((lower.contains("pre-approved") || lower.contains("apply now") || lower.contains("loan up to")
                || lower.contains("get flat") || lower.contains("win up to") || lower.contains("click http"))
                && !lower.contains("debited") && !lower.contains("credited") && !lower.contains("paid")
                && !lower.contains("deposited") && !lower.contains("received")) {
                return null;
            }

            if (!hasCompletionWord && !lower.contains("upi/") && !lower.contains("vpa")) {
                return null;
            }

            // 0. Extract Available Bank Balance (Avl Bal) & Account Mask FIRST, and strip Balance from amount search text
            double accountBalance = -1.0;
            String textWithoutBalance = fullText;
            Matcher mBal = BALANCE_PATTERN.matcher(fullText);
            if (mBal.find()) {
                double parsedBal = parseDoubleSafe(mBal.group(1));
                if (parsedBal >= 0.0 && parsedBal <= 1000000000.0) {
                    accountBalance = parsedBal;
                }
                textWithoutBalance = mBal.replaceAll(" ");
            }

            String accountMask = "";
            Matcher mMask = ACCOUNT_MASK_PATTERN.matcher(fullText);
            if (mMask.find()) {
                String digits = safeTrim(mMask.group(1));
                if (digits.length() > 4) {
                    digits = digits.substring(digits.length() - 4);
                }
                accountMask = "XX" + digits;
            }

            // 1. Parse Transaction Amount from textWithoutBalance
            double amount = 0.0;
            Matcher mPrefix = AMOUNT_PATTERN_PREFIX.matcher(textWithoutBalance);
            if (mPrefix.find()) {
                amount = parseDoubleSafe(mPrefix.group(1));
            }
            if (amount <= 0.0) {
                Matcher mVerb = AMOUNT_PATTERN_VERB.matcher(textWithoutBalance);
                if (mVerb.find()) {
                    amount = parseDoubleSafe(mVerb.group(1));
                }
            }
            if (amount <= 0.0) {
                Matcher mVerbAfter = AMOUNT_PATTERN_VERB_AFTER.matcher(textWithoutBalance);
                if (mVerbAfter.find()) {
                    amount = parseDoubleSafe(mVerbAfter.group(1));
                }
            }
            if (amount <= 0.0) {
                Matcher mSuffix = AMOUNT_PATTERN_SUFFIX.matcher(textWithoutBalance);
                if (mSuffix.find()) {
                    amount = parseDoubleSafe(mSuffix.group(1));
                }
            }
            if (amount <= 0.0 || amount > 100000000.0) return null;

            // 2. Determine Transaction Status (completed, failed, reversed, pending)
            boolean hasExplicitSuccess = lower.contains("debited") || lower.contains("credited")
                || lower.contains("deposited") || lower.contains("paid") || lower.contains("received")
                || lower.contains("sent") || lower.contains("successful") || lower.contains("completed");
            String status = "completed";
            if (lower.contains("failed") || lower.contains("declined") || lower.contains("unsuccessful") || lower.contains("could not be processed")) {
                status = "failed";
            } else if (lower.contains("reversed") || lower.contains("reversal")) {
                status = "reversed";
            } else if (lower.contains("is pending") || lower.contains("pending processing") || lower.contains("payment pending")
                || ((!hasExplicitSuccess) && (lower.contains("pending") || lower.contains("processing")))) {
                status = "pending";
            }

            // 3. Determine Type: debit (expense), credit (income/deposit), refund, transfer
            boolean isRefund = lower.contains("refund") || lower.contains("reversed") || lower.contains("reversal") || lower.contains("cashback");
            boolean isSelfTransfer = lower.contains("self transfer") || lower.contains("to self") || lower.contains("own account") || lower.contains("between your accounts");
            boolean hasStrongCredit = lower.contains("credited") || lower.contains("deposited")
                || lower.contains("deposit of") || lower.contains("cash deposit")
                || lower.contains("received from") || lower.contains("money received")
                || lower.contains("you received") || lower.contains("payment received")
                || lower.contains("added to your") || lower.contains("upi/cr/");
            boolean hasStrongDebit = lower.contains("debited") || lower.contains("withdrawn")
                || lower.contains("deducted") || lower.contains("spent")
                || lower.contains("paid to") || lower.contains("sent to")
                || lower.contains("money sent") || lower.contains("you paid")
                || lower.contains("trf to") || lower.contains("upi/dr/")
                || lower.contains("payment of") || lower.contains("payment to");
            boolean isCredit = hasStrongCredit || lower.contains("received") || lower.contains("credit");
            boolean isDebit = hasStrongDebit || lower.contains("paid") || lower.contains("sent") || lower.contains("debit");

            String type = "debit";
            if (isSelfTransfer) {
                type = "transfer";
            } else if (isRefund) {
                type = "refund";
            } else if (hasStrongCredit && !hasStrongDebit) {
                type = "credit";
            } else if (hasStrongDebit && !hasStrongCredit) {
                type = "debit";
            } else if (isCredit && !isDebit) {
                type = "credit";
            } else if (lower.startsWith("received") || lower.startsWith("credited") || lower.startsWith("deposited") || lower.contains("money received")) {
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

            // 6. Extract Merchant / Payee / Depositor
            String merchant = "";
            Matcher mMerch = MERCHANT_PATTERN.matcher(textWithoutBalance);
            if (mMerch.find()) {
                String candidateMerch = cleanMerchantName(mMerch.group(1));
                if (!candidateMerch.equalsIgnoreCase("your a/c")
                    && !candidateMerch.equalsIgnoreCase("your account")
                    && !candidateMerch.equalsIgnoreCase("your bank")
                    && !candidateMerch.toLowerCase(Locale.ROOT).startsWith("a/c ")) {
                    merchant = candidateMerch;
                }
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
                else if ("credit".equals(type)) merchant = !app.equals("Bank Notice") ? app + " Deposit / Credit" : "Bank Deposit / Credit";
                else merchant = !app.equals("Bank Notice") ? app + " Payment" : "UPI Payment";
            }

            // 7. Extract Original Payment Remark (never fabricated if missing!)
            String originalRemark = "";
            Matcher mNote = NOTE_EXPLICIT_PATTERN.matcher(textWithoutBalance);
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

            // 9. Format Date & Time (also extracting explicit date from SMS/notification text if present)
            long ts = timestampMs > 0 ? timestampMs : System.currentTimeMillis();
            Date dt = new Date(ts);
            SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            isoFmt.setTimeZone(TimeZone.getDefault());
            SimpleDateFormat timeFmt = new SimpleDateFormat("HH:mm", Locale.US);
            timeFmt.setTimeZone(TimeZone.getDefault());

            String dateIso = isoFmt.format(dt);
            String timeHHMM = timeFmt.format(dt);

            Matcher mIsoDate = Pattern.compile("\\b(20\\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])\\b").matcher(fullText);
            Matcher mDmyDate = Pattern.compile("\\b(0?[1-9]|[12]\\d|3[01])[\\/-](0?[1-9]|1[0-2])[\\/-](20\\d{2}|\\d{2})\\b").matcher(fullText);
            if (mIsoDate.find()) {
                dateIso = mIsoDate.group(1) + "-" + mIsoDate.group(2) + "-" + mIsoDate.group(3);
            } else if (mDmyDate.find()) {
                String dd = mDmyDate.group(1).length() == 1 ? "0" + mDmyDate.group(1) : mDmyDate.group(1);
                String mm = mDmyDate.group(2).length() == 1 ? "0" + mDmyDate.group(2) : mDmyDate.group(2);
                String yr = mDmyDate.group(3).length() == 2 ? "20" + mDmyDate.group(3) : mDmyDate.group(3);
                dateIso = yr + "-" + mm + "-" + dd;
            } else if (lower.contains("yesterday")) {
                dateIso = isoFmt.format(new Date(ts - 86400000L));
            }

            // Deterministic ID including transaction type (debit vs credit) so ₹100 payment & ₹100 deposit never collide!
            String uniqueKey = !refId.isEmpty()
                ? "mob_ref_" + type + "_" + refId + "_" + Math.round(amount)
                : "mob_ts_" + type + "_" + (ts / 30000L) + "_" + Math.round(amount * 100);

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
            tx.put("accountMask", accountMask);
            if (accountBalance >= 0.0) {
                tx.put("accountBalance", accountBalance);
            }
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

    private static String readNoBackupEncryptedFile(Context context, String fileName) {
        if (context == null || fileName == null) return "";
        try {
            File f = new File(context.getNoBackupFilesDir(), fileName);
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

    private static void writeNoBackupEncryptedFile(Context context, String fileName, String encrypted) {
        if (context == null || fileName == null || encrypted == null || encrypted.isEmpty()) return;
        try {
            File f = new File(context.getNoBackupFilesDir(), fileName);
            try (FileOutputStream fos = new FileOutputStream(f, false)) {
                fos.write(encrypted.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
        } catch (Exception ignored) {}
    }

    private static String readPermanentVaultEncrypted(Context context) {
        return readNoBackupEncryptedFile(context, PERMANENT_VAULT_FILE);
    }

    private static void writePermanentVaultEncrypted(Context context, String encrypted) {
        writeNoBackupEncryptedFile(context, PERMANENT_VAULT_FILE, encrypted);
    }

    private static void mergeCleanJsonIntoMap(JSONObject target, String plainJson) {
        if (target == null || plainJson == null || plainJson.isEmpty()) return;
        try {
            JSONObject rawObj = new JSONObject(plainJson);
            java.util.Iterator<String> keys = rawObj.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                if (k == null || k.startsWith("demo_tx_") || k.startsWith("tx_yasin_master_")) continue;
                JSONObject v = rawObj.optJSONObject(k);
                String src = v != null ? v.optString("source", "") : "";
                if (v != null && !"demo-preview".equals(src) && !"owner-master-vault".equals(src)) {
                    v.put("_deleted", false);
                    v.put("rawText", "");
                    if (target.has(k)) {
                        JSONObject existing = target.optJSONObject(k);
                        if (existing != null) {
                            long existingUpdatedAt = existing.optLong("updatedAtMs", 0L);
                            long incomingUpdatedAt = v.optLong("updatedAtMs", 0L);
                            boolean existingUserConfirmed = "user_confirmed".equalsIgnoreCase(existing.optString("detectionStatus", ""))
                                || existing.optBoolean("noteReviewed", false)
                                || !existing.optString("personalNote", "").isEmpty();
                            boolean incomingUserConfirmed = "user_confirmed".equalsIgnoreCase(v.optString("detectionStatus", ""))
                                || v.optBoolean("noteReviewed", false);

                            // If existing record has a newer timestamp or user-confirmed edits and incoming is an older auto-scan,
                            // keep existing as primary so user edits (note, merchant, category, amount, tags) are NEVER lost!
                            if (existingUpdatedAt > incomingUpdatedAt || (existingUserConfirmed && !incomingUserConfirmed && incomingUpdatedAt <= existingUpdatedAt)) {
                                if (existing.optString("refId", "").isEmpty() && !v.optString("refId", "").isEmpty()) {
                                    existing.put("refId", v.optString("refId", ""));
                                }
                                if (existing.optString("accountMask", "").isEmpty() && !v.optString("accountMask", "").isEmpty()) {
                                    existing.put("accountMask", v.optString("accountMask", ""));
                                }
                                if (!existing.has("accountBalance") && v.has("accountBalance")) {
                                    existing.put("accountBalance", v.optDouble("accountBalance", 0.0));
                                }
                                if (existing.optString("originalRemark", "").isEmpty() && !v.optString("originalRemark", "").isEmpty()) {
                                    existing.put("originalRemark", v.optString("originalRemark", ""));
                                }
                                existing.put("_deleted", false);
                                existing.put("rawText", "");
                                target.put(k, existing);
                                continue;
                            }

                            // Otherwise incoming is newer/equal: still preserve existing non-empty notes/metadata if incoming is blank
                            if (v.optString("personalNote", "").isEmpty() && !existing.optString("personalNote", "").isEmpty()) {
                                v.put("personalNote", existing.optString("personalNote", ""));
                            }
                            if (v.optString("note", "").isEmpty() && !existing.optString("note", "").isEmpty()) {
                                v.put("note", existing.optString("note", ""));
                            }
                            if (v.optString("originalRemark", "").isEmpty() && !existing.optString("originalRemark", "").isEmpty()) {
                                v.put("originalRemark", existing.optString("originalRemark", ""));
                            }
                            if (v.optString("refId", "").isEmpty() && !existing.optString("refId", "").isEmpty()) {
                                v.put("refId", existing.optString("refId", ""));
                            }
                            if (v.optString("accountMask", "").isEmpty() && !existing.optString("accountMask", "").isEmpty()) {
                                v.put("accountMask", existing.optString("accountMask", ""));
                            }
                            if (!v.has("accountBalance") && existing.has("accountBalance")) {
                                v.put("accountBalance", existing.optDouble("accountBalance", 0.0));
                            }
                            if (existing.optBoolean("noteReviewed", false)) {
                                v.put("noteReviewed", true);
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

            // 2b. Also merge any expenses stored in the patanyasin144@gmail.com owner profile vault
            try {
                String ownerVaultPlain = getSavedProfileVaultJson(context, "patanyasin144@gmail.com");
                if (ownerVaultPlain != null && !ownerVaultPlain.isEmpty() && !"{}".equals(ownerVaultPlain)) {
                    JSONObject ownerVaultObj = new JSONObject(ownerVaultPlain);
                    JSONObject ownerExp = ownerVaultObj.optJSONObject("expenses");
                    if (ownerExp != null) {
                        mergeCleanJsonIntoMap(mapObj, ownerExp.toString());
                    }
                }
            } catch (Exception ignored) {}

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

    public static String getSavedBankBalanceJson(Context context) {
        if (context == null) return "{}";
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String enc = prefs.getString(KEY_BANK_BALANCE_ENC, "");
            if (enc != null && !enc.isEmpty()) {
                String plain = decryptJsonString(enc, "{}");
                if (!"{}".equals(plain)) return plain;
            }
            String fileEnc = readNoBackupEncryptedFile(context, PERMANENT_BANK_BALANCE_FILE);
            if (fileEnc != null && !fileEnc.isEmpty()) {
                return decryptJsonString(fileEnc, "{}");
            }
            return "{}";
        } catch (Exception ignored) {
            return "{}";
        }
    }

    public static boolean saveBankBalanceJson(Context context, String plainJson) {
        if (context == null || plainJson == null) return false;
        try {
            JSONObject obj = new JSONObject(plainJson);
            String encrypted = encryptJsonString(obj.toString());
            if (encrypted.isEmpty()) return false;
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                .putString(KEY_BANK_BALANCE_ENC, encrypted)
                .apply();
            writeNoBackupEncryptedFile(context, PERMANENT_BANK_BALANCE_FILE, encrypted);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String sanitizeEmailKey(String email) {
        if (email == null) return "default";
        String clean = email.trim().toLowerCase().replaceAll("[^a-z0-9._@-]", "_");
        return clean.isEmpty() ? "default" : clean;
    }

    public static String getSavedProfileVaultJson(Context context, String email) {
        if (context == null) return "{}";
        try {
            String keySuffix = sanitizeEmailKey(email);
            String prefKey = "pattan_profile_vault_enc_" + keySuffix;
            String fileName = "pattan_profile_vault_" + keySuffix + ".enc";
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String enc = prefs.getString(prefKey, "");
            if (enc != null && !enc.isEmpty()) {
                String plain = decryptJsonString(enc, "{}");
                if (!"{}".equals(plain)) return plain;
            }
            String fileEnc = readNoBackupEncryptedFile(context, fileName);
            if (fileEnc != null && !fileEnc.isEmpty()) {
                return decryptJsonString(fileEnc, "{}");
            }
            return "{}";
        } catch (Exception ignored) {
            return "{}";
        }
    }

    public static boolean saveProfileVaultJson(Context context, String email, String plainJson) {
        if (context == null || plainJson == null) return false;
        try {
            String keySuffix = sanitizeEmailKey(email);
            String prefKey = "pattan_profile_vault_enc_" + keySuffix;
            String fileName = "pattan_profile_vault_" + keySuffix + ".enc";
            JSONObject incomingVault = new JSONObject(plainJson);

            // Preserve all existing transactions in this profile vault additively (never delete transactions)
            String existingPlain = getSavedProfileVaultJson(context, email);
            if (existingPlain != null && !existingPlain.isEmpty() && !"{}".equals(existingPlain)) {
                try {
                    JSONObject existingVault = new JSONObject(existingPlain);
                    JSONObject mergedExpenses = new JSONObject();
                    JSONObject exExp = existingVault.optJSONObject("expenses");
                    if (exExp != null) {
                        mergeCleanJsonIntoMap(mergedExpenses, exExp.toString());
                    }
                    JSONObject inExp = incomingVault.optJSONObject("expenses");
                    if (inExp != null) {
                        mergeCleanJsonIntoMap(mergedExpenses, inExp.toString());
                    }
                    incomingVault.put("expenses", mergedExpenses);
                } catch (Exception ignored) {}
            }

            String encrypted = encryptJsonString(incomingVault.toString());
            if (encrypted.isEmpty()) return false;
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(prefKey, encrypted).apply();
            writeNoBackupEncryptedFile(context, fileName, encrypted);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    public static JSONObject extractAndSaveStandaloneBalance(
        Context context,
        String senderOrPkg,
        String title,
        String body,
        long timestampMs
    ) {
        if (context == null) return null;
        try {
            if (!isAllowedPaymentPackage(senderOrPkg) && !looksLikeFinancialNotification(senderOrPkg, title, body)) {
                return null;
            }
            String fullText = ((title != null ? title + " " : "") + (body != null ? body : "")).trim();
            if (fullText.length() < 6) return null;
            Matcher mBal = BALANCE_PATTERN.matcher(fullText);
            if (!mBal.find()) return null;
            double bal = parseDoubleSafe(mBal.group(1));
            if (bal < 0.0 || bal > 1000000000.0) return null;

            String accountMask = "";
            Matcher mMask = ACCOUNT_MASK_PATTERN.matcher(fullText);
            if (mMask.find()) {
                String digits = safeTrim(mMask.group(1));
                if (digits.length() > 4) digits = digits.substring(digits.length() - 4);
                accountMask = "XX" + digits;
            }
            String bankApp = detectPaymentApp(senderOrPkg, fullText);
            long ts = timestampMs > 0 ? timestampMs : System.currentTimeMillis();

            JSONObject balObj = new JSONObject();
            balObj.put("balance", bal);
            balObj.put("bankName", bankApp);
            balObj.put("accountMask", accountMask);
            balObj.put("updatedAtMs", ts);
            balObj.put("source", "auto-notification");
            saveBankBalanceJson(context, balObj.toString());
            return balObj;
        } catch (Exception ignored) {
            return null;
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
            String txType = tx.optString("type", "debit");
            boolean alreadyExisted = false;

            JSONArray next = new JSONArray();
            next.put(tx);
            for (int i = 0; i < arr.length() && next.length() < 10000; i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) continue;
                item.put("rawText", "");
                item.put("_deleted", false);
                String itemType = item.optString("type", "debit");
                boolean sameType = txType.equalsIgnoreCase(itemType);
                boolean sameId = !id.isEmpty() && id.equals(item.optString("id", ""));
                boolean sameRef = sameType && !refId.isEmpty() && refId.equals(item.optString("refId", ""))
                    && Math.abs(tx.optDouble("amount", 0) - item.optDouble("amount", 0)) < 0.01;
                if (sameId || sameRef) {
                    alreadyExisted = true;
                    if (tx.optString("personalNote", "").isEmpty() && !item.optString("personalNote", "").isEmpty()) {
                        tx.put("personalNote", item.optString("personalNote", ""));
                    }
                    if (tx.optString("note", "").isEmpty() && !item.optString("note", "").isEmpty()) {
                        tx.put("note", item.optString("note", ""));
                    }
                    if (tx.optString("originalRemark", "").isEmpty() && !item.optString("originalRemark", "").isEmpty()) {
                        tx.put("originalRemark", item.optString("originalRemark", ""));
                    }
                    if (!tx.has("accountBalance") && item.has("accountBalance")) {
                        tx.put("accountBalance", item.optDouble("accountBalance", 0));
                    }
                    if (item.optBoolean("noteReviewed", false)) {
                        tx.put("noteReviewed", true);
                    }
                    if ("user_confirmed".equalsIgnoreCase(item.optString("detectionStatus", "")) || item.optLong("updatedAtMs", 0L) > tx.optLong("updatedAtMs", 0L)) {
                        if (!item.optString("merchant", "").isEmpty()) tx.put("merchant", item.optString("merchant", ""));
                        if (!item.optString("category", "").isEmpty()) tx.put("category", item.optString("category", ""));
                        if (!item.optString("personalNote", "").isEmpty()) tx.put("personalNote", item.optString("personalNote", ""));
                        if (!item.optString("note", "").isEmpty()) tx.put("note", item.optString("note", ""));
                        tx.put("detectionStatus", item.optString("detectionStatus", "user_confirmed"));
                        tx.put("updatedAtMs", item.optLong("updatedAtMs", System.currentTimeMillis()));
                    }
                    continue;
                }
                next.put(item);
            }

            // Update or compute live running bank balance when transaction is completed
            if ("completed".equalsIgnoreCase(tx.optString("status", "completed"))) {
                double explicitBal = tx.optDouble("accountBalance", -1.0);
                long ts = tx.optLong("timestampMs", System.currentTimeMillis());
                if (explicitBal >= 0.0) {
                    JSONObject balObj = new JSONObject();
                    balObj.put("balance", explicitBal);
                    balObj.put("bankName", tx.optString("app", "Bank Account"));
                    balObj.put("accountMask", tx.optString("accountMask", ""));
                    balObj.put("updatedAtMs", ts);
                    balObj.put("source", "sms-avl-bal");
                    saveBankBalanceJson(context, balObj.toString());
                } else if (!alreadyExisted) {
                    try {
                        JSONObject currentBalObj = new JSONObject(getSavedBankBalanceJson(context));
                        if (currentBalObj.has("balance")) {
                            double prevBal = currentBalObj.optDouble("balance", 0.0);
                            double amt = tx.optDouble("amount", 0.0);
                            double newBal = prevBal;
                            if ("credit".equalsIgnoreCase(txType) || "refund".equalsIgnoreCase(txType)) {
                                newBal = Math.round((prevBal + amt) * 100.0) / 100.0;
                            } else if ("debit".equalsIgnoreCase(txType)) {
                                newBal = Math.max(0.0, Math.round((prevBal - amt) * 100.0) / 100.0);
                            }
                            tx.put("accountBalance", newBal);
                            currentBalObj.put("balance", newBal);
                            currentBalObj.put("updatedAtMs", ts);
                            currentBalObj.put("source", "live-auto-calc");
                            saveBankBalanceJson(context, currentBalObj.toString());
                        }
                    } catch (Exception ignored) {}
                }
            }

            String encrypted = encryptJsonString(next.toString());
            if (!encrypted.isEmpty()) {
                SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                prefs.edit()
                    .putString(KEY_TXNS_ENC, encrypted)
                    .remove(KEY_TXNS_LEGACY)
                    .apply();
                writeNoBackupEncryptedFile(context, PERMANENT_CAPTURED_ARRAY_FILE, encrypted);
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
                JSONArray arr = new JSONArray(decryptJsonString(enc, "[]"));
                if (arr.length() > 0) return arr;
            }
            String fileEnc = readNoBackupEncryptedFile(context, PERMANENT_CAPTURED_ARRAY_FILE);
            if (fileEnc != null && !fileEnc.isEmpty()) {
                return new JSONArray(decryptJsonString(fileEnc, "[]"));
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
        if (s.contains("com.dreamplug") || s.contains("dreamplug")) {
            return "UPI";
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
