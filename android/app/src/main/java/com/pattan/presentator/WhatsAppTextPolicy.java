package com.pattan.presentator;

import java.nio.charset.StandardCharsets;

final class WhatsAppTextPolicy {
    private WhatsAppTextPolicy() {}

    static boolean validMessage(String message) {
        // Leave ample space below Android's shared Binder transaction limit.
        // Reject oversized input; never silently shorten the attendance report.
        return message != null && !message.trim().isEmpty()
            && message.getBytes(StandardCharsets.UTF_8).length <= 128 * 1024;
    }

    static String recipient(String phone) {
        if (phone == null || "PICK_CONTACT".equalsIgnoreCase(phone.trim())) return "";
        String digits = phone.replaceAll("[^0-9]", "");
        if (digits.length() == 10) digits = "91" + digits;
        return digits.matches("[1-9][0-9]{6,14}") ? digits : "";
    }
}
