'use strict';

// Drafts are local, temporary, and never sent by this service. Only an explicit
// openDraft call may open WhatsApp, where the user must review and click Send.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RECIPIENT = '917386726193';
const MAX_DRAFTS = 100;
const MAX_SEEN_IDS = 5000;
const PREFERENCES_FILE = 'whatsapp-draft-preferences.json';

function sanitizeDraftText(value, limit) {
  return (typeof value === 'string' ? value : '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, '[link removed]')
    .replace(/\bwww\.[^\s<>"']+/gi, '[link removed]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, '[authorization removed]')
    .replace(/\b(?:authorization|authentication|api[_ -]?key|access[_ -]?token|mobile[_ -]?token|refresh[_ -]?token|token|password|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[credential removed]')
    .replace(/\bEAA[A-Za-z0-9_-]{20,}/g, '[credential removed]')
    .replace(/["'][A-Za-z]:[\\/][^"'\r\n]*["']/g, '[local path removed]')
    .replace(/\b[A-Za-z]:[\\/][^\r\n,;<>]*/g, '[local path removed]')
    .replace(/\\\\[^\r\n,;<>]+/g, '[local path removed]')
    .replace(/["']\/(?:[^"'\r\n]+)["']/g, '[local path removed]')
    .replace(/(?:^|[\s=(:])\/(?:[^\s,;<>]+\/)*[^\s,;<>]*/g, ' [local path removed]')
    .replace(/\b[A-Za-z0-9_=-]{48,}\b/g, '[credential removed]')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}

function formatDraftMessage(draft) {
  return `Pattan Workspace\nStatus: ${draft.status === 'completed' ? 'Completed' : 'Failed'}\nProcess: ${draft.processName}\nDetails: ${draft.details}`;
}

function createWhatsAppDrafts(options = {}) {
  const { getUserDataPath, openExternal, now = Date.now } = options;
  const openingTimeoutMs = Math.max(1, Math.min(60000, Number(options.openingTimeoutMs) || 12000));
  let loaded = false, enabled = false, closed = false, configurationError = '';
  let lastAttempt = null, opening = null;
  const drafts = [], seenIds = new Set();

  function settingsPath() {
    const directory = getUserDataPath?.();
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Invalid settings location');
    return path.join(directory, PREFERENCES_FILE);
  }

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const filename = settingsPath();
      if (!fs.existsSync(filename)) return;
      if (fs.statSync(filename).size > 2048) throw new Error('Invalid preference');
      const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (saved.version !== 1 || typeof saved.enabled !== 'boolean') throw new Error('Invalid preference');
      enabled = saved.enabled;
    } catch {
      enabled = false;
      configurationError = 'The local WhatsApp draft preference could not be loaded. Draft creation is off; save the preference again.';
    }
  }

  function persist() {
    const filename = settingsPath();
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, enabled }, null, 2), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, filename);
      configurationError = '';
    } finally {
      try { fs.unlinkSync(temporary); } catch { /* Remove only this operation's temporary file. */ }
    }
  }

  function getStatus() {
    load();
    return {
      ok: true, mode: 'drafts', enabled: enabled && !closed, recipient: RECIPIENT,
      pending: drafts.length, drafts: drafts.map(draft => ({ ...draft })),
      lastAttempt: lastAttempt ? { ...lastAttempt } : null,
      ...(configurationError ? { configurationError } : {}),
    };
  }

  function failure(error) { return { ...getStatus(), ok: false, error }; }
  function timestamp() { return new Date(now()).toISOString(); }
  function validId(id) { return typeof id === 'string' && id.length > 0 && id.length <= 256 && !/[\u0000-\u001f\u007f]/.test(id); }

  async function setEnabled(value) {
    load();
    if (typeof value !== 'boolean') return failure('Choose draft creation On or Off.');
    if (closed && value) return failure('Draft creation has shut down. Reopen the app first.');
    enabled = value;
    try { persist(); } catch {
      enabled = false;
      configurationError = 'The draft preference could not be saved. New drafts are off for this session; check local settings storage before reopening the app.';
      return failure(configurationError);
    }
    return { ...getStatus(), message: value
      ? 'New completion and failure drafts will appear here. You must review and click Send in WhatsApp.'
      : 'New draft creation is off. Existing drafts remain available for review.' };
  }

  function rememberId(id) {
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    if (seenIds.size > MAX_SEEN_IDS) seenIds.delete(seenIds.values().next().value);
    return true;
  }

  function notify(job = {}) {
    try {
      load();
      if (!job || typeof job !== 'object') return failure('A completed or failed process is required.');
      const cancellationText = [job.details, job.error?.name, job.error?.message].filter(value => typeof value === 'string').join(' ');
      if (job.cancelled === true || job.canceled === true || job.noop === true || job.noOp === true ||
          /\b(?:AbortError|aborted|cancelled|canceled|cancellation)\b/i.test(cancellationText)) {
        return { ...getStatus(), skipped: 'cancelled-or-noop' };
      }
      if (['cancelled', 'canceled', 'skipped', 'noop', 'running', 'started'].includes(job.status)) return { ...getStatus(), skipped: 'non-terminal' };
      if (!['completed', 'failed'].includes(job.status)) return failure('Only completed or failed processes create drafts.');
      if (!validId(job.id)) return failure('A unique process event ID is required.');
      if (!rememberId(job.id)) return { ...getStatus(), skipped: 'duplicate' };
      if (closed || !enabled) return { ...getStatus(), skipped: 'disabled' };
      const draft = {
        id: job.id, status: job.status,
        processName: sanitizeDraftText(job.processName, 96) || 'Process',
        details: sanitizeDraftText(job.details, 700) || (job.status === 'failed' ? 'The process failed. No reason was reported.' : 'The process completed successfully.'),
        at: timestamp(),
      };
      drafts.unshift(draft);
      if (drafts.length > MAX_DRAFTS) drafts.length = MAX_DRAFTS;
      lastAttempt = { status: 'draft_ready', processName: draft.processName, at: draft.at };
      return { ...getStatus(), created: true };
    } catch { return { ok: false, error: 'The local draft could not be prepared. The process itself was not affected.' }; }
  }

  async function openDraft(input = {}) {
    load();
    if (closed) return failure('Drafts have shut down. Reopen the app first.');
    if (!input || !validId(input.id)) return failure('Choose a draft from the review list.');
    if (!['app', 'web'].includes(input.target)) return failure('Choose Open WhatsApp or Open in browser.');
    const draft = drafts.find(item => item.id === input.id);
    if (!draft) return failure('This draft is no longer available. It may have been dismissed or expired.');
    if (opening) {
      if (opening.id === input.id && opening.target === input.target) return opening.promise;
      return failure('A draft is already opening. Wait before opening another one.');
    }
    if (typeof openExternal !== 'function') return failure('Opening WhatsApp is unavailable. Please use the desktop app.');
    const text = encodeURIComponent(formatDraftMessage(draft));
    const url = input.target === 'app'
      ? `whatsapp://send?phone=${RECIPIENT}&text=${text}`
      : `https://wa.me/${RECIPIENT}?text=${text}`;
    let timer, stopOpening;
    const bounded = new Promise(resolve => {
      timer = setTimeout(() => resolve({ outcome: 'unconfirmed' }), openingTimeoutMs);
      stopOpening = () => resolve({ outcome: 'closed' });
    });
    const operation = (async () => {
      try {
        const accepted = Promise.resolve().then(() => openExternal(url)).then(
          result => ({ outcome: result === false || result?.ok === false ? 'failed' : 'opened' }),
          () => ({ outcome: 'failed' }),
        );
        const result = await Promise.race([accepted, bounded]);
        if (result.outcome === 'closed' || closed) return failure('The app closed while the draft was opening. Check WhatsApp yourself; nothing was automatically sent.');
        if (result.outcome !== 'opened') {
          const error = result.outcome === 'unconfirmed'
            ? 'Opening could not be confirmed. Check WhatsApp before trying again; no automatic retry or send was made.'
            : input.target === 'app'
              ? 'WhatsApp could not be opened. Check that it is installed, or choose Open in browser. Nothing was sent.'
              : 'The WhatsApp browser link could not be opened. Check your default browser. Nothing was sent.';
          lastAttempt = { status: 'open_failed', processName: draft.processName, at: timestamp(), error };
          return failure(error);
        }
        const openedAt = timestamp();
        if (drafts.includes(draft)) draft.openedAt = openedAt;
        lastAttempt = { status: 'opened', processName: draft.processName, at: openedAt };
        return { ...getStatus(), message: 'The WhatsApp link was opened. Review the draft and click Send yourself. Sending or delivery is not confirmed.' };
      } catch {
        return failure('The draft could not be opened. No automatic send or retry was made.');
      } finally {
        clearTimeout(timer);
        if (opening?.promise === operation) opening = null;
      }
    })();
    opening = { id: input.id, target: input.target, promise: operation, stop: stopOpening };
    return operation;
  }

  function dismissDraft(id) {
    load();
    if (!validId(id)) return failure('Choose a draft from the review list.');
    const index = drafts.findIndex(draft => draft.id === id);
    if (index < 0) return failure('This draft is no longer available.');
    drafts.splice(index, 1);
    return getStatus();
  }

  function shutdown() {
    closed = true;
    opening?.stop();
    drafts.length = 0;
    seenIds.clear();
    lastAttempt = null;
  }

  return { getStatus, setEnabled, notify, openDraft, dismissDraft, shutdown };
}

module.exports = { createWhatsAppDrafts, RECIPIENT, MAX_DRAFTS, sanitizeDraftText, formatDraftMessage };
