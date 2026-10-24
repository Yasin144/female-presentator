package com.pattan.presentator;

/** Pure timing rules shared by scheduling and delivery. */
public final class OtMilestonePolicy {
    public static final int MAX_HOUR = 8;
    public static final long HOUR_MS = 3_600_000L;
    // Allow Android's idle batching without replaying a sequence of old hours.
    public static final long DELIVERY_WINDOW_MS = 30 * 60_000L;
    private OtMilestonePolicy() {}

    public static boolean validSchedule(long base, long now, String key) {
        return key != null && !key.trim().isEmpty() && key.length() <= 160
            && base > 0 && base >= now - 9 * HOUR_MS && base <= now + 48 * HOUR_MS;
    }

    public static long at(long base, int hour) { return base + hour * HOUR_MS; }

    public static boolean shouldSchedule(long base, int hour, long now, int deliveredMask) {
        return hour >= 0 && hour <= MAX_HOUR && (deliveredMask & (1 << hour)) == 0
            && at(base, hour) > now;
    }

    public static boolean shouldDeliver(long base, int hour, long now, int deliveredMask) {
        return hour >= 0 && hour <= MAX_HOUR && latestDeliverableHour(base, now, deliveredMask) == hour;
    }

    public static int latestDeliverableHour(long base, long now, int deliveredMask) {
        if (base <= 0 || now < base) return -1;
        long elapsed = now - base;
        int hour = (int) Math.min(MAX_HOUR, elapsed / HOUR_MS);
        if (elapsed - hour * HOUR_MS > DELIVERY_WINDOW_MS || (deliveredMask & (1 << hour)) != 0) return -1;
        return hour;
    }

    public static int deliveryHour(long base, int triggeredHour, long now, int deliveredMask) {
        if (triggeredHour < 0 || triggeredHour > MAX_HOUR || now < at(base, triggeredHour)) return -1;
        return latestDeliverableHour(base, now, deliveredMask);
    }

    public static String phrase(int hour) {
        if (hour == 0) return "Your time has completed";
        return hour == 1 ? "1 hour completed" : hour + " hours completed";
    }
}
