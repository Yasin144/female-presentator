'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createMetaWorkspace, registerMetaWorkspace, validateWav, CHANNELS } = require('../meta-workspace.cjs');
const ids = ['muse-spark-1.3', 'muse-spark-1.3-contributor', 'muse-image-1.0', 'muse-voice-transcribe-1.0'];
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function fixture(t, options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-workspace-test-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const secret = crypto.randomBytes(32), calls = [];
  const safeStorage = { isEncryptionAvailable: () => true, encryptString(value) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', secret, iv); return Buffer.concat([iv, c.update(value), c.final(), c.getAuthTag()]); }, decryptString(b) { const c = crypto.createDecipheriv('aes-256-gcm', secret, b.subarray(0, 12)); c.setAuthTag(b.subarray(-16)); return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString(); } };
  let response = () => json({ data: ids.map(id => ({ id })) });
  const config = { getUserDataPath: () => folder, safeStorage, fetchImpl: async (url, init) => { calls.push({ url, init }); return response(url, init); }, ...options };
  const service = createMetaWorkspace(config);
  t.after(() => service.shutdown());
  return { service, folder, calls, config, respond: fn => { response = fn; }, async ready() { assert.equal((await service.saveKey({ kind: 'cloud', key: 'LLM_private_fixture_key_123456789' })).ok, true); assert.equal((await service.check('cloud')).ok, true); } };
}
function wav(rate = 24000, seconds = 1) {
  const b = Buffer.alloc(44 + rate * 2 * seconds);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40); return b;
}
test('startup has no network, model download or plaintext key; saved key survives restart', async t => {
  const f = fixture(t); assert.equal(f.service.status().hasCloudKey, false); assert.equal(f.calls.length, 0);
  await f.ready();
  const saved = fs.readFileSync(path.join(f.folder, 'meta-workspace-keys.json'), 'utf8');
  assert.doesNotMatch(saved, /LLM_|private_fixture/); assert.doesNotMatch(JSON.stringify(f.service.status()), /LLM_|private_fixture/);
  const restarted = createMetaWorkspace(f.config);
  assert.equal(restarted.status().hasCloudKey, true); assert.deepEqual(restarted.status().cloudModels, []);
  await restarted.check('cloud'); assert.equal(f.calls.at(-1).init.headers.Authorization, 'Bearer LLM_private_fixture_key_123456789');
});
test('masked keys, unencrypted storage and unknown key kinds are rejected', async t => {
  const f = fixture(t);
  for (const key of ['LLM_2766...8CEY', 'LLM_2766…8CEY', 'short', 'secret\nheader123456']) assert.equal((await f.service.saveKey({ kind: 'cloud', key })).ok, false);
  assert.equal((await f.service.saveKey({ kind: 'other', key: 'long_private_key' })).ok, false);
  const disabled = fixture(t, { safeStorage: { isEncryptionAvailable: () => false } });
  assert.equal((await disabled.service.saveKey({ kind: 'cloud', key: 'long_private_key' })).ok, false);
  assert.equal(f.calls.length, 0); assert.equal(disabled.calls.length, 0);
});
test('key removal persists and clears access discovery', async t => {
  const f = fixture(t); await f.ready(); await f.service.forgetKey('cloud');
  assert.equal(f.service.status().hasCloudKey, false); assert.deepEqual(f.service.status().cloudModels, []);
  assert.equal(createMetaWorkspace(f.config).status().hasCloudKey, false);
});
test('cloud access and consent required; no model fallback or unexpected target', async t => {
  const f = fixture(t);
  assert.equal((await f.service.run({ tool: 'spark', model: ids[0], prompt: 'hi', consent: true })).ok, false);
  assert.equal(f.calls.length, 0); await f.ready();
  for (const input of [{}, { model: 'unknown', consent: true }, { consent: false }]) assert.equal((await f.service.run({ tool: 'spark', prompt: 'Hi', model: ids[0], ...input })).ok, false);
  assert.equal(f.calls.length, 1);
  f.respond(() => json({ choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] }));
  const result = await f.service.run({ tool: 'spark', model: ids[0], prompt: 'Hello', consent: true, url: 'https://attacker.test', tools: [{}] });
  assert.equal(result.text, 'Hello');
  assert.equal(f.calls.at(-1).url, 'https://api.meta.ai/v1/chat/completions'); assert.equal(f.calls.at(-1).init.redirect, 'error');
  const body = JSON.parse(f.calls.at(-1).init.body); assert.equal(body.max_completion_tokens, 8192); assert.equal(body.tools, undefined); assert.equal(body.reasoning_effort, 'low');
});
test('discovery lists only supported available models and resets after a failed check', async t => {
  const f = fixture(t); await f.ready();
  f.respond(() => json({ data: [{ id: ids[0] }, { id: 'other' }] })); await f.service.check('cloud'); assert.deepEqual(f.service.status().cloudModels, [ids[0]]);
  f.respond(() => json({}, 401)); assert.equal((await f.service.check('cloud')).ok, false); assert.deepEqual(f.service.status().cloudModels, []);
});
test('errors do not echo provider secrets and no retries occur', async t => {
  const f = fixture(t); await f.ready();
  f.respond(() => json({ error: { message: 'LLM_secret_do_not_echo' } }, 403));
  const result = await f.service.run({ tool: 'spark', model: ids[0], prompt: 'hello', consent: true });
  assert.match(result.error, /403/); assert.doesNotMatch(result.error, /LLM_/); assert.equal(f.calls.length, 2);
});
test('PNG image protocol fixes output, bounds work and disables planner tools', async t => {
  const f = fixture(t); await f.ready();
  f.respond(() => json({ data: [{ b64_json: 'iVBORw0KGgo=' }] }));
  const result = await f.service.run({ tool: 'image', prompt: 'dog', size: '1024x1024', consent: true });
  assert.match(result.image, /^data:image\/png;base64,/);
  const body = JSON.parse(f.calls.at(-1).init.body);
  assert.equal(body.n, 1); assert.equal(body.output_format, 'png'); assert.deepEqual(body.tool_enablement, { enable_web_search: false, enable_image_search: false, enable_shell: false });
  f.respond(() => json({ data: [{ url: 'https://untrusted.test/image' }] }));
  assert.equal((await f.service.run({ tool: 'image', prompt: 'dog', size: '1024x1024', consent: true })).ok, false);
});
test('WAV validates sample format, duration, truncation and size', () => {
  assert.ok(validateWav(wav())); assert.ok(validateWav(wav(16000)));
  const stereo = wav(); stereo.writeUInt16LE(2, 22); assert.throws(() => validateWav(stereo), /mono/);
  assert.throws(() => validateWav(wav(44100)), /16 kHz/);
  assert.throws(() => validateWav(wav(16000, 601)), /10 minutes/);
  assert.throws(() => validateWav(wav().subarray(0, 55)), /RIFF/);
  assert.throws(() => validateWav('private-path.wav'));
});
test('transcription sends verified multipart WAV with generic filename and diarization', async t => {
  const f = fixture(t); await f.ready();
  f.respond(() => json({ transcript: 'Hello', turns: [{ startMs: 0, endMs: 1000, speaker: 'A', transcript: 'Hello' }] }));
  const result = await f.service.run({ tool: 'voice', audio: wav(), consent: true });
  assert.equal(result.text, 'Hello'); assert.equal(result.turns[0].speaker, 'A');
  const { url, init } = f.calls.at(-1); assert.equal(url, 'https://api.meta.ai/v1/asr/transcribe');
  assert.equal(init.body.get('audio').name, 'recording.wav');
  assert.deepEqual(JSON.parse(await init.body.get('request').text()), { model: ids[3], mode: 'DIARIZATION', audioEncoding: 'WAV' });
});
test('local route never uses the cloud key and requires the explicit Glimmer alias', async t => {
  const f = fixture(t); await f.ready();
  f.respond(() => json({ data: [{ id: 'other-model' }] })); assert.equal((await f.service.check('local')).ok, false);
  f.respond(() => json({ data: [{ id: 'muse-glimmer' }] })); await f.service.check('local');
  assert.equal(f.calls.at(-1).init.headers.Authorization, undefined);
  await f.service.saveKey({ kind: 'local', key: 'local_server_key_123456' }); await f.service.check('local');
  f.respond(() => json({ choices: [{ message: { content: 'Local answer' } }] }));
  assert.equal((await f.service.run({ tool: 'glimmer', prompt: 'Hello' })).text, 'Local answer');
  assert.equal(f.calls.at(-1).url, 'http://127.0.0.1:8080/v1/chat/completions');
  assert.equal(f.calls.at(-1).init.headers.Authorization, 'Bearer local_server_key_123456');
});
test('duplicate requests and changing keys while busy are blocked; cancellation releases lock', async t => {
  const f = fixture(t); await f.ready();
  f.respond((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Abort', 'AbortError')), { once: true })));
  const first = f.service.run({ tool: 'spark', model: ids[0], prompt: 'Hi', consent: true });
  assert.equal((await f.service.run({ tool: 'spark' })).ok, false);
  assert.equal((await f.service.forgetKey('cloud')).ok, false);
  f.service.cancel(); assert.equal((await first).cancelled, true); assert.equal(f.service.status().busy, false);
});
test('timeout, invalid response and truncated answers give actionable outcomes', async t => {
  const f = fixture(t, { timeoutMs: 20 }); await f.ready();
  f.respond((_u, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Abort', 'AbortError')), { once: true })));
  const input = { tool: 'spark', model: ids[0], prompt: 'Hi', consent: true };
  assert.match((await f.service.run(input)).error, /timed out/); assert.equal(f.service.status().busy, false);
  f.respond(() => new Response('not json')); assert.match((await f.service.run(input)).error, /unreadable/);
  f.respond(() => json({ choices: [{ message: { content: 'Partial' }, finish_reason: 'length' }] })); assert.match((await f.service.run(input)).warning, /incomplete/);
});
test('oversized response rejected before body parsing', async t => {
  const f = fixture(t); await f.ready(); f.respond(() => new Response('{}', { headers: { 'content-length': '99999999' } }));
  assert.match((await f.service.run({ tool: 'spark', model: ids[0], prompt: 'hi', consent: true })).error, /safe size/);
});
test('IPC denies remote origins and child frames; all Meta channels excluded from mobile bridge', async t => {
  const f = fixture(t), handlers = new Map();
  registerMetaWorkspace({ handle: (channel, handler) => handlers.set(channel, handler) }, f.config);
  for (const channel of CHANNELS) {
    assert.equal((await handlers.get(channel)({})).ok, false);
    const frame = { url: 'https://attacker.test/' };
    assert.equal((await handlers.get(channel)({ senderFrame: frame, sender: { mainFrame: frame } })).ok, false);
  }
  const frame = { url: 'app://voice/renderer-dist/index.html' };
  assert.equal((await handlers.get('meta-status')({ senderFrame: frame, sender: { mainFrame: frame } })).ok, true);
  assert.equal((await handlers.get('meta-status')({ senderFrame: frame, sender: { mainFrame: {} } })).ok, false);
  const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  assert.ok(main.indexOf('registerMetaWorkspace(ipcMain,') < main.indexOf('ipcMain.handle ='));
  assert.match(main, /for \(const channel of metaDesktopChannels\) desktopOnlyIpcChannels.add\(channel\)/);
});
