'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWhatsAppSession, minimizeSessionWindow } = require('../whatsapp-session.cjs');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
function setup(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pattan-wa-test-'));
  const clients = [], sent = [];
  const factory = () => {
    const client = new EventEmitter();
    client.initialize = async () => {};
    client.destroy = async () => { client.destroyed = true; };
    client.getNumberId = async number => ({ _serialized: `${number}@c.us` });
    client.sendMessage = async (recipient, message) => {
      sent.push({ recipient, message });
      return { id: { _serialized: `message-${sent.length}` }, ack: 1, fromMe: true, to: '917386726193@c.us' };
    };
    clients.push(client); return client;
  };
  const config = { getUserDataPath: () => directory, clientFactory: factory, paceMs: 1, retryDelayMs: 5, sendTimeoutMs: 30, ...overrides };
  const service = createWhatsAppSession(config);
  t.after(async () => { await service.shutdown(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { service, clients, sent, directory, config, async enable() { await service.setEnabled(true, true); await tick(); return clients.at(-1); } };
}
const event = (id = 'job-1') => ({ id, status: 'completed', processName: 'Sing Song', details: 'Output: sample.mp4' });

test('off by default; explicit risk consent required; no Chrome launch or sending', async t => {
  const { service, clients } = setup(t);
  assert.equal(service.getStatus().enabled, false);
  assert.equal((await service.setEnabled(true)).ok, false);
  assert.equal(service.notify(event()).skipped, 'disabled');
  assert.equal(clients.length, 0);
});
test('queues before linking; sends terminal events once to fixed recipient; sanitizes secrets', async t => {
  const { service, enable, sent } = setup(t);
  const client = await enable();
  client.emit('qr', 'private-qr-must-never-be-stored');
  service.notify({ ...event(), details: 'Failed token=secret123 https://private.example' });
  service.notify(event());
  assert.equal(service.getStatus().pending, 1);
  assert.equal(sent.length, 0);
  assert.ok(!JSON.stringify(service.getStatus()).includes('private-qr'));
  client.emit('ready'); await tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].recipient, '917386726193@c.us');
  assert.ok(!sent[0].message.includes('secret123'));
  assert.ok(!sent[0].message.includes('private.example'));
  assert.equal(service.getStatus().history[0].delivery, 'accepted');
  client.emit('message_ack', { id: { _serialized: 'message-1' }, fromMe: true, to: '917386726193@c.us' }, 2);
  assert.equal(service.getStatus().history[0].delivery, 'delivered');
});
test('nonterminal, cancelled and noop jobs are not sent', async t => {
  const { service, enable, sent } = setup(t);
  const client = await enable(); client.emit('ready');
  for (const change of [{ status: 'running' }, { cancelled: true }, { noop: true }, { details: 'Cancelled by user' }]) service.notify({ ...event(), ...change });
  await tick(); assert.equal(sent.length, 0); assert.equal(service.getStatus().pending, 0);
});
test('turning off cancels pending and closes only owned client; late ready cannot send', async t => {
  const { service, enable, sent } = setup(t);
  const client = await enable(); service.notify(event());
  await service.setEnabled(false); client.emit('ready'); await tick();
  assert.equal(client.destroyed, true); assert.equal(sent.length, 0);
  assert.equal(service.getStatus().history[0].delivery, 'cancelled');
});
test('turning off during recipient lookup prevents send', async t => {
  const { service, enable, sent } = setup(t);
  const client = await enable(); let release;
  client.getNumberId = () => new Promise(resolve => { release = resolve; });
  client.emit('ready'); service.notify(event());
  await service.setEnabled(false); release({ _serialized: '917386726193@c.us' }); await tick();
  assert.equal(sent.length, 0);
});
test('uncertain send is never automatically resent, including after restart', async t => {
  const { service, enable, config } = setup(t);
  const client = await enable(); let sends = 0;
  client.sendMessage = async () => { sends++; throw new Error('Connection lost after send'); };
  client.emit('ready'); service.notify(event()); await tick();
  assert.equal(sends, 1); assert.equal(service.getStatus().history[0].delivery, 'uncertain');
  await service.shutdown();
  const restarted = createWhatsAppSession(config);
  t.after(() => restarted.shutdown());
  assert.equal(restarted.getStatus().history[0].delivery, 'uncertain');
  assert.equal(restarted.notify(event()).skipped, 'duplicate');
});
test('crash during send restores uncertain, never queued', async t => {
  const { service, directory } = setup(t);
  fs.writeFileSync(path.join(directory, 'whatsapp-session-outbox.json'), JSON.stringify({ version: 1, enabled: true, consent: true,
    items: [{ ...event(), delivery: 'sending' }], seen: ['job-1'] }));
  assert.equal(service.getStatus().history[0].delivery, 'uncertain');
  assert.equal(service.getStatus().pending, 0);
});
test('failed job includes reason; pending jobs survive restart and dedup persists', async t => {
  const { service, enable, config, clients, sent } = setup(t);
  await enable(); service.notify({ ...event(), status: 'failed', details: 'Voice synthesis timed out.' });
  await service.shutdown();
  const restarted = createWhatsAppSession(config); t.after(() => restarted.shutdown());
  assert.equal(restarted.getStatus().pending, 1);
  restarted.start(); await tick(); clients.at(-1).emit('ready'); await tick();
  assert.equal(sent.length, 1); assert.match(sent[0].message, /Status: Failed/); assert.match(sent[0].message, /timed out/);
});
test('invalid recipient is marked failed without sending', async t => {
  const { service, enable, sent } = setup(t); const client = await enable();
  client.getNumberId = async () => null;
  client.emit('ready'); service.notify(event()); await tick();
  assert.equal(sent.length, 0); assert.equal(service.getStatus().history[0].delivery, 'failed');
});
test('timeout after send is uncertain; output never falsely says delivered', async t => {
  const { service, enable } = setup(t, { sendTimeoutMs: 5 }); const client = await enable();
  client.sendMessage = () => new Promise(() => {});
  client.emit('ready'); service.notify(event()); await tick();
  assert.equal(service.getStatus().history[0].delivery, 'uncertain');
});
test('recipient lookup retries stop after three attempts without ever sending', async t => {
  const { service, enable, clients, sent } = setup(t, { retryDelayMs: 1 });
  let current = await enable();
  for (let attempt = 0; attempt < 3; attempt++) {
    current.getNumberId = async () => { throw new Error('Offline'); };
    current.emit('ready');
    if (attempt === 0) service.notify(event());
    await tick();
    current = clients.at(-1);
  }
  assert.equal(sent.length, 0);
  assert.equal(service.getStatus().history[0].attempts, 3);
  assert.equal(service.getStatus().history[0].delivery, 'failed');
});
test('two notifications are serialized; submitted does not mean delivered', async t => {
  const { service, enable } = setup(t); const client = await enable();
  let active = 0, maximum = 0, sends = 0;
  client.sendMessage = async () => {
    active++; maximum = Math.max(maximum, active); sends++;
    await tick(); active--;
    return { id: { _serialized: `m-${sends}` }, ack: 0, fromMe: true, to: '917386726193@c.us' };
  };
  client.emit('ready'); service.notify(event('a')); service.notify(event('b'));
  await tick(); await tick(); await tick(); await tick();
  assert.equal(sends, 2); assert.equal(maximum, 1);
  assert.ok(service.getStatus().history.every(item => item.delivery === 'submitted'));
});
test('disk failure disables sending rather than sending without durable deduplication', async t => {
  const { service, directory } = setup(t);
  fs.mkdirSync(path.join(directory, 'whatsapp-session-outbox.json'));
  const result = await service.setEnabled(true, true);
  assert.equal(result.ok, false); assert.equal(result.enabled, false);
});
test('production bridge keeps connection controls and QR session desktop-only', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  assert.match(main, /\['whatsapp-session-status', 'whatsapp-session-enable', 'whatsapp-session-connect'\].*desktopOnlyIpcChannels.add/);
  assert.match(main, /if \(session.getStatus\(\).enabled\) return session.notify\(event\)/);
  assert.match(main, /getWhatsAppSession\(\).start\(\)/);
});
test('blocks different numbers, group chats and unverified aliases before sending', async t => {
  for (const target of ['919999999999@c.us', '917386726193@g.us', '12345@lid']) {
    await t.test(target, async t => {
      const { service, enable, sent } = setup(t);
      const client = await enable();
      client.getNumberId = async () => ({ _serialized: target });
      client.emit('ready'); service.notify(event()); await tick();
      assert.equal(sent.length, 0);
      assert.equal(service.getStatus().history[0].delivery, 'failed');
      assert.match(service.getStatus().history[0].note, /Blocked/);
    });
  }
});
test('job payload cannot override the authorized notification number', async t => {
  const { service, enable, sent } = setup(t);
  const client = await enable(); client.emit('ready');
  service.notify({ ...event(), recipient: '919999999999', phone: '919999999999', chatId: 'bad@g.us' });
  await tick();
  assert.equal(sent[0].recipient, '917386726193@c.us');
});
test('minimizes only the dedicated client window and tolerates missing windows', async () => {
  const calls = [];
  await minimizeSessionWindow({ pupPage: { createCDPSession: async () => ({
    send: async (method, args) => { calls.push({ method, args }); return { windowId: 42 }; },
    detach: async () => calls.push('detached'),
  }) } });
  assert.deepEqual(calls[1], { method: 'Browser.setWindowBounds', args: { windowId: 42, bounds: { windowState: 'minimized' } } });
  assert.equal(calls[2], 'detached');
  await minimizeSessionWindow({});
});
test('missing IDs and unrelated acknowledgements cannot create a false delivery', async t => {
  const { service, enable } = setup(t); const client = await enable();
  service.notify(event());
  for (const message of [{}, { id: {} }, { id: { _serialized: '' } },
    { id: { _serialized: 'other' }, fromMe: true, to: '917386726193@c.us' }]) client.emit('message_ack', message, 2);
  assert.equal(service.getStatus().history[0].delivery, 'queued');
  client.emit('ready'); await tick();
  client.emit('message_ack', { id: { _serialized: 'message-1' }, fromMe: true, to: '919999999999@c.us' }, 2);
  client.emit('message_ack', { id: { _serialized: 'message-1' }, fromMe: false, to: '917386726193@c.us' }, 2);
  assert.equal(service.getStatus().history[0].delivery, 'accepted');
});
test('legacy delivered without a receipt is repaired, persisted and not automatically resent', async t => {
  const { service, directory } = setup(t);
  const file = path.join(directory, 'whatsapp-session-outbox.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, enabled: true, consent: true,
    items: [{ ...event(), delivery: 'delivered', note: 'Send result is unknown' }], seen: ['job-1'] }));
  assert.equal(service.getStatus().history[0].delivery, 'uncertain');
  assert.equal(JSON.parse(fs.readFileSync(file)).items[0].delivery, 'uncertain');
  assert.equal(service.getStatus().pending, 0);
});
test('explicit retry requires confirmation and sends only to the fixed number', async t => {
  const { service, enable, sent } = setup(t); const client = await enable();
  const send = client.sendMessage;
  client.sendMessage = async () => undefined;
  client.emit('ready'); service.notify(event()); await tick();
  assert.equal(service.getStatus().history[0].delivery, 'uncertain');
  const next = await enable(); next.sendMessage = send; next.emit('ready');
  assert.equal(service.retry('job-1', false).ok, false);
  assert.equal(service.retry('job-1', true).ok, true);
  await tick(); assert.equal(sent.length, 1);
  assert.equal(service.getStatus().history[0].delivery, 'accepted');
});
test('verified LID maps only to the authorized phone number', async t => {
  for (const phone of ['917386726193@c.us', '919999999999@c.us']) {
    await t.test(phone, async t => {
      const { service, enable, sent } = setup(t);
      const client = await enable();
      client.getNumberId = async () => ({ _serialized: '123456@lid' });
      client.getContactLidAndPhone = async () => [{ lid: '123456@lid', pn: phone }];
      client.emit('ready'); service.notify(event()); await tick();
      assert.equal(sent.length, phone === '917386726193@c.us' ? 1 : 0);
      if (sent.length) assert.equal(sent[0].recipient, '123456@lid');
    });
  }
});
test('current WhatsApp message keys retain real serialized IDs in outgoing receipts', () => {
  const vm = require('node:vm');
  const { installMessageKeyCompatibility } = require('../whatsapp-session.cjs');
  class Key { toString() { return 'true_917386726193@c.us_REAL_MESSAGE_out'; } }
  const mockWindow = { require: name => { assert.equal(name, 'WAWebMsgKey'); return Key; },
    WWebJS: { getMessageModel: () => ({ id: { fromMe: true, remote: '917386726193@c.us' } }) } };
  vm.runInNewContext(`(${installMessageKeyCompatibility.toString()})()`, { window: mockWindow });
  const key = new Key();
  assert.equal(key._serialized, key.toString());
  assert.equal(mockWindow.WWebJS.getMessageModel({ id: key }).id._serialized, key.toString());
  const wrapped = mockWindow.WWebJS.getMessageModel;
  vm.runInNewContext(`(${installMessageKeyCompatibility.toString()})()`, { window: mockWindow });
  assert.equal(mockWindow.WWebJS.getMessageModel, wrapped, 'Repeated setup is idempotent');
});

test('notification page blocks manual inputs only, survives repeated setup and leaves other sites alone', () => {
  const vm = require('node:vm');
  const { installNotificationReadOnly } = require('../whatsapp-session.cjs');
  for (const hostname of ['web.whatsapp.com', 'example.com']) {
    const handlers = new Map();
    let notices = 0;
    const context = { location: { hostname }, window: { addEventListener(type, fn) { handlers.set(type, fn); } },
      document: { body: { appendChild() { notices++; } }, getElementById: () => null, createElement: () => ({ style: {} }) } };
    vm.runInNewContext(`(${installNotificationReadOnly.toString()})()`, context);
    vm.runInNewContext(`(${installNotificationReadOnly.toString()})()`, context);
    if (hostname !== 'web.whatsapp.com') { assert.equal(handlers.size, 0); assert.equal(notices, 0); continue; }
    assert.equal(notices, 1);
    for (const type of ['keydown', 'paste', 'beforeinput', 'drop', 'click', 'submit']) {
      for (const trusted of [true, false]) {
        let prevented = false, stopped = false;
        handlers.get(type)({ isTrusted: trusted, preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
        assert.equal(prevented, trusted); assert.equal(stopped, trusted);
      }
    }
  }
});
