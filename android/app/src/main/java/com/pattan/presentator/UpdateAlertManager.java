package com.pattan.presentator;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;
import java.util.HashSet;
import java.util.Set;

public final class UpdateAlertManager {
    private static final String PREFS = "pattan_update_alerts_v1";
    private static final String PERIODIC = "pattan_update_alert_periodic_v1";
    private static final String ONCE = "pattan_update_alert_once_v1";
    private static final int NOTIFICATION_ID = 8240;
    public static final int INTERVAL_MINUTES = 15;

    private UpdateAlertManager() {}

    static SharedPreferences prefs(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    static boolean isUdhaar(Context context) { return context.getPackageName().toLowerCase(java.util.Locale.ROOT).contains("udhaar"); }
    static String appName(Context context) { return isUdhaar(context) ? "Udhaar Book" : "Time Is Money"; }
    static String otaPrefs(Context context) { return isUdhaar(context) ? "udhaar_standalone_ota_prefs" : "pattan_live_ota_prefs"; }
    static String builtinVersion(Context context) { return isUdhaar(context) ? MainActivity.BUILTIN_UDHAAR_OTA_VERSION : MainActivity.BUILTIN_OTA_VERSION; }
    static boolean enabled(Context context) { return prefs(context).getBoolean("enabled", true); }

    static boolean voiceAssetAvailable(Context context) {
        return context.getResources().getIdentifier("update_available_voice", "raw", context.getPackageName()) != 0;
    }

    private static Uri voiceUri(Context context) {
        return Uri.parse("content://" + context.getPackageName() + ".update-sounds/available");
    }

    static String selectedChannel(Context context) {
        SharedPreferences p = prefs(context);
        return UpdateAlertPolicy.channelId(p.getBoolean("spoken", true), p.getBoolean("silent_speech", true), voiceAssetAvailable(context));
    }

    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        createChannel(manager, "tim_updates_v1", "App update alerts", RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), AudioAttributes.USAGE_NOTIFICATION_EVENT);
        if (voiceAssetAvailable(context)) {
            createChannel(manager, "tim_update_voice_v1", "Spoken app updates", voiceUri(context), AudioAttributes.USAGE_NOTIFICATION_EVENT);
            createChannel(manager, "tim_update_voice_alarm_v1", "Spoken updates in silent mode", voiceUri(context), AudioAttributes.USAGE_ALARM);
        }
    }

    private static void createChannel(NotificationManager manager, String id, String name, Uri sound, int usage) {
        // Never recreate or overwrite channels that the phone owner has customized.
        if (manager.getNotificationChannel(id) != null) return;
        NotificationChannel channel = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("App update messages. Sound, lock-screen visibility and Do Not Disturb remain under your control.");
        int contentType = "tim_updates_v1".equals(id) ? AudioAttributes.CONTENT_TYPE_SONIFICATION : AudioAttributes.CONTENT_TYPE_SPEECH;
        channel.setSound(sound, new AudioAttributes.Builder().setUsage(usage).setContentType(contentType).build());
        channel.enableVibration(true);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    public static void schedule(Context context) {
        reconcileInstalledUpdate(context);
        WorkManager work = WorkManager.getInstance(context);
        if (!enabled(context)) {
            work.cancelUniqueWork(PERIODIC);
            work.cancelUniqueWork(ONCE);
            return;
        }
        ensureChannels(context);
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(UpdateCheckWorker.class, INTERVAL_MINUTES, TimeUnit.MINUTES)
            .setConstraints(constraints).addTag(PERIODIC).build();
        work.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    public static boolean checkNow(Context context) {
        if (!enabled(context)) return false;
        try {
            Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
            OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(UpdateCheckWorker.class).setConstraints(constraints).build();
            WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.KEEP, request);
            return true;
        } catch (Exception error) {
            prefs(context).edit().putString("last_error", "Could not schedule update check").apply();
            return false;
        }
    }

    public static String configure(Context context, boolean enabled, boolean spoken, boolean silentSpeech) {
        prefs(context).edit().putBoolean("enabled", enabled).putBoolean("spoken", spoken).putBoolean("silent_speech", spoken && silentSpeech).apply();
        try {
            schedule(context);
            if (enabled) checkNow(context);
        } catch (Exception error) {
            prefs(context).edit().putString("last_error", "Could not schedule background update checks. Reopen the app and review battery settings.").apply();
        }
        return status(context);
    }

    static boolean notificationsGranted(Context context) {
        return Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean channelEnabled(Context context) {
        if (Build.VERSION.SDK_INT < 26) return true;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = manager == null ? null : manager.getNotificationChannel(selectedChannel(context));
        return channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    public static synchronized void reconcileInstalledUpdate(Context context) {
        SharedPreferences state = prefs(context);
        String availableVersion = state.getString("available_version", "");
        String availableBuild = state.getString("available_build", "");
        if (!UpdateAlertPolicy.validVersion(availableVersion) || !UpdateAlertPolicy.validBuild(availableBuild)) return;
        SharedPreferences installed = context.getSharedPreferences(otaPrefs(context), Context.MODE_PRIVATE);
        if (!UpdateAlertPolicy.shouldNotify(availableVersion, availableBuild, installed.getString("ota_version", builtinVersion(context)), installed.getString("ota_build_id", ""), "")) {
            state.edit().remove("available_version").remove("available_build").remove("available_notes").apply();
            try { NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID); } catch (Exception ignored) {}
        }
    }

    public static synchronized boolean notifyAvailable(Context context, String version, String buildId, String notes) {
        reconcileInstalledUpdate(context);
        if (!enabled(context)) return false;
        SharedPreferences state = prefs(context);
        SharedPreferences installed = context.getSharedPreferences(otaPrefs(context), Context.MODE_PRIVATE);
        String currentVersion = installed.getString("ota_version", builtinVersion(context));
        String currentBuild = installed.getString("ota_build_id", "");
        if (!UpdateAlertPolicy.validVersion(version) || !UpdateAlertPolicy.validBuild(buildId)) return false;
        if (!UpdateAlertPolicy.shouldNotify(version, buildId, currentVersion, currentBuild, "")) return false;
        String highest = state.getString("highest_available_version", "");
        if (UpdateAlertPolicy.isOlderThanHighest(version, highest)) return false;
        Set<String> announcedBuilds = new HashSet<>();
        if (UpdateAlertPolicy.validVersion(highest) && UpdateAlertPolicy.compareVersions(version, highest) == 0) announcedBuilds.addAll(state.getStringSet("announced_builds_for_version", java.util.Collections.emptySet()));
        if (UpdateAlertPolicy.alreadyAnnouncedForVersion(version, highest, buildId, announcedBuilds)) return false;
        if (buildId.equals(state.getString("last_notified_build", ""))) {
            announcedBuilds.add(buildId);
            state.edit().putString("highest_available_version", version).putStringSet("announced_builds_for_version", announcedBuilds).apply();
            return false;
        }
        state.edit().putString("highest_available_version", version).putStringSet("announced_builds_for_version", announcedBuilds).apply();
        String safeNotes = notes == null ? "" : notes.trim().substring(0, Math.min(notes.trim().length(), 1200));
        state.edit().putString("available_version", version).putString("available_build", buildId).putString("available_notes", safeNotes).apply();
        ensureChannels(context);
        if (!notificationsGranted(context) || !NotificationManagerCompat.from(context).areNotificationsEnabled() || !channelEnabled(context)) {
            state.edit().putString("last_error", "Allow app and update-channel notifications in Android settings.").apply();
            return false;
        }
        try {
            Intent launch = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launch.putExtra("pattan_update_available", true);
            launch.putExtra("pattan_update_build", buildId);
            PendingIntent open = PendingIntent.getActivity(context, NOTIFICATION_ID, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            String body = "Version " + version + " is available. Open the app to review the update.";
            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, selectedChannel(context))
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(appName(context) + " update available")
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body + (safeNotes.isEmpty() ? "" : "\n" + safeNotes)))
                .setContentIntent(open).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_STATUS).setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
            if (Build.VERSION.SDK_INT < 26) {
                boolean spoken = state.getBoolean("spoken", true) && voiceAssetAvailable(context);
                Uri sound = spoken ? voiceUri(context) : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                builder.setSound(sound, spoken && state.getBoolean("silent_speech", true) ? AudioManager.STREAM_ALARM : AudioManager.STREAM_NOTIFICATION);
            }
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
            announcedBuilds.add(buildId);
            state.edit().putStringSet("announced_builds_for_version", announcedBuilds).putString("last_notified_build", buildId).putLong("last_notified_at", System.currentTimeMillis()).putString("last_error", "").apply();
            return true;
        } catch (SecurityException error) {
            state.edit().putString("last_error", "Android blocked update notifications. Review notification permissions.").apply();
        } catch (Exception error) {
            state.edit().putString("last_error", "Could not post update notification.").apply();
        }
        return false;
    }

    public static boolean testAlert(Context context) {
        if (!enabled(context)) return false;
        ensureChannels(context);
        if (!notificationsGranted(context) || !NotificationManagerCompat.from(context).areNotificationsEnabled() || !channelEnabled(context)) return false;
        try {
            Intent launch = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent open = PendingIntent.getActivity(context, NOTIFICATION_ID + 1, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder notification = new NotificationCompat.Builder(context, selectedChannel(context))
                .setSmallIcon(android.R.drawable.stat_sys_download_done).setContentTitle(appName(context) + " — alert sound test")
                .setContentText("This is a test of your chosen update announcement. No update was installed.")
                .setContentIntent(open).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH);
            if (Build.VERSION.SDK_INT < 26) notification.setSound(prefs(context).getBoolean("spoken", true) ? voiceUri(context) : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), prefs(context).getBoolean("silent_speech", true) ? AudioManager.STREAM_ALARM : AudioManager.STREAM_NOTIFICATION);
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID + 1, notification.build());
            return true;
        } catch (Exception ignored) { return false; }
    }

    public static String status(Context context) {
        JSONObject result = new JSONObject();
        try {
            reconcileInstalledUpdate(context);
            ensureChannels(context);
            SharedPreferences p = prefs(context);
            AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            boolean dnd = manager != null && manager.getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_ALL && manager.getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_UNKNOWN;
            int notificationVolume = audio == null ? 0 : audio.getStreamVolume(AudioManager.STREAM_NOTIFICATION);
            int alarmVolume = audio == null ? 0 : audio.getStreamVolume(AudioManager.STREAM_ALARM);
            boolean ringerSilenced = audio != null && audio.getRingerMode() != AudioManager.RINGER_MODE_NORMAL;
            NotificationChannel channel = Build.VERSION.SDK_INT >= 26 && manager != null ? manager.getNotificationChannel(selectedChannel(context)) : null;
            boolean channelSoundEnabled = Build.VERSION.SDK_INT < 26 || (channel != null && channel.getSound() != null);
            boolean channelVoiceSoundSelected = Build.VERSION.SDK_INT < 26 || (channel != null && voiceUri(context).equals(channel.getSound()));
            boolean allowed = notificationsGranted(context) && NotificationManagerCompat.from(context).areNotificationsEnabled() && channelEnabled(context);
            boolean spoken = p.getBoolean("spoken", true);
            boolean inSilent = p.getBoolean("silent_speech", true);
            result.put("supported", true);
            result.put("enabled", enabled(context));
            result.put("spokenEnabled", spoken);
            result.put("speakInSilent", inSilent);
            result.put("notificationsGranted", notificationsGranted(context));
            result.put("notificationsEnabled", NotificationManagerCompat.from(context).areNotificationsEnabled());
            result.put("channelEnabled", channelEnabled(context));
            result.put("channelId", selectedChannel(context));
            result.put("channelSoundEnabled", channelSoundEnabled);
            result.put("channelVoiceSoundSelected", channelVoiceSoundSelected);
            result.put("channelImportance", channel == null ? NotificationCompat.PRIORITY_HIGH : channel.getImportance());
            result.put("voiceAssetAvailable", voiceAssetAvailable(context));
            result.put("voiceReady", enabled(context) && spoken && voiceAssetAvailable(context) && allowed && channelSoundEnabled && channelVoiceSoundSelected && (inSilent ? alarmVolume > 0 : notificationVolume > 0 && !ringerSilenced) && !dnd);
            result.put("dndActive", dnd);
            result.put("notificationVolume", notificationVolume);
            result.put("alarmVolume", alarmVolume);
            result.put("ringerSilenced", ringerSilenced);
            PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            result.put("batteryOptimizationExempt", power != null && power.isIgnoringBatteryOptimizations(context.getPackageName()));
            result.put("lastCheckedAt", p.getLong("last_checked_at", 0L));
            result.put("lastCheckError", p.getString("last_error", ""));
            result.put("availableVersion", p.getString("available_version", ""));
            result.put("availableBuildId", p.getString("available_build", ""));
            result.put("availableNotes", p.getString("available_notes", ""));
            result.put("lastNotifiedBuildId", p.getString("last_notified_build", ""));
            result.put("checkIntervalMinutes", INTERVAL_MINUTES);
            result.put("timingNote", "Android schedules checks about every 15 minutes when online. Doze, force-stop and phone battery restrictions can delay them; this is not instant push.");
            result.put("voiceDelivery", "notification-sound");
            result.put("speechNotice", "A short packaged update announcement plays through the selected Android notification channel, even with the screen off. Silent-mode speech uses alarm audio only when opted in. Muted volume, Do Not Disturb and channel settings can still silence it. The app never raises volume or bypasses Do Not Disturb.");
        } catch (Exception error) {
            try { result.put("supported", false); result.put("lastCheckError", "Update alert status unavailable."); } catch (Exception ignored) {}
        }
        return result.toString();
    }
}
