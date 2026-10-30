# Expenses-only export — OTA 8.2.37

The expense Transactions footer and Sync & export screen open the same date-based export dialog. It supports one date, an inclusive date range, and all saved dates. Only positive, completed debit expenses with valid dates are included. Income, refunds, deleted/demo records, pending/failed/reversed payments and possible duplicates are excluded. Existing ledgers, stored balances, attendance and salary calculations are unchanged.

## Outputs

- WhatsApp messages group the selected expenses by date, show daily and overall totals, and include payment purpose and method. The user chooses a contact or enters a number and reviews/sends in WhatsApp. Long reports use numbered parts without discarding text; each part needs a separate explicit tap. Copy and preview remain available if WhatsApp cannot open.
- Real `.xlsx` workbooks contain Expenses, Daily totals and Report details sheets. Amounts are numeric, references remain text, the detail sheet has an autofilter and frozen header, and user-entered text is not converted to a formula.
- Copy for Excel produces a tab-separated expense table for pasting into Excel/Sheets. It includes a total and escapes formula-leading user text. When clipboard access is unavailable the table remains selectable for manual copying.

## Android file-saving boundary

Inspection of this project's native Java and Capacitor configuration found no download handler, file-saving JavaScript bridge or Filesystem plugin. Android WebView needs native [download handling](https://developer.android.com/reference/android/webkit/WebView#setDownloadListener(android.webkit.DownloadListener)); device-file access is supplied by a native plugin such as [Capacitor Filesystem](https://capacitorjs.com/docs/apis/filesystem). OTA JavaScript cannot install that native capability.

Therefore browser `.xlsx` downloads are enabled and tested. The Android WebView branch explicitly disables the unsupported file-save action and explains that it needs the signed APK update; Copy for Excel and WhatsApp remain usable through OTA. The app does not claim that an Android file was saved. The user was informed of this limitation before publication. No APK is published or installed with this release.

## Verification

- 639 executable app checks pass: 567 existing checks and 72 export checks. Date boundaries, leap/invalid dates, empty and reversed ranges, exclusion rules, exact minor-unit totals, long Unicode messages, contact selection, formula-like text, preserved references and 2,000-row workbooks are covered. The unchanged financial/storage baseline checks still pass.
- Generated `.xlsx` files were opened with ExcelJS and the details, daily totals, cell types and totals checked. Actual browser downloads from the UI and the packaged OTA were also opened and verified (two synthetic expenses, INR 155.75).
- UI checks cover single-date, range and all-date totals, empty/error states, invalid phone input, preview/copy, exact WhatsApp payload, native-safe Copy for Excel, Escape/focus restoration, and opening export from Sync & export. Dialog layout passed at widths 320, 390 and 1440 without internal horizontal overflow.
- The production IIFE ran with an older-APK bridge mock and synthetic in-memory transactions. No real phone, account, private ledger or live WhatsApp recipient was used. Runtime errors: zero.
- OTA validation verifies one standalone JS payload, embedded font assets, hashes and immutability of earlier release payloads. Udhaar remains 1.0.11. Native Android and desktop output are excluded from the publication commit.

Review workbooks and screenshots are under ignored `review/expense-export/`. Publication hashes and live-server checks are under `review/ota-8.2.37-publication/`.
