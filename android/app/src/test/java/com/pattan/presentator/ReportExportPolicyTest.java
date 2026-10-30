package com.pattan.presentator;

import org.junit.Test;
import static org.junit.Assert.*;

public class ReportExportPolicyTest {
    @Test public void permitsOnlyAppDocumentOrigin() {
        assertTrue(ReportExportPolicy.trustedDocument("https://localhost/index.html"));
        assertTrue(ReportExportPolicy.trustedDocument("https://localhost:443/?app=salary"));
        for (String url : new String[]{null, "http://localhost/", "https://localhost.evil.test/", "https://user@localhost/", "https://localhost:8443/", "https://example.com/", "file:///sdcard/a.html"}) assertFalse(ReportExportPolicy.trustedDocument(url));
    }
    @Test public void matchesReportExtensionToMime() {
        assertTrue(ReportExportPolicy.validNameAndType("Expenses-2026-10-30.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
        assertTrue(ReportExportPolicy.validNameAndType("Payslip-2026-10.pdf", "application/pdf"));
        assertTrue(ReportExportPolicy.validNameAndType("Payslip.csv", "text/csv"));
        assertTrue(ReportExportPolicy.validNameAndType("Backup.json", "application/json"));
        assertFalse(ReportExportPolicy.validNameAndType("Payslip.pdf", "text/html"));
        assertFalse(ReportExportPolicy.validNameAndType("Expenses.xlsx", "application/pdf"));
    }
    @Test public void rejectsPathsExecutablesAndMalformedNames() {
        for (String name : new String[]{null, "", ".pdf", "../payslip.pdf", "a/secret.pdf", "a\\secret.pdf", "file.pdf.exe", "file\n.pdf", "'report'.pdf", new String(new char[121]).replace('\0', 'a') + ".pdf"}) assertFalse(ReportExportPolicy.validNameAndType(name, "application/pdf"));
    }
}
