package com.pattan.presentator;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import java.util.Calendar;

public class OfficeEndAlarmReceiver extends BroadcastReceiver {
    public static final String CHANNEL_ID = "pattan_office_end_ot_start_channel";
    public static final String PREF_NAME = "pattan_ot_alarm_prefs";
    public static final int NOTIF_ID = 7386;
    public static final int ALARM_REQ_CODE = 7387;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        int hour24 = prefs.getInt("office_end_hour", 18);
        int minute = prefs.getInt("office_end_min", 30);
        String empName = prefs.getString("employee_name", "Yasin Pattan");

        String time12h = format12h(hour24, minute);
        String title = "⏰ Office Time Ended — OT Time Started!";
        String message = "Hi " + empName + ", normal office time (" + time12h + ") has ended. Your Extra Overtime (OT) hours & pay are now counting! ⚡";

        showOfficeEndOtStartNotification(context, title, message);

        // Reschedule for the next day automatically
        scheduleNextAlarmInternal(context, hour24, minute, true);
    }

    public static void ensureChannel(Context context) {
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
            if (existing == null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Office Time Ends & OT Starts Alerts",
                    NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Alerts when normal office hours finish and Overtime (OT) begins");
                channel.enableVibration(true);
                channel.setVibrationPattern(new long[]{0, 300, 150, 400});
                nm.createNotificationChannel(channel);
            }
        } catch (Exception ignored) {}
    }

    public static void showOfficeEndOtStartNotification(Context context, String title, String message) {
        if (context == null) return;
        try {
            ensureChannel(context);
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            Intent openIntent = new Intent(context, MainActivity.class);
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            openIntent.putExtra("ot_started_alert", true);

            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent contentIntent = PendingIntent.getActivity(context, NOTIF_ID, openIntent, flags);

            String safeTitle = (title != null && !title.trim().isEmpty())
                ? title.trim()
                : "⏰ Office Time Ended — OT Time Started!";
            String safeBody = (message != null && !message.trim().isEmpty())
                ? message.trim()
                : "Your normal office shift has ended and Overtime (OT) calculation has started! ⚡";

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(safeTitle)
                .setContentText(safeBody)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(safeBody))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setAutoCancel(true)
                .setVibrate(new long[]{0, 300, 150, 400})
                .setContentIntent(contentIntent);

            nm.notify(NOTIF_ID, builder.build());
        } catch (Exception ignored) {}
    }

    public static void scheduleDailyOfficeEndAlarm(Context context, int hour24, int minute, String employeeName) {
        if (context == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                .putInt("office_end_hour", hour24)
                .putInt("office_end_min", minute)
                .putString("employee_name", (employeeName != null && !employeeName.trim().isEmpty()) ? employeeName.trim() : "Yasin Pattan")
                .apply();
            scheduleNextAlarmInternal(context, hour24, minute, false);
        } catch (Exception ignored) {}
    }

    public static void scheduleFromSavedPrefs(Context context) {
        if (context == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            int hour24 = prefs.getInt("office_end_hour", 18);
            int minute = prefs.getInt("office_end_min", 30);
            scheduleNextAlarmInternal(context, hour24, minute, false);
        } catch (Exception ignored) {}
    }

    private static void scheduleNextAlarmInternal(Context context, int hour24, int minute, boolean forceTomorrow) {
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;

            Intent alarmIntent = new Intent(context, OfficeEndAlarmReceiver.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pi = PendingIntent.getBroadcast(context, ALARM_REQ_CODE, alarmIntent, flags);

            Calendar target = Calendar.getInstance();
            target.set(Calendar.HOUR_OF_DAY, Math.max(0, Math.min(23, hour24)));
            target.set(Calendar.MINUTE, Math.max(0, Math.min(59, minute)));
            target.set(Calendar.SECOND, 0);
            target.set(Calendar.MILLISECOND, 0);

            if (forceTomorrow || target.getTimeInMillis() <= System.currentTimeMillis()) {
                target.add(Calendar.DAY_OF_YEAR, 1);
            }

            long triggerAtMillis = target.getTimeInMillis();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi);
            } else {
                am.set(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi);
            }
        } catch (Exception ignored) {}
    }

    private static String format12h(int hour24, int minute) {
        String period = hour24 >= 12 ? "PM" : "AM";
        int h12 = hour24 % 12;
        if (h12 == 0) h12 = 12;
        return String.format("%02d:%02d %s", h12, minute, period);
    }
}
