'use strict';

// Pure helpers and mocked bridge calls only; no files, messaging or app launch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const preferences = import(pathToFileURL(path.join(root, 'src/studioPreferences.mjs')));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const publicStatus = overrides => ({ ok: true, mode: 'drafts', enabled: false, pending: 0, drafts: [], ...overrides });
const draft = overrides => ({ id: 'job-1', status: 'completed', processName: 'PDF export', details: 'Video ready.', at: '2026-09-09T10:00:00.000Z', ...overrides });

test('app appearance defaults to dark when no preference exists', async () => {
  const { loadAppTheme } = await preferences;
  assert.equal(loadAppTheme({ getItem: () => null }), 'dark');
});

test('only exact dark and light saved values are accepted', async () => {
  const { loadAppTheme } = await preferences;
  for (const value of ['dark', 'light']) assert.equal(loadAppTheme({ getItem: () => value }), value);
  for (const value of ['', 'LIGHT', 'system', 'true', ' dark ', undefined, {}, 0]) assert.equal(loadAppTheme({ getItem: () => value }), 'dark');
});

test('blocked or absent preference storage still allows dark mode', async () => {
  const { loadAppTheme, saveAppTheme } = await preferences;
  const blocked = { getItem() { throw new Error('Storage blocked'); }, setItem() { throw new Error('Storage quota exceeded'); } };
  for (const storage of [blocked, undefined, null]) {
    assert.equal(loadAppTheme(storage), 'dark');
    assert.doesNotThrow(() => saveAppTheme(storage, 'light'));
  }
});

test('light and dark selections persist only under an app-specific key', async () => {
  const { APP_THEME_KEY, loadAppTheme, saveAppTheme } = await preferences;
  const values = new Map([['theme', 'presentation-value'], ['themeSelect', 'lesson-value']]);
  const writes = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); writes.push([key, value]); } };
  saveAppTheme(storage, 'light');
  assert.equal(loadAppTheme(storage), 'light');
  saveAppTheme(storage, 'dark');
  assert.equal(loadAppTheme(storage), 'dark');
  saveAppTheme(storage, 'unrecognized');
  assert.equal(loadAppTheme(storage), 'dark');
  assert.deepEqual(writes, [[APP_THEME_KEY, 'light'], [APP_THEME_KEY, 'dark'], [APP_THEME_KEY, 'dark']]);
  assert.equal(values.get('theme'), 'presentation-value');
  assert.equal(values.get('themeSelect'), 'lesson-value');
});

test('draft status reads exact booleans without writes or external opening', async () => {
  const { readWhatsAppPreference } = await preferences;
  let reads = 0;
  for (const enabled of [false, true]) {
    assert.equal(await readWhatsAppPreference({
      getWhatsAppAutoSend: async () => { reads++; return publicStatus({ enabled }); },
      setWhatsAppAutoSend: () => assert.fail('Read must not write'),
      openWhatsAppDraft: () => assert.fail('Read must not open'),
    }), enabled);
  }
  assert.equal(reads, 2);
});

test('missing, malformed and older automatic-sender backends cannot appear On', async () => {
  const { readWhatsAppStatus } = await preferences;
  for (const api of [undefined, null, {}, { getWhatsAppAutoSend: 'invalid' }]) await assert.rejects(readWhatsAppStatus(api), /updated desktop app/);
  for (const result of [null, {}, { ok: true, enabled: true }, { ok: true, enabled: true, mode: 'cloud' }]) {
    await assert.rejects(readWhatsAppStatus({ getWhatsAppAutoSend: async () => result }), /Restart.*drafts/);
  }
  for (const enabled of [undefined, 'false', 0, null]) {
    await assert.rejects(readWhatsAppStatus({ getWhatsAppAutoSend: async () => publicStatus({ enabled }) }), /Could not read/);
  }
});

test('failed draft reads remain retryable without touching the preference', async () => {
  const { readWhatsAppStatus } = await preferences;
  let calls = 0;
  const failure = new Error('Bridge unavailable');
  const api = { getWhatsAppAutoSend: async () => { if (++calls === 1) throw failure; return publicStatus(); } };
  await assert.rejects(readWhatsAppStatus(api), error => error === failure);
  assert.equal((await readWhatsAppStatus(api)).enabled, false);
});

test('status allowlists draft fields and fixes recipient without retaining secrets or arbitrary links', async () => {
  const { normalizeWhatsAppStatus } = await preferences;
  const result = normalizeWhatsAppStatus(publicStatus({
    recipient: 'wrong-recipient', token: 'top-secret', pending: 500,
    drafts: [draft({ token: 'draft-secret', url: 'https://untrusted.example', details: 'token=hidden-value https://untrusted.example/path' })],
    lastAttempt: { status: 'opened', processName: 'PDF export', token: 'attempt-secret' },
  }));
  assert.equal(result.recipient, '917386726193');
  assert.equal(result.pending, 1);
  assert.deepEqual(Object.keys(result.drafts[0]), ['id', 'status', 'processName', 'details', 'at', 'openedAt']);
  assert.doesNotMatch(JSON.stringify(result), /top-secret|draft-secret|attempt-secret|wrong-recipient|untrusted\.example|hidden-value/);
});

test('draft normalization rejects invalid jobs and preserves completed or failed drafts while Off', async () => {
  const { normalizeWhatsAppStatus } = await preferences;
  const result = normalizeWhatsAppStatus(publicStatus({ drafts: [
    null, draft(), draft(), draft({ id: 'job-2', status: 'failed' }),
    draft({ id: '', status: 'failed' }), draft({ id: 'invalid\n' }), draft({ id: 'sent-job', status: 'sent' }),
  ] }));
  assert.equal(result.enabled, false);
  assert.equal(result.pending, 2);
  assert.deepEqual(result.drafts.map(item => item.status), ['completed', 'failed']);
  assert.equal(normalizeWhatsAppStatus(publicStatus({ drafts: Array.from({ length: 105 }, (_, index) => draft({ id: 'job-' + index })) })).drafts.length, 100);
});

test('On and Off reflect backend confirmation and do not open or dispatch messages', async () => {
  const { changeWhatsAppEnabled } = await preferences;
  const writes = [];
  const api = {
    setWhatsAppAutoSend: async enabled => { writes.push(enabled); return publicStatus(); },
    openWhatsAppDraft: () => assert.fail('Toggle must not open WhatsApp'),
    reportWhatsAppJob: () => assert.fail('Toggle must not create an example job'),
  };
  assert.equal((await changeWhatsAppEnabled(api, true)).enabled, false);
  assert.equal((await changeWhatsAppEnabled(api, false)).enabled, false);
  assert.deepEqual(writes, [true, false]);
  assert.throws(() => changeWhatsAppEnabled(api, 'true'), /On or Off/);
});

test('failed state changes retain sanitized authoritative Off status', async () => {
  const { changeWhatsAppEnabled } = await preferences;
  await assert.rejects(changeWhatsAppEnabled({ setWhatsAppAutoSend: async () => publicStatus({ ok: false, error: 'Could not save Off', token: 'private' }) }, false), failure => {
    assert.match(failure.message, /Could not save Off/);
    assert.equal(failure.whatsAppStatus.enabled, false);
    assert.doesNotMatch(JSON.stringify(failure.whatsAppStatus), /private/);
    return true;
  });
});

test('opening uses only an explicit known draft and app or browser target; remote clients cannot open desktop', async () => {
  const { openWhatsAppDraft } = await preferences;
  const calls = [];
  const api = { openWhatsAppDraft: async input => { calls.push(input); return publicStatus({ drafts: [draft()] }); } };
  await openWhatsAppDraft(api, 'job-1', 'app');
  await openWhatsAppDraft(api, 'job-1', 'web');
  assert.deepEqual(calls, [{ id: 'job-1', target: 'app' }, { id: 'job-1', target: 'web' }]);
  assert.throws(() => openWhatsAppDraft(api, '', 'app'), /Choose a draft/);
  assert.throws(() => openWhatsAppDraft(api, 'job-1', 'https://untrusted.example'), /Choose a draft/);
  assert.throws(() => openWhatsAppDraft({ ...api, isMobileRemote: true }, 'job-1', 'app'), /desktop app/);
  assert.equal(calls.length, 2);
});

test('dismiss removes only the chosen draft and never opens WhatsApp', async () => {
  const { dismissWhatsAppDraft } = await preferences;
  const calls = [];
  const result = await dismissWhatsAppDraft({
    dismissWhatsAppDraft: async id => { calls.push(id); return publicStatus(); },
    openWhatsAppDraft: () => assert.fail('Dismiss must not open'),
  }, 'job-1');
  assert.deepEqual(calls, ['job-1']);
  assert.equal(result.pending, 0);
});

test('review message matches the backend formatter exactly for sanitized drafts', async () => {
  const { normalizeWhatsAppStatus, formatWhatsAppDraft } = await preferences;
  const { formatDraftMessage, sanitizeDraftText } = require(path.join(root, 'whatsapp-drafts.cjs'));
  for (const status of ['completed', 'failed']) {
    const prepared = draft({ status, processName: sanitizeDraftText('PDF export', 96), details: sanitizeDraftText('Disk full; token="private value"; https://private.example', 700) });
    const normalized = normalizeWhatsAppStatus(publicStatus({ drafts: [prepared] })).drafts[0];
    assert.equal(formatWhatsAppDraft(normalized), formatDraftMessage(prepared));
    assert.doesNotMatch(formatWhatsAppDraft(normalized), /private value|private\.example/);
  }
});

test('activity never turns opening into sent or delivered status', async () => {
  const { describeWhatsAppAttempt, normalizeWhatsAppStatus, formatWhatsAppDraftTime } = await preferences;
  assert.match(describeWhatsAppAttempt({ status: 'opened' }), /review.*click Send yourself/);
  assert.match(describeWhatsAppAttempt({ status: 'open_failed', error: 'No handler' }), /Could not open.*No handler/);
  assert.match(describeWhatsAppAttempt({ status: 'draft_ready' }), /ready to review/);
  for (const status of ['sent', 'delivered', 'submitted']) {
    assert.equal(normalizeWhatsAppStatus(publicStatus({ lastAttempt: { status } })).lastAttempt, null);
  }
  assert.equal(formatWhatsAppDraftTime('invalid-time'), 'Time unavailable');
});

test('preferences expose a simple guarded draft review and unchanged accessible theme switch', () => {
  const component = read('src/components/StudioPreferences.jsx');
  for (const id of ['studio-theme-toggle', 'studio-whatsapp-status', 'studio-whatsapp-drafts-toggle', 'studio-whatsapp-drafts-refresh']) assert.ok(component.includes(`id="${id}"`));
  assert.match(component, /aria-checked=\{appTheme === 'dark'\}/);
  assert.match(component, /aria-checked=\{status\?\.enabled === true\}/);
  assert.match(component, /status\.mode !== 'drafts'/);
  assert.match(component, /role="alert"/);
  assert.match(component, /setStatus\(actualStatus \|\| null\)/);
  assert.match(component, /if \(!desktopOpening\) return/);
  assert.match(component, /desktopOpening && <>/);
  assert.match(component, /Open drafts from the desktop app/);
  assert.match(component, /Latest 100 drafts; cleared when this app closes/);
  assert.match(component, /Send or clear the current WhatsApp draft before opening another/);
  assert.match(component, /existing drafts remain available/);
  assert.match(component, /formatWhatsAppDraft\(draft\)/);
});

test('draft UI has no credentials, setup service, automatic opening or renderer persistence', () => {
  const component = read('src/components/StudioPreferences.jsx');
  const helpers = read('src/studioPreferences.mjs');
  assert.doesNotMatch(component, /Meta|Business account|Access token|template|saveWhatsAppConfig|validateWhatsAppConfig|localStorage|sessionStorage|window\.open|href=|fetch\(/);
  assert.doesNotMatch(helpers, /WHATSAPP_CONFIG_DEFAULTS|saveWhatsAppSettings|checkWhatsAppConnection|fetch\(|window\.open/);
  assert.match(component, /onClick=\{\(\) => openDraft\(draft, 'app'\)\}/);
  assert.match(component, /Nothing is sent automatically/);
});

test('app appearance stays independent of presentation and exported media', () => {
  const appSource = read('src/App.jsx');
  const helperSource = read('src/studioPreferences.mjs');
  assert.match(appSource, /data-app-theme=\{appTheme\}/);
  assert.match(appSource, /loadAppTheme\(/);
  assert.match(appSource, /saveAppTheme\(/);
  assert.doesNotMatch(helperSource, /themeToggle|themeSelect|previewCanvas|sendWhatsApp/);
  assert.doesNotMatch(appSource, /setWhatsAppAutoSend/);
});

test('isolated Home QA keeps its theme, canvas and selected-file checks', () => {
  const harness = read('scripts/qa-simple-home.cjs');
  for (const text of ['verifyAppPreferences', 'Fresh profile defaults to dark mode', 'Light app theme survives a renderer reload', 'App theme leaves presentation controls and canvas pixels unchanged', 'Theme changes preserve selected files and lesson input identity']) assert.ok(harness.includes(text));
});
