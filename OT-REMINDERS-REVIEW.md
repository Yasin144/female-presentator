# Music, hourly OT voice and biometric/calendar changes

Implemented in the existing isolated redesign workspace, without publishing or installing an APK.

- Opening the native app requires a user gesture for WebView media. Native biometric confirmation uses haptics instead of creating a WebAudio session. Haptics and legacy volume APIs no longer change system volume or mute state.
- `timeCompletedVoice.js` prefers the new native OT bridge for scheduling, cancellation, explicit voice playback and the six-second lock-screen test. It does not start a continuous audio stream or a second JavaScript speech timer on Android.
- Only a saved punch-in arms reminders. Leave and punch-out cancel them. The old code that moved the native alarm to tomorrow has been removed.
- `OtMilestoneAlarmReceiver` persists the shift and delivered-hour mask, schedules separate shift-end and hourly events (0–8 hours), cancels legacy pending alarms, and restores future events after reboot/package replacement/clock events. Delayed delivery and restore recover only the latest completed milestone, up to 30 minutes late, with durable deduplication. Older milestones are skipped.
- Nine complete existing PCM phrases are packaged as WAV resources, exposed through a provider restricted to those nine files. Android's notification service plays them using the owner's alarm volume. No background TTS, keep-alive audio, system-volume modification or DND override is used.
- Settings includes alarm permission, notification settings, a six-second native test, and permission/volume/channel diagnostics. Without exact-alarm permission the app uses Android's inexact idle alarms and reports the limitation.
- Eye/monkey privacy controls and biometric badges use Lucide fingerprint/lock icons. The punch-pad fingerprint is a clean SVG without the previous glowing bezel.
- Calendar saved-day cells show `OT HH:MM`, including zero OT. Today's active saved shift uses the existing live OT minutes; completed dates use existing calculated/stored minutes. Salary calculations and storage keys were not changed.

## Verification

- `node scripts/test-ot-reminders.cjs`: startup silence, native delegation, cancellation, explicit test, volume preservation, duration formatting, icon checks and complete audio payloads.
- `node scripts/test-navigation-history.cjs`: 62 existing navigation scenarios.
- `node node_modules/vite/bin/vite.js build --config vite.salary.config.js --outDir review/ot-change-build`: successful isolated frontend build.
- Android `:app:testSalaryDebugUnitTest`: successful native compilation and eleven OT timing-policy tests, alongside seven update-alert tests.
- Live preview inspected on a separate localhost origin; 360px mobile layout showed the new fingerprint controls without horizontal document overflow. No real attendance or financial records were edited.

## Release and device testing still required

These native features require a new APK; OTA JavaScript alone cannot provide the receivers, bridge, sound provider or packaged resources. A production renderer must be rebuilt and synced **after** these changes, using the production entry rather than the network-blocked preview. Do not distribute a preview build. Preserve the installed app's package identity and signing certificate; no uninstall or data reset is needed for a correctly signed upgrade.

No physical Android 16 Infinix Note 50 S was connected for verification. On the phone, test music playback while opening/unlocking the app, a six-second screen-off voice test, a real hour boundary, punch-out cancellation, reboot restoration, muted/blocked channels and exact-alarm denial. Doze/OEM battery rules, force-stop, notifications permissions, alarm volume and Do Not Disturb can affect delivery. An actual spoken notification can briefly interrupt/duck other audio according to Android and the music player's own focus policy.

Official platform references: [audio focus](https://developer.android.com/media/optimize/audio-focus), [alarm scheduling](https://developer.android.com/develop/background-work/services/alarms).
