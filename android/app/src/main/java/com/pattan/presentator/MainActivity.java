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
    private String pendingBioActionType = "in";
    private long lastRootBackPressMs = 0L;

    private final BroadcastReceiver paymentNotifReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null) return;
            String txJson = intent.getStringExtra("tx_json");
            if (txJson != null && !txJson.isEmpty()) {
                try {
                    JSONObject single = new JSONObject(txJson);
                    JSONArray arr = new JSONArray();
                    arr.put(single);
                    dispatchMobileTransactionsToJs(true, arr, "");
                } catch (Exception ignored) {}
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new RecoveringWebViewClient());
        if (bridge != null && bridge.getWebView() != null) {
            WebView wv = bridge.getWebView();
            wv.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE);
            wv.clearCache(true);
            wv.addJavascriptInterface(new PattanBiometricBridge(), "PattanBiometric");
            wv.addJavascriptInterface(new PattanSecureWhatsAppBridge(), "PattanSecureWhatsApp");
            wv.reload();
        }
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleSmartBackGesture();
            }
        });
        try {
            IntentFilter filter = new IntentFilter(PaymentNotificationService.ACTION_MOBILE_TXN);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(paymentNotifReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(paymentNotifReceiver, filter);
            }
        } catch (Exception ignored) {}
        handleIncomingSharedReceiptIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingSharedReceiptIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        performMobileTransactionScanAsync();
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
            if (webView.canGoBack()) {
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
            return MobileTransactionParser.loadEncryptedExpenseStoreJson(getApplicationContext());
        }

        @JavascriptInterface
        public boolean saveEncryptedExpenseStoreJson(final String plainJson) {
            return MobileTransactionParser.saveEncryptedExpenseStoreJson(getApplicationContext(), plainJson);
        }

        @JavascriptInterface
        public String getSavedMobileTransactionsJson() {
            try {
                JSONArray arr = MobileTransactionParser.getSavedCapturedTransactions(getApplicationContext());
                return arr != null ? arr.toString() : "[]";
            } catch (Exception ignored) {
                return "[]";
            }
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
            triggerNativeVibrate(durationMs);
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
    }

    private final class RecoveringWebViewClient extends BridgeWebViewClient {
        RecoveringWebViewClient() {
            super(bridge);
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
