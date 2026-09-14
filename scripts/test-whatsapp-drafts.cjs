'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWhatsAppDrafts, RECIPIENT, MAX_DRAFTS, sanitizeDraftText, formatDraftMessage } = require('../whatsapp-drafts.cjs');

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'presentator-drafts-test-'));
  const opened = [], services = [];
  const create = (extra = {}) => {
    const service = createWhatsAppDrafts({
      getUserDataPath: () => directory, now: () => Date.UTC(2026, 8, 9, 15),
      openExternal: async url => { opened.push(url); return options.openExternal ? options.openExternal(url) : undefined; },
      ...options.serviceOptions, ...extra,
    });
    services.push(service);
    return service;
  };
  const service = create();
  t.after(() => {
    services.forEach(item => item.shutdown());
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { service, directory, opened, create };
}

async function readyDraft(f, id = 'job-1', status = 'completed') {
  await f.service.setEnabled(true);
  assert.equal(f.service.notify({ id, status, processName: 'PDF video', details: status === 'failed' ? 'The decoder failed.' : 'Video export completed.' }).created, true);
  return f.service.getStatus().drafts.find(draft => draft.id === id);
}

test('drafts default off and never read Meta or legacy preferences', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'whatsapp-cloud-notifications.json'), '{"enabled":true,"token":"do-not-read"}');
  fs.writeFileSync(path.join(f.directory, 'mobile-preferences.json'), '{"whatsappAutoSend":true}');
  assert.deepEqual(f.service.getStatus(), { ok: true, mode: 'drafts', enabled: false, recipient: '917386726193', pending: 0, drafts: [], lastAttempt: null });
  assert.equal(f.service.notify({ id: 'old', status: 'completed' }).skipped, 'disabled');
  assert.deepEqual(f.opened, []);
});

test('only the enabled preference persists; drafts, text, and attempts stay memory-only', async t => {
  const f = fixture(t);
  await readyDraft(f);
  const filename = path.join(f.directory, 'whatsapp-draft-preferences.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')), { version: 1, enabled: true });
  assert.deepEqual(fs.readdirSync(f.directory), ['whatsapp-draft-preferences.json']);
  const restored = f.create().getStatus();
  assert.equal(restored.enabled, true);
  assert.equal(restored.pending, 0);
  assert.equal(restored.lastAttempt, null);
  assert.deepEqual(f.opened, []);
});

test('completed and failed jobs create sanitized drafts but never open WhatsApp', async t => {
  const f = fixture(t);
  await readyDraft(f, 'completed', 'completed');
  await readyDraft(f, 'failed', 'failed');
  const status = f.service.getStatus();
  assert.equal(status.pending, 2);
  assert.deepEqual(status.drafts.map(draft => draft.id), ['failed', 'completed']);
  assert.equal(status.lastAttempt.status, 'draft_ready');
  assert.equal(status.drafts[0].details, 'The decoder failed.');
  assert.deepEqual(f.opened, []);
});

test('off stops new drafts but retains existing drafts for explicit review', async t => {
  const f = fixture(t);
  await readyDraft(f);
  const disabled = await f.service.setEnabled(false);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.pending, 1);
  assert.equal(f.service.notify({ id: 'while-off', status: 'failed' }).skipped, 'disabled');
  assert.equal((await f.service.openDraft({ id: 'job-1', target: 'web' })).ok, true);
  assert.equal(f.opened.length, 1);
  await f.service.setEnabled(true);
  assert.equal(f.service.notify({ id: 'while-off', status: 'failed' }).skipped, 'duplicate');
  assert.equal(f.service.getStatus().pending, 1);
});

test('deduplication uses exact job ID, not process text', async t => {
  const f = fixture(t);
  await readyDraft(f, 'first');
  assert.equal(f.service.notify({ id: 'first', status: 'completed', processName: 'Another label' }).skipped, 'duplicate');
  await readyDraft(f, 'second');
  assert.equal(f.service.getStatus().pending, 2);
  assert.deepEqual(f.opened, []);
});

test('newest-first memory queue keeps at most the most recent 100 drafts', async t => {
  const f = fixture(t);
  await f.service.setEnabled(true);
  for (let index = 0; index < 105; index += 1) f.service.notify({ id: `job-${index}`, status: 'completed' });
  const status = f.service.getStatus();
  assert.equal(MAX_DRAFTS, 100);
  assert.equal(status.pending, 100);
  assert.equal(status.drafts[0].id, 'job-104');
  assert.equal(status.drafts[99].id, 'job-5');
  assert.equal((await f.service.openDraft({ id: 'job-0', target: 'app' })).ok, false);
  assert.deepEqual(f.opened, []);
});

test('cancelled, no-op, and running events never create drafts; malformed jobs are harmless', async t => {
  const f = fixture(t);
  await f.service.setEnabled(true);
  for (const status of ['cancelled', 'canceled', 'noop', 'skipped', 'running', 'started']) assert.equal(f.service.notify({ id: status, status }).skipped, 'non-terminal');
  for (const job of [null, {}, { id: 'unknown', status: 'surprise' }, { status: 'completed' }, { id: 'x\n', status: 'failed' }, { id: 'x'.repeat(257), status: 'completed' }]) assert.equal(f.service.notify(job).ok, false);
  assert.equal(f.service.getStatus().pending, 0);
  assert.deepEqual(f.opened, []);
});

test('draft details redact credentials URLs local paths and control characters', async t => {
  const f = fixture(t);
  await f.service.setEnabled(true);
  const details = 'Decoder failed.\nhttps://private.example/?mobileToken=private-token\nwss://private.example/live\nAuthorization: Bearer private-auth\npassword=private-password\n"D:\\LESSONS\\Private Course\\book.pdf"\npath=/Users/private/book.pdf\nEAA' + 's'.repeat(40);
  const status = f.service.notify({ id: 'redaction-test', status: 'failed', processName: 'PDF\u202e export', details });
  const draft = status.drafts[0];
  assert.match(draft.details, /Decoder failed/);
  assert.equal(/private|LESSONS|book\.pdf|Bearer|https:|EAA/.test(JSON.stringify(status)), false);
  assert.equal(/[\n\t\u202e]/.test(draft.processName + draft.details), false);
  assert.equal(sanitizeDraftText('x '.repeat(900), 700).length <= 700, true);
  assert.equal(sanitizeDraftText('name '.repeat(100), 96).length <= 96, true);
});

test('explicit app opening uses only a fixed recipient and the exact reviewed message', async t => {
  const f = fixture(t);
  const draft = await readyDraft(f);
  const result = await f.service.openDraft({ id: draft.id, target: 'app', recipient: 'wrong', text: 'injected' });
  assert.equal(result.ok, true);
  assert.equal(f.opened.length, 1);
  const url = new URL(f.opened[0]);
  assert.equal(url.protocol, 'whatsapp:');
  assert.equal(url.hostname, 'send');
  assert.equal(url.searchParams.get('phone'), RECIPIENT);
  assert.equal(url.searchParams.get('text'), formatDraftMessage(draft));
  assert.equal(url.searchParams.get('text'), 'Pattan Workspace\nStatus: Completed\nProcess: PDF video\nDetails: Video export completed.');
  assert.equal(result.lastAttempt.status, 'opened');
  assert.equal(result.pending, 1);
  assert.equal(typeof result.drafts[0].openedAt, 'string');
  assert.match(result.message, /click Send yourself/);
  assert.match(result.message, /not confirmed/);
});

test('explicit cancellation flags and AbortError details suppress misleading failure drafts', async t => {
  const f = fixture(t);
  await f.service.setEnabled(true);
  for (const extra of [
    { cancelled: true }, { canceled: true }, { noop: true }, { noOp: true },
    { details: 'AbortError: The user aborted this request.' },
    { details: 'The export was cancelled by the user.' },
    { error: { name: 'AbortError' } }, { error: { message: 'Operation canceled.' } },
  ]) assert.equal(f.service.notify({ id: 'cancel-event', status: 'failed', ...extra }).skipped, 'cancelled-or-noop');
  assert.equal(f.service.getStatus().pending, 0);
  assert.deepEqual(f.opened, []);
});

test('malformed UTF-16 in process text is normalized before preparing a WhatsApp URL', async t => {
  const f = fixture(t);
  await f.service.setEnabled(true);
  f.service.notify({ id: 'malformed-text', status: 'failed', processName: 'Video \uD800', details: 'Decoder \uDC00 failed.' });
  const result = await f.service.openDraft({ id: 'malformed-text', target: 'web' });
  assert.equal(result.ok, true);
  const text = new URL(f.opened[0]).searchParams.get('text');
  assert.equal(text.includes('\uFFFD'), true);
  assert.equal(/[\uD800-\uDFFF]/.test(text), false);
});

test('explicit web opening uses only wa.me and the fixed authorized recipient', async t => {
  const f = fixture(t);
  const draft = await readyDraft(f, 'failed', 'failed');
  await f.service.openDraft({ id: 'failed', target: 'web' });
  const url = new URL(f.opened[0]);
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/' + RECIPIENT);
  assert.equal(url.searchParams.get('text'), formatDraftMessage(draft));
  assert.equal(f.service.getStatus().pending, 1);
});

test('only exact existing IDs and app/web targets may open external links', async t => {
  const f = fixture(t);
  await readyDraft(f);
  for (const input of [null, {}, { id: 'missing', target: 'app' }, { id: 'job-1', target: 'https://evil.example' }, { id: 'job-1', target: 'APP' }, { id: '../job-1', target: 'web' }]) assert.equal((await f.service.openDraft(input)).ok, false);
  assert.deepEqual(f.opened, []);
});

test('concurrent duplicate opens coalesce and a different draft cannot open concurrently', async t => {
  let release;
  const f = fixture(t, { openExternal: () => new Promise(resolve => { release = resolve; }) });
  await readyDraft(f, 'first');
  await readyDraft(f, 'second');
  const first = f.service.openDraft({ id: 'first', target: 'app' });
  const duplicate = f.service.openDraft({ id: 'first', target: 'app' });
  const other = await f.service.openDraft({ id: 'second', target: 'web' });
  assert.equal(other.ok, false);
  assert.match(other.error, /already opening/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.opened.length, 1);
  release();
  assert.equal((await first).ok, true);
  assert.equal((await duplicate).ok, true);
  assert.equal(f.opened.length, 1);
});

test('missing WhatsApp returns a safe opening error with no automatic browser fallback', async t => {
  const f = fixture(t, { openExternal: () => Promise.reject(new Error('secret D:\\private\\auth-token')) });
  await readyDraft(f);
  const result = await f.service.openDraft({ id: 'job-1', target: 'app' });
  assert.equal(result.ok, false);
  assert.equal(result.lastAttempt.status, 'open_failed');
  assert.match(result.error, /installed/);
  assert.equal(/secret|private|auth-token/.test(JSON.stringify(result)), false);
  assert.equal(f.opened.length, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.drafts[0].openedAt, undefined);
});

test('opening timeout is bounded and truthful, with no automatic retry', async t => {
  const f = fixture(t, { serviceOptions: { openingTimeoutMs: 10 }, openExternal: () => new Promise(() => {}) });
  await readyDraft(f);
  const result = await f.service.openDraft({ id: 'job-1', target: 'app' });
  assert.equal(result.ok, false);
  assert.match(result.error, /could not be confirmed/);
  assert.match(result.error, /no automatic retry/);
  assert.equal(result.lastAttempt.status, 'open_failed');
  assert.equal(result.drafts[0].openedAt, undefined);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.opened.length, 1);
});

test('dismiss is local, retains dedup identity, and never pretends delivery', async t => {
  const f = fixture(t);
  await readyDraft(f);
  assert.equal(f.service.dismissDraft('job-1').pending, 0);
  assert.equal(f.service.dismissDraft('job-1').ok, false);
  assert.equal(f.service.notify({ id: 'job-1', status: 'completed' }).skipped, 'duplicate');
  assert.deepEqual(f.opened, []);
});

test('shutdown clears drafts and safely settles an opening without another external call', async t => {
  const f = fixture(t, { openExternal: () => new Promise(() => {}) });
  await readyDraft(f);
  const opening = f.service.openDraft({ id: 'job-1', target: 'app' });
  await new Promise(resolve => setImmediate(resolve));
  f.service.shutdown();
  assert.equal((await opening).ok, false);
  assert.equal(f.service.getStatus().pending, 0);
  assert.equal(f.service.getStatus().lastAttempt, null);
  assert.equal(f.service.getStatus().enabled, false);
  assert.equal(f.service.notify({ id: 'closed', status: 'failed' }).skipped, 'disabled');
  assert.equal((await f.service.setEnabled(true)).ok, false);
  assert.equal(f.opened.length, 1);
});

test('corrupt preferences fail closed and a successful save can recover', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'whatsapp-draft-preferences.json'), 'not valid JSON');
  assert.equal(f.service.getStatus().enabled, false);
  assert.match(f.service.getStatus().configurationError, /could not be loaded/);
  const result = await f.service.setEnabled(true);
  assert.equal(result.ok, true);
  assert.equal(result.configurationError, undefined);
  assert.equal(result.enabled, true);
});

test('save failure is safely off without deleting existing drafts or leaking the path', async t => {
  const f = fixture(t);
  await readyDraft(f);
  const filename = path.join(f.directory, 'whatsapp-draft-preferences.json');
  fs.unlinkSync(filename);
  fs.mkdirSync(filename);
  const result = await f.service.setEnabled(false);
  assert.equal(result.ok, false);
  assert.equal(result.enabled, false);
  assert.equal(result.pending, 1);
  assert.match(result.error, /off for this session/);
  assert.equal(JSON.stringify(result).includes(f.directory), false);
  assert.equal(fs.readdirSync(f.directory).filter(name => name.endsWith('.tmp')).length, 0);
});

test('status clones cannot mutate the actual queued draft or recipient', async t => {
  const f = fixture(t);
  await readyDraft(f);
  const snapshot = f.service.getStatus();
  snapshot.drafts[0].details = 'tampered';
  snapshot.recipient = 'different';
  snapshot.lastAttempt.status = 'sent';
  assert.equal(f.service.getStatus().drafts[0].details, 'Video export completed.');
  assert.equal(f.service.getStatus().recipient, RECIPIENT);
  assert.equal(f.service.getStatus().lastAttempt.status, 'draft_ready');
  assert.equal((await f.service.setEnabled('true')).ok, false);
});
