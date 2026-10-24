package com.pattan.presentator;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;

/** User-facing shift reminders, independent of WebView timers and process lifetime. */
public final class OtMilestoneAlarmReceiver extends BroadcastReceiver {
    private static final String PREFS = "tim_ot_milestone_alarms_v1";
    private static final int REQUEST_BASE = 7480;
    private static final int TEST_REQUEST = 7499;
    private static final String FIRE = "com.pattan.presentator.OT_MILESTONE";
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    private static PendingIntent pending(Context c, int hour, String key, long base) {
        return PendingIntent.getBroadcast(c, REQUEST_BASE + hour,
            new Intent(c, OtMilestoneAlarmReceiver.class).setAction(FIRE)
                .putExtra("hour", hour).putExtra("key", key).putExtra("base", base),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static boolean exactAllowed(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return am != null && (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms());
    }

    private static void setAlarm(Context c, long at, PendingIntent pi) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) throw new IllegalStateException("Android alarm service unavailable");
        if (exactAllowed(c)) {
            try { am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi); return; }
            catch (SecurityException denied) { /* Permission may have changed during scheduling. */ }
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    }

    private static void cancelPending(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        for (int h = 0; h <= OtMilestonePolicy.MAX_HOUR; h++) am.cancel(pending(c, h, "", 0));
        // Remove the legacy daily alarm instead of postponing it to a different day.
        am.cancel(PendingIntent.getBroadcast(c, OfficeEndAlarmReceiver.ALARM_REQ_CODE,
            new Intent(c, OfficeEndAlarmReceiver.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    }

    public static synchronized void cancel(Context c) {
        prefs(c).edit().putBoolean("enabled", false).commit();
        cancelPending(c);
    }

    public static synchronized boolean configure(Context c, String json) {
        try {
            JSONObject value = new JSONObject(json);
            long base = value.getLong("shiftEndEpochMs");
            String key = value.getString("dateKey");
            if (!OtMilestonePolicy.validSchedule(base, System.currentTimeMillis(), key)) return false;
            SharedPreferences p = prefs(c);
            boolean sameSchedule = key.equals(p.getString("key", "")) && base == p.getLong("base", 0);
            int mask = sameSchedule ? p.getInt("delivered", 0) : 0;
            JSONArray spoken = value.optJSONArray("alreadySpokenHours");
            // Native state owns an existing shift. The legacy browser also calls
            // missed hours "spoken" after two minutes, before Android may deliver.
            if (!sameSchedule && spoken != null) for (int i = 0; i < spoken.length(); i++) {
                int h = spoken.optInt(i, -1);
                if (h >= 0 && h <= OtMilestonePolicy.MAX_HOUR) mask |= 1 << h;
            }
            if (!p.edit().putBoolean("enabled", true).putString("key", key).putLong("base", base)
                .putInt("delivered", mask).putString("error", "").commit()) return false;
            restore(c);
            return true;
        } catch (Exception error) {
            prefs(c).edit().putString("error", "OT alarms could not be scheduled").apply();
            return false;
        }
    }

    public static synchronized void restore(Context c) {
        cancelPending(c);
        SharedPreferences p = prefs(c);
        if (!p.getBoolean("enabled", false)) return;
        long base = p.getLong("base", 0), now = System.currentTimeMillis();
        String key = p.getString("key", "");
        if (!OtMilestonePolicy.validSchedule(base, now, key)) return;
        int mask = p.getInt("delivered", 0);
        int recentHour = OtMilestonePolicy.latestDeliverableHour(base, now, mask);
        if (recentHour >= 0 && notifyHour(c, recentHour)) {
            mask |= 1 << recentHour;
            p.edit().putInt("delivered", mask).putLong("lastDeliveredAt", now).putInt("lastDeliveredHour", recentHour).commit();
        }
        for (int h = 0; h <= OtMilestonePolicy.MAX_HOUR; h++) {
            if (OtMilestonePolicy.shouldSchedule(base, h, now, mask)) setAlarm(c, OtMilestonePolicy.at(base, h), pending(c, h, key, base));
        }
    }

    @Override public void onReceive(Context c, Intent intent) {
        if (c == null || intent == null) return;
        if (!FIRE.equals(intent.getAction())) { restore(c); return; }
        if (intent.getBooleanExtra("test", false)) {
            long due = intent.getLongExtra("due", 0);
            if (System.currentTimeMillis() >= due && System.currentTimeMillis() - due <= OtMilestonePolicy.DELIVERY_WINDOW_MS) notifyHour(c, 0);
            return;
        }
        deliver(c, intent);
    }

    private static synchronized void deliver(Context c, Intent intent) {
        SharedPreferences p = prefs(c);
        if (!p.getBoolean("enabled", false) || !p.getString("key", "").equals(intent.getStringExtra("key"))) return;
        long base = p.getLong("base", 0);
        int requestedHour = intent.getIntExtra("hour", -1), mask = p.getInt("delivered", 0);
        long now = System.currentTimeMillis();
        if (base != intent.getLongExtra("base", -1)) return;
        int h = OtMilestonePolicy.deliveryHour(base, requestedHour, now, mask);
        if (h < 0) return;
        if (notifyHour(c, h)) p.edit().putInt("delivered", mask | (1 << h))
            .putLong("lastDeliveredAt", now).putInt("lastDeliveredHour", h).commit();
    }

    private static String channel(int h) { return "tim_ot_voice_" + h + "_v1"; }

    public static boolean notifyHour(Context c, int hour) {
        if (hour < 0 || hour > OtMilestonePolicy.MAX_HOUR) return false;
        try {
            if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null || !nm.areNotificationsEnabled()) return false;
            Uri sound = Uri.parse("content://" + c.getPackageName() + ".ot-sounds/" + hour);
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(channel(hour)) == null) {
                NotificationChannel ch = new NotificationChannel(channel(hour), hour == 0 ? "Shift completed voice" : hour + " hour OT voice", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Spoken attendance reminder. Uses your alarm volume; does not change music volume or bypass Do Not Disturb.");
                ch.setSound(sound, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
                ch.enableVibration(true);
                nm.createNotificationChannel(ch);
            }
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = nm.getNotificationChannel(channel(hour));
                if (ch == null || ch.getImportance() == NotificationManager.IMPORTANCE_NONE) {
                    prefs(c).edit().putString("error", "OT " + hour + " notification channel is blocked in Android settings").apply();
                    return false;
                }
            }
            Intent launch = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
            if (launch == null) return false;
            PendingIntent open = PendingIntent.getActivity(c, REQUEST_BASE, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, channel(hour)) : new Notification.Builder(c);
            builder.setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle("Time Is Money · " + (hour == 0 ? "Shift completed" : "OT " + hour + ":00"))
                .setContentText(OtMilestonePolicy.phrase(hour)).setContentIntent(open).setCategory(Notification.CATEGORY_REMINDER)
                .setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(true).setShowWhen(true);
            if (Build.VERSION.SDK_INT < 26) builder.setSound(sound, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            nm.notify(REQUEST_BASE + hour, builder.build());
            prefs(c).edit().putString("error", "").apply();
            return true;
        } catch (Exception error) {
            prefs(c).edit().putString("error", "Android could not deliver the OT notification").apply();
            return false;
        }
    }

    public static boolean test(Context c, int seconds) {
        try {
            long due = System.currentTimeMillis() + Math.max(2, Math.min(60, seconds)) * 1000L;
            PendingIntent pi = PendingIntent.getBroadcast(c, TEST_REQUEST,
                new Intent(c, OtMilestoneAlarmReceiver.class).setAction(FIRE).putExtra("test", true).putExtra("due", due),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            setAlarm(c, due, pi);
            return true;
        } catch (Exception error) { return false; }
    }

    public static String status(Context c) {
        JSONObject v = new JSONObject();
        try {
            SharedPreferences p = prefs(c);
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            AudioManager audio = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
            boolean channelsEnabled = true, soundsEnabled = true, voiceAssets = true;
            JSONArray channels = new JSONArray(), blocked = new JSONArray(), silent = new JSONArray(), changed = new JSONArray();
            for (int h = 0; h <= OtMilestonePolicy.MAX_HOUR; h++) {
                voiceAssets &= c.getResources().getIdentifier("ot_milestone_" + h, "raw", c.getPackageName()) != 0;
                NotificationChannel ch = null;
                if (Build.VERSION.SDK_INT >= 26 && nm != null) {
                    ch = nm.getNotificationChannel(channel(h));
                }
                boolean exists = ch != null;
                boolean enabled = !exists || ch.getImportance() != NotificationManager.IMPORTANCE_NONE;
                boolean audible = !exists || ch.getSound() != null && ch.getImportance() >= NotificationManager.IMPORTANCE_DEFAULT;
                boolean voiceSelected = !exists || Uri.parse("content://" + c.getPackageName() + ".ot-sounds/" + h).equals(ch.getSound());
                channelsEnabled &= enabled;
                soundsEnabled &= audible;
                channels.put(new JSONObject().put("hour", h).put("id", channel(h)).put("created", exists)
                    .put("enabled", enabled).put("soundEnabled", audible).put("voiceSoundSelected", voiceSelected)
                    .put("importance", exists ? ch.getImportance() : NotificationManager.IMPORTANCE_HIGH));
                if (!enabled) blocked.put(h);
                else if (!audible) silent.put(h);
                else if (!voiceSelected) changed.put(h);
            }
            long now = System.currentTimeMillis(), base = p.getLong("base", 0);
            int mask = p.getInt("delivered", 0), futureCount = 0;
            boolean enabled = p.getBoolean("enabled", false);
            boolean valid = enabled && OtMilestonePolicy.validSchedule(base, now, p.getString("key", ""));
            for (int h = 0; h <= OtMilestonePolicy.MAX_HOUR; h++) {
                if (valid && OtMilestonePolicy.shouldSchedule(base, h, now, mask)) futureCount++;
            }
            boolean notifications = nm != null && nm.areNotificationsEnabled();
            int alarmVolume = audio == null ? 0 : audio.getStreamVolume(AudioManager.STREAM_ALARM);
            boolean dnd = nm != null && nm.getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_ALL;
            v.put("supported", true).put("enabled", enabled).put("exactAllowed", exactAllowed(c))
                .put("active", valid && (futureCount > 0 || OtMilestonePolicy.latestDeliverableHour(base, now, mask) >= 0))
                .put("futureAlarmCount", futureCount)
                .put("notificationsEnabled", notifications).put("deliveredMask", mask)
                .put("channelsEnabled", channelsEnabled).put("soundsEnabled", soundsEnabled).put("voiceAssetsAvailable", voiceAssets)
                .put("channels", channels).put("blockedHours", blocked).put("silentHours", silent).put("changedSoundHours", changed)
                .put("alarmVolume", alarmVolume).put("dndActive", dnd)
                .put("voiceReady", notifications && voiceAssets && alarmVolume > 0 && !dnd && channelsEnabled && soundsEnabled && changed.length() == 0)
                .put("lastDeliveredAt", p.getLong("lastDeliveredAt", 0)).put("lastDeliveredHour", p.getInt("lastDeliveredHour", -1))
                .put("deliveryWindowMinutes", OtMilestonePolicy.DELIVERY_WINDOW_MS / 60_000L)
                .put("error", p.getString("error", ""));
        } catch (Exception ignored) {}
        return v.toString();
    }
}
