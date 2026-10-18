package com.pattan.presentator;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.HapticFeedbackConstants;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final int REQ_DEVICE_CREDENTIAL = 9421;
    private String pendingBioActionType = "in";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new RecoveringWebViewClient());
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().addJavascriptInterface(new PattanBiometricBridge(), "PattanBiometric");
        }
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
                                    // If BiometricPrompt reports no biometrics or unavailable, try Keyguard screen lock
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
