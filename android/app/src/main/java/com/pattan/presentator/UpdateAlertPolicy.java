package com.pattan.presentator;

final class UpdateAlertPolicy {
    private UpdateAlertPolicy() {}

    static boolean validVersion(String version) {
        return version != null && version.length() <= 40 && version.matches("[0-9]{1,9}(\\.[0-9]{1,9}){0,4}");
    }

    static int compareVersions(String first, String second) {
        if (!validVersion(first) || !validVersion(second)) throw new IllegalArgumentException("Invalid app version");
        String[] a = first.split("\\.");
        String[] b = second.split("\\.");
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            int left = i < a.length ? Integer.parseInt(a[i]) : 0;
            int right = i < b.length ? Integer.parseInt(b[i]) : 0;
            if (left != right) return Integer.compare(left, right);
        }
        return 0;
    }

    static boolean validBuild(String build) {
        return build != null && build.length() > 0 && build.length() <= 160 && build.matches("[A-Za-z0-9._-]+");
    }

    static boolean shouldNotify(String version, String build, String installedVersion, String installedBuild, String lastNotified) {
        if (!validVersion(version) || !validVersion(installedVersion) || !validBuild(build) || build.equals(lastNotified)) return false;
        int comparison = compareVersions(version, installedVersion);
        return comparison > 0 || (comparison == 0 && installedBuild != null && !installedBuild.isEmpty() && !build.equals(installedBuild));
    }

    static boolean isOlderThanHighest(String version, String highestVersion) {
        return validVersion(version) && validVersion(highestVersion) && compareVersions(version, highestVersion) < 0;
    }

    static boolean alreadyAnnouncedForVersion(String version, String highestVersion, String build, java.util.Set<String> announced) {
        return validVersion(version) && validVersion(highestVersion) && compareVersions(version, highestVersion) == 0 && announced != null && announced.contains(build);
    }

    static String channelId(boolean spoken, boolean silentSpeech, boolean assetAvailable) {
        if (!spoken || !assetAvailable) return "tim_updates_v1";
        return silentSpeech ? "tim_update_voice_alarm_v1" : "tim_update_voice_v1";
    }
}
