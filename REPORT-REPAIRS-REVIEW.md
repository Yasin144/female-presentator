# Time Is Money 8.2.38 — reports and Android repair review

## Web repairs

Resend Today's Statement now prepares a manual WhatsApp draft from today's saved attendance and all completed expenses on that exact date. It does not depend on the automatic-send switch, a Cloud API configuration or a paid relay. Missing attendance produces a clear notice instead of borrowing the selected calendar day's inputs. IN-only records show pay as pending until OUT. The entire prepared text stays available for review, retry and copying; opening WhatsApp never marks a report delivered.

The payslip presents full earnings and net receivable together, with base salary, overtime, allowances, leave deductions and saved-day earnings below. Payment-date controls and employee/attendance details are expandable. Full earnings are base plus OT plus allowances; net receivable is the existing full-month amount after leave deductions. Personal expenses and payment credits remain separate. No salary calculation or storage identity changed.

CSV, genuine paginated PDF and WhatsApp use the same report model and selected month. CSV has an Excel-compatible UTF-8 BOM and safely quoted/formula-protected text. PDF embeds the existing Nunito font, includes summary and daily attendance tables, and marks unsaved rows as estimates. WhatsApp sharing uses native full-text sharing where available and retains copy/retry controls and the selected recipient mode.

Expense statements now have readable dates, 12-hour times, numbered payments, purpose/reference fields, a subtotal for each date and an explicit final total. Normal payment paragraphs stay together across numbered parts. Long notes and Unicode are retained. One-date messages explicitly label Date. Copy for Excel remains available.

## Native APK repairs prepared

- A restricted `PattanReportFiles` interface opens Android's document picker for CSV, PDF, XLSX and JSON. It accepts only the specified formats, safe filenames and files up to 12 MB. It writes to the user's chosen content URI without requesting broad storage permission, reports success only after stream closure, returns the selected filename when available, and distinguishes cancellation, failure and completion. APK clients use this path; older APKs get an honest upgrade-required message.
- Background update alerts default on. Voice and silent-mode alarm-channel speech now default on when those preferences have never been stored, as requested; existing explicit preferences are preserved. The panel can enable all three together and resolves either supported native bridge name. The alarm channel uses `USAGE_ALARM`, and phone volume/DND/channel settings remain owner-controlled.
- Test update alert posts a separate test notification without recording a fake available version or altering update deduplication. Actual update checks remain Android WorkManager jobs and may be delayed by network, Doze or Infinix battery restrictions. Screen-off audio requires the native APK and must still be verified on the physical phone.
- The candidate retains package `com.pattan.presentator`, targets Android 16, version 8.2.38/code 26, and includes the earlier full-text WhatsApp and OT reminder native fixes plus all ten voice files. It is a production build, not the network-blocked QA renderer.

## Verification

732 executable app checks pass, including 89 expense-export checks and 76 salary/statement/file/alert checks. All 63 financial/storage preservation comparisons still pass against the original baseline. The actual manual-resend handler executes with automatic sending absent, refuses missing/mismatched records, includes more than five expenses and excludes other dates/refunds. Native file callbacks cover success, cancellation, malformed replies, unrelated request IDs, Unicode, size limits and errors.

Both Android unit suites pass: 52 tests, zero failures/errors. Release compilation and vital lint pass. The built APK's native interfaces and all ten voice assets are verified. No signing key or QA fixture is included.

Browser checks use synthetic, isolated data. The production IIFE exercised the compact payslip, exact WhatsApp payloads, statement resend with automatic sending OFF, all three enabled alert switches, test-alert action, file-save cancellation and complete CSV/PDF bytes through the native-interface fixture. Downloaded CSV and real two-page PDF match the displayed gross/net totals; both PDF pages were rendered and inspected. These fixtures do not establish physical Android picker, notification or audio behavior. No live WhatsApp message was sent and no real phone or account data was changed.

## Signing and publication boundary

The signed APK is not complete. The available local debug key was compared to the certificate in the previously captured installed APK and does not match. The signing script correctly rejected it before signing or installing anything. It reads passwords from private environment variables, verifies the original certificate before signing, and verifies the result afterward. A different signing key is not an installable update for the existing app.

YASIN DELL is offline and no USB phone is connected; the user chose to continue code repairs. Recover/verify the original key when the computer is available, sign the prepared candidate and obtain the user's approval before publishing/installing the APK. Never uninstall or clear data to bypass a certificate mismatch. Native switches and Android file saving cannot become available on the installed older APK through OTA alone.

The compatible web release is OTA 8.2.38; APK publication remains separate and unapproved. Review records are under ignored `review/report-repairs/`, `review/native-repairs-8.2.38/` and `review/ota-8.2.38-publication/`.
