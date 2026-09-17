'use strict';

// Dedicated Chrome profile: never attach to, copy, or close the user's Chrome.
// Only sanitized terminal job events go out; no incoming-chat handlers are used.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { RECIPIENT, sanitizeDraftText, formatDraftMessage } = require('./whatsapp-drafts.cjs');
const STATES = new Set(['queued', 'sending', 'submitted', 'accepted', 'delivered', 'uncertain', 'failed', 'cancelled']);
const ALLOWED_CHAT = `${RECIPIENT}@c.us`;
const validMessageId = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const isOwnReceipt = (message, verifiedChats) => validMessageId(message?.id?._serialized) &&
  message.fromMe === true && verifiedChats.has(message.to);

// WhatsApp's current MsgKey exposes toString(), but no longer _serialized.
// wwebjs 1.34.7 still uses _serialized to retrieve the message it just created.
// This compatibility shim is confined to our dedicated browser session.
function installMessageKeyCompatibility() {
  const Key = window.require('WAWebMsgKey');
  if (!Key?.prototype || !window.WWebJS?.getMessageModel) throw new Error('WhatsApp message API is unavailable');
  if (!('_serialized' in Key.prototype)) Object.defineProperty(Key.prototype, '_serialized', {
    configurable: true, get() { return this.toString(); },
  });
  if (!window.WWebJS.__pattanMessageKeyCompatibility) {
    const original = window.WWebJS.getMessageModel;
    window.WWebJS.getMessageModel = message => {
      const result = original(message);
      if (result?.id && typeof result.id === 'object' && !result.id._serialized) {
        result.id = { ...result.id, _serialized: message.id.toString() };
      }
      return result;
    };
    window.WWebJS.__pattanMessageKeyCompatibility = true;
  }
}

async function minimizeSessionWindow(client) {
  // CDP targets only the separate browser owned by this notification service.
  let session;
  try {
    session = await client.pupPage.createCDPSession();
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
  } catch { /* Window management must never break notifications. */ }
  finally { try { await session?.detach(); } catch {} }
}
const bounded = (promise, ms) => {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Operation timed out')), ms);
  })]).finally(() => clearTimeout(timer));
};

function defaultClient(directory) {
  const chrome = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(root => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    .find(filename => fs.existsSync(filename));
  if (!chrome) throw new Error('Google Chrome is not installed. Install Chrome before linking WhatsApp.');
  const { Client, LocalAuth } = require('whatsapp-web.js');
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'pattan-notifications', dataPath: path.join(directory, 'whatsapp-session') }),
    webVersionCache: { type: 'none' },
    deviceName: 'Pattan Workspace notifications',
    takeoverOnConflict: false,
    authTimeoutMs: 60000,
    qrMaxRetries: 5,
    puppeteer: { executablePath: chrome, headless: false, timeout: 60000,
      args: ['--window-size=900,760'], protocolTimeout: 60000 },
  });
  client.prepareNotifications = () => client.pupPage.evaluate(installMessageKeyCompatibility);
  return client;
}

function createWhatsAppSession({ getUserDataPath, clientFactory = defaultClient,
  now = Date.now, sendTimeoutMs = 45000, retryDelayMs = 10000, paceMs = 3000 } = {}) {
  let loaded = false, enabled = false, consent = false, closed = false;
  let items = [], seen = [], client = null, connection = 'off', error = '';
  let timer = null, watchdog = null, draining = false, retries = 0, epoch = 0, stopping = Promise.resolve();
  let nextSendAt = 0;
  const verifiedChats = new Set([ALLOWED_CHAT]);
  const stamp = () => new Date(now()).toISOString();
  const filename = () => path.join(getUserDataPath(), 'whatsapp-session-outbox.json');
  function save() {
    const file = filename(), temp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify({ version: 1, enabled, consent, items, seen }), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, file);
      return true;
    } catch {
      enabled = false;
      error = 'Cannot save the notification outbox. Automatic sending is off; check disk space and folder access.';
      void stopClient();
      return false;
    } finally { try { fs.unlinkSync(temp); } catch {} }
  }
  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const file = filename();
      if (!fs.existsSync(file)) return;
      if (fs.statSync(file).size > 4 * 1024 * 1024) throw new Error('Invalid outbox');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.items) || !Array.isArray(data.seen)) throw new Error('Invalid outbox');
      consent = data.consent === true;
      enabled = data.enabled === true && consent;
      items = data.items.filter(item => item && typeof item.id === 'string' && STATES.has(item.delivery) && ['completed', 'failed'].includes(item.status)).slice(-500)
        .map(item => ({ ...item, processName: sanitizeDraftText(item.processName, 96), details: sanitizeDraftText(item.details, 700),
          delivery: item.delivery === 'sending' ||
            (['submitted', 'accepted', 'delivered'].includes(item.delivery) && !validMessageId(item.messageId))
            ? 'uncertain' : item.delivery }));
      // Repair legacy false delivery claims without silently resending them.
      for (const item of items) if (item.delivery === 'uncertain' && !validMessageId(item.messageId)) {
        item.note = 'No valid send receipt exists. Delivery is unconfirmed; check WhatsApp before retrying.';
      }
      seen = data.seen.filter(id => typeof id === 'string' && id.length <= 256).slice(-5000);
      connection = enabled ? 'disconnected' : 'off';
      if (items.some((item, index) => item.delivery !== data.items[index]?.delivery)) save();
    } catch { enabled = false; error = 'The notification outbox could not be read. Sending is off. Check local storage before enabling again.'; }
  }
  function getStatus() {
    load();
    return { ok: true, mode: 'chrome-session', recipient: RECIPIENT, enabled: enabled && !closed, consent,
      connection, error, pending: items.filter(item => item.delivery === 'queued').length,
      history: items.slice(-50).reverse().map(({ messageId, ...item }) => ({ ...item })) };
  }
  function later(fn, delay) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(); }, delay);
    timer.unref?.();
  }
  function stopClient() {
    clearTimeout(watchdog); watchdog = null;
    const previous = client;
    client = null; epoch++;
    // Retain login. destroy closes only this client, whereas logout revokes it.
    if (previous) stopping = stopping.then(() => bounded(previous.destroy(), 8000)).catch(() => {});
    return stopping;
  }
  function disconnected(message, retry = true) {
    if (closed) return;
    connection = enabled ? 'disconnected' : 'off'; error = message;
    void stopClient();
    if (enabled && retry && retries < 3) {
      retries++;
      later(() => { void connect(false); }, retryDelayMs * retries);
    }
  }
  async function connect(manual = true) {
    load();
    if (closed || !enabled) return { ...getStatus(), ok: false, error: 'Turn automatic notifications on first.' };
    if (client) {
      if (manual) { try { await client.pupPage?.bringToFront(); } catch {} }
      return getStatus();
    }
    if (manual) retries = 0;
    clearTimeout(timer);
    connection = 'connecting'; error = '';
    const generation = ++epoch;
    await stopping;
    if (closed || !enabled || generation !== epoch) return getStatus();
    try {
      const current = clientFactory(getUserDataPath());
      client = current;
      const live = () => current === client && enabled && !closed;
      current.on('qr', () => { if (live()) { connection = 'scan-qr'; error = ''; } });
      current.on('authenticated', () => { if (live()) connection = 'loading'; });
      current.on('ready', async () => {
        if (!live()) return;
        try { if (current.prepareNotifications) await current.prepareNotifications(); }
        catch { if (live()) disconnected('WhatsApp message compatibility check failed. Sending is paused.', false); return; }
        if (!live()) return;
        clearTimeout(watchdog); connection = 'ready'; error = ''; retries = 0;
        void minimizeSessionWindow(current);
        void drain();
      });
      current.on('auth_failure', () => { if (live()) disconnected('WhatsApp login failed. Reconnect and scan the QR code.', false); });
      current.on('disconnected', () => { if (live()) disconnected('WhatsApp disconnected. Pending notifications are saved.'); });
      current.on('message_ack', (message, ack) => {
        if (!live() || !isOwnReceipt(message, verifiedChats) || !Number.isInteger(ack) || ack < -1 || ack > 4) return;
        const item = items.find(entry => validMessageId(entry.messageId) && entry.messageId === message.id._serialized);
        if (!item) return;
        if (ack >= 2) item.delivery = 'delivered';
        else if (ack === 1 && item.delivery !== 'delivered') item.delivery = 'accepted';
        else if (ack < 0 && item.delivery !== 'delivered') item.delivery = 'failed';
        if (['accepted', 'delivered'].includes(item.delivery)) delete item.note;
        item.updatedAt = stamp(); save();
      });
      watchdog = setTimeout(() => {
        if (live() && connection !== 'ready') disconnected('Linking timed out. Click Connect and scan the new QR code.', false);
      }, 240000);
      watchdog.unref?.();
      Promise.resolve(current.initialize()).catch(() => {
        if (live()) disconnected('Could not connect to WhatsApp. Check Chrome and your internet connection.');
      }).finally(() => {
        // Off can race Chrome startup, before pupBrowser has been assigned.
        if (!live()) return bounded(current.destroy(), 8000).catch(() => {});
      });
    } catch (failure) { disconnected(sanitizeDraftText(failure.message, 300) || 'Chrome session could not start.', false); }
    return getStatus();
  }
  async function setEnabled(value, acceptedRisk = false) {
    load();
    if (typeof value !== 'boolean' || closed) return { ...getStatus(), ok: false, error: 'Choose On or Off in the desktop app.' };
    if (value && !consent && acceptedRisk !== true) return { ...getStatus(), ok: false, error: 'Accept the unofficial WhatsApp integration warning first.' };
    if (acceptedRisk === true) consent = true;
    enabled = value; error = '';
    if (!value) {
      clearTimeout(timer);
      // Off must not cause a burst of old notifications on the next enable.
      for (const item of items) if (item.delivery === 'queued') item.delivery = 'cancelled';
      connection = 'off';
      void stopClient();
    }
    if (!save()) { void stopClient(); return { ...getStatus(), ok: false }; }
    if (value) void connect();
    return getStatus();
  }
  function notify(job = {}) {
    load();
    if (!enabled || closed) return { ok: true, skipped: 'disabled' };
    if (!job || !['completed', 'failed'].includes(job.status) || job.cancelled || job.canceled || job.noop || job.noOp ||
        /\b(?:AbortError|cancelled|canceled|cancellation)\b/i.test(String(job.details || ''))) return { ok: true, skipped: 'non-terminal' };
    if (typeof job.id !== 'string' || !job.id || job.id.length > 256) return { ok: false, error: 'Unique job ID required.' };
    if (seen.includes(job.id)) return { ok: true, skipped: 'duplicate' };
    // Prune only finished entries; never silently drop pending messages.
    if (items.length >= 500) {
      const index = items.findIndex(item => !['queued', 'sending', 'uncertain'].includes(item.delivery));
      if (index < 0) { error = 'Notification outbox is full (500). Reconnect WhatsApp to send waiting updates.'; return { ok: false, error }; }
      items.splice(index, 1);
    }
    seen.push(job.id); seen = seen.slice(-5000);
    items.push({ id: job.id, status: job.status, processName: sanitizeDraftText(job.processName, 96) || 'Process',
      details: sanitizeDraftText(job.details, 700) || (job.status === 'failed' ? 'Failed; no reason was reported.' : 'Completed successfully.'),
      at: stamp(), delivery: 'queued', attempts: 0 });
    if (!save()) return { ok: false, error };
    void drain();
    return { ok: true, queued: true };
  }
  async function drain() {
    if (draining || !enabled || closed || connection !== 'ready' || !client) return;
    if (now() < nextSendAt) { later(() => { void drain(); }, nextSendAt - now()); return; }
    const item = items.find(entry => entry.delivery === 'queued');
    if (!item) return;
    draining = true;
    const current = client;
    let submitted = false;
    try {
      // Retry only lookup/preflight failures, never an uncertain send.
      const target = await bounded(current.getNumberId(RECIPIENT), sendTimeoutMs);
      if (!enabled || closed || client !== current) return;
      if (!target?._serialized) { item.delivery = 'failed'; item.note = 'Recipient is not available on WhatsApp.'; save(); return; }
      let verified = target._serialized === ALLOWED_CHAT;
      // WhatsApp now resolves phone numbers to privacy-preserving LIDs. Never
      // trust a LID alone: verify the reverse phone mapping for this exact ID.
      if (!verified && /^\d+@lid$/.test(target._serialized) && typeof current.getContactLidAndPhone === 'function') {
        const mappings = await bounded(current.getContactLidAndPhone([target._serialized]), sendTimeoutMs);
        verified = Array.isArray(mappings) && mappings.length === 1 &&
          mappings[0].lid === target._serialized && mappings[0].pn === ALLOWED_CHAT;
      }
      if (!enabled || closed || client !== current) return;
      if (!verified) {
        item.delivery = 'failed';
        item.note = 'Blocked: recipient verification did not match the only allowed number, +91 7386726193.';
        error = item.note; save(); return;
      }
      verifiedChats.add(target._serialized);
      item.delivery = 'sending'; item.attempts++; item.updatedAt = stamp();
      if (!save()) return;
      submitted = true;
      nextSendAt = now() + paceMs;
      const result = await bounded(current.sendMessage(target._serialized, formatDraftMessage(item), { sendSeen: false, linkPreview: false }), sendTimeoutMs);
      if (!isOwnReceipt(result, verifiedChats)) throw new Error('WhatsApp returned no valid outgoing receipt for the allowed number');
      item.messageId = result.id._serialized;
      item.delivery = result.ack >= 2 ? 'delivered' : result.ack >= 1 ? 'accepted' : 'submitted';
      item.updatedAt = stamp(); save();
    } catch (failure) {
      if (submitted) {
        item.delivery = 'uncertain';
        item.note = 'Send unconfirmed: ' + (sanitizeDraftText(failure?.message, 200) || 'Connection failed') + '. Check WhatsApp before retrying; no automatic resend.';
        save();
        disconnected('A send could not be confirmed. Check the notification history.');
      } else if (enabled && !closed && item.delivery === 'queued') {
        item.attempts++;
        if (item.attempts >= 3) { item.delivery = 'failed'; item.note = 'Recipient lookup failed three times. Check WhatsApp and the connection.'; }
        save();
        disconnected('Recipient lookup failed. Pending notifications are saved.');
      }
    } finally {
      draining = false;
      if (enabled && !closed && connection === 'ready') later(() => { void drain(); }, paceMs);
    }
  }
  function start() { load(); if (enabled && !closed) void connect(false); }
  function retry(id, confirmedNotReceived) {
    load();
    const item = items.find(entry => entry.id === id);
    if (!enabled || closed || connection !== 'ready') return { ...getStatus(), ok: false, error: 'Connect WhatsApp before retrying.' };
    if (!item || !['uncertain', 'failed'].includes(item.delivery) || confirmedNotReceived !== true)
      return { ...getStatus(), ok: false, error: 'Check WhatsApp and confirm this notification was not received before retrying.' };
    item.delivery = 'queued'; item.attempts = 0; item.updatedAt = stamp();
    delete item.messageId; delete item.note;
    error = '';
    if (!save()) return { ...getStatus(), ok: false };
    void drain();
    return getStatus();
  }
  async function shutdown() {
    closed = true; clearTimeout(timer); connection = 'off';
    // Persist in-flight work as uncertain, never automatically repeat it.
    for (const item of items) if (item.delivery === 'sending') item.delivery = 'uncertain';
    if (loaded) save();
    await stopClient();
  }
  return { getStatus, setEnabled, connect, notify, retry, start, shutdown };
}

module.exports = { createWhatsAppSession, defaultClient, minimizeSessionWindow, installMessageKeyCompatibility };
