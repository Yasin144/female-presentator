'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JOB_CHANNELS, createWhatsAppJobObserver, describeResult } = require('../whatsapp-job-events.cjs');

test('each whole native operation reports success once and preserves its result and receiver', async () => {
  const events = [];
  let next = 0;
  const wrap = createWhatsAppJobObserver(event => events.push(event), { makeId: () => ++next });
  for (const channel of Object.keys(JOB_CHANNELS)) {
    const result = { ok: true, outputPath: 'D:\\private lessons\\lesson.mp4' };
    const receiver = {};
    const handler = wrap(channel, function (event, input) { assert.equal(this, receiver); assert.equal(input, 42); return result; });
    assert.equal(await handler.call(receiver, {}, 42), result);
  }
  assert.equal(events.length, Object.keys(JOB_CHANNELS).length);
  assert.equal(new Set(events.map(event => event.id)).size, events.length);
  assert.ok(events.every(event => event.status === 'completed' && event.details === 'Output: lesson.mp4'));
});

test('separate identical jobs receive separate ids instead of being deduplicated by wording', async () => {
  const events = [];
  const handler = createWhatsAppJobObserver(event => events.push(event))('burn-captions', async () => ({ ok: true }));
  await handler({}); await handler({});
  assert.equal(events.length, 2);
  assert.notEqual(events[0].id, events[1].id);
});

test('returned failures and thrown errors keep their original semantics and real reasons', async () => {
  const events = [];
  const wrap = createWhatsAppJobObserver(event => events.push(event));
  const failure = { ok: false, error: 'Not enough disk space' };
  assert.equal(await wrap('my-exporter-export', () => failure)({}), failure);
  const error = new Error('Encoder failed');
  await assert.rejects(wrap('burn-captions', () => { throw error; })({}), value => value === error);
  assert.deepEqual(events.map(event => [event.status, event.details]), [['failed', 'Not enough disk space'], ['failed', 'Encoder failed']]);
});

test('unknown success shapes and explicit cancellation are not completion or failure alerts', async () => {
  const events = [];
  const wrap = createWhatsAppJobObserver(event => events.push(event));
  for (const result of [undefined, {}, { canceled: true }, { ok: false, cancelled: true }, { ok: false, error: 'Export canceled by user' }]) {
    assert.equal(await wrap('burn-captions', () => result)({}), result);
  }
  await assert.rejects(wrap('burn-captions', () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; })({}));
  assert.equal(events.length, 0);
});

test('cancel targets only its active job and suppresses the resulting process-exit failure', async () => {
  const events = [];
  const wrap = createWhatsAppJobObserver(event => events.push(event));
  const resolves = [];
  const exportJob = wrap('video-resizer-export', () => new Promise(resolve => resolves.push(resolve)));
  const a = exportJob({}, { jobId: 'a' });
  const b = exportJob({}, { jobId: 'b' });
  const cancellation = { ok: true, cancelled: true };
  assert.equal(wrap('video-resizer-cancel', () => cancellation)({}, { jobId: 'a' }), cancellation);
  resolves[0]({ ok: false, error: 'FFmpeg code 1' });
  resolves[1]({ ok: true });
  await Promise.all([a, b]);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'completed');
});

test('alerts never delay jobs or replace job errors', async () => {
  for (const report of [() => new Promise(() => {}), () => Promise.reject(new Error('network')), () => { throw new Error('sender'); }]) {
    const wrap = createWhatsAppJobObserver(report);
    const result = { ok: true };
    assert.equal(await wrap('quote-export-finish', () => result)({}), result);
    const error = new Error('original job error');
    await assert.rejects(wrap('burn-captions', () => { throw error; })({}), value => value === error);
  }
});

test('reads, chunks, previews and individual narration calls keep identity without observation', () => {
  const wrap = createWhatsAppJobObserver(() => { throw new Error('must not notify'); });
  for (const channel of ['show-notification', 'show-save-dialog', 'write-file', 'quote-export-append', 'narrate-sc3-tts', 'narrate-edge-tts-timed', 'get-server-health', 'get-whatsapp-auto-send']) {
    const handler = () => ({ ok: true });
    assert.equal(wrap(channel, handler), handler);
  }
});

test('result descriptions exclude transcripts, URLs, and full paths', () => {
  assert.equal(describeResult({ outputPath: '/private/path/clip.mp4' }), 'Output: clip.mp4');
  assert.equal(describeResult({ outputPath: 'https://private.example/?token=secret', text: 'transcript' }), 'Operation completed successfully.');
  assert.equal(describeResult({ text: 'private lesson', words: ['private'] }), 'Operation completed successfully.');
});

test('app shares draft events with mobile but only desktop clicks can open WhatsApp', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  assert.match(source, /desktopOnlyIpcChannels = new Set\(\['open-whatsapp-draft'\]\)/);
  assert.match(source, /if \(!desktopOnlyIpcChannels.has\(channel\)\) mobileIpcHandlers.set\(channel, observed\)/);
  assert.match(source, /originalIpcHandle\(channel, observed\)/);
  assert.match(source, /if \(!desktopOnlyIpcChannels.has\(match\[2\]\)\) methods/);
  assert.doesNotMatch(source, /sendProcessWhatsAppAlert|processAlertFromNotification|autoSendMobileLinkToWhatsApp|auto_send_whatsapp\.py/);
  assert.match(source, /require\('\.\/whatsapp-drafts\.cjs'\)/);
  assert.doesNotMatch(source, /createWhatsAppNotifications|save-whatsapp-config|validate-whatsapp-config|whatsapp-notifications\.cjs/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8');
  assert.match(preload, /openWhatsAppDraft:[\s\S]*?ipcRenderer\.invoke\('open-whatsapp-draft', request\)/);
  assert.match(preload, /dismissWhatsAppDraft:[\s\S]*?ipcRenderer\.invoke\('dismiss-whatsapp-draft', id\)/);
  assert.doesNotMatch(preload, /saveWhatsAppConfig|validateWhatsAppConfig/);
});

test('retired senders cannot send public messages or simulated browser keystrokes', () => {
  for (const name of ['auto_send_whatsapp.py', 'auto_send_whatsapp.ps1']) {
    const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
    assert.match(source, /retired/i);
    assert.doesNotMatch(source, /ntfy\.sh|pyautogui|SendKeys|urllib\.request|Start-Process|os\.system/);
  }
});
