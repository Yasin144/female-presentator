package com.pattan.presentator;

import org.junit.Test;
import static org.junit.Assert.*;

public class WhatsAppTextPolicyTest {
    @Test public void rejectsEmptyReports() {
        assertFalse(WhatsAppTextPolicy.validMessage(null));
        assertFalse(WhatsAppTextPolicy.validMessage(" \n\t"));
    }
    @Test public void acceptsCompleteMultilingualReportsAndLongNotes() {
        assertTrue(WhatsAppTextPolicy.validMessage("🟢 *IN REPORT*\nతెలుగు • हिन्दी • العربية\n₹12,345.50 & 100% + #?\nEnd"));
        assertTrue(WhatsAppTextPolicy.validMessage(new String(new char[20000]).replace('\0', 'x')));
    }
    @Test public void sizeLimitUsesActualUtf8BytesAndRejectsRatherThanTruncates() {
        assertTrue(WhatsAppTextPolicy.validMessage(new String(new char[128 * 1024]).replace('\0', 'x')));
        assertFalse(WhatsAppTextPolicy.validMessage(new String(new char[128 * 1024 + 1]).replace('\0', 'x')));
        assertFalse(WhatsAppTextPolicy.validMessage(new String(new char[50000]).replace('\0', '₹')));
    }
    @Test public void normalizesRecipientWithoutChoosingAnUnexpectedDefault() {
        assertEquals("917386726193", WhatsAppTextPolicy.recipient("+91 73867 26193"));
        assertEquals("917386726193", WhatsAppTextPolicy.recipient("7386726193"));
        assertEquals("", WhatsAppTextPolicy.recipient("PICK_CONTACT"));
        assertEquals("", WhatsAppTextPolicy.recipient(null));
        assertEquals("", WhatsAppTextPolicy.recipient("bad"));
    }
}
