package com.pattan.presentator;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class UpdateCheckWorker extends Worker {
    public UpdateCheckWorker(@NonNull Context context, @NonNull WorkerParameters parameters) { super(context, parameters); }

    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext();
        if (!UpdateAlertManager.enabled(context) || isStopped()) return Result.success();
        String folder = UpdateAlertManager.isUdhaar(context) ? "ota-udhaar" : "ota";
        String filename = UpdateAlertManager.isUdhaar(context) ? "udhaar-ota-manifest.json" : "ota-manifest.json";
        String[] urls = {
            "https://raw.githubusercontent.com/Yasin144/female-presentator/main/" + folder + "/" + filename,
            "https://cdn.jsdelivr.net/gh/Yasin144/female-presentator@main/" + folder + "/" + filename
        };
        for (String url : urls) {
            if (isStopped()) return Result.success();
            try {
                JSONObject manifest = fetchManifest(url);
                String version = manifest.optString("version", "");
                String build = manifest.optString("buildId", "");
                if (!UpdateAlertPolicy.validVersion(version) || !UpdateAlertPolicy.validBuild(build)) throw new IllegalArgumentException("Invalid update manifest");
                if (isStopped() || !UpdateAlertManager.enabled(context)) return Result.success();
                UpdateAlertManager.prefs(context).edit().putString("last_error", "").apply();
                UpdateAlertManager.notifyAvailable(context, version, build, manifest.optString("notes", ""));
                UpdateAlertManager.prefs(context).edit().putLong("last_checked_at", System.currentTimeMillis()).apply();
                return Result.success();
            } catch (Exception ignored) {}
        }
        UpdateAlertManager.prefs(context).edit().putLong("last_checked_at", System.currentTimeMillis()).putString("last_error", "Update check could not reach GitHub. Android will retry when online.").apply();
        return getRunAttemptCount() < 3 ? Result.retry() : Result.failure();
    }

    private JSONObject fetchManifest(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(8000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "TimeIsMoney-Android-UpdateCheck/1");
        try {
            if (connection.getResponseCode() != 200) throw new java.io.IOException("Manifest request failed");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (isStopped() || output.size() + read > 65536) throw new java.io.IOException("Manifest exceeds limit or worker stopped");
                    output.write(buffer, 0, read);
                }
                return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
            }
        } finally { connection.disconnect(); }
    }
}
