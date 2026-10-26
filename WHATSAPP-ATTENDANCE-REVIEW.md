# IN-punch WhatsApp draft recovery — 26 October 2026

The reported symptom is an empty WhatsApp composer after an IN punch. The existing report builder produces a non-empty report, but the old APK launches a pre-filled deep link asynchronously and reports success before launch. Whether the receiving WhatsApp activity consumed that link cannot be established from that return value. No physical reproduction has been claimed.

## Changes prepared locally

- A new Android bridge uses `ACTION_SEND`, `text/plain` and the entire unmodified report in `Intent.EXTRA_TEXT`. It opens WhatsApp (Business if regular WhatsApp is unavailable). WhatsApp may ask the user to choose the recipient; the app shows +91 7386726193. The user reviews and sends the message. This follows Android's [text sharing mechanism](https://developer.android.com/develop/ui/compose/sharing/send).
- The web client checks every supported bridge for the required method instead of stopping at the first bridge object. New APKs use text sharing; old APKs retain their existing draft launcher.
- The complete prepared report stays available in the current app session, with Copy full report, a selectable read-only text area and retry. Clipboard denial selects the full text and provides manual-copy instructions. The app does not infer successful delivery from a draft handoff.
- Punch notices say “WhatsApp report ready” instead of “WhatsApp Sent.” Changing accounts clears the prepared report. No report is added to persistent storage, and no financial/attendance calculation or storage key changed.
- The unapproved native candidate is Time Is Money 8.2.36, code 25, package `com.pattan.presentator`, bundled web baseline 8.2.36. The user authorized packaging and publishing the compatible web changes as OTA 8.2.36; Udhaar OTA remains 1.0.11. Native code and APKs are excluded from this OTA publication.

## Verification

- `npm run test:mobile-apps`: 511 existing checks plus 56 new WhatsApp checks. Tests execute the actual IN-report builder and verify exact complete messages, long notes, Unicode, all bridge names, failure recovery, URL round trips and clipboard-denial handling.
- Native Salary and Udhaar debug unit suites: 46 tests, zero failures/errors. Release compilation and release vital lint passed.
- Production mobile build and Capacitor sync passed. The unsigned Salary release APK contains the text-share bridge client, recovery controls, no preview network guard, and all ten packaged notification/OT WAV files with exact source hashes. Android resource optimization changes archive filenames; hashes verify the complete audio payloads.
- Browser fixture with synthetic attendance: prepared, retried, copied, expanded and dismissed reports; simulated unavailable launcher retained the complete report including its last line. No horizontal overflow at 320, 390 or 1440 pixels. The browser's virtual clipboard read API did not reflect the page clipboard; exact copy arguments and denied-copy behavior were verified separately by the executable handler tests.
- No live WhatsApp message was sent. No real attendance, expense record, phone permission or installed APK was changed.

## Pending device and signing work

The original development computer is locked, and no USB phone is currently attached. The user chose to continue code tests. The matching original signing key has not been recovered. The current local debug key does not match the certificate recorded from the installed Salary APK on 24 October. The review artifact is deliberately unsigned and is not an installable upgrade.

After the user unlocks YASIN DELL and reconnects the phone: recover the original key privately, compare its certificate to a fresh read of the installed package, export the user's data before any upgrade, sign and verify the candidate, and obtain approval before installation/publication. Never uninstall or clear app data to work around a certificate mismatch. Confirm actual IN drafts, screen-off notification speech, silent-mode alarm audio, punch-out cancellation and XOS battery behavior on the phone. DND, zero alarm volume, blocked channels and force-stop still remain Android/user-controlled limits.

Candidate validation, hashes and screenshots are in ignored `review/native-whatsapp-8.2.36/validation.json` and `review/whatsapp-report-recovery-mobile.png`. The signed APK and device installation remain pending. The OTA publication record and live URL/hash checks are kept separately in `review/ota-8.2.36-publication/`.
