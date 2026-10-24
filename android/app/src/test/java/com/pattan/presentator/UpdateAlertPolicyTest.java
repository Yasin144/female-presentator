package com.pattan.presentator;

import org.junit.Test;
import static org.junit.Assert.*;

public class UpdateAlertPolicyTest {
    @Test public void comparesNumericVersionsWithoutLexicalMistakes() {
        assertTrue(UpdateAlertPolicy.compareVersions("8.2.100", "8.2.33") > 0);
        assertTrue(UpdateAlertPolicy.compareVersions("8.10", "8.2.33") > 0);
        assertEquals(0, UpdateAlertPolicy.compareVersions("8.2.33.0", "8.2.33"));
        assertTrue(UpdateAlertPolicy.compareVersions("8.2.3", "8.2.33") < 0);
    }

    @Test public void rejectsInvalidOrOversizedManifestFields() {
        for (String version : new String[]{"", "eight", "8..2", "8.2.33-beta", "99999999999", "1.2.3.4.5.6", "8.2.33\n"}) {
            assertFalse(version, UpdateAlertPolicy.validVersion(version));
        }
        assertFalse(UpdateAlertPolicy.validBuild(""));
        assertFalse(UpdateAlertPolicy.validBuild("../unsafe"));
        assertFalse(UpdateAlertPolicy.validBuild("build with spaces"));
        assertTrue(UpdateAlertPolicy.validBuild("ota_8_2_34_release"));
    }

    @Test public void notifiesNewVersionsOnlyOnce() {
        assertTrue(UpdateAlertPolicy.shouldNotify("8.2.34", "new", "8.2.33", "current", ""));
        assertFalse(UpdateAlertPolicy.shouldNotify("8.2.34", "new", "8.2.33", "current", "new"));
        assertFalse(UpdateAlertPolicy.shouldNotify("8.2.32", "old", "8.2.33", "current", ""));
        assertFalse(UpdateAlertPolicy.shouldNotify("8.2.33", "current", "8.2.33", "current", ""));
    }

    @Test public void supportsHotfixWithoutNaggingEqualBuiltinVersion() {
        assertTrue(UpdateAlertPolicy.shouldNotify("8.2.33", "hotfix", "8.2.33", "current", ""));
        assertFalse(UpdateAlertPolicy.shouldNotify("8.2.33", "release", "8.2.33", "", ""));
    }

    @Test public void channelsRequireExplicitSpeechAndSilentOptIns() {
        assertEquals("tim_updates_v1", UpdateAlertPolicy.channelId(false, false, true));
        assertEquals("tim_updates_v1", UpdateAlertPolicy.channelId(false, true, true));
        assertEquals("tim_updates_v1", UpdateAlertPolicy.channelId(true, true, false));
        assertEquals("tim_update_voice_v1", UpdateAlertPolicy.channelId(true, false, true));
        assertEquals("tim_update_voice_alarm_v1", UpdateAlertPolicy.channelId(true, true, true));
    }

    @Test public void rejectsStaleFallbackAfterSeeingANewerVersion() {
        assertTrue(UpdateAlertPolicy.isOlderThanHighest("8.2.34", "8.2.35"));
        assertFalse(UpdateAlertPolicy.isOlderThanHighest("8.2.35", "8.2.35"));
        assertFalse(UpdateAlertPolicy.isOlderThanHighest("8.2.36", "8.2.35"));
        assertFalse(UpdateAlertPolicy.isOlderThanHighest("8.2.34", ""));
    }

    @Test public void remembersMultipleHotfixAnnouncementsForTheSameVersion() {
        java.util.Set<String> announced = new java.util.HashSet<>();
        announced.add("hotfix-a");
        announced.add("hotfix-b");
        assertTrue(UpdateAlertPolicy.alreadyAnnouncedForVersion("8.2.35", "8.2.35", "hotfix-a", announced));
        assertTrue(UpdateAlertPolicy.alreadyAnnouncedForVersion("8.2.35.0", "8.2.35", "hotfix-b", announced));
        assertFalse(UpdateAlertPolicy.alreadyAnnouncedForVersion("8.2.35", "8.2.35", "hotfix-c", announced));
        assertFalse(UpdateAlertPolicy.alreadyAnnouncedForVersion("8.2.36", "8.2.35", "hotfix-a", announced));
    }
}
