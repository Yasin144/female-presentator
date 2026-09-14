'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWhatsAppDrafts } = require('../whatsapp-drafts.cjs');
const { createWhatsAppJobObserver } = require('../whatsapp-job-events.cjs');

test('native and renderer terminal events prepare local drafts without opening or sending', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-draft-integration-'));
  const opened = [];
  const drafts = createWhatsAppDrafts({ getUserDataPath: () => directory, openExternal: async url => opened.push(url) });
  t.after(() => { drafts.shutdown(); fs.rmSync(directory, { recursive: true, force: true }); });
  const report = event => drafts.notify(event);
  const observe = createWhatsAppJobObserver(report);
  const nativeResult = { ok: true, outputPath: 'D:\\private lessons\\lesson.mp4' };
  const exportVideo = observe('video-resizer-export', async () => nativeResult);
  assert.equal(await exportVideo({}, { jobId: 'disabled-job' }), nativeResult);
  assert.equal(drafts.getStatus().pending, 0);

  assert.equal((await drafts.setEnabled(true)).enabled, true);
  assert.equal(await exportVideo({}, { jobId: 'enabled-job' }), nativeResult);
  await observe('transcribe-video', async () => ({ ok: false, error: 'The voice engine is unavailable.' }))({});
  report({ id: 'browser-preparation', status: 'completed', processName: 'PDF narration preparation', details: 'Prepared: narration.mp3' });
  report({ id: 'browser-preparation', status: 'completed', processName: 'Duplicate', details: 'Do not repeat.' });
  assert.equal(drafts.getStatus().pending, 3);
  assert.deepEqual(opened, []);
  assert.ok(drafts.getStatus().drafts.some(draft => draft.status === 'failed' && draft.details === 'The voice engine is unavailable.'));
  assert.ok(drafts.getStatus().drafts.some(draft => draft.details === 'Output: lesson.mp4'));
  assert.doesNotMatch(JSON.stringify(drafts.getStatus()), /private lessons/);

  await drafts.setEnabled(false);
  assert.equal(drafts.getStatus().pending, 3, 'Off preserves existing drafts');
  const chosen = drafts.getStatus().drafts[0];
  const result = await drafts.openDraft({ id: chosen.id, target: 'web' });
  assert.equal(result.ok, true);
  assert.equal(result.lastAttempt.status, 'opened');
  assert.equal(result.pending, 3, 'Opening is not sending or dismissing');
  assert.equal(opened.length, 1);
  const url = new URL(opened[0]);
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/917386726193');
  assert.match(url.searchParams.get('text'), /PDF narration preparation/);
  assert.equal(drafts.dismissDraft(chosen.id).pending, 2);
});
