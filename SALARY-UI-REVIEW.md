# Time Is Money and Udhaar review

Based on Yasin144/female-presentator main at `6df2d4ac23372d016b4825c83402def3887176a7`, Salary OTA version 8.2.33 and Udhaar 1.0.10. Work is isolated in `D:\voice\salary-pro-redesign`; the original checkout and remote computer were not replaced.

## Implemented

- Main app renamed Time Is Money. Udhaar Book remains a separate Android app.
- New clock/book identities, matching adaptive Android icons, bundled offline font, clear icons, member initials, light/dark surfaces and responsive layouts.
- Five main destinations, compact tools, attendance shortcuts, clearer salary metrics, ledger totals and entry forms.
- Back closes the current editor/dialog first, then returns through visited sections instead of forcing Home. Expense subview history is retained.
- Native WorkManager update checks with a 15-minute minimum interval, network constraints and one-time checks on open. Android may delay delivery.
- Native update notifications with a fixed public sound URI, optional spoken sound and explicit opt-in for alarm audio in silent mode. No volume forcing, DND bypass or automatic battery exemptions.
- Native check completion/error status, permission refresh, channel diagnostics and separate OT/update notification settings.
- Numeric OTA version comparison, same-version hotfix rules, stale-manifest suppression, announcement history and cancellation of installed-update notifications.
- Native OT reminders recover only the latest completed milestone up to 30 minutes late. Delayed alarms and restore share durable deduplication; older milestones are skipped.

## Data compatibility

The package IDs remain `com.pattan.presentator` and `com.pattan.udhaar`; the native WebView origin remains `https://localhost`. Financial record keys and schemas are unchanged. No production record was edited, imported, cleared or migrated during testing.

`scripts/test-salary-ui.cjs` compares 63 complete financial/storage definitions against the base revision: 19 salary, 24 expense and 20 Udhaar. All three modules retain identical literal localStorage key sets. The test also parses components/styles and checks navigation, privacy and version contracts.

An APK upgrade must use the installed app's signing certificate. Current artifacts are debug QA builds, not verified upgrades for the user's installed APK. Never uninstall the existing app to work around a signature mismatch.

Read-only certificate verification of the original APKs stored in local Git objects confirmed a mismatch:

| APK | SHA-256 signing certificate |
| --- | --- |
| Original Salary OT | `152642f11bfdea97d77285014beb5d81d0db8c8616bd66e3cc6350d4c3be67de` |
| Original Udhaar | `94a8cdaf8f889cfbeae5cae77d6d9c9dd3d97e1ba7730d4af33513601c0d15ff` |
| Current debug QA builds | `e44ca7e663ced60bcce41f5e7f15e063bd3eb95982a4d1b825cbc2df24c6c16e` |

The original signing keystores are required before producing a data-preserving installation update. No matching keystore files were found in the local D:\voice workspace.

## Verification

- 63 financial/storage preservation checks pass.
- 62 navigation scenarios pass.
- 31 OTA policy scenarios pass.
- 107 OT audio/startup/scheduling, Expense authentication/silence, duration display, icon and complete voice-asset checks pass.
- 8 transaction reading-order scenarios pass, including a repeated empty-ledger render regression that previously caused a maximum-update-depth error.
- 240 transaction memory, live-arrival, captured-field preservation and reading-order scenarios pass. The aggregate mobile suite runs 511 checks; financial preservation tests pin the original full Git revision rather than comparing with a changing `HEAD`.
- Native update policy and OT timing suites pass; final Gradle reports are under `android/app/build/test-results/`.
- Android assemblies pass with 19 native tests per flavor (38 total, zero failures/errors). The source-readiness mobile build packages `index-B66PRJtU.js` and `index-1_9FiCdO.css` from `mobile-dist/`. All five existing `renderer-dist/` files retained identical hashes through the mobile build, Capacitor sync and both flavor assemblies.
- Production mobile bundle builds successfully. Vite's large-chunk advisory remains.
- All five salary screens checked at 360, 390, 430 and 1440 pixels: correct active destination, five navigation controls, scroll reset and no horizontal document overflow (20 combinations).
- Ledger Pending/Settled views checked at the same four widths without overflow (8 combinations).
- Salary Calendar -> Settings -> Back restores Calendar. Back closes the day editor first; browser Back then restores the previous main section.
- Ledger Back restores Pending from Settled. Add-entry and alert dialogs open and close with Escape without saving.
- Light/dark themes checked in both apps. Clean reloads reported no browser console errors.
- After the empty-ledger repair, all five current screens were revisited at the existing 390px salary viewport without a display error or document overflow. The earlier 20 width combinations precede the last transaction styling refinements; the latest regression report records actual measured widths.
- Screenshots and responsive reports are in ignored `review/` output.

## Previews and device boundary

- Time Is Money: http://127.0.0.1:8452/salary.html
- Udhaar Book: http://127.0.0.1:8453/udhaar.html

The previews render the actual components using separate localhost storage and block external sync, OTA and messaging fetches. Empty balances are not seeded transactions. No account was connected, attendance punched or WhatsApp message sent. Browser biometric fallback is not a device fingerprint test.

The connected phone was verified as Infinix X6870, Android 16/API 36. Read-only inspection confirmed both installed packages and their signing certificates; only the installed base APKs were copied for certificate verification. No phone settings, permissions or data were changed. The installed certificates match the original APKs in the table above and differ from the current debug builds. Real screen-off delivery of the new code, XOS battery behavior and native biometric behavior remain untested because no compatible signed update has been installed. Do Not Disturb, zero volume, muted channels, force-stop and OEM battery restrictions can still prevent or delay sound.

Read-only installed-APK and permission diagnosis:

- Installed Udhaar declares no `POST_NOTIFICATIONS` permission; its notification app-op is ignored and no channels were found. Settings alone cannot add a missing manifest permission. The new shared manifest declares it.
- Installed Salary has notification permission granted and its existing office-end channel is high importance, with a default tone and no DND bypass. It declares neither `SCHEDULE_EXACT_ALARM` nor `USE_EXACT_ALARM`, so this APK cannot request precise alarm access. The new salary flavor declares `SCHEDULE_EXACT_ALARM`; Udhaar intentionally does not.
- Both installed apps were active in standby bucket 10, not stopped, with standard background app-ops allowed. The OEM-specific restriction state was unknown. No alert text or financial logs were retrieved.

No APK was installed. After the user's explicit approval, the web updates were published in Git commit `db68b994c20f3e4edda2b2d33aca36584f9b7d0b`: Time Is Money 8.2.34 and Udhaar 1.0.11. The commit changes only the two OTA manifests and adds four immutable versioned JS/CSS payloads; the prior payloads remain available. Native permissions, launcher branding and background scheduling still require a compatible signed APK.

The OTA update removes the app confirmation beep from Expense entry while retaining authentication. Five authentication outcomes are exercised in the audio tests. A separate browser fixture with the old native bridge completed four authenticated Expense entries with zero audio contexts, and cancellation kept the vault locked. These are simulated bridge checks, not a physical fingerprint test. Both IIFE bundles and their embedded fonts were verified with the old APK's module loading format. The QA mock server was stopped after testing; it was never part of the published payloads. Reports are in `review/ota-release/`, `review/ota-browser-validation.json` and `review/ota-publication-candidate/`.

The original Antigravity remote computer was reachable briefly, but its remote connection dropped before a matching signing file could be located. Neither signing keystore has been copied or replaced.

## Build commands

The production mobile entry builds into ignored `mobile-dist/`, and Capacitor copies that directory into the APK assets. Desktop `npm run build:react` continues to use `renderer-dist/`; mobile builds must not replace or commit that desktop output. `npm run android:sync` builds the mobile entry before syncing, and `npm run android:build` assembles both Android flavors.

```powershell
npm run test:mobile-apps
npm run build:mobile-apps
npx cap sync android
cd android
.\gradlew.bat testSalaryDebugUnitTest testUdhaarDebugUnitTest assembleSalaryDebug assembleUdhaarDebug
```

Use these flavor builds instead of the legacy `scripts/build-udhaar-apk.ps1`. That helper temporarily rewrites native sources, manifests and resources, creates a temporary signing key, and copies an APK into OTA paths. It is unsuitable for a source-only update or an upgrade that must match the installed certificate. It was not executed during this work.

Native version metadata remains the existing QA baseline: Salary code 24/name 7.8 with bundled web version 8.2.33, and Udhaar code 10/name 1.0.10. The published web OTA versions are 8.2.34 and 1.0.11. Before a production APK release, choose new native version metadata and align its bundled web baseline with the packaged source, then sign with the original app key. This source handoff does not install or release a new APK.

Use the dedicated mobile production entry, not either preview entry. The production entry contains no preview network guards and selects the separate Udhaar app from the native `?app=udhaar` URL.
