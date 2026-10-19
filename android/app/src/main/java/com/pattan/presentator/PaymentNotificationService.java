package com.pattan.presentator;

import android.app.Notification;
import android.content.Intent;
import android.os.Bundle;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONObject;

public class PaymentNotificationService extends NotificationListenerService {
    public static final String ACTION_MOBILE_TXN = "com.pattan.presentator.MOBILE_TXN_EVENT";
    private static volatile PaymentNotificationService sInstance;

    @Override
    public void onCreate() {
        super.onCreate();
        sInstance = this;
    }

    @Override
    public void onDestroy() {
        if (sInstance == this) {
            sInstance = null;
        }
        super.onDestroy();
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        sInstance = this;
        sweepAllActiveNotifications();
    }

    public static void rescanActiveNotificationsNow() {
        PaymentNotificationService inst = sInstance;
        if (inst != null) {
            inst.sweepAllActiveNotifications();
        }
    }

    private void sweepAllActiveNotifications() {
        try {
            StatusBarNotification[] active = getActiveNotifications();
            if (active != null) {
                for (StatusBarNotification sbn : active) {
                    processStatusBarNotification(sbn);
                }
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        sInstance = this;
        processStatusBarNotification(sbn);
    }

    private static void appendUniqueSegment(StringBuilder sb, CharSequence segment, String separator) {
        if (segment == null || segment.length() == 0) return;
        String str = segment.toString().trim();
        if (str.isEmpty()) return;
        if (sb.indexOf(str) < 0) {
            if (sb.length() > 0) sb.append(separator);
            sb.append(str);
        }
    }

    private static void extractMessagingStyleBundles(Parcelable[] parcelables, StringBuilder bodyBuilder, StringBuilder senderFallback) {
        if (parcelables == null || parcelables.length == 0) return;
        for (Parcelable p : parcelables) {
            if (p instanceof Bundle) {
                Bundle b = (Bundle) p;
                CharSequence msgText = b.getCharSequence("text");
                CharSequence sender = b.getCharSequence("sender");
                if (sender != null && sender.length() > 0 && senderFallback.length() == 0) {
                    senderFallback.append(sender.toString().trim());
                }
                appendUniqueSegment(bodyBuilder, msgText, " · ");
            }
        }
    }

    private void processStatusBarNotification(StatusBarNotification sbn) {
        if (sbn == null) return;
        try {
            String pkg = sbn.getPackageName() != null ? sbn.getPackageName().trim() : "";
            if (pkg.isEmpty() || pkg.equalsIgnoreCase(getPackageName())) return;

            Notification notification = sbn.getNotification();
            if (notification == null) return;

            String title = "";
            StringBuilder bodyBuilder = new StringBuilder();
            StringBuilder senderFallback = new StringBuilder();

            Bundle extras = notification.extras;
            if (extras != null) {
                CharSequence csTitle = extras.getCharSequence(Notification.EXTRA_TITLE);
                CharSequence csBigTitle = extras.getCharSequence(Notification.EXTRA_TITLE_BIG);
                CharSequence csConvTitle = extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE);
                CharSequence csText = extras.getCharSequence(Notification.EXTRA_TEXT);
                CharSequence csBigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
                CharSequence csInfoText = extras.getCharSequence(Notification.EXTRA_INFO_TEXT);
                CharSequence csSubText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT);
                CharSequence csSummary = extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT);
                CharSequence[] csLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);

                if (csTitle != null && csTitle.length() > 0) {
                    title = csTitle.toString().trim();
                } else if (csBigTitle != null && csBigTitle.length() > 0) {
                    title = csBigTitle.toString().trim();
                } else if (csConvTitle != null && csConvTitle.length() > 0) {
                    title = csConvTitle.toString().trim();
                }

                appendUniqueSegment(bodyBuilder, csBigText, " ");
                appendUniqueSegment(bodyBuilder, csText, " · ");
                appendUniqueSegment(bodyBuilder, csInfoText, " · ");

                // Android 11-16 MessagingStyle messages (Google Messages, Samsung Messages, GPay, PhonePe, WhatsApp)
                try {
                    Parcelable[] msgParcelables = extras.getParcelableArray(Notification.EXTRA_MESSAGES);
                    extractMessagingStyleBundles(msgParcelables, bodyBuilder, senderFallback);
                } catch (Exception ignored) {}

                try {
                    Parcelable[] histParcelables = extras.getParcelableArray(Notification.EXTRA_HISTORIC_MESSAGES);
                    extractMessagingStyleBundles(histParcelables, bodyBuilder, senderFallback);
                } catch (Exception ignored) {}

                if (title.isEmpty() && senderFallback.length() > 0) {
                    title = senderFallback.toString();
                }

                if (csLines != null && csLines.length > 0) {
                    for (CharSequence line : csLines) {
                        appendUniqueSegment(bodyBuilder, line, " · ");
                    }
                }

                if (csSubText != null && csSubText.length() > 0) {
                    String subStr = csSubText.toString().trim();
                    if (!subStr.isEmpty() && bodyBuilder.indexOf(subStr) < 0) {
                        if (bodyBuilder.length() > 0) bodyBuilder.append(" Note: ");
                        bodyBuilder.append(subStr);
                    }
                }

                appendUniqueSegment(bodyBuilder, csSummary, " ");
            }

            if (bodyBuilder.length() == 0 && notification.tickerText != null) {
                bodyBuilder.append(notification.tickerText.toString());
            }

            String combinedBody = bodyBuilder.toString().trim();
            if (title.isEmpty() && combinedBody.isEmpty()) return;

            boolean allowedPkg = MobileTransactionParser.isAllowedPaymentPackage(pkg);
            boolean looksFinancial = MobileTransactionParser.looksLikeFinancialNotification(pkg, title, combinedBody);
            if (!allowedPkg && !looksFinancial) {
                return;
            }

            long postTime = sbn.getPostTime() > 0 ? sbn.getPostTime() : System.currentTimeMillis();

            JSONObject parsed = MobileTransactionParser.parseSmsOrNotification(
                allowedPkg ? pkg : "com.google.android.apps.messaging",
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
            } else {
                // Check if this is a standalone bank balance inquiry / Avl Bal alert
                JSONObject balUpdate = MobileTransactionParser.extractAndSaveStandaloneBalance(
                    getApplicationContext(),
                    pkg,
                    title,
                    combinedBody,
                    postTime
                );
                if (balUpdate != null) {
                    Intent broadcast = new Intent(ACTION_MOBILE_TXN);
                    broadcast.setPackage(getPackageName());
                    broadcast.putExtra("balance_json", balUpdate.toString());
                    sendBroadcast(broadcast);
                }
            }
        } catch (Exception ignored) {}
    }
}
