# Transaction memory redesign

Implemented locally without installing, linking an account, or editing real transaction records. The resulting web interface was subsequently included in the user-approved OTA releases Time Is Money 8.2.34 and Udhaar 1.0.11, commit `db68b994c20f3e4edda2b2d33aca36584f9b7d0b`; native features were not installed.

## What changed

- Expenses opens on Transactions. The list shows the person/shop, paid/received direction, amount, a prominent memory note, and time/method. Secondary actions are in transaction details rather than many tiny buttons on every row.
- Search covers the existing transaction search fields. Paid/Received are direct filters; date/month/year, category, payment method, amount, review and note filters are grouped under Filters. Empty searches/dates stay empty rather than showing unrelated dates.
- Transactions and the Overview transaction section share the same presentation.
- New captured IDs are saved to the authoritative ledger immediately, but wait behind a fixed-height `View N new transactions` control before entering the current reading order. Existing row IDs and order stay stable even when captures change timestamps. First captures on an empty view appear directly. The user can search/filter all captured transactions before revealing them.
- Scan/undo notices are fixed overlays and cannot insert/remove content above the list. Passive duplicate captures no longer display repeated success notices. The new list uses ordinary page scrolling rather than nested smooth scrollers.
- The detail page puts Who/Why editing first. Live replacements of record objects cannot overwrite an unsaved note. The new memory save handler edits only the selected record and preserves amount, direction, reference, captured remark, balances and review status; it does not copy the note to other payments at the same merchant.
- Missing UPI IDs, references and recorded balances display `Not recorded`. The old detail presentation generated a fictitious UPI ID/reference and substituted the current balance for an unknown historic balance; those fallbacks are removed from this view.
- Android retries the normal update check on resume, including return from notification settings. Existing background alerts remain enabled by default, network-constrained and deduplicated per available build. WorkManager runs approximately every 15 minutes, subject to Android/OEM scheduling and notification/channel permissions.

## Verification

- `node scripts/test-transaction-memory.cjs`: live arrival batches, duplicate IDs, filters, authoritative row updates, immutable records, unknown details, individual note saves, preservation of captured/financial fields, and a 5,000-row reading-order case.
- `node scripts/test-salary-ui.cjs`: 63 pre-existing financial/storage nodes and all three storage-key sets unchanged, plus syntax checks.
- Existing navigation, OT and OTA-policy tests pass.
- Isolated Vite build succeeds. Android salary compilation/unit tests succeed.
- Real `ExpensesModule` rendered with disposable in-memory records and a simulated native capture event. No bank/account/production API was contacted. Live capture while reading `review-payment-15`: scrollY remained 2667 and row top remained 185.375px; three new entries waited behind the reveal button. Repeating the capture kept 30 displayed rows and 3 pending. Revealing displayed 33 records.
- Live search returned one matching memory, Received returned six entries, Received + missing note returned one, and a native date-input change to a date without transactions returned zero entries.
- A typed note survived record-object refresh; saving it changed only the selected payment, with another blank payment at the same shop remaining blank.
- Widths 360, 390, 430 and 1280 in light/dark: no document horizontal overflow; row height stayed 132px.

`review/transaction-memory-preview.html` is disposable test data only and excluded from production entry/build. Screenshots in `review/` are examples, not the user's financial records.

## Remaining release verification

No APK was installed on the phone in this side conversation. Build/sync the production entry after these source changes, preserve the existing package/signing identity, and verify capture/notification delivery on the physical Android 16 Infinix phone. Browser fixtures and JVM tests cannot certify OEM screen-off delivery.
