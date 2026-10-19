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
    public void onListenerConnected() {
        super.onListenerConnected();
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
        processStatusBarNotification(sbn);
    }

    private void processStatusBarNotification(StatusBarNotification sbn) {
        if (sbn == null) return;
        try {
            String pkg = sbn.getPackageName() != null ? sbn.getPackageName().trim() : "";
            if (pkg.isEmpty() || pkg.equalsIgnoreCase(getPackageName())) return;

            // Strict allow-list: ignore any notification from non-payment/non-banking packages
            if (!MobileTransactionParser.isAllowedPaymentPackage(pkg)) {
                return;
            }

            Notification notification = sbn.getNotification();
            if (notification == null) return;

            String title = "";
            StringBuilder bodyBuilder = new StringBuilder();

            Bundle extras = notification.extras;
            if (extras != null) {
                CharSequence csTitle = extras.getCharSequence(Notification.EXTRA_TITLE);
                CharSequence csBigTitle = extras.getCharSequence(Notification.EXTRA_TITLE_BIG);
                CharSequence csText = extras.getCharSequence(Notification.EXTRA_TEXT);
                CharSequence csBigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
                CharSequence csSubText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT);
                CharSequence csSummary = extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT);
                CharSequence[] csLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);

                if (csTitle != null && csTitle.length() > 0) {
                    title = csTitle.toString();
                } else if (csBigTitle != null && csBigTitle.length() > 0) {
                    title = csBigTitle.toString();
                }

                if (csBigText != null && csBigText.length() > 0) {
                    bodyBuilder.append(csBigText.toString());
                } else if (csText != null && csText.length() > 0) {
                    bodyBuilder.append(csText.toString());
                }

                if (csLines != null && csLines.length > 0) {
                    for (CharSequence line : csLines) {
                        if (line != null && line.length() > 0) {
                            String lineStr = line.toString();
                            if (bodyBuilder.indexOf(lineStr) < 0) {
                                if (bodyBuilder.length() > 0) bodyBuilder.append(" · ");
                                bodyBuilder.append(lineStr);
                            }
                        }
                    }
                }

                if (csSubText != null && csSubText.length() > 0) {
                    String subStr = csSubText.toString();
                    if (bodyBuilder.indexOf(subStr) < 0) {
                        if (bodyBuilder.length() > 0) bodyBuilder.append(" Note: ");
                        bodyBuilder.append(subStr);
                    }
                }

                if (csSummary != null && csSummary.length() > 0) {
                    String sumStr = csSummary.toString();
                    if (bodyBuilder.indexOf(sumStr) < 0) {
                        if (bodyBuilder.length() > 0) bodyBuilder.append(" ");
                        bodyBuilder.append(sumStr);
                    }
                }
            }

            if (bodyBuilder.length() == 0 && notification.tickerText != null) {
                bodyBuilder.append(notification.tickerText.toString());
            }

            String combinedBody = bodyBuilder.toString().trim();
            if (title.isEmpty() && combinedBody.isEmpty()) return;

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
