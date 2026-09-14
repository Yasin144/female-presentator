'use strict';

// This service only uses Meta's supported Cloud API. It never controls WhatsApp
// windows, types into another application, or starts external programs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RECIPIENT = '917386726193';
const FILE_NAME = 'whatsapp-cloud-notifications.json';
const DEFAULT_CONFIG = Object.freeze({
  phoneNumberId: '', businessAccountId: '', templateName: 'pattan_job_alert',
  language: 'en_US', apiVersion: 'v26.0',
});
const MAX_SEEN_IDS = 5000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function cleanConfig(input = {}, previous = DEFAULT_CONFIG) {
  const next = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    const value = Object.prototype.hasOwnProperty.call(input, key) ? input[key] : previous[key];
    next[key] = typeof value === 'string' ? value.trim() : '';
  }
  return next;
}

function configProblem(config) {
  if (!/^\d{1,32}$/.test(config.phoneNumberId)) return 'Enter the Meta phone number ID (digits only).';
  if (!/^\d{1,32}$/.test(config.businessAccountId)) return 'Enter the WhatsApp Business Account ID (digits only).';
  if (!/^[a-z0-9_]{1,128}$/.test(config.templateName)) return 'Enter a template name using lowercase letters, digits, and underscores.';
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(config.language)) return 'Enter the approved template language, for example en_US.';
  if (!/^v\d{1,2}\.0$/.test(config.apiVersion)) return 'Enter a Graph API version, for example v26.0.';
  return '';
}

function sanitizeText(value, limit, secret = '') {
  let text = typeof value === 'string' ? value : '';
  if (secret) text = text.split(secret).join('[redacted]');
  return text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, '[link removed]')
    .replace(/\bwww\.[^\s<>"']+/gi, '[link removed]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, '[authorization removed]')
    .replace(/\b(?:authorization|authentication|api[_ -]?key|access[_ -]?token|mobile[_ -]?token|refresh[_ -]?token|token|password|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[credential removed]')
    .replace(/["'][A-Za-z]:[\\/][^"'\r\n]*["']/g, '[local path removed]')
    .replace(/\b[A-Za-z]:[\\/][^\r\n,;<>]*/g, '[local path removed]')
    .replace(/\\\\[^\r\n,;<>]+/g, '[local path removed]')
    .replace(/["']\/(?:[^"'\r\n]+)["']/g, '[local path removed]')
    .replace(/(?:^|[\s=(:])\/(?:[^\s,;<>]+\/)*[^\s,;<>]*/g, ' [local path removed]')
    .replace(/\b[A-Za-z0-9_=-]{48,}\b/g, '[redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}

function templateProblem(template) {
  if (template.status !== 'APPROVED') return 'The selected message template is not approved by Meta.';
  if (template.category !== 'UTILITY') return 'Use an approved UTILITY template for process notifications.';
  if (template.parameter_format && template.parameter_format !== 'POSITIONAL') return 'The template must use positional parameters {{1}}, {{2}}, and {{3}}.';
  const components = Array.isArray(template.components) ? template.components : [];
  const bodies = components.filter(component => component?.type === 'BODY');
  if (bodies.length !== 1 || typeof bodies[0].text !== 'string') return 'The template needs one text body.';
  const placeholders = [...bodies[0].text.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1]);
  if (placeholders.join(',') !== '1,2,3' || /[{}]/.test(bodies[0].text.replace(/\{\{[123]\}\}/g, ''))) {
    return 'The template body must contain {{1}}, {{2}}, and {{3}} once, in that order: status, process, details.';
  }
  for (const component of components) {
    if (component.type === 'BODY') continue;
    if (!['HEADER', 'FOOTER'].includes(component.type) ||
        (component.type === 'HEADER' && component.format !== 'TEXT') ||
        typeof component.text !== 'string' || /[{}]/.test(component.text)) {
      return 'Use a text-body template without buttons, media, or extra variables. Static text headers and footers are allowed.';
    }
  }
  return '';
}

function safeApiError(response, payload) {
  const code = Number(payload?.error?.code);
  const descriptions = {
    190: 'The Meta access token is invalid or expired. Update it and validate again.',
    10: 'The Meta token does not have the required WhatsApp permissions.',
    200: 'The Meta token does not have access to this WhatsApp Business account.',
    100: 'Meta rejected the account, phone number, or template settings. Check them and validate again.',
    131026: 'WhatsApp could not deliver to the recipient. Check that the number can receive business messages.',
    131048: 'WhatsApp restricted this sender. Check the account status in WhatsApp Manager.',
    131049: 'WhatsApp declined this message to protect recipient engagement.',
    132000: 'The approved template parameters do not match. Validate the template again.',
    132001: 'The approved template or language could not be found. Validate the settings again.',
    132015: 'Meta paused this template. Check WhatsApp Manager before enabling notifications again.',
    132016: 'Meta disabled this template. Choose an approved template and validate again.',
  };
  if (descriptions[code]) return descriptions[code];
  if (response.status === 401 || response.status === 403) return 'Meta denied access. Check the token and WhatsApp permissions.';
  if (response.status === 429) return 'Meta rate-limited the request. No automatic retry was made.';
  if (response.status >= 500) return 'Meta is temporarily unavailable. No automatic retry was made.';
  return 'Meta rejected the WhatsApp request. Check the account and template settings in WhatsApp Manager.';
}

function createWhatsAppNotifications(options = {}) {
  const { getUserDataPath, safeStorage, fetchImpl = globalThis.fetch, now = Date.now } = options;
  const timeoutMs = Math.max(1, Math.min(60000, Number(options.requestTimeoutMs) || 12000));
  const maxPending = Math.max(1, Math.min(100, Number(options.maxPending) || 100));
  let loaded = false, closed = false, enabled = false, validated = false;
  let config = { ...DEFAULT_CONFIG }, encryptedToken = '', storageIssue = '';
  let lastAttempt = null, generation = 0, inFlight = null, draining = false;
  let validationPromise = null;
  const queue = [], seenIds = new Set(), controllers = new Set();

  function encryptionReady() {
    try {
      return safeStorage?.isEncryptionAvailable?.() === true &&
        safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
    } catch { return false; }
  }

  function configHash() {
    return crypto.createHash('sha256').update(JSON.stringify(config)).update(encryptedToken).digest('hex');
  }

  function settingsPath() {
    const directory = getUserDataPath?.();
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Invalid settings location');
    return path.join(directory, FILE_NAME);
  }

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const file = settingsPath();
      if (!fs.existsSync(file)) return;
      if (fs.statSync(file).size > MAX_RESPONSE_BYTES) throw new Error('Invalid settings');
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved.version !== 1) throw new Error('Unsupported settings');
      config = cleanConfig(saved.config);
      encryptedToken = typeof saved.encryptedToken === 'string' && /^[A-Za-z0-9+/=]{1,32768}$/.test(saved.encryptedToken) ? saved.encryptedToken : '';
      if (encryptedToken) {
        if (!encryptionReady()) throw new Error('Secure storage unavailable');
        const token = safeStorage.decryptString(Buffer.from(encryptedToken, 'base64'));
        if (typeof token !== 'string' || !/^[\x21-\x7e]{10,8192}$/.test(token)) throw new Error('Cannot decrypt token');
      }
      validated = !configProblem(config) && Boolean(encryptedToken) && saved.validatedConfigHash === configHash();
      enabled = saved.enabled === true && validated;
    } catch {
      enabled = false;
      validated = false;
      storageIssue = 'Saved WhatsApp settings could not be securely loaded. Notifications are off; save and validate the settings again.';
    }
  }

  function persist() {
    const file = settingsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({
        version: 1, config, encryptedToken, enabled,
        validatedConfigHash: validated ? configHash() : '',
      }, null, 2), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, file);
      storageIssue = '';
    } finally {
      try { fs.unlinkSync(temporary); } catch { /* Only our own temporary file. */ }
    }
  }

  function getStatus() {
    load();
    return {
      ok: true, enabled: enabled && !closed,
      configured: !configProblem(config) && Boolean(encryptedToken) && encryptionReady(),
      validated, recipient: RECIPIENT, config: { ...config }, hasToken: Boolean(encryptedToken),
      lastAttempt: lastAttempt ? { ...lastAttempt } : null,
      pending: queue.length + (inFlight ? 1 : 0),
      validating: Boolean(validationPromise),
      ...(storageIssue ? { configurationError: storageIssue } : {}),
    };
  }

  function failure(error) { return { ...getStatus(), ok: false, error }; }
  function stamp(attempt) { lastAttempt = { ...attempt, at: new Date(now()).toISOString() }; }

  function stopPending(reason) {
    generation += 1;
    queue.length = 0;
    for (const controller of controllers) controller.abort();
    if (inFlight) stamp({ status: 'unknown', processName: inFlight.processName, error: reason });
  }

  function tokenValue() {
    if (!encryptionReady()) throw new Error('Secure storage unavailable');
    return safeStorage.decryptString(Buffer.from(encryptedToken, 'base64'));
  }

  async function request(endpoint, requestConfig, token, method = 'GET', body) {
    const controller = new AbortController();
    controllers.add(controller);
    let timedOut = false;
    let timer;
    // A separate abort promise also bounds injected/non-cooperative fetches.
    const aborted = new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('Request stopped')), { once: true });
    });
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const url = `https://graph.facebook.com/${requestConfig.apiVersion}/${endpoint}`;
      const work = (async () => {
        const response = await fetchImpl(url, {
          method, redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (response.redirected) return { ok: false, uncertain: method === 'POST', error: 'Meta returned an unexpected redirect. The request was not retried.' };
        const raw = await response.text();
        if (raw.length > MAX_RESPONSE_BYTES) return { ok: false, uncertain: method === 'POST', error: 'Meta returned an unexpected response. Check WhatsApp Manager.' };
        let payload;
        try { payload = JSON.parse(raw); } catch { return { ok: false, uncertain: method === 'POST', error: 'Meta returned an unreadable response. No automatic retry was made.' }; }
        if (!response.ok || payload?.error) return { ok: false, uncertain: method === 'POST' && response.status >= 500, error: safeApiError(response, payload) };
        return { ok: true, payload };
      })();
      return await Promise.race([work, aborted]);
    } catch {
      return {
        ok: false, uncertain: method === 'POST',
        error: timedOut
          ? 'The WhatsApp request timed out. Its outcome is unconfirmed; no automatic retry was made.'
          : controller.signal.aborted
            ? 'The request was stopped. Any message already accepted by WhatsApp cannot be recalled; no automatic retry was made.'
            : 'The WhatsApp request could not be confirmed. Check the connection; no automatic retry was made.',
      };
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }

  async function saveConfig(input = {}) {
    load();
    if (closed) return failure('Notifications have shut down. Reopen the app before changing settings.');
    if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('Enter the WhatsApp settings in the form.');
    const candidate = cleanConfig(input, config);
    const problem = configProblem(candidate);
    if (problem) return failure(problem);
    if (!encryptionReady()) return failure('Windows secure token storage is unavailable. Nothing was saved or enabled.');
    const suppliedToken = typeof input.token === 'string' ? input.token.trim() : '';
    if (suppliedToken && !/^[\x21-\x7e]{10,8192}$/.test(suppliedToken)) return failure('Enter a valid Meta access token without spaces or line breaks.');
    let nextToken = encryptedToken;
    try {
      if (suppliedToken) nextToken = safeStorage.encryptString(suppliedToken).toString('base64');
      else if (nextToken) tokenValue();
      if (!nextToken) return failure('Enter the Meta access token. It is stored encrypted on this computer.');
    } catch { return failure('The access token could not be securely stored. Nothing was enabled.'); }
    stopPending('Sending was stopped because settings changed. An already accepted message cannot be recalled.');
    validationPromise = null;
    enabled = false;
    validated = false;
    config = candidate;
    encryptedToken = nextToken;
    try { persist(); } catch {
      storageIssue = 'WhatsApp settings could not be saved. Notifications remain off.';
      return failure(storageIssue);
    }
    return { ...getStatus(), message: 'Saved securely. Validate the approved template, then turn notifications on.' };
  }

  async function validateConfig() {
    load();
    if (closed) return failure('Notifications have shut down. Reopen the app before validating.');
    if (validationPromise) return validationPromise;
    if (!getStatus().configured) return failure('Save the phone number ID, Business Account ID, access token, and template first.');
    stopPending('Sending was stopped for validation. An already accepted message cannot be recalled.');
    enabled = false;
    validated = false;
    try { persist(); } catch { return failure('Could not save the disabled state. Fix local settings storage before validating.'); }
    const currentGeneration = generation, requestConfig = { ...config };
    let token;
    try { token = tokenValue(); } catch { return failure('The saved access token could not be unlocked. Save the token again.'); }
    const operation = (async () => {
      const phone = await request(`${requestConfig.phoneNumberId}?fields=id`, requestConfig, token);
      if (currentGeneration !== generation || closed) return failure('Settings changed or validation was stopped. Validate the current settings again.');
      if (!phone.ok) return failure(phone.error);
      if (String(phone.payload?.id || '') !== requestConfig.phoneNumberId) return failure('Meta did not confirm the configured phone number ID.');
      const phones = await request(`${requestConfig.businessAccountId}/phone_numbers?fields=id&limit=100`, requestConfig, token);
      if (currentGeneration !== generation || closed) return failure('Settings changed or validation was stopped. Validate the current settings again.');
      if (!phones.ok) return failure(phones.error);
      if (!Array.isArray(phones.payload?.data) || !phones.payload.data.some(item => String(item?.id || '') === requestConfig.phoneNumberId)) {
        return failure('The phone number ID was not found in this WhatsApp Business account. Use the phone and account IDs from the same Meta setup.');
      }
      const query = new URLSearchParams({ name: requestConfig.templateName, fields: 'name,language,status,category,components,parameter_format', limit: '100' });
      const result = await request(`${requestConfig.businessAccountId}/message_templates?${query}`, requestConfig, token);
      if (currentGeneration !== generation || closed) return failure('Settings changed or validation was stopped. Validate the current settings again.');
      if (!result.ok) return failure(result.error);
      const templates = Array.isArray(result.payload?.data) ? result.payload.data : [];
      const template = templates.find(item => item?.name === requestConfig.templateName && item?.language === requestConfig.language);
      if (!template) return failure('The template and language were not found in this WhatsApp Business account. Check the exact approved name and language.');
      const problem = templateProblem(template);
      if (problem) return failure(problem);
      validated = true;
      try { persist(); } catch {
        validated = false;
        return failure('Validation passed, but it could not be saved. Notifications remain off.');
      }
      return { ...getStatus(), validating: false, message: 'Phone access and approved template verified. No test message was sent. You can now turn notifications on.' };
    })();
    validationPromise = operation;
    try { return await operation; }
    finally { if (validationPromise === operation) validationPromise = null; }
  }

  async function setEnabled(value) {
    load();
    if (typeof value !== 'boolean') return failure('Choose notifications on or off.');
    if (closed && value) return failure('Notifications have shut down. Reopen the app before enabling.');
    if (value && (!getStatus().configured || !validated)) return failure('Save and validate the official WhatsApp connection before turning notifications on.');
    if (!value) stopPending('Sending was switched off. An already accepted message cannot be recalled.');
    enabled = value;
    try { persist(); } catch {
      enabled = false;
      storageIssue = 'The notification preference could not be saved. Notifications are off for this session; fix local settings storage before reopening the app.';
      return failure(storageIssue);
    }
    return { ...getStatus(), message: value
      ? 'Notifications are on for future completed and failed processes.'
      : 'Notifications are off. Queued messages were discarded; already accepted messages cannot be recalled.' };
  }

  function rememberId(id) {
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    if (seenIds.size > MAX_SEEN_IDS) seenIds.delete(seenIds.values().next().value);
    return true;
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (!closed && enabled && validated && queue.length) {
        const item = queue.shift();
        inFlight = item;
        const currentGeneration = generation, requestConfig = { ...config };
        let token;
        try { token = tokenValue(); } catch {
          enabled = false;
          validated = false;
          queue.length = 0;
          stamp({ status: 'failed', processName: item.processName, error: 'The access token could not be unlocked. Save and validate it again.' });
          try { persist(); } catch { /* Fail closed in memory as well. */ }
          inFlight = null;
          break;
        }
        stamp({ status: 'sending', processName: item.processName });
        const body = {
          messaging_product: 'whatsapp', recipient_type: 'individual', to: RECIPIENT, type: 'template',
          template: { name: requestConfig.templateName, language: { code: requestConfig.language }, components: [{
            type: 'body', parameters: [item.status === 'completed' ? 'Completed' : 'Failed', item.processName, item.details]
              .map(text => ({ type: 'text', text: sanitizeText(text, 700, token) || 'Not provided' })),
          }] },
        };
        const result = await request(`${requestConfig.phoneNumberId}/messages`, requestConfig, token, 'POST', body);
        if (currentGeneration === generation && !closed) {
          if (result.ok && typeof result.payload?.messages?.[0]?.id === 'string' && result.payload.messages[0].id) {
            stamp({ status: 'submitted', processName: item.processName });
          } else {
            stamp({ status: result.uncertain || result.ok ? 'unknown' : 'failed', processName: item.processName,
              error: result.error || 'Meta did not return a message ID. Submission is unconfirmed; no automatic retry was made.' });
          }
        }
        inFlight = null;
      }
    } finally { inFlight = null; draining = false; }
  }

  function notify(event = {}) {
    try {
      load();
      if (!event || typeof event !== 'object' || !['completed', 'failed'].includes(event.status)) return { ok: false, error: 'Only completed or failed processes can create notifications.' };
      const id = typeof event.id === 'string' ? event.id.trim() : '';
      if (!id || id.length > 256) return { ok: false, error: 'A unique process event ID is required.' };
      if (!rememberId(id)) return { ok: true, skipped: 'duplicate' };
      if (closed || !enabled || !validated) return { ok: true, skipped: 'disabled' };
      let secret = '';
      try { secret = tokenValue(); } catch { /* drain() reports a locked token without interrupting the process. */ }
      const processName = sanitizeText(event.processName, 96, secret) || 'Process';
      if (queue.length + (inFlight ? 1 : 0) >= maxPending) {
        stamp({ status: 'failed', processName, error: 'The notification queue is full. This alert was not sent.' });
        return { ok: false, error: 'The notification queue is full. The process itself was not affected.' };
      }
      queue.push({ id, status: event.status, processName,
        details: sanitizeText(event.details, 700, secret) || (event.status === 'failed' ? 'The process failed. No reason was reported.' : 'The process completed successfully.'),
      });
      queueMicrotask(() => { drain().catch(() => {
        enabled = false;
        queue.length = 0;
        stamp({ status: 'unknown', processName: 'Process', error: 'Notification processing stopped unexpectedly. No automatic retry was made.' });
      }); });
      return { ok: true, queued: true };
    } catch { return { ok: false, error: 'The notification could not be prepared. The process itself was not affected.' }; }
  }

  function shutdown() {
    closed = true;
    stopPending('The app closed before submission could be confirmed. No automatic retry will be made.');
    // Do not persist the queue or replay alerts on the next launch.
  }

  return { getStatus, saveConfig, validateConfig, setEnabled, notify, shutdown };
}

module.exports = { createWhatsAppNotifications, RECIPIENT, DEFAULT_CONFIG, sanitizeText, templateProblem };
