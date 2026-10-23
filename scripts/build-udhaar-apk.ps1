$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$env:JAVA_HOME = "C:\Users\patan\.cache\android-build-tools\jdk21\jdk-21.0.12.1+1"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

$rootDir = (Get-Location).Path
$pubDir = Join-Path $rootDir "android\app\src\main\assets\public"
$javaDir = Join-Path $rootDir "android\app\src\main\java\com\pattan\presentator"
$manifestPath = Join-Path $rootDir "android\app\src\main\AndroidManifest.xml"
$gradlePath = Join-Path $rootDir "android\app\build.gradle"
$stringsPath = Join-Path $rootDir "android\app\src\main\res\values\strings.xml"
$mainActivityPath = Join-Path $javaDir "MainActivity.java"

# Backup originals
$origManifest = [System.IO.File]::ReadAllText($manifestPath, $utf8NoBom).TrimStart([char]0xFEFF)
$origGradle = [System.IO.File]::ReadAllText($gradlePath, $utf8NoBom).TrimStart([char]0xFEFF)
$origStrings = [System.IO.File]::ReadAllText($stringsPath, $utf8NoBom).TrimStart([char]0xFEFF)
$origMainActivity = [System.IO.File]::ReadAllText($mainActivityPath, $utf8NoBom).TrimStart([char]0xFEFF)

$backupDir = Join-Path $env:TEMP "udhaar_java_backup_$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Move-Item (Join-Path $javaDir "PaymentNotificationService.java") $backupDir -Force
Move-Item (Join-Path $javaDir "MobileTransactionParser.java") $backupDir -Force
Move-Item (Join-Path $javaDir "OfficeEndAlarmReceiver.java") $backupDir -Force

$ksFile = Join-Path $env:TEMP "pattan-udhaar-release-v108.jks"
if (-not (Test-Path $ksFile)) {
    & "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -v -keystore $ksFile -keyalg RSA -keysize 2048 -validity 10000 -alias udhaar_key -storepass pattanudhaar144 -keypass pattanudhaar144 -dname "CN=Pattan Yasin, OU=Mobile, O=Pattan Yasin, L=Hyderabad, ST=TS, C=IN"
}

try {
    # 1. Prepare assets with window.__UDHAAR_ONLY_APK__ = true (and strip any nested .apk or unused assets so Play Protect never flags nested APKs)
    Remove-Item "$pubDir\*" -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path "$pubDir\assets" -Force | Out-Null
    Copy-Item (Join-Path $rootDir "renderer-dist\index.html") (Join-Path $pubDir "index.html") -Force
    Copy-Item (Join-Path $rootDir "renderer-dist\assets\index-*.js") "$pubDir\assets\" -Force
    Copy-Item (Join-Path $rootDir "renderer-dist\assets\index-*.css") "$pubDir\assets\" -Force

    $idxHtmlPath = Join-Path $pubDir "index.html"
    $idxHtml = [System.IO.File]::ReadAllText($idxHtmlPath, $utf8NoBom).TrimStart([char]0xFEFF)
    $idxHtml = $idxHtml.Replace("<head>", "<head><script>window.__UDHAAR_ONLY_APK__ = true; document.title = 'Udhaar Tracker';</script>")
    [System.IO.File]::WriteAllText($idxHtmlPath, $idxHtml, $utf8NoBom)

    $assetJs = Get-ChildItem "$pubDir\assets\index-*.js" | Select-Object -First 1
    $assetJsContent = [System.IO.File]::ReadAllText($assetJs.FullName, $utf8NoBom).TrimStart([char]0xFEFF)
    [System.IO.File]::WriteAllText($assetJs.FullName, ("window.__UDHAAR_ONLY_APK__ = true;`n" + $assetJsContent), $utf8NoBom)

    # 2. Write Play-Protect-Compliant Clean AndroidManifest.xml (NO NotificationListenerService, NO SMS, NO UPI package queries)
    $cleanManifest = @"
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <application
        android:allowBackup="false"
        android:fullBackupContent="false"
        android:usesCleartextTraffic="false"
        tools:replace="android:usesCleartextTraffic"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="`${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths"></meta-data>
        </provider>
    </application>

    <queries>
        <package android:name="com.whatsapp" />
        <package android:name="com.whatsapp.w4b" />
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="whatsapp" />
        </intent>
    </queries>

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.USE_BIOMETRIC" />
    <uses-permission android:name="android.permission.USE_FINGERPRINT" />
    <uses-permission android:name="android.permission.VIBRATE" />
</manifest>
"@
    [System.IO.File]::WriteAllText($manifestPath, $cleanManifest, $utf8NoBom)

    # 3. Write Play-Protect-Compliant Clean MainActivity.java (Zero NotificationListener / SMS / Settings.Secure references)
    $cleanMainActivity = @"
package com.pattan.presentator;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executor;

public class MainActivity extends BridgeActivity {
    private static final int REQ_CREDENTIAL_UNLOCK = 9402;
    private static final String UDHAAR_OTA_PREF_NAME = "pattan_udhaar_live_ota_prefs_v1";
    private static final String UDHAAR_OTA_JS_FILE = "pattan_udhaar_ota_bundle.js";
    private static final String UDHAAR_OTA_CSS_FILE = "pattan_udhaar_ota_bundle.css";
    private static final String BUILTIN_UDHAAR_OTA_VERSION = "1.0.8";
    private String pendingBioActionType = "unlock";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }
        try {
            WebView wv = bridge.getWebView();
            wv.addJavascriptInterface(new PattanBiometricBridge(), "PattanBiometric");
            if (wv.getSettings() != null) {
                wv.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE);
            }
            wv.evaluateJavascript("window.__UDHAAR_ONLY_APK__ = true;", null);
            String curUrl = wv.getUrl();
            if (curUrl == null || !curUrl.contains("app=udhaar")) {
                wv.loadUrl(bridge.getLocalUrl() + "/?app=udhaar");
            }
        } catch (Exception ignored) {}
        bridge.setWebViewClient(new UdhaarWebViewClient());
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_CREDENTIAL_UNLOCK) {
            if (resultCode == RESULT_OK) {
                triggerNativeVibrate(65);
                sendBiometricEventToJs(pendingBioActionType, true, false, "android-device-credential", "");
            } else {
                sendBiometricEventToJs(pendingBioActionType, false, false, "canceled", "Device unlock cancelled");
            }
        }
    }

    private void triggerNativeVibrate(int durationMs) {
        try {
            Vibrator vib = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vib != null && vib.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vib.vibrate(VibrationEffect.createOneShot(Math.max(20, durationMs), VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vib.vibrate(Math.max(20, durationMs));
                }
            }
        } catch (Exception ignored) {}
    }

    private void sendBiometricEventToJs(final String actionType, final boolean ok, final boolean fallback, final String method, final String error) {
        if (bridge == null || bridge.getWebView() == null) return;
        final String safeAction = actionType == null ? "unlock" : actionType.replace("'", "");
        final String safeMethod = method == null ? "android-biometric" : method.replace("'", "");
        final String safeError = error == null ? "" : error.replace("'", "\\'");
        final String js = "window.dispatchEvent(new CustomEvent('pattan-biometric-result', { detail: { "
            + "actionType: '" + safeAction + "', "
            + "ok: " + (ok ? "true" : "false") + ", "
            + "fallback: " + (fallback ? "true" : "false") + ", "
            + "method: '" + safeMethod + "', "
            + "error: '" + safeError + "' "
            + "} }));";
        bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(js, null));
    }

    public class PattanBiometricBridge {
        @JavascriptInterface
        public boolean isAvailable() {
            return true;
        }

        @JavascriptInterface
        public boolean isUdhaarOnlyApp() {
            return true;
        }

        @JavascriptInterface
        public String getLiveOtaStatusJson() {
            try {
                SharedPreferences otaPrefs = getSharedPreferences(UDHAAR_OTA_PREF_NAME, Context.MODE_PRIVATE);
                java.io.File otaJs = new java.io.File(getNoBackupFilesDir(), UDHAAR_OTA_JS_FILE);
                boolean hasOta = otaJs.exists() && otaJs.length() > 1024;
                JSONObject res = new JSONObject();
                res.put("version", hasOta ? otaPrefs.getString("ota_version", BUILTIN_UDHAAR_OTA_VERSION) : BUILTIN_UDHAAR_OTA_VERSION);
                res.put("builtinVersion", BUILTIN_UDHAAR_OTA_VERSION);
                res.put("hasLiveBundle", hasOta);
                res.put("updatedAt", otaPrefs.getString("ota_updated_at", ""));
                res.put("buildId", otaPrefs.getString("ota_build_id", ""));
                res.put("appType", "udhaar-only");
                return res.toString();
            } catch (Exception ignored) {
                return "{\"version\":\"" + BUILTIN_UDHAAR_OTA_VERSION + "\",\"hasLiveBundle\":false,\"appType\":\"udhaar-only\"}";
            }
        }

        @JavascriptInterface
        public boolean saveLiveOtaBundle(final String version, final String buildId, final String jsContent, final String cssContent) {
            if (jsContent == null || jsContent.length() < 1024) return false;
            try {
                String safeJsContent = "window.__UDHAAR_ONLY_APK__ = true;\n" + jsContent;
                java.io.File otaJs = new java.io.File(getNoBackupFilesDir(), UDHAAR_OTA_JS_FILE);
                try (java.io.FileOutputStream fos = new java.io.FileOutputStream(otaJs, false)) {
                    fos.write(safeJsContent.getBytes(StandardCharsets.UTF_8));
                    fos.flush();
                }
                if (cssContent != null && cssContent.length() > 50) {
                    java.io.File otaCss = new java.io.File(getNoBackupFilesDir(), UDHAAR_OTA_CSS_FILE);
                    try (java.io.FileOutputStream fos = new java.io.FileOutputStream(otaCss, false)) {
                        fos.write(cssContent.getBytes(StandardCharsets.UTF_8));
                        fos.flush();
                    }
                }
                SharedPreferences otaPrefs = getSharedPreferences(UDHAAR_OTA_PREF_NAME, Context.MODE_PRIVATE);
                otaPrefs.edit()
                    .putString("ota_version", version != null && !version.isEmpty() ? version : BUILTIN_UDHAAR_OTA_VERSION)
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
                java.io.File otaJs = new java.io.File(getNoBackupFilesDir(), UDHAAR_OTA_JS_FILE);
                java.io.File otaCss = new java.io.File(getNoBackupFilesDir(), UDHAAR_OTA_CSS_FILE);
                if (otaJs.exists()) otaJs.delete();
                if (otaCss.exists()) otaCss.delete();
                SharedPreferences otaPrefs = getSharedPreferences(UDHAAR_OTA_PREF_NAME, Context.MODE_PRIVATE);
                otaPrefs.edit()
                    .putString("ota_version", BUILTIN_UDHAAR_OTA_VERSION)
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
                final Uri targetUri = Uri.parse(rawUri.trim());
                runOnUiThread(() -> {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, targetUri);
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception ignored) {}
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

        @JavascriptInterface
        public boolean sendWhatsAppMessageToNumber(final String phoneE164, final String messageText) {
            return launchDirectWhatsAppMessage(phoneE164, messageText);
        }

        @SuppressWarnings("deprecation")
        @JavascriptInterface
        public void authenticate(final String actionType, final String title, final String subtitle) {
            runOnUiThread(() -> {
                pendingBioActionType = actionType != null ? actionType : "unlock";
                final String safeTitle = title != null && !title.isEmpty() ? title : "Unlock Udhaar Book";
                final String safeSub = subtitle != null && !subtitle.isEmpty() ? subtitle : "Verify with your fingerprint, face, or screen lock";

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
                        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            builder.setDeviceCredentialAllowed(true);
                        } else {
                            builder.setNegativeButton("Use Screen Lock", getMainExecutor(), (dialog, which) -> {
                                launchKeyguardFallback(actionType, safeTitle, safeSub);
                            });
                        }

                        BiometricPrompt prompt = builder.build();
                        CancellationSignal cancelSignal = new CancellationSignal();
                        Executor mainExecutor = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                            ? getMainExecutor()
                            : command -> runOnUiThread(command);

                        prompt.authenticate(cancelSignal, mainExecutor, new BiometricPrompt.AuthenticationCallback() {
                            @Override
                            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                                super.onAuthenticationSucceeded(result);
                                triggerNativeVibrate(65);
                                sendBiometricEventToJs(actionType, true, false, "android-hardware-biometric", "");
                            }

                            @Override
                            public void onAuthenticationError(int errorCode, CharSequence errString) {
                                super.onAuthenticationError(errorCode, errString);
                                if (errorCode == BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS
                                    || errorCode == BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT
                                    || errorCode == BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE
                                    || errorCode == BiometricPrompt.BIOMETRIC_ERROR_NO_DEVICE_CREDENTIAL) {
                                    launchKeyguardFallback(actionType, safeTitle, safeSub);
                                } else {
                                    sendBiometricEventToJs(
                                        actionType,
                                        false,
                                        false,
                                        "canceled",
                                        errString != null ? errString.toString() : "Biometric verification cancelled"
                                    );
                                }
                            }
                        });
                        return;
                    } catch (Exception ignored) {}
                }
                launchKeyguardFallback(actionType, safeTitle, safeSub);
            });
        }

        private void launchKeyguardFallback(final String actionType, final String safeTitle, final String safeSub) {
            try {
                KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
                if (km != null && km.isKeyguardSecure()) {
                    Intent confirmIntent = km.createConfirmDeviceCredentialIntent(safeTitle, safeSub);
                    if (confirmIntent != null) {
                        startActivityForResult(confirmIntent, REQ_CREDENTIAL_UNLOCK);
                        return;
                    }
                }
                triggerNativeVibrate(55);
                sendBiometricEventToJs(actionType, true, true, "device-unlocked", "");
            } catch (Exception e) {
                sendBiometricEventToJs(actionType, false, false, "error", "Biometric error");
            }
        }
    }

    private boolean launchDirectWhatsAppMessage(final String phoneE164, final String messageText) {
        try {
            final boolean isContactPicker = phoneE164 != null && "PICK_CONTACT".equalsIgnoreCase(phoneE164.trim());
            final String digits = isContactPicker ? "" : (phoneE164 != null ? phoneE164 : "").replaceAll("[^0-9]", "");
            final String targetPhone = isContactPicker ? "" : (digits.length() == 10 ? "91" + digits : digits);
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

                try {
                    Intent directIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(schemeUrl));
                    directIntent.setPackage("com.whatsapp");
                    directIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(directIntent);
                    return;
                } catch (Exception ignored) {}

                try {
                    Intent bizDirectIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(schemeUrl));
                    bizDirectIntent.setPackage("com.whatsapp.w4b");
                    bizDirectIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(bizDirectIntent);
                    return;
                } catch (Exception ignored) {}

                try {
                    Intent schemeIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(schemeUrl));
                    schemeIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(schemeIntent);
                    return;
                } catch (Exception ignored) {}

                try {
                    Intent webIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(webUrl));
                    webIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(webIntent);
                } catch (Exception ignored) {}
            }, 250);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private final class UdhaarWebViewClient extends BridgeWebViewClient {
        UdhaarWebViewClient() {
            super(bridge);
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            if (view != null) {
                try {
                    view.evaluateJavascript("window.__UDHAAR_ONLY_APK__ = true;", null);
                } catch (Exception ignored) {}
            }
            super.onPageStarted(view, url, favicon);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (view != null) {
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
                            java.io.File otaJs = new java.io.File(getNoBackupFilesDir(), UDHAAR_OTA_JS_FILE);
                            if (otaJs.exists() && otaJs.length() > 1024) {
                                java.util.Map<String, String> headers = new java.util.HashMap<>();
                                headers.put("Access-Control-Allow-Origin", "*");
                                headers.put("Cache-Control", "no-store, no-cache, must-revalidate");
                                return new WebResourceResponse("application/javascript", "UTF-8", 200, "OK", headers, new java.io.FileInputStream(otaJs));
                            }
                        } else if (path.endsWith(".css")) {
                            java.io.File otaCss = new java.io.File(getNoBackupFilesDir(), UDHAAR_OTA_CSS_FILE);
                            if (otaCss.exists() && otaCss.length() > 50) {
                                java.util.Map<String, String> headers = new java.util.HashMap<>();
                                headers.put("Access-Control-Allow-Origin", "*");
                                headers.put("Cache-Control", "no-store, no-cache, must-revalidate");
                                return new WebResourceResponse("text/css", "UTF-8", 200, "OK", headers, new java.io.FileInputStream(otaCss));
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
            return super.shouldInterceptRequest(view, request);
        }
    }
}
"@
    [System.IO.File]::WriteAllText($mainActivityPath, $cleanMainActivity, $utf8NoBom)

    # 4. Configure build.gradle and strings.xml for com.pattan.udhaar v1.0.8
    $ksPath = $ksFile.Replace("\", "/")
    $udhaarGradle = $origGradle.Replace('applicationId "com.pattan.presentator"', 'applicationId "com.pattan.udhaar"').Replace('versionCode 24', 'versionCode 8').Replace('versionName "7.8"', 'versionName "1.0.8"')
    $signingBlock = @"
    signingConfigs {
        release {
            storeFile file("$ksPath")
            storePassword "pattanudhaar144"
            keyAlias "udhaar_key"
            keyPassword "pattanudhaar144"
            v1SigningEnabled true
            v2SigningEnabled true
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
"@
    $udhaarGradle = $udhaarGradle.Replace("    buildTypes {`r`n        release {", $signingBlock).Replace("    buildTypes {`n        release {", $signingBlock)
    [System.IO.File]::WriteAllText($gradlePath, $udhaarGradle, $utf8NoBom)

    $udhaarStrings = @"
<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">Udhaar Book</string>
    <string name="title_activity_main">Udhaar Book</string>
    <string name="package_name">com.pattan.udhaar</string>
    <string name="custom_url_scheme">com.pattan.udhaar</string>
</resources>
"@
    [System.IO.File]::WriteAllText($stringsPath, $udhaarStrings, $utf8NoBom)

    # 5. Build clean release APK
    Push-Location (Join-Path $rootDir "android")
    .\gradlew.bat assembleRelease
    if ($LASTEXITCODE -ne 0) { throw "Gradle assembleRelease failed" }
    Pop-Location

    $apkSrc = Join-Path $rootDir "android\app\build\outputs\apk\release\app-release.apk"
    Copy-Item $apkSrc (Join-Path $rootDir "ota-udhaar\Udhaar-Tracker-Pro-Friend.apk") -Force
    Copy-Item $apkSrc (Join-Path $rootDir "ota\Udhaar-Tracker-Pro-Friend.apk") -Force
    Remove-Item (Join-Path $rootDir "public\Udhaar-Tracker-Pro-Friend.apk") -Force -ErrorAction SilentlyContinue
    Write-Host "PLAY-PROTECT-CLEAN APK v1.0.8 BUILT & COPIED: $((Get-Item $apkSrc).Length) bytes"
} finally {
    if ((Get-Location).Path.EndsWith("\android")) { Pop-Location }
    [System.IO.File]::WriteAllText($manifestPath, $origManifest, $utf8NoBom)
    [System.IO.File]::WriteAllText($gradlePath, $origGradle, $utf8NoBom)
    [System.IO.File]::WriteAllText($stringsPath, $origStrings, $utf8NoBom)
    [System.IO.File]::WriteAllText($mainActivityPath, $origMainActivity, $utf8NoBom)
    Move-Item (Join-Path $backupDir "*.java") $javaDir -Force
    Remove-Item $backupDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$pubDir\*" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $rootDir "renderer-dist\*") $pubDir -Recurse -Force
}
