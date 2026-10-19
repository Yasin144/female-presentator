package com.pattan.presentator;

import android.app.Notification;
import android.content.Intent;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONObject;

public class PaymentNotificationService extends NotificationListenerService {
    public static final String ACTION_MOBILE_TXN = "com.pattan.presentator.MOBILE_TXN_EVENT";

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        try {
            String pkg = sbn.getPackageName() != null ? sbn.getPackageName() : "";
            if (pkg.equals(getPackageName())) return;

            Notification notification = sbn.getNotification();
            if (notification == null || notification.extras == null) return;

            Bundle extras = notification.extras;
            CharSequence csTitle = extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence csText = extras.getCharSequence(Notification.EXTRA_TEXT);
            CharSequence csBigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
            CharSequence csSubText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT);

            String title = csTitle != null ? csTitle.toString() : "";
            String text = csBigText != null && csBigText.length() > 0
                ? csBigText.toString()
                : (csText != null ? csText.toString() : "");
            String subText = csSubText != null ? csSubText.toString() : "";

            String combinedBody = text;
            if (!subText.isEmpty() && !combinedBody.contains(subText)) {
                combinedBody = combinedBody + " Note: " + subText;
            }

            long postTime = sbn.getPostTime() > 0 ? sbn.getPostTime() : System.currentTimeMillis();

            JSONObject parsed = MobileTransactionParser.parseSmsOrNotification(
                pkg,
                title,
                combinedBody,
                postTime,
                "mobile-notification"
            );

            if (parsed != null) {
                MobileTransactionParser.saveCapturedTransaction(getApplicationContext(), parsed);
                Intent broadcast = new Intent(ACTION_MOBILE_TXN);
                broadcast.setPackage(getPackageName());
                broadcast.putExtra("tx_json", parsed.toString());
                sendBroadcast(broadcast);
            }
        } catch (Exception ignored) {}
    }
}
