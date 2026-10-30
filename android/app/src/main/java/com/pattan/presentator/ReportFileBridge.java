package com.pattan.presentator;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONObject;
import java.io.OutputStream;

/** Explicit user-selected document export. No storage permission or ledger changes. */
public final class ReportFileBridge {
    static final int REQUEST_SAVE_REPORT = 9432;
    private final Activity activity;
    private final WebView webView;
    private Job pending;

    private static final class Job {
        final String id, filename, mime;
        final byte[] bytes;
        Job(String id, String filename, String mime, byte[] bytes) { this.id = id; this.filename = filename; this.mime = mime; this.bytes = bytes; }
    }

    ReportFileBridge(Activity activity, WebView webView) { this.activity = activity; this.webView = webView; }

    private String reply(String status, String error) {
        JSONObject result = new JSONObject();
        try { result.put("status", status); if (error != null) result.put("error", error); } catch (Exception ignored) {}
        return result.toString();
    }

    @JavascriptInterface public synchronized String beginSaveReportJson(String id, String filename, String mime, String base64) {
        if (pending != null) return reply("failed", "Another save window is already open. Complete or cancel it first.");
        if (id == null || !id.matches("[A-Za-z0-9-]{1,80}") || !ReportExportPolicy.validNameAndType(filename, mime)
            || base64 == null || base64.isEmpty() || base64.length() > ReportExportPolicy.MAX_BASE64 || base64.length() % 4 != 0
            || !base64.matches("[A-Za-z0-9+/]*={0,2}")) return reply("failed", "Invalid report file or unsupported format.");
        final Job job;
        try {
            byte[] bytes = Base64.decode(base64, Base64.NO_WRAP);
            if (bytes.length == 0 || bytes.length > ReportExportPolicy.MAX_BYTES) return reply("failed", "Choose a smaller report (maximum 12 MB).");
            job = new Job(id, filename, mime, bytes);
        } catch (Exception ignored) { return reply("failed", "Could not read the report file."); }
        pending = job;
        activity.runOnUiThread(() -> {
            if (!ReportExportPolicy.trustedDocument(webView.getUrl())) { complete(job, "failed", "File export is available only inside the app."); return; }
            try {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(job.mime).putExtra(Intent.EXTRA_TITLE, job.filename);
                activity.startActivityForResult(intent, REQUEST_SAVE_REPORT);
            } catch (Exception ignored) { complete(job, "failed", "Android could not open its file picker. Please enable the system Files app."); }
        });
        return reply("choosing", null);
    }

    boolean handleResult(int request, int result, Intent data) {
        if (request != REQUEST_SAVE_REPORT) return false;
        final Job job;
        synchronized (this) { job = pending; }
        if (job == null) return true;
        Uri uri = data == null ? null : data.getData();
        if (result != Activity.RESULT_OK || uri == null) { complete(job, "cancelled", null); return true; }
        if (!"content".equals(uri.getScheme())) { complete(job, "failed", "Android returned an unsupported save location."); return true; }
        new Thread(() -> {
            try {
                try (OutputStream output = activity.getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new java.io.IOException("No writable stream");
                    output.write(job.bytes); output.flush();
                }
                String savedName = null;
                try (Cursor cursor = activity.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) savedName = cursor.getString(0);
                } catch (Exception ignored) {}
                complete(job, "saved", null, savedName);
            } catch (Exception ignored) { complete(job, "failed", "Could not finish writing the file. Check storage space and export again."); }
        }, "TimeIsMoney-report-save").start();
        return true;
    }

    private void complete(Job job, String status, String error) {
        complete(job, status, error, job.filename);
    }

    private void complete(Job job, String status, String error, String filename) {
        synchronized (this) { if (pending != job) return; pending = null; }
        JSONObject detail = new JSONObject();
        try { detail.put("requestId", job.id); detail.put("status", status); if (filename != null) detail.put("filename", filename); if (error != null) detail.put("error", error); } catch (Exception ignored) {}
        String script = "window.dispatchEvent(new CustomEvent('pattan-report-file-result',{detail:" + detail + "}));";
        activity.runOnUiThread(() -> { if (!activity.isFinishing() && ReportExportPolicy.trustedDocument(webView.getUrl())) webView.evaluateJavascript(script, null); });
    }
}
