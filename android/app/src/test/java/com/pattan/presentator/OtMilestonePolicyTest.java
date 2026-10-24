package com.pattan.presentator;

import org.junit.Test;
import static org.junit.Assert.*;

public class OtMilestonePolicyTest {
    private static final long NOW = 1_800_000_000_000L;
    @Test public void validatesSavedShift() {
        assertFalse(OtMilestonePolicy.validSchedule(0, NOW, "shift"));
        assertFalse(OtMilestonePolicy.validSchedule(NOW, NOW, ""));
        assertFalse(OtMilestonePolicy.validSchedule(NOW, NOW, null));
        assertFalse(OtMilestonePolicy.validSchedule(NOW - 10 * OtMilestonePolicy.HOUR_MS, NOW, "shift"));
        assertFalse(OtMilestonePolicy.validSchedule(NOW + 49 * OtMilestonePolicy.HOUR_MS, NOW, "shift"));
        assertTrue(OtMilestonePolicy.validSchedule(NOW + 1, NOW, "saved-shift"));
        assertTrue(OtMilestonePolicy.validSchedule(NOW - 9 * OtMilestonePolicy.HOUR_MS, NOW, "shift"));
        assertTrue(OtMilestonePolicy.validSchedule(NOW + 48 * OtMilestonePolicy.HOUR_MS, NOW, "shift"));
        assertFalse(OtMilestonePolicy.validSchedule(NOW, NOW, new String(new char[161]).replace('\0', 'x')));
    }
    @Test public void startupNeverSchedulesPastOrReplaysDeliveredHours() {
        for (int h = 0; h <= 8; h++) {
            long due = OtMilestonePolicy.at(NOW, h);
            assertTrue(OtMilestonePolicy.shouldSchedule(NOW, h, NOW - 1, 0));
            assertFalse(OtMilestonePolicy.shouldSchedule(NOW, h, due, 0));
            assertFalse(OtMilestonePolicy.shouldSchedule(NOW, h, due + 1, 0));
            assertFalse(OtMilestonePolicy.shouldSchedule(NOW, h, NOW - 1, 1 << h));
        }
    }
    @Test public void deliveryAllowsIdleBatchingButRemainsBounded() {
        for (int h = 0; h <= 8; h++) {
            long due = OtMilestonePolicy.at(NOW, h);
            assertFalse(OtMilestonePolicy.shouldDeliver(NOW, h, due - 1, 0));
            assertTrue(OtMilestonePolicy.shouldDeliver(NOW, h, due, 0));
            assertTrue(OtMilestonePolicy.shouldDeliver(NOW, h, due + 15 * 60_000L, 0));
            assertTrue(OtMilestonePolicy.shouldDeliver(NOW, h, due + 30 * 60_000L, 0));
            assertFalse(OtMilestonePolicy.shouldDeliver(NOW, h, due + 30 * 60_000L + 1, 0));
            assertFalse(OtMilestonePolicy.shouldDeliver(NOW, h, due, 1 << h));
        }
    }
    @Test public void hourlyCadenceWorksAcrossMidnight() {
        for (int h = 1; h <= 8; h++) assertEquals(3_600_000L, OtMilestonePolicy.at(NOW, h) - OtMilestonePolicy.at(NOW, h - 1));
        assertFalse(OtMilestonePolicy.shouldSchedule(NOW, -1, NOW - 1, 0));
        assertFalse(OtMilestonePolicy.shouldSchedule(NOW, 9, NOW - 1, 0));
        assertFalse(OtMilestonePolicy.shouldDeliver(NOW, 9, NOW + 9 * 3_600_000L, 0));
    }
    @Test public void phrasesMatchHour() {
        assertEquals("Your time has completed", OtMilestonePolicy.phrase(0));
        assertEquals("1 hour completed", OtMilestonePolicy.phrase(1));
        assertEquals("8 hours completed", OtMilestonePolicy.phrase(8));
    }

    @Test public void delayedAlarmAnnouncesLatestHourInsteadOfOldSequence() {
        long now = NOW + 3 * OtMilestonePolicy.HOUR_MS + 15 * 60_000L;
        assertEquals(3, OtMilestonePolicy.deliveryHour(NOW, 0, now, 0));
        assertEquals(3, OtMilestonePolicy.deliveryHour(NOW, 1, now, 0));
        assertEquals(3, OtMilestonePolicy.deliveryHour(NOW, 2, now, 0));
        assertEquals(3, OtMilestonePolicy.deliveryHour(NOW, 3, now, 0));
        assertFalse(OtMilestonePolicy.shouldDeliver(NOW, 0, now, 0));
        assertFalse(OtMilestonePolicy.shouldDeliver(NOW, 1, now, 0));
        assertFalse(OtMilestonePolicy.shouldDeliver(NOW, 2, now, 0));
    }

    @Test public void batchedPendingIntentsCannotReplayAnAlreadyDeliveredLatestHour() {
        long now = NOW + 3 * OtMilestonePolicy.HOUR_MS + 15 * 60_000L;
        int mask = 0;
        int delivered = OtMilestonePolicy.deliveryHour(NOW, 0, now, mask);
        assertEquals(3, delivered);
        mask |= 1 << delivered;
        for (int pending = 0; pending <= 3; pending++) {
            assertEquals(-1, OtMilestonePolicy.deliveryHour(NOW, pending, now, mask));
        }
        assertEquals(-1, OtMilestonePolicy.latestDeliverableHour(NOW, now, mask));
    }

    @Test public void restoreRecoversRecentDueHourAndPreservesFutureHours() {
        long now = NOW + OtMilestonePolicy.HOUR_MS + 15 * 60_000L;
        int recovered = OtMilestonePolicy.latestDeliverableHour(NOW, now, 0);
        assertEquals(1, recovered);
        int mask = 1 << recovered;
        assertEquals(-1, OtMilestonePolicy.latestDeliverableHour(NOW, now, mask));
        for (int hour = 0; hour <= 8; hour++) {
            assertEquals(hour >= 2, OtMilestonePolicy.shouldSchedule(NOW, hour, now, mask));
        }
    }

    @Test public void restoreDoesNotReplayStaleOrPreviouslyHandledHours() {
        assertEquals(-1, OtMilestonePolicy.latestDeliverableHour(NOW, NOW + 31 * 60_000L, 0));
        assertEquals(-1, OtMilestonePolicy.latestDeliverableHour(NOW, NOW + OtMilestonePolicy.HOUR_MS + 31 * 60_000L, 0));
        assertEquals(-1, OtMilestonePolicy.latestDeliverableHour(NOW, NOW + OtMilestonePolicy.HOUR_MS + 1, 1 << 1));
        // An unhandled older hour is never used as a fallback for the handled latest hour.
        assertFalse(OtMilestonePolicy.shouldDeliver(NOW, 0, NOW + OtMilestonePolicy.HOUR_MS + 1, 1 << 1));
    }

    @Test public void earlyAndInvalidIntentsCannotTriggerSpeech() {
        assertEquals(-1, OtMilestonePolicy.latestDeliverableHour(NOW, NOW - 1, 0));
        assertEquals(-1, OtMilestonePolicy.latestDeliverableHour(0, NOW, 0));
        assertEquals(-1, OtMilestonePolicy.deliveryHour(NOW, -1, NOW, 0));
        assertEquals(-1, OtMilestonePolicy.deliveryHour(NOW, 9, NOW, 0));
        assertEquals(-1, OtMilestonePolicy.deliveryHour(NOW, 1, NOW + 60_000L, 0));
    }

    @Test public void finalHourExpiresWithoutWrappingOrReplaying() {
        long last = NOW + 8 * OtMilestonePolicy.HOUR_MS;
        assertEquals(8, OtMilestonePolicy.deliveryHour(NOW, 0, last + 30 * 60_000L, 0));
        assertEquals(-1, OtMilestonePolicy.deliveryHour(NOW, 0, last + 30 * 60_000L + 1, 0));
        assertEquals(-1, OtMilestonePolicy.latestDeliverableHour(NOW, NOW + 9 * OtMilestonePolicy.HOUR_MS, 0));
    }
}
