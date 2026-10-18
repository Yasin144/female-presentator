package com.pattan.presentator;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.pm.PackageManager;
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
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new RecoveringWebViewClient());
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().addJavascriptInterface(new PattanBiometricBridge(), "PattanBiometric");
        }
    }

    public final class PattanBiometricBridge {
        @JavascriptInterface
        public boolean isHardwareAvailable() {
            try {
                boolean hasFingerprint = getPackageManager().hasSystemFeature(PackageManager.FEATURE_FINGERPRINT);
                KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
                boolean secure = km != null && km.isDeviceSecure();
                return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && (hasFingerprint || secure);
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public void vibrate(final int durationMs) {
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

        @JavascriptInterface
        public void authenticate(final String actionType, final String title, final String subtitle) {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P || !isHardwareAvailable()) {
                    vibrate(70);
                    dispatchBiometricResult(actionType, true, true, "touch-sensor-fallback", "");
                    return;
                }
                try {
                    BiometricPrompt prompt = new BiometricPrompt.Builder(MainActivity.this)
                        .setTitle(title != null && !title.isEmpty() ? title : "Biometric Touch Sensor")
                        .setSubtitle(subtitle != null && !subtitle.isEmpty() ? subtitle : "Touch fingerprint sensor to punch attendance")
                        .setDescription("Touch your phone fingerprint sensor to record your office Enter / Exit time.")
                        .setNegativeButton("Use Touch Pad", getMainExecutor(), (dialog, which) -> {
                            vibrate(60);
                            dispatchBiometricResult(actionType, true, true, "touch-sensor-pad", "");
                        })
                        .build();

                    prompt.authenticate(
                        new CancellationSignal(),
                        getMainExecutor(),
                        new BiometricPrompt.AuthenticationCallback() {
                            @Override
                            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                                super.onAuthenticationSucceeded(result);
                                vibrate(95);
                                dispatchBiometricResult(actionType, true, false, "android-hardware-biometric", "");
                            }

                            @Override
                            public void onAuthenticationError(int errorCode, CharSequence errString) {
                                super.onAuthenticationError(errorCode, errString);
                                // If no biometrics enrolled or canceled, allow fallback or report
                                if (errorCode == BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS
                                        || errorCode == BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT
                                        || errorCode == BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE) {
                                    vibrate(70);
                                    dispatchBiometricResult(actionType, true, true, "touch-sensor-fallback", String.valueOf(errString));
                                } else {
                                    dispatchBiometricResult(actionType, false, false, "canceled", String.valueOf(errString));
                                }
                            }
                        }
                    );
                } catch (Exception ex) {
                    vibrate(70);
                    dispatchBiometricResult(actionType, true, true, "touch-sensor-fallback", ex.getMessage());
                }
            });
        }

        private void dispatchBiometricResult(String actionType, boolean ok, boolean fallback, String method, String error) {
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
