'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createWhatsAppNotifications, RECIPIENT, DEFAULT_CONFIG, sanitizeText, templateProblem } = require('../whatsapp-notifications.cjs');

const TOKEN = 'mock-meta-secret-for-tests-only-1234567890';
const INPUT = { phoneNumberId: '12345678901', businessAccountId: '9988776655', token: TOKEN };
const TEMPLATE = {
  name: 'pattan_job_alert', language: 'en_US', status: 'APPROVED', category: 'UTILITY', parameter_format: 'POSITIONAL',
  components: [{ type: 'BODY', text: 'Status: {{1}}. Process: {{2}}. Details: {{3}}.' }],
};

function encryptedStorage() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString(buffer) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

function response(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'presentator-whatsapp-test-'));
  const calls = [], storage = options.safeStorage || encryptedStorage();
  const validResponse = (url, init) => {
    if (init.method === 'POST') return response({ messages: [{ id: 'wamid.mock-only' }] });
    if (url.includes('/phone_numbers?')) return response({ data: [{ id: INPUT.phoneNumberId }] });
    if (url.includes('/message_templates?')) return response({ data: [TEMPLATE] });
    return response({ id: INPUT.phoneNumberId });
  };
  const instances = [];
  function create(extra = {}) {
    const instance = createWhatsAppNotifications({
      getUserDataPath: () => directory, safeStorage: storage, now: () => Date.UTC(2026, 8, 9, 12),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return options.fetchImpl ? options.fetchImpl(url, init, validResponse) : validResponse(url, init);
      },
      ...options.serviceOptions, ...extra,
    });
    instances.push(instance);
    return instance;
  }
  const service = create();
  t.after(() => {
    for (const instance of instances) instance.shutdown();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { service, directory, calls, storage, create };
}

async function enable(service) {
  assert.equal((await service.saveConfig(INPUT)).ok, true);
  assert.equal((await service.validateConfig()).ok, true);
  assert.equal((await service.setEnabled(true)).enabled, true);
}

async function drained(service) {
  for (let attempt = 0; attempt < 150 && service.getStatus().pending; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.equal(service.getStatus().pending, 0, 'notification queue drained');
}

test('new setup starts off, does not read legacy auto-send or send a message', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'mobile-preferences.json'), JSON.stringify({ whatsappAutoSend: true }));
  assert.deepEqual(f.service.getStatus(), {
    ok: true, enabled: false, configured: false, validated: false, recipient: RECIPIENT,
    config: DEFAULT_CONFIG, hasToken: false, lastAttempt: null, pending: 0, validating: false,
  });
  assert.equal(RECIPIENT, '917386726193');
  assert.equal((await f.service.setEnabled(true)).ok, false);
  assert.deepEqual(f.service.notify({ id: 'old', status: 'completed' }), { ok: true, skipped: 'disabled' });
  assert.equal(f.calls.length, 0);
});

test('token is encrypted only and public settings never contain it', async t => {
  const f = fixture(t);
  const saved = await f.service.saveConfig(INPUT);
  assert.equal(saved.ok, true);
  assert.equal(saved.configured, true);
  assert.equal(saved.enabled, false);
  assert.equal(saved.validated, false);
  const filename = path.join(f.directory, 'whatsapp-cloud-notifications.json');
  const raw = fs.readFileSync(filename, 'utf8'), persisted = JSON.parse(raw);
  assert.equal(raw.includes(TOKEN), false);
  assert.equal(JSON.stringify(saved).includes(TOKEN), false);
  assert.equal(Object.hasOwn(persisted, 'token'), false);
  assert.equal(f.storage.decryptString(Buffer.from(persisted.encryptedToken, 'base64')), TOKEN);
  assert.deepEqual(fs.readdirSync(f.directory), ['whatsapp-cloud-notifications.json']);
});

test('blank token retains the encrypted token and config changes force off and revalidation', async t => {
  const f = fixture(t);
  await enable(f.service);
  const result = await f.service.saveConfig({ ...INPUT, token: '', templateName: 'other_job_alert' });
  assert.equal(result.ok, true);
  assert.equal(result.hasToken, true);
  assert.equal(result.enabled, false);
  assert.equal(result.validated, false);
  assert.equal((await f.service.setEnabled(true)).ok, false);
});

test('secure storage is mandatory and basic_text is never accepted', async t => {
  for (const storage of [
    { isEncryptionAvailable: () => false },
    { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' },
    { isEncryptionAvailable: () => true, encryptString() { throw new Error(TOKEN); } },
  ]) {
    const f = fixture(t, { safeStorage: storage });
    const result = await f.service.saveConfig(INPUT);
    assert.equal(result.ok, false);
    assert.equal(result.enabled, false);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
    assert.equal(fs.readdirSync(f.directory).length, 0);
  }
});

test('validation only reads official endpoints and checks phone account and approved template', async t => {
  const f = fixture(t);
  await f.service.saveConfig(INPUT);
  const result = await f.service.validateConfig();
  assert.equal(result.ok, true);
  assert.equal(result.validated, true);
  assert.equal(result.enabled, false);
  assert.equal(f.calls.length, 3);
  for (const call of f.calls) {
    const url = new URL(call.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'graph.facebook.com');
    assert.equal(url.pathname.startsWith('/v26.0/'), true);
    assert.equal(url.searchParams.has('access_token'), false);
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(call.init.body, undefined);
  }
});

test('a phone from a different business account is refused before template check', async t => {
  const f = fixture(t, { fetchImpl: (url, init, valid) => url.includes('/phone_numbers?') ? response({ data: [{ id: '99999' }] }) : valid(url, init) });
  await f.service.saveConfig(INPUT);
  const result = await f.service.validateConfig();
  assert.equal(result.ok, false);
  assert.match(result.error, /same Meta setup/);
  assert.equal(f.calls.length, 2);
  assert.equal((await f.service.setEnabled(true)).ok, false);
});

test('only approved utility templates with exactly three body parameters validate', async t => {
  const variants = [
    { status: 'PENDING' }, { category: 'MARKETING' }, { parameter_format: 'NAMED' },
    { language: 'hi' }, { name: 'different' },
    { components: [{ type: 'BODY', text: '{{1}} {{2}}' }] },
    { components: [{ type: 'BODY', text: '{{2}} {{1}} {{3}}' }] },
    { components: [{ type: 'BODY', text: '{{1}} {{2}} {{3}} {{3}}' }] },
    { components: [{ type: 'BODY', text: '{{1}} {{2}} {{3}} {{secret}}' }] },
    { components: [...TEMPLATE.components, { type: 'HEADER', format: 'IMAGE' }] },
    { components: [...TEMPLATE.components, { type: 'HEADER', format: 'TEXT', text: 'Hello {{1}}' }] },
    { components: [...TEMPLATE.components, { type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://example.org/{{1}}' }] }] },
  ];
  for (const variant of variants) {
    const f = fixture(t, { fetchImpl: (url, init, valid) => url.includes('/message_templates?') ? response({ data: [{ ...TEMPLATE, ...variant }] }) : valid(url, init) });
    await f.service.saveConfig(INPUT);
    const result = await f.service.validateConfig();
    assert.equal(result.ok, false, JSON.stringify(variant));
    assert.equal(result.validated, false);
  }
  assert.equal(templateProblem({ ...TEMPLATE, components: [...TEMPLATE.components, { type: 'HEADER', format: 'TEXT', text: 'Pattan Studio' }, { type: 'FOOTER', text: 'Process alert' }] }), '');
});

test('configuration inputs cannot inject URLs paths versions or control characters', async t => {
  const f = fixture(t);
  for (const variant of [
    { phoneNumberId: '../messages' }, { businessAccountId: 'https://evil.example' },
    { apiVersion: 'v26.0@evil.example/' }, { templateName: 'TEMPLATE!?' }, { language: '../../' },
    { token: 'some token with spaces' }, { phoneNumberId: 123 },
  ]) {
    assert.equal((await f.service.saveConfig({ ...INPUT, ...variant })).ok, false);
  }
  assert.equal(f.calls.length, 0);
});

test('enable preference persists securely but pending jobs are never saved or replayed', async t => {
  const f = fixture(t);
  await enable(f.service);
  const restored = f.create();
  assert.equal(restored.getStatus().enabled, true);
  assert.equal(restored.getStatus().validated, true);
  assert.equal(restored.getStatus().pending, 0);
  assert.equal(restored.getStatus().lastAttempt, null);
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 0);
  assert.equal((await restored.setEnabled(false)).enabled, false);
  assert.equal(f.create().getStatus().enabled, false);
});

test('tampered config and un-decryptable token fail closed without revealing secrets', async t => {
  const f = fixture(t);
  await enable(f.service);
  const filename = path.join(f.directory, 'whatsapp-cloud-notifications.json');
  const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
  saved.config.phoneNumberId = '66666';
  fs.writeFileSync(filename, JSON.stringify(saved));
  assert.equal(f.create().getStatus().enabled, false);
  const locked = f.create({ safeStorage: encryptedStorage() });
  const status = locked.getStatus();
  assert.equal(status.enabled, false);
  assert.equal(status.validated, false);
  assert.match(status.configurationError, /securely loaded/);
  assert.equal(JSON.stringify(status).includes(TOKEN), false);
});

test('completion and failure send fixed-recipient template parameters and are submitted not delivered', async t => {
  const f = fixture(t);
  await enable(f.service);
  assert.deepEqual(f.service.notify({ id: 'job-1', status: 'completed', processName: 'PDF video export', details: 'Saved the video.' }), { ok: true, queued: true });
  assert.deepEqual(f.service.notify({ id: 'job-2', status: 'failed', processName: 'Transcription', details: 'Audio decoder failed.' }), { ok: true, queued: true });
  await drained(f.service);
  const posts = f.calls.filter(call => call.init.method === 'POST');
  assert.equal(posts.length, 2);
  const [complete, failed] = posts.map(call => JSON.parse(call.init.body));
  assert.equal(complete.to, RECIPIENT);
  assert.equal(complete.messaging_product, 'whatsapp');
  assert.equal(complete.type, 'template');
  assert.equal(complete.template.name, 'pattan_job_alert');
  assert.deepEqual(complete.template.components[0].parameters.map(item => item.text), ['Completed', 'PDF video export', 'Saved the video.']);
  assert.deepEqual(failed.template.components[0].parameters.map(item => item.text), ['Failed', 'Transcription', 'Audio decoder failed.']);
  assert.equal(f.service.getStatus().lastAttempt.status, 'submitted');
  assert.equal(JSON.stringify(f.service.getStatus()).includes('wamid'), false);
});

test('dedup uses job identity not identical completion text and drops disabled history', async t => {
  const f = fixture(t);
  f.service.notify({ id: 'before-enable', status: 'completed', details: 'Done' });
  await enable(f.service);
  assert.equal(f.service.notify({ id: 'before-enable', status: 'completed' }).skipped, 'duplicate');
  f.service.notify({ id: 'first', status: 'completed', details: 'Done' });
  assert.equal(f.service.notify({ id: 'first', status: 'completed', details: 'Done' }).skipped, 'duplicate');
  f.service.notify({ id: 'second', status: 'completed', details: 'Done' });
  await drained(f.service);
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 2);
});

test('job details redact URLs credentials and full local paths while keeping useful failure reason', async t => {
  const f = fixture(t);
  await enable(f.service);
  const privateDetails = `Decoder failed.\nhttps://example.test/?mobileToken=private-link-token\nAuthorization: Bearer secret-header-value\naccess_token=secret-access-value\n"D:\\LESSONS\\NURSERY COURSE\\book.pdf"\n/Users/private/lesson.pdf\n${TOKEN}`;
  f.service.notify({ id: 'private-failure', status: 'failed', processName: 'PDF export', details: privateDetails });
  await drained(f.service);
  const body = f.calls.find(call => call.init.method === 'POST').init.body;
  for (const secret of ['https://', 'private-link-token', 'secret-header-value', 'secret-access-value', 'LESSONS', 'book.pdf', '/Users/private', TOKEN]) {
    assert.equal(body.includes(secret), false, secret);
  }
  assert.match(body, /Decoder failed/);
  const text = sanitizeText('Failure\t\n' + 'x '.repeat(900), 700);
  assert.equal(text.length <= 700, true);
  assert.equal(/[\n\t]/.test(text), false);
  const otherSecrets = sanitizeText('wss://private-server.example/session?secret=shh\nAuthorization: Basic cHJpdmF0ZTpwYXNzd29yZA==\npath=/home/private/book.pdf', 700);
  assert.equal(/private|cHJpdmF0ZTpwYXNzd29yZA/.test(otherSecrets), false);
});

test('the configured token is removed from process labels and public queue errors as well as message bodies', async t => {
  const f = fixture(t, { serviceOptions: { maxPending: 1 } });
  await enable(f.service);
  f.service.notify({ id: 'first', status: 'completed', processName: TOKEN });
  f.service.notify({ id: 'full', status: 'failed', processName: TOKEN });
  assert.equal(JSON.stringify(f.service.getStatus()).includes(TOKEN), false);
  await drained(f.service);
  assert.equal(JSON.stringify(f.service.getStatus()).includes(TOKEN), false);
  assert.equal(f.calls.find(call => call.init.method === 'POST').init.body.includes(TOKEN), false);
});

test('sends are serialized and queue capacity is strictly bounded including in-flight request', async t => {
  let release;
  const f = fixture(t, {
    serviceOptions: { maxPending: 2 },
    fetchImpl: (url, init, valid) => init.method === 'POST' ? new Promise(resolve => { release = () => resolve(valid(url, init)); }) : valid(url, init),
  });
  await enable(f.service);
  f.service.notify({ id: 'first', status: 'completed' });
  await new Promise(resolve => setImmediate(resolve));
  f.service.notify({ id: 'second', status: 'completed' });
  assert.equal(f.service.notify({ id: 'third', status: 'completed' }).ok, false);
  assert.equal(f.service.getStatus().pending, 2);
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 2);
  release();
  await drained(f.service);
});

test('switching off aborts an in-flight send and discards pending sends without replay', async t => {
  let signal;
  const f = fixture(t, { fetchImpl: (url, init, valid) => {
    if (init.method !== 'POST') return valid(url, init);
    signal = init.signal;
    return new Promise(() => {});
  } });
  await enable(f.service);
  f.service.notify({ id: 'in-flight', status: 'completed' });
  f.service.notify({ id: 'queued', status: 'failed' });
  await new Promise(resolve => setImmediate(resolve));
  await f.service.setEnabled(false);
  assert.equal(signal.aborted, true);
  await drained(f.service);
  assert.equal(f.service.getStatus().lastAttempt.status, 'unknown');
  await f.service.setEnabled(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1);
});

test('timeouts and network failures remain unconfirmed and are never automatically retried', async t => {
  for (const network of [() => new Promise(() => {}), () => Promise.reject(new Error(`private exception ${TOKEN}`))]) {
    const f = fixture(t, { serviceOptions: { requestTimeoutMs: 10 }, fetchImpl: (url, init, valid) => init.method === 'POST' ? network() : valid(url, init) });
    await enable(f.service);
    f.service.notify({ id: 'uncertain', status: 'completed' });
    await drained(f.service);
    assert.equal(f.service.getStatus().lastAttempt.status, 'unknown');
    assert.equal(JSON.stringify(f.service.getStatus()).includes(TOKEN), false);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1);
  }
});

test('Meta error bodies do not expose credentials paths or opaque exceptions', async t => {
  const f = fixture(t, { fetchImpl: (url, init, valid) => init.method === 'POST'
    ? response({ error: { code: 190, message: `${TOKEN} D:\\private\\file.pdf`, error_user_msg: 'secret' } }, 401) : valid(url, init) });
  await enable(f.service);
  f.service.notify({ id: 'rejected', status: 'failed' });
  await drained(f.service);
  const status = f.service.getStatus();
  assert.equal(status.lastAttempt.status, 'failed');
  assert.match(status.lastAttempt.error, /invalid or expired/);
  assert.equal(JSON.stringify(status).includes(TOKEN), false);
  assert.equal(JSON.stringify(status).includes('private'), false);
});

test('success without message ID or malformed response is not reported as submitted', async t => {
  for (const result of [{ messages: [] }, 'not-json']) {
    const f = fixture(t, { fetchImpl: (url, init, valid) => init.method === 'POST'
      ? (typeof result === 'string' ? new Response(result) : response(result)) : valid(url, init) });
    await enable(f.service);
    f.service.notify({ id: 'missing-id', status: 'completed' });
    await drained(f.service);
    assert.equal(f.service.getStatus().lastAttempt.status, 'unknown');
  }
});

test('saving changed settings while validation is running cannot validate the replacement', async t => {
  let release;
  const f = fixture(t, { fetchImpl: (url, init, valid) => new Promise(resolve => { release = () => resolve(valid(url, init)); }) });
  await f.service.saveConfig(INPUT);
  const validating = f.service.validateConfig();
  await new Promise(resolve => setImmediate(resolve));
  await f.service.saveConfig({ ...INPUT, templateName: 'replacement_job_alert' });
  release();
  const result = await validating;
  assert.equal(result.ok, false);
  assert.equal(f.service.getStatus().validated, false);
  assert.equal(f.service.getStatus().enabled, false);
  assert.equal((await f.service.setEnabled(true)).ok, false);
});

test('validation timeout is bounded and does not send any notification', async t => {
  const f = fixture(t, { serviceOptions: { requestTimeoutMs: 10 }, fetchImpl: () => new Promise(() => {}) });
  await f.service.saveConfig(INPUT);
  const result = await f.service.validateConfig();
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/);
  assert.equal(f.service.getStatus().validated, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.method, 'GET');
});

test('invalid jobs and shutdown never throw or trigger new network work', async t => {
  const f = fixture(t);
  await enable(f.service);
  assert.equal(f.service.notify({ id: 'not-terminal', status: 'running' }).ok, false);
  assert.equal(f.service.notify({ status: 'completed' }).ok, false);
  assert.equal(f.service.notify(null).ok, false);
  f.service.shutdown();
  assert.equal(f.service.notify({ id: 'after-shutdown', status: 'completed' }).skipped, 'disabled');
  assert.equal((await f.service.setEnabled(true)).ok, false);
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 0);
});
