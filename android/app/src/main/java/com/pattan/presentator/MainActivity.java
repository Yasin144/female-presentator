package com.pattan.presentator;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.HapticFeedbackConstants;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

public class MainActivity extends BridgeActivity {
    private static final int REQ_DEVICE_CREDENTIAL = 9421;
    private static final String WA_PREF_NAME = "pattan_wa_secure_relay";
    private static final String OTA_PREF_NAME = "pattan_live_ota_prefs";
    private static final String OTA_JS_FILE = "pattan_live_ota_bundle.js";
    private static final String OTA_CSS_FILE = "pattan_live_ota_bundle.css";
    private static final String BUILTIN_OTA_VERSION = "8.2.32";

    private static final String UDHAAR_OTA_PREF_NAME = "udhaar_standalone_ota_prefs";
    private static final String UDHAAR_OTA_JS_FILE = "udhaar_standalone_ota_bundle.js";
    private static final String UDHAAR_OTA_CSS_FILE = "udhaar_standalone_ota_bundle.css";
    private static final String BUILTIN_UDHAAR_OTA_VERSION = "1.0.9";

    private String pendingBioActionType = "in";
    private long lastRootBackPressMs = 0L;

    private boolean isUdhaarStandalonePackage() {
        try {
            String pkg = getPackageName();
            return pkg != null && pkg.toLowerCase().contains("udhaar");
        } catch (Exception ignored) {
            return false;
        }
    }

    private String getActiveOtaPrefName() {
        return isUdhaarStandalonePackage() ? UDHAAR_OTA_PREF_NAME : OTA_PREF_NAME;
    }

    private String getActiveOtaJsFile() {
        return isUdhaarStandalonePackage() ? UDHAAR_OTA_JS_FILE : OTA_JS_FILE;
    }

    private String getActiveOtaCssFile() {
        return isUdhaarStandalonePackage() ? UDHAAR_OTA_CSS_FILE : OTA_CSS_FILE;
    }

    private String getActiveBuiltinOtaVersion() {
        return isUdhaarStandalonePackage() ? BUILTIN_UDHAAR_OTA_VERSION : BUILTIN_OTA_VERSION;
    }

    private final BroadcastReceiver paymentNotifReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null) return;
            String txJson = intent.getStringExtra("tx_json");
            String balJson = intent.getStringExtra("balance_json");
            if (txJson != null && !txJson.isEmpty()) {
                try {
                    JSONObject single = new JSONObject(txJson);
                    JSONArray arr = new JSONArray();
                    arr.put(single);
                    dispatchMobileTransactionsToJs(true, arr, "");
                } catch (Exception ignored) {}
            } else if (balJson != null && !balJson.isEmpty()) {
                dispatchMobileTransactionsToJs(true, new JSONArray(), "");
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            long apkUpdateTime = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
            SharedPreferences otaPrefs = getSharedPreferences(getActiveOtaPrefName(), Context.MODE_PRIVATE);
            long savedApkTime = otaPrefs.getLong("apk_last_update_time", 0L);
            if (apkUpdateTime > savedApkTime) {
                java.io.File otaJs = new java.io.File(getNoBackupFilesDir(), getActiveOtaJsFile());
                java.io.File otaCss = new java.io.File(getNoBackupFilesDir(), getActiveOtaCssFile());
                if (otaJs.exists()) otaJs.delete();
                if (otaCss.exists()) otaCss.delete();
                otaPrefs.edit()
                    .putLong("apk_last_update_time", apkUpdateTime)
                    .putString("ota_version", getActiveBuiltinOtaVersion())
                    .putString("ota_build_id", "")
                    .apply();
            }
        } catch (Exception ignored) {}
        try {
            if (getWindow() != null) {
                int execNavy = android.graphics.Color.parseColor("#070C18");
                getWindow().setStatusBarColor(execNavy);
                getWindow().setNavigationBarColor(execNavy);
            }
        } catch (Exception ignored) {}
        bridge.setWebViewClient(new RecoveringWebViewClient());
        if (bridge != null && bridge.getWebView() != null) {
            WebView wv = bridge.getWebView();
            try {
                wv.setBackgroundColor(android.graphics.Color.parseColor("#070C18"));
            } catch (Exception ignored) {}
            wv.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE);
            wv.getSettings().setMediaPlaybackRequiresUserGesture(false);
            wv.clearCache(true);
            PattanBiometricBridge bioBridge = new PattanBiometricBridge();
            wv.addJavascriptInterface(bioBridge, "PattanBiometric");
            wv.addJavascriptInterface(bioBridge, "PattanBiometricBridge");
            wv.addJavascriptInterface(new PattanSecureWhatsAppBridge(), "PattanSecureWhatsApp");
            if (isUdhaarStandalonePackage()) {
                try {
                    wv.evaluateJavascript("window.__UDHAAR_ONLY_APK__ = true;", null);
                } catch (Exception ignored) {}
                wv.loadUrl(bridge.getLocalUrl() + "/?app=udhaar");
            } else {
                wv.reload();
            }
        }
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleSmartBackGesture();
            }
        });
        if (!isUdhaarStandalonePackage()) {
            try {
                IntentFilter filter = new IntentFilter(PaymentNotificationService.ACTION_MOBILE_TXN);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    registerReceiver(paymentNotifReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
                    if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 9501);
                    }
                } else {
                    registerReceiver(paymentNotifReceiver, filter);
                }
            } catch (Exception ignored) {}
            try {
                OfficeEndAlarmReceiver.ensureChannel(getApplicationContext());
                OfficeEndAlarmReceiver.scheduleFromSavedPrefs(getApplicationContext());
            } catch (Exception ignored) {}
            handleIncomingSharedReceiptIntent(getIntent());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (!isUdhaarStandalonePackage()) {
            handleIncomingSharedReceiptIntent(intent);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().resumeTimers();
        }
        if (!isUdhaarStandalonePackage()) {
            performMobileTransactionScanAsync();
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().resumeTimers();
        }
    }

    private void handleIncomingSharedReceiptIntent(Intent intent) {
        if (intent == null) return;
        try {
            if (Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
                String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (sharedText != null && !sharedText.trim().isEmpty()) {
                    JSONObject parsed = MobileTransactionParser.parseSmsOrNotification(
                        "shared-receipt",
                        "Shared Receipt",
                        sharedText.trim(),
                        System.currentTimeMillis(),
                        "receipt-share"
                    );
                    if (parsed != null) {
                        MobileTransactionParser.saveCapturedTransaction(getApplicationContext(), parsed);
                        JSONArray arr = new JSONArray();
                        arr.put(parsed);
                        if (bridge != null && bridge.getWebView() != null) {
                            bridge.getWebView().postDelayed(() -> dispatchMobileTransactionsToJs(true, arr, ""), 800);
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        try {
            unregisterReceiver(paymentNotifReceiver);
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    private boolean isNotifListenerEnabledInternal() {
        try {
            String flat = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
            return flat != null && flat.contains(getPackageName());
        } catch (Exception ignored) {
            return false;
        }
    }

    private void performMobileTransactionScanAsync() {
        new Thread(() -> {
            try {
                // Sweep any currently active and snoozed status-bar notifications first
                PaymentNotificationService.rescanActiveNotificationsNow();

                JSONArray combined = new JSONArray();
                Set<String> seenIds = new HashSet<>();

                JSONArray savedNotifs = MobileTransactionParser.getSavedCapturedTransactions(getApplicationContext());
                for (int i = 0; i < savedNotifs.length(); i++) {
                    JSONObject item = savedNotifs.optJSONObject(i);
                    if (item == null) continue;
                    String id = item.optString("id", "");
                    if (!id.isEmpty() && seenIds.add(id)) {
                        combined.put(item);
                    }
                }

                // Also merge all transactions from the encrypted permanent expense vault & profile vaults
                try {
                    String vaultRaw = MobileTransactionParser.loadEncryptedExpenseStoreJson(getApplicationContext());
                    if (vaultRaw != null && !vaultRaw.isEmpty() && !"{}".equals(vaultRaw)) {
                        JSONObject vaultObj = new JSONObject(vaultRaw);
                        java.util.Iterator<String> keys = vaultObj.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            if (k == null || k.startsWith("demo_tx_") || k.startsWith("tx_yasin_master_")) continue;
                            JSONObject tx = vaultObj.optJSONObject(k);
                            if (tx == null || tx.optBoolean("_deleted", false)) continue;
                            String id = tx.optString("id", k);
                            if (!id.isEmpty() && seenIds.add(id)) {
                                combined.put(tx);
                            }
                        }
                    }
                } catch (Exception ignored) {}

                dispatchMobileTransactionsToJs(true, combined, "");
            } catch (Exception ex) {
                dispatchMobileTransactionsToJs(false, new JSONArray(), String.valueOf(ex.getMessage()));
            }
        }).start();
    }

    private void dispatchMobileTransactionsToJs(boolean ok, JSONArray transactions, String error) {
        if (bridge == null || bridge.getWebView() == null) return;
        try {
            JSONObject payload = new JSONObject();
            payload.put("ok", ok);
            payload.put("smsGranted", false);
            payload.put("notifGranted", isNotifListenerEnabledInternal());
            payload.put("transactions", transactions != null ? transactions : new JSONArray());
            try {
                String balRaw = MobileTransactionParser.getSavedBankBalanceJson(getApplicationContext());
                if (balRaw != null && !balRaw.isEmpty()) {
                    payload.put("bankBalance", new JSONObject(balRaw));
                }
            } catch (Exception ignored) {}
            payload.put("error", error != null ? error : "");
            payload.put("timestamp", System.currentTimeMillis());
            final String js = "window.dispatchEvent(new CustomEvent('pattan-mobile-transactions', { detail: " + payload.toString() + " }));";
            bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(js, null));
        } catch (Exception ignored) {}
    }

    private void handleSmartBackGesture() {
        if (bridge == null || bridge.getWebView() == null) {
            finish();
            return;
        }
        final WebView webView = bridge.getWebView();
        final String js = "(function(){"
            + "try {"
            + "  if (typeof window.__handlePattanHardwareBack === 'function') {"
            + "    return String(window.__handlePattanHardwareBack() || '');"
            + "  }"
            + "} catch (e) {}"
            + "return '';"
            + "})()";
        webView.evaluateJavascript(js, value -> {
            String clean = value == null ? "" : value.replace("\"", "").trim();
            if ("handled".equalsIgnoreCase(clean)) {
                triggerNativeVibrate(25);
                lastRootBackPressMs = 0L;
                return;
            }
            if (!isUdhaarStandalonePackage() && webView.canGoBack()) {
                webView.goBack();
                triggerNativeVibrate(25);
                lastRootBackPressMs = 0L;
                return;
            }
            long now = System.currentTimeMillis();
            if (now - lastRootBackPressMs < 2200L) {
                moveTaskToBack(true);
            } else {
                lastRootBackPressMs = now;
                triggerNativeVibrate(35);
                Toast.makeText(MainActivity.this, "Swipe back again to close app", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_DEVICE_CREDENTIAL) {
            if (resultCode == Activity.RESULT_OK) {
                triggerNativeVibrate(95);
                sendBiometricEventToJs(pendingBioActionType, true, false, "android-device-unlock", "");
            } else {
                sendBiometricEventToJs(pendingBioActionType, false, false, "canceled", "Phone unlock was cancelled");
            }
        }
    }

    private void triggerNativeVibrate(final int durationMs) {
        try {
            final int ms = Math.max(20, Math.min(400, durationMs));
            runOnUiThread(() -> {
                try {
                    if (bridge != null && bridge.getWebView() != null) {
                        bridge.getWebView().performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
                    }
                } catch (Exception ignored) {}
            });
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(ms);
                }
            }
        } catch (Exception ignored) {}
    }

    private void sendBiometricEventToJs(String actionType, boolean ok, boolean fallback, String method, String error) {
        if (bridge == null || bridge.getWebView() == null) return;
        try {
            JSONObject payload = new JSONObject();
            payload.put("actionType", actionType != null ? actionType : "auto");
            payload.put("ok", ok);
            payload.put("fallback", fallback);
            payload.put("method", method != null ? method : "biometric");
            payload.put("error", error != null ? error : "");
            payload.put("timestamp", System.currentTimeMillis());
            final String js = "window.dispatchEvent(new CustomEvent('pattan-biometric-result', { detail: " + payload.toString() + " }));";
            bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(js, null));
        } catch (Exception ignored) {}
    }

    @SuppressWarnings("deprecation")
    private boolean launchKeyguardFallback(String actionType, String title, String subtitle) {
        try {
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null && km.isDeviceSecure()) {
                Intent intent = km.createConfirmDeviceCredentialIntent(
                    title != null && !title.isEmpty() ? title : "Unlock Phone to Punch Attendance",
                    subtitle != null && !subtitle.isEmpty() ? subtitle : "Use your phone fingerprint or screen lock"
                );
                if (intent != null) {
                    pendingBioActionType = actionType != null ? actionType : "in";
                    startActivityForResult(intent, REQ_DEVICE_CREDENTIAL);
                    return true;
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    public final class PattanBiometricBridge {
        @JavascriptInterface
        public boolean isHardwareAvailable() {
            try {
                boolean hasFingerprint = getPackageManager().hasSystemFeature(PackageManager.FEATURE_FINGERPRINT);
                KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
                boolean secure = km != null && km.isDeviceSecure();
                return hasFingerprint || secure;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean isSmsPermissionGranted() {
            return false;
        }

        @JavascriptInterface
        public boolean hasSmsPermission() {
            return false;
        }

        @JavascriptInterface
        public boolean isNotificationListenerEnabled() {
            return isNotifListenerEnabledInternal();
        }

        @JavascriptInterface
        public void openNotificationListenerSettings() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception ignored) {}
            });
        }

        @JavascriptInterface
        public void openAppDetailsSettings() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.fromParts("package", getPackageName(), null));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception ignored) {}
            });
        }

        @JavascriptInterface
        public String loadEncryptedExpenseStoreJson() {
            PaymentNotificationService.rescanActiveNotificationsNow();
            return MobileTransactionParser.loadEncryptedExpenseStoreJson(getApplicationContext());
        }

        @JavascriptInterface
        public boolean saveEncryptedExpenseStoreJson(final String plainJson) {
            return MobileTransactionParser.saveEncryptedExpenseStoreJson(getApplicationContext(), plainJson);
        }

        @JavascriptInterface
        public String getSavedMobileTransactionsJson() {
            try {
                PaymentNotificationService.rescanActiveNotificationsNow();
                JSONArray arr = MobileTransactionParser.getSavedCapturedTransactions(getApplicationContext());
                return arr != null ? arr.toString() : "[]";
            } catch (Exception ignored) {
                return "[]";
            }
        }

        @JavascriptInterface
        public String getBankBalanceJson() {
            try {
                return MobileTransactionParser.getSavedBankBalanceJson(getApplicationContext());
            } catch (Exception ignored) {
                return "{}";
            }
        }

        @JavascriptInterface
        public boolean saveBankBalanceJson(final String plainJson) {
            try {
                return MobileTransactionParser.saveBankBalanceJson(getApplicationContext(), plainJson);
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public String getProfileVaultJson(final String email) {
            try {
                return MobileTransactionParser.getSavedProfileVaultJson(getApplicationContext(), email);
            } catch (Exception ignored) {
                return "{}";
            }
        }

        @JavascriptInterface
        public boolean saveProfileVaultJson(final String email, final String plainJson) {
            try {
                return MobileTransactionParser.saveProfileVaultJson(getApplicationContext(), email, plainJson);
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean shareVaultToEmail(final String email, final String subject, final String bodyText) {
            runOnUiThread(() -> {
                try {
                    String targetEmail = (email != null && !email.trim().isEmpty()) ? email.trim() : "patanyasin144@gmail.com";
                    Intent sendIntent = new Intent(Intent.ACTION_SEND);
                    sendIntent.setType("text/plain");
                    sendIntent.putExtra(Intent.EXTRA_EMAIL, new String[]{targetEmail});
                    sendIntent.putExtra(Intent.EXTRA_SUBJECT, subject != null ? subject : "Yasin OT & Expense Master Vault Sync (" + targetEmail + ")");
                    sendIntent.putExtra(Intent.EXTRA_TEXT, bodyText != null ? bodyText : "");
                    Intent chooser = Intent.createChooser(sendIntent, "Sync / Backup Vault to " + targetEmail);
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(chooser);
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "Vault saved locally for " + email, Toast.LENGTH_SHORT).show();
                }
            });
            return true;
        }

        @JavascriptInterface
        public boolean openUpiAppForBalanceCheck(final String appKey) {
            runOnUiThread(() -> {
                try {
                    String key = appKey != null ? appKey.trim().toLowerCase() : "";
                    String[] candidates;
                    if (key.contains("gpay") || key.contains("google")) {
                        candidates = new String[]{"com.google.android.apps.nbu.paisa.user", "com.phonepe.app", "net.one97.paytm", "in.org.npci.upiapp"};
                    } else if (key.contains("phonepe")) {
                        candidates = new String[]{"com.phonepe.app", "com.google.android.apps.nbu.paisa.user", "net.one97.paytm", "in.org.npci.upiapp"};
                    } else if (key.contains("paytm")) {
                        candidates = new String[]{"net.one97.paytm", "com.google.android.apps.nbu.paisa.user", "com.phonepe.app", "in.org.npci.upiapp"};
                    } else if (key.contains("bhim")) {
                        candidates = new String[]{"in.org.npci.upiapp", "com.google.android.apps.nbu.paisa.user", "com.phonepe.app", "net.one97.paytm"};
                    } else {
                        candidates = new String[]{"com.google.android.apps.nbu.paisa.user", "com.phonepe.app", "net.one97.paytm", "in.org.npci.upiapp", "money.super.payments", "com.dreamplug.androidapp"};
                    }
                    PackageManager pm = getPackageManager();
                    for (String pkg : candidates) {
                        Intent launch = pm.getLaunchIntentForPackage(pkg);
                        if (launch != null) {
                            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            Toast.makeText(MainActivity.this, "Opening UPI App to Check Bank Balance...", Toast.LENGTH_SHORT).show();
                            startActivity(launch);
                            return;
                        }
                    }
                    Intent upiView = new Intent(Intent.ACTION_VIEW, Uri.parse("upi://pay"));
                    Intent chooser = Intent.createChooser(upiView, "Open UPI App to Check Balance");
                    startActivity(chooser);
                } catch (Exception ignored) {}
            });
            return true;
        }

        @JavascriptInterface
        public void scanMobileTransactions(final int daysBack) {
            performMobileTransactionScanAsync();
        }

        @JavascriptInterface
        public void scanMobileTransactionsSilent(final int daysBack) {
            performMobileTransactionScanAsync();
        }

        @JavascriptInterface
        public void scanMobileSmsInbox(final int daysBack) {
            performMobileTransactionScanAsync();
        }

        @JavascriptInterface
        public boolean clearSavedMobileTransactions() {
            try {
                MobileTransactionParser.clearAllSavedTransactions(getApplicationContext());
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public String parseRawTransactionText(final String rawText) {
            try {
                JSONObject parsed = MobileTransactionParser.parseSmsOrNotification(
                    "manual-paste",
                    "",
                    rawText != null ? rawText : "",
                    System.currentTimeMillis(),
                    "mobile-paste"
                );
                return parsed != null ? parsed.toString() : "";
            } catch (Exception ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean isUdhaarOnlyApp() {
            return isUdhaarStandalonePackage();
        }

        @JavascriptInterface
        public String getLiveOtaStatusJson() {
            try {
                String builtinVer = getActiveBuiltinOtaVersion();
                SharedPreferences otaPrefs = getSharedPreferences(getActiveOtaPrefName(), Context.MODE_PRIVATE);
                java.io.File otaJs = new java.io.File(getNoBackupFilesDir(), getActiveOtaJsFile());
                boolean hasOta = otaJs.exists() && otaJs.length() > 1024;
                JSONObject res = new JSONObject();
                res.put("builtinVersion", builtinVer);
                res.put("activeVersion", hasOta ? otaPrefs.getString("ota_version", builtinVer) : builtinVer);
                res.put("buildId", hasOta ? otaPrefs.getString("ota_build_id", "") : "");
                res.put("updatedAt", otaPrefs.getString("ota_updated_at", ""));
                res.put("hasOtaBundle", hasOta);
                res.put("appType", isUdhaarStandalonePackage() ? "udhaar-only" : "salary-ot");
                return res.toString();
            } catch (Exception ignored) {
                String v = getActiveBuiltinOtaVersion();
                return "{\"builtinVersion\":\"" + v + "\",\"activeVersion\":\"" + v + "\",\"hasOtaBundle\":false}";
            }
        }

        @JavascriptInterface
        public boolean saveLiveOtaBundle(final String version, final String buildId, final String jsContent, final String cssContent) {
            try {
                if (jsContent == null || jsContent.length() < 1024) return false;
                String safeJsContent = jsContent;
                if (isUdhaarStandalonePackage() && !safeJsContent.startsWith("window.__UDHAAR_ONLY_APK__")) {
                    safeJsContent = "window.__UDHAAR_ONLY_APK__ = true;\n" + safeJsContent;
                }
                java.io.File otaJs = new java.io.File(getNoBackupFilesDir(), getActiveOtaJsFile());
                try (java.io.FileOutputStream fos = new java.io.FileOutputStream(otaJs, false)) {
                    fos.write(safeJsContent.getBytes(StandardCharsets.UTF_8));
                    fos.flush();
                }
                if (cssContent != null && cssContent.length() > 50) {
                    java.io.File otaCss = new java.io.File(getNoBackupFilesDir(), getActiveOtaCssFile());
                    try (java.io.FileOutputStream fos = new java.io.FileOutputStream(otaCss, false)) {
                        fos.write(cssContent.getBytes(StandardCharsets.UTF_8));
                        fos.flush();
                    }
                }
                String builtinVer = getActiveBuiltinOtaVersion();
                SharedPreferences otaPrefs = getSharedPreferences(getActiveOtaPrefName(), Context.MODE_PRIVATE);
                otaPrefs.edit()
                    .putString("ota_version", version != null && !version.isEmpty() ? version : builtinVer)
                    .putString("ota_build_id", buildId != null ? buildId : "")
                    .putString("ota_updated_at", String.valueOf(System.currentTimeMillis()))
                    .apply();
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean clearLiveOtaBundle() {
            try {
                java.io.File otaJs = new java.io.File(getNoBackupFilesDir(), getActiveOtaJsFile());
                java.io.File otaCss = new java.io.File(getNoBackupFilesDir(), getActiveOtaCssFile());
                if (otaJs.exists()) otaJs.delete();
                if (otaCss.exists()) otaCss.delete();
                SharedPreferences otaPrefs = getSharedPreferences(getActiveOtaPrefName(), Context.MODE_PRIVATE);
                otaPrefs.edit()
                    .putString("ota_version", getActiveBuiltinOtaVersion())
                    .putString("ota_build_id", "")
                    .apply();
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean launchUpiUri(final String rawUri) {
            if (rawUri == null || rawUri.trim().isEmpty()) return false;
            try {
                final Uri upiUri = Uri.parse(rawUri.trim());
                runOnUiThread(() -> {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, upiUri);
                        Intent chooser = Intent.createChooser(intent, "Pay with UPI App");
                        startActivity(chooser);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Open your UPI app to complete payment.", Toast.LENGTH_SHORT).show();
                    }
                });
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean launchUpiPayment(final String vpa, final String payeeName, final String amount, final String note) {
            try {
                Uri.Builder builder = Uri.parse("upi://pay").buildUpon();
                if (vpa != null && !vpa.trim().isEmpty()) {
                    builder.appendQueryParameter("pa", vpa.trim());
                }
                if (payeeName != null && !payeeName.trim().isEmpty()) {
                    builder.appendQueryParameter("pn", payeeName.trim());
                }
                if (amount != null && !amount.trim().isEmpty()) {
                    builder.appendQueryParameter("am", amount.trim());
                }
                builder.appendQueryParameter("cu", "INR");
                if (note != null && !note.trim().isEmpty()) {
                    builder.appendQueryParameter("tn", note.trim());
                }
                final Uri upiUri = builder.build();
                runOnUiThread(() -> {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, upiUri);
                        Intent chooser = Intent.createChooser(intent, "Pay with UPI App (Note Saved in Expenses)");
                        startActivity(chooser);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Expense & Note saved! Open your UPI app to complete payment.", Toast.LENGTH_SHORT).show();
                    }
                });
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public void vibrate(final int durationMs) {
            if (durationMs >= 150) {
                OfficeEndAlarmReceiver.forceRaiseSpeakerVolume(getApplicationContext());
            }
            triggerNativeVibrate(durationMs);
        }

        @JavascriptInterface
        public boolean forceMaxSpeakerVolume() {
            try {
                OfficeEndAlarmReceiver.forceRaiseSpeakerVolume(getApplicationContext());
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean triggerOfficeEndOtStartNotification(final String title, final String body) {
            try {
                OfficeEndAlarmReceiver.showOfficeEndOtStartNotification(getApplicationContext(), title, body);
                triggerNativeVibrate(140);
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean scheduleOfficeEndOtAlarm(final int hour24, final int minute, final String employeeName) {
            try {
                OfficeEndAlarmReceiver.scheduleDailyOfficeEndAlarm(getApplicationContext(), hour24, minute, employeeName);
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean sendWhatsAppMessageToNumber(final String phoneE164, final String messageText) {
            return launchDirectWhatsAppMessage(phoneE164, messageText);
        }

        @SuppressWarnings("deprecation")
        @JavascriptInterface
        public void authenticate(final String actionType, final String title, final String subtitle) {
            runOnUiThread(() -> {
                pendingBioActionType = actionType != null ? actionType : "in";
                final String safeTitle = title != null && !title.isEmpty() ? title : "Unlock to Punch Attendance";
                final String safeSub = subtitle != null && !subtitle.isEmpty() ? subtitle : "Use your phone fingerprint, face, or screen unlock";

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    try {
                        BiometricPrompt.Builder builder = new BiometricPrompt.Builder(MainActivity.this)
                            .setTitle(safeTitle)
                            .setSubtitle(safeSub)
                            .setDescription("Verify with your phone unlock fingerprint or screen lock");

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                            builder.setAllowedAuthenticators(
                                BiometricManager.Authenticators.BIOMETRIC_STRONG
                                | BiometricManager.Authenticators.BIOMETRIC_WEAK
                                | BiometricManager.Authenticators.DEVICE_CREDENTIAL
                            );
                        } else if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) {
                            builder.setDeviceCredentialAllowed(true);
                        } else {
                            builder.setNegativeButton("Cancel", getMainExecutor(), (dialog, which) -> {
                                sendBiometricEventToJs(actionType, false, false, "canceled", "Cancelled by user");
                            });
                        }

                        BiometricPrompt prompt = builder.build();
                        prompt.authenticate(
                            new CancellationSignal(),
                            getMainExecutor(),
                            new BiometricPrompt.AuthenticationCallback() {
                                @Override
                                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                                    super.onAuthenticationSucceeded(result);
                                    triggerNativeVibrate(95);
                                    sendBiometricEventToJs(actionType, true, false, "android-hardware-biometric", "");
                                }

                                @Override
                                public void onAuthenticationError(int errorCode, CharSequence errString) {
                                    super.onAuthenticationError(errorCode, errString);
                                    if (errorCode == BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS
                                            || errorCode == BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT
                                            || errorCode == BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE) {
                                        if (!launchKeyguardFallback(actionType, safeTitle, safeSub)) {
                                            sendBiometricEventToJs(actionType, false, false, "no-lock", "Please enable Fingerprint or Screen Lock in Android Settings");
                                        }
                                    } else {
                                        sendBiometricEventToJs(actionType, false, false, "canceled", String.valueOf(errString));
                                    }
                                }
                            }
                        );
                        return;
                    } catch (Exception ex) {
                        if (launchKeyguardFallback(actionType, safeTitle, safeSub)) {
                            return;
                        }
                        sendBiometricEventToJs(actionType, false, false, "error", String.valueOf(ex.getMessage()));
                        return;
                    }
                }

                if (!launchKeyguardFallback(actionType, safeTitle, safeSub)) {
                    sendBiometricEventToJs(actionType, false, false, "no-lock", "Please enable Fingerprint or Screen Lock on your phone");
                }
            });
        }
    }

    public final class PattanSecureWhatsAppBridge {
        @JavascriptInterface
        public String getConfig() {
            try {
                SharedPreferences prefs = getSharedPreferences(WA_PREF_NAME, Context.MODE_PRIVATE);
                boolean enabled = prefs.getBoolean("enabled", false);
                boolean consent = prefs.getBoolean("consent", false);
                String endpointEnc = prefs.getString("endpoint_enc", "");
                String tokenEnc = prefs.getString("token_enc", "");
                String endpointUrl = MobileTransactionParser.decryptJsonString(endpointEnc, "");
                String token = MobileTransactionParser.decryptJsonString(tokenEnc, "");

                JSONObject cfg = new JSONObject();
                cfg.put("enabled", enabled && consent);
                cfg.put("consentAccepted", consent);
                cfg.put("endpointUrl", endpointUrl);
                cfg.put("hasToken", !token.isEmpty());
                cfg.put("recipient", "917386726193");
                return cfg.toString();
            } catch (Exception ignored) {
                return "{}";
            }
        }

        @JavascriptInterface
        public boolean setEnabled(final boolean enabled, final boolean consentAccepted) {
            try {
                SharedPreferences prefs = getSharedPreferences(WA_PREF_NAME, Context.MODE_PRIVATE);
                prefs.edit()
                    .putBoolean("enabled", enabled && consentAccepted)
                    .putBoolean("consent", consentAccepted)
                    .apply();
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean configureRelay(final String endpointUrl, final String clientToken) {
            try {
                SharedPreferences prefs = getSharedPreferences(WA_PREF_NAME, Context.MODE_PRIVATE);
                SharedPreferences.Editor ed = prefs.edit();
                if (endpointUrl != null) {
                    ed.putString("endpoint_enc", MobileTransactionParser.encryptJsonString(endpointUrl.trim()));
                }
                if (clientToken != null && !clientToken.trim().isEmpty()) {
                    ed.putString("token_enc", MobileTransactionParser.encryptJsonString(clientToken.trim()));
                }
                ed.apply();
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public String sendStatementJson(final String requestJson) {
            HttpURLConnection conn = null;
            try {
                SharedPreferences prefs = getSharedPreferences(WA_PREF_NAME, Context.MODE_PRIVATE);
                String endpointUrl = MobileTransactionParser.decryptJsonString(prefs.getString("endpoint_enc", ""), "");
                String token = MobileTransactionParser.decryptJsonString(prefs.getString("token_enc", ""), "");

                if (endpointUrl == null || endpointUrl.trim().isEmpty()) {
                    JSONObject err = new JSONObject();
                    err.put("ok", false);
                    err.put("statusCode", 0);
                    err.put("error", "WhatsApp Cloud API relay URL is not configured");
                    return err.toString();
                }

                JSONObject outerObj = new JSONObject(requestJson != null ? requestJson : "{}");
                JSONObject reqObj = (outerObj.has("request") && outerObj.optJSONObject("request") != null)
                    ? outerObj.optJSONObject("request")
                    : outerObj;
                String idempotencyKey = reqObj.optString("idempotencyKey", "");

                URL url = new URL(endpointUrl.trim());
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(8000);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                if (!idempotencyKey.isEmpty()) {
                    conn.setRequestProperty("Idempotency-Key", idempotencyKey);
                }
                if (token != null && !token.isEmpty()) {
                    conn.setRequestProperty("Authorization", "Bearer " + token);
                }

                byte[] bytes = reqObj.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bytes);
                    os.flush();
                }

                int code = conn.getResponseCode();
                InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
                StringBuilder sb = new StringBuilder();
                if (is != null) {
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = br.readLine()) != null) {
                            sb.append(line);
                        }
                    }
                }
                JSONObject respJson = sb.length() > 0 ? new JSONObject(sb.toString()) : new JSONObject();
                respJson.put("statusCode", code);
                if (!respJson.has("ok")) {
                    respJson.put("ok", code >= 200 && code < 300);
                }
                return respJson.toString();
            } catch (Exception ex) {
                try {
                    JSONObject err = new JSONObject();
                    err.put("ok", false);
                    err.put("statusCode", 0);
                    err.put("error", ex.getMessage() != null ? ex.getMessage() : "Network error");
                    return err.toString();
                } catch (Exception ignored) {
                    return "{\"ok\":false,\"statusCode\":0,\"error\":\"Network error\"}";
                }
            } finally {
                if (conn != null) conn.disconnect();
            }
        }

        @JavascriptInterface
        public boolean sendWhatsAppMessageToNumber(final String phoneE164, final String messageText) {
            return launchDirectWhatsAppMessage(phoneE164, messageText);
        }
    }

    private boolean launchDirectWhatsAppMessage(final String phoneE164, final String messageText) {
        try {
            final boolean isContactPicker = phoneE164 != null && "PICK_CONTACT".equalsIgnoreCase(phoneE164.trim());
            final String digits = isContactPicker ? "" : (phoneE164 != null ? phoneE164 : "917386726193").replaceAll("[^0-9]", "");
            final String targetPhone = isContactPicker ? "" : (digits.isEmpty() ? "917386726193" : (digits.length() == 10 ? "91" + digits : digits));
            final String msg = messageText != null ? messageText : "";
            final String encodedMsg = Uri.encode(msg);
            final String schemeUrl = targetPhone.isEmpty()
                ? ("whatsapp://send?text=" + encodedMsg)
                : ("whatsapp://send?phone=" + targetPhone + "&text=" + encodedMsg);
            final String webUrl = targetPhone.isEmpty()
                ? ("https://api.whatsapp.com/send?text=" + encodedMsg)
                : ("https://api.whatsapp.com/send?phone=" + targetPhone + "&text=" + encodedMsg);

            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                try {
                    String toastLabel = targetPhone.isEmpty() ? "Opening WhatsApp..." : "Opening WhatsApp chat (+" + targetPhone + ")...";
                    Toast.makeText(getApplicationContext(), toastLabel, Toast.LENGTH_SHORT).show();
                } catch (Exception ignored) {}

                // 1. Direct WhatsApp native deep-link (com.whatsapp)
                try {
                    Uri directUri = Uri.parse(schemeUrl);
                    Intent directIntent = new Intent(Intent.ACTION_VIEW, directUri);
                    directIntent.setPackage("com.whatsapp");
                    directIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(directIntent);
                    return;
                } catch (Exception ignored) {}

                // 2. Direct WhatsApp Business native deep-link (com.whatsapp.w4b)
                try {
                    Uri bizDirectUri = Uri.parse(schemeUrl);
                    Intent bizDirectIntent = new Intent(Intent.ACTION_VIEW, bizDirectUri);
                    bizDirectIntent.setPackage("com.whatsapp.w4b");
                    bizDirectIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(bizDirectIntent);
                    return;
                } catch (Exception ignored) {}

                // 3. Unpackaged whatsapp://send scheme (for dual/cloned WhatsApp apps)
                try {
                    Uri schemeUri = Uri.parse(schemeUrl);
                    Intent schemeIntent = new Intent(Intent.ACTION_VIEW, schemeUri);
                    schemeIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(schemeIntent);
                    return;
                } catch (Exception ignored) {}

                // 4. Fallback to api.whatsapp.com / wa.me
                try {
                    Uri webUri = Uri.parse(webUrl);
                    Intent webIntent = new Intent(Intent.ACTION_VIEW, webUri);
                    webIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(webIntent);
                } catch (Exception ignored) {}
            }, 320);

            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private final class RecoveringWebViewClient extends BridgeWebViewClient {
        RecoveringWebViewClient() {
            super(bridge);
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            if (isUdhaarStandalonePackage() && view != null) {
                try {
                    view.evaluateJavascript("window.__UDHAAR_ONLY_APK__ = true;", null);
                } catch (Exception ignored) {}
            }
            super.onPageStarted(view, url, favicon);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (isUdhaarStandalonePackage() && view != null) {
                try {
                    view.evaluateJavascript("window.__UDHAAR_ONLY_APK__ = true;", null);
                } catch (Exception ignored) {}
            }
            super.onPageFinished(view, url);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            try {
                if (request != null && request.getUrl() != null) {
                    Uri reqUri = request.getUrl();
                    String host = reqUri.getHost() != null ? reqUri.getHost() : "";
                    String path = reqUri.getPath() != null ? reqUri.getPath() : "";
                    if (("localhost".equalsIgnoreCase(host) || "127.0.0.1".equalsIgnoreCase(host)) && path.startsWith("/assets/index-")) {
                        if (path.endsWith(".js")) {
                            java.io.File otaJs = new java.io.File(getNoBackupFilesDir(), getActiveOtaJsFile());
                            if (otaJs.exists() && otaJs.length() > 1024) {
                                java.util.Map<String, String> headers = new java.util.HashMap<>();
                                headers.put("Access-Control-Allow-Origin", "*");
                                headers.put("Cache-Control", "no-store, no-cache, must-revalidate");
                                return new WebResourceResponse(
                                    "application/javascript",
                                    "UTF-8",
                                    200,
                                    "OK",
                                    headers,
                                    new java.io.FileInputStream(otaJs)
                                );
                            }
                        } else if (path.endsWith(".css")) {
                            java.io.File otaCss = new java.io.File(getNoBackupFilesDir(), getActiveOtaCssFile());
                            if (otaCss.exists() && otaCss.length() > 50) {
                                java.util.Map<String, String> headers = new java.util.HashMap<>();
                                headers.put("Access-Control-Allow-Origin", "*");
                                headers.put("Cache-Control", "no-store, no-cache, must-revalidate");
                                return new WebResourceResponse(
                                    "text/css",
                                    "UTF-8",
                                    200,
                                    "OK",
                                    headers,
                                    new java.io.FileInputStream(otaCss)
                                );
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
            return super.shouldInterceptRequest(view, request);
        }

        private boolean isExpiredTunnelRequest(WebResourceRequest request) {
            if (request == null || !request.isForMainFrame()) return false;
            Uri uri = request.getUrl();
            String host = uri == null ? "" : String.valueOf(uri.getHost());
            if (host.isEmpty() || "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host)) {
                return false;
            }
            return true;
        }

        private void returnToConnector(WebView view) {
            String connector = bridge.getLocalUrl() + "/?staleMobileLink=1";
            view.post(() -> view.loadUrl(connector));
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (isExpiredTunnelRequest(request)) {
                returnToConnector(view);
                return;
            }
            super.onReceivedError(view, request, error);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (isExpiredTunnelRequest(request) && response != null && response.getStatusCode() >= 400) {
                returnToConnector(view);
                return;
            }
            super.onReceivedHttpError(view, request, response);
        }
    }
}
