package com.pattan.presentator;

import java.net.URI;

final class ReportExportPolicy {
    static final int MAX_BYTES = 12 * 1024 * 1024;
    static final int MAX_BASE64 = ((MAX_BYTES + 2) / 3) * 4;

    static boolean trustedDocument(String url) {
        try {
            URI value = new URI(url);
            return "https".equals(value.getScheme()) && "localhost".equals(value.getHost())
                && value.getUserInfo() == null && (value.getPort() == -1 || value.getPort() == 443);
        } catch (Exception ignored) { return false; }
    }

    static boolean validNameAndType(String filename, String mime) {
        if (filename == null || filename.length() > 120 || !filename.matches("[A-Za-z0-9][A-Za-z0-9 _().-]*") || filename.contains("..")) return false;
        String lower = filename.toLowerCase(java.util.Locale.ROOT);
        return lower.endsWith(".csv") && "text/csv".equals(mime)
            || lower.endsWith(".pdf") && "application/pdf".equals(mime)
            || lower.endsWith(".xlsx") && "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".equals(mime)
            || lower.endsWith(".json") && "application/json".equals(mime);
    }
}
