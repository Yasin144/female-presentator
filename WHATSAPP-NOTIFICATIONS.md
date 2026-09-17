# Automatic WhatsApp notifications

In the Windows app Home screen, find **Automatic WhatsApp notifications**.
Accept the unofficial-integration warning, turn it On, and scan the QR code
in the separate Chrome window using WhatsApp on your phone → Linked devices.
The destination is fixed to **+91 7386726193**. No Business API key is needed.
Keep Pattan Workspace open; Chrome may be minimized. Existing personal Chrome
profiles and Windows WhatsApp are not used or modified. Linking must be done
by the account owner. Turning On does not import old manual drafts.

Home shows a compact WhatsApp alerts row; expand **Setup & history** only when
needed. The dedicated Chrome window automatically minimizes after connecting.
Sending is locked to `917386726193@c.us` or a WhatsApp LID whose reverse phone
mapping confirms that exact number; groups, mismatched numbers and unverified
aliases are blocked. Job payloads cannot supply another recipient.
The dedicated notification page blocks manual typing, pasting, dropping files,
and clicking chat controls. QR linking by scanning with your phone and automatic
notifications remain available. The guard is installed for each new document.
Normal Chrome windows and your phone are unaffected. This is a page-level UI
guard, not a browser/OS security boundary: browser controls and developer tools
are not locked. The fixed-recipient backend still restricts automatic messages.

The existing job-event reporting sends completion/failure notices for Sing Song,
PDF/lesson narration and export, captions, transcription, translation, resizer,
and exporter operations. It does not report individual words or percentage updates.
Messages contain status, process name, output basename or sanitized error reason.
No source videos, transcripts, credentials, full local paths or full logs are sent.

- Waiting notifications persist across app restarts.
- Connection/recipient lookup failures have bounded retries.
- An uncertain send is **never** resent automatically (avoids duplicates).
- Submitted is not proof of delivery. Accepted means server acknowledgement;
  Delivered requires a WhatsApp delivery acknowledgement while connected.
- Off cancels unsent waiting notifications. Already-started sends cannot be recalled.
- The separate manual-draft switch still controls the manual fallback when auto is off.
- History shows the latest 50; up to 500 outbox/history entries and 5,000 event IDs
  are retained. A full outbox reports an error rather than discarding pending jobs.

Login data and the sanitized outbox remain under Electron's per-user data directory
(normally `%APPDATA%/presentator`), outside the source repository. They are also
git-ignored. Revoke the linked device from your phone to invalidate saved login.
Do not share the session folder or computer account. No received-chat handlers
or chat-history export features are implemented; WhatsApp itself still synchronizes
its linked-device session.

## Limits and maintenance

This is an **unofficial** `whatsapp-web.js` integration. It can break when WhatsApp
changes, and WhatsApp may restrict unofficial clients. It is not guaranteed delivery
and should not be used for critical alerts. See https://wwebjs.dev/guide/.

`whatsapp-web.js` 1.34.7 pins Puppeteer 24.38.0. The dependency audit currently
reports an unpatched `extract-zip` advisory through Puppeteer's browser installer.
This feature uses an existing installed Chrome, never downloads/extracts browser
archives, and `.puppeteerrc.cjs` disables automatic browser downloads. That avoids
this vulnerable installer path; it does not make the entire dependency audit clean.
Other existing dependency advisories were not changed as part of this feature.

Unit tests use fake clients and never send messages. Isolated renderer QA uses
mock IPC and blocks external network traffic. A real delivery test is still needed
after the user links WhatsApp; passing mocks does not prove live delivery.

## Message-receipt compatibility fix

Current WhatsApp message keys expose `toString()` instead of `_serialized`.
A dedicated-session compatibility shim supplies the field expected by wwebjs
1.34.7 and normalizes outgoing receipt IDs. Acknowledgements without valid IDs,
from other destinations, or not for our own outgoing messages are ignored.
Legacy Delivered records with no receipt ID are repaired to Unconfirmed.
Unconfirmed/failed notices can be retried explicitly from history after checking
WhatsApp; they are never silently re-sent. A live recovery on 17 September 2026
received a valid message ID and delivery acknowledgement for the fixed recipient.
