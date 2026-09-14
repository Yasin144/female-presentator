'use strict';

// Verified against dev.meta.ai/docs on 2026-09-09. No CLI, shell, file-reading
// tools, model downloads, automatic uploads, or automatic billable retries.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const CLOUD = 'https://api.meta.ai/v1';
const LOCAL = 'http://127.0.0.1:8080/v1';
const MODELS = ['muse-spark-1.3', 'muse-spark-1.3-contributor', 'muse-image-1.0', 'muse-voice-transcribe-1.0'];
const CHANNELS = ['meta-status', 'meta-save-key', 'meta-forget-key', 'meta-check', 'meta-run', 'meta-cancel'];
class UserError extends Error {}
const problem = message => { throw new UserError(message); };

function validateWav(input) {
  if (!(input instanceof Uint8Array) || input.byteLength > 29_000_000 || input.byteLength < 44) problem('Choose a mono PCM WAV file, up to 10 minutes and 29 MB.');
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE' || b.readUInt32LE(4) + 8 !== b.length) problem('This file is not a supported RIFF/WAVE recording.');
  let format, audioBytes = 0;
  for (let p = 12; p + 8 <= b.length;) {
    const name = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4), start = p + 8;
    if (start + size > b.length) problem('The WAV file is incomplete.');
    if (name === 'fmt ' && size >= 16) format = { type: b.readUInt16LE(start), channels: b.readUInt16LE(start + 2), rate: b.readUInt32LE(start + 4), align: b.readUInt16LE(start + 12), bits: b.readUInt16LE(start + 14) };
    if (name === 'data') audioBytes += size;
    p = start + size + (size % 2);
  }
  if (!format || format.type !== 1 || format.channels !== 1 || ![16000, 24000].includes(format.rate) || format.bits !== 16 || format.align !== 2 || !audioBytes || audioBytes % 2) problem('Use mono, 16-bit PCM WAV at 16 kHz or 24 kHz. Other audio formats need conversion first.');
  if (audioBytes / (format.rate * 2) > 600) problem('This recording is longer than 10 minutes. Split it into shorter clips first.');
  return b;
}

function createMetaWorkspace({ getUserDataPath, safeStorage, fetchImpl = globalThis.fetch, timeoutMs = 240000, totalMemory = os.totalmem }) {
  let loaded = false, encrypted = {}, storageError = '', cloudModels = [], localReady = false, pending = null;
  const storagePath = () => path.join(getUserDataPath(), 'meta-workspace-keys.json');
  const encryptionReady = () => safeStorage?.isEncryptionAvailable?.() === true && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  function load() {
    if (loaded) return;
    loaded = true;
    try {
      if (!fs.existsSync(storagePath())) return;
      const saved = JSON.parse(fs.readFileSync(storagePath(), 'utf8'));
      for (const kind of ['cloud', 'local']) if (typeof saved[kind] === 'string' && saved[kind].length < 20000) encrypted[kind] = saved[kind];
    } catch (_) { storageError = 'Saved Meta settings could not be read. Save your key again.'; }
  }
  function status() {
    load();
    return { ok: true, hasCloudKey: Boolean(encrypted.cloud), hasLocalKey: Boolean(encrypted.local), encryptionReady: encryptionReady(), cloudModels: [...cloudModels], localReady, busy: Boolean(pending), memoryGB: Math.round(totalMemory() / 1024 ** 3), storageError };
  }
  function persist(next) {
    fs.mkdirSync(getUserDataPath(), { recursive: true });
    const temp = storagePath() + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600 }); fs.renameSync(temp, storagePath()); }
    catch (_) { try { fs.unlinkSync(temp); } catch (_) {} problem('Could not save encrypted settings. Your previous key was kept.'); }
    encrypted = next;
    storageError = '';
  }
  const kindOf = kind => { if (!['cloud', 'local'].includes(kind)) problem('Choose Cloud or Local.'); return kind; };
  function key(kind) {
    load();
    if (!encryptionReady()) problem('Windows secure key storage is unavailable.');
    if (!encrypted[kind]) problem(kind === 'cloud' ? 'Save your Meta Model API key first.' : 'Save your local server key first.');
    try { return safeStorage.decryptString(Buffer.from(encrypted[kind], 'base64')); }
    catch (_) { problem('The saved key cannot be unlocked on this Windows account. Save it again.'); }
  }
  async function guarded(fn) {
    try { return await fn(); }
    catch (e) { return { ok: false, error: e instanceof UserError ? e.message : 'The operation could not finish. Check the connection and try again.', ...((pending?.controller.signal.aborted || e?.name === 'AbortError') ? { cancelled: true, error: 'Request stopped. The provider may already have processed or billed it. No automatic retry was made.' } : {}) }; }
  }
  async function withRequest(fn, limit = timeoutMs) {
    if (pending) problem('Another Meta request is running. Wait or cancel it first.');
    const task = { controller: new AbortController() };
    pending = task;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; task.controller.abort(); }, limit);
    try { return await fn(task.controller.signal); }
    catch (e) {
      if (timedOut) problem('Request timed out. The provider may already have processed or billed it. No automatic retry was made.');
      if (task.controller.signal.aborted) return { ok: false, cancelled: true, error: 'Request cancelled. The provider may already have processed or billed it.' };
      throw e;
    } finally { clearTimeout(timer); if (pending === task) pending = null; }
  }
  async function request(kind, route, init, signal, limit = 2_000_000) {
    // Targets cannot be supplied by renderer or model output. Never redirect keys.
    const headers = { Accept: 'application/json', ...init.headers };
    if (kind === 'cloud' || (kind === 'local' && route !== '/models')) headers.Authorization = 'Bearer ' + key(kind);
    let response;
    try { response = await fetchImpl((kind === 'cloud' ? CLOUD : LOCAL) + route, { ...init, headers, signal, redirect: 'error' }); }
    catch (e) { if (signal.aborted) throw e; problem(kind === 'local' ? 'Local Glimmer server is unavailable at 127.0.0.1:8080. No model was downloaded or started.' : 'Cannot reach Meta securely. Check your connection. No automatic retry was made.'); }
    if (!response.ok) {
      await response.body?.cancel();
      const reasons = { 400: 'The provider rejected this request or format.', 401: 'The key was rejected. Save a valid key.', 402: 'Billing or available credits need attention.', 403: 'Your account does not have access to this model or operation.', 404: 'This model or endpoint is not available.', 413: 'The recording or request is too large.', 429: 'Rate limit reached. Wait before sending again.' };
      problem(`${kind === 'cloud' ? 'Meta' : 'Local server'} HTTP ${response.status}: ${reasons[response.status] || 'The service could not complete the request.'}`);
    }
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); problem('The response exceeds this app’s safe size limit.'); }
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); problem('The response exceeds this app’s safe size limit.'); }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (e) { if (e instanceof UserError || signal.aborted) throw e; problem('The provider returned an unreadable response.'); }
  }
  const textInput = value => { if (typeof value !== 'string' || !value.trim() || value.length > 16000) problem('Enter a prompt of 1–16,000 characters.'); return value.trim(); };
  return {
    status,
    saveKey: input => guarded(() => {
      load();
      if (pending) problem('Wait for the current Meta request before changing keys.');
      const kind = kindOf(input?.kind), value = input?.key;
      if (!encryptionReady()) problem('Windows secure key storage is unavailable. No key was saved.');
      if (typeof value !== 'string' || value.trim().length < 12 || value.length > 4096 || /\s|\.\.\.|…|[<>*]/.test(value.trim())) problem('Enter the full, unmasked key in this private field.');
      persist({ ...encrypted, [kind]: safeStorage.encryptString(value.trim()).toString('base64') });
      if (kind === 'cloud') cloudModels = []; else localReady = false;
      return status();
    }),
    forgetKey: kind => guarded(() => {
      load(); kindOf(kind);
      if (pending) problem('Wait for the current Meta request before removing keys.');
      const next = { ...encrypted }; delete next[kind]; persist(next);
      if (kind === 'cloud') cloudModels = []; else localReady = false;
      return status();
    }),
    check: kind => guarded(() => {
      kindOf(kind);
      if (kind === 'cloud') cloudModels = []; else localReady = false;
      return withRequest(async signal => {
        const result = await request(kind, '/models', { method: 'GET' }, signal);
        if (!Array.isArray(result.data)) problem('The server did not return a model list.');
        const ids = result.data.map(m => m?.id);
        if (kind === 'cloud') cloudModels = MODELS.filter(id => ids.includes(id));
        else localReady = ids.includes('muse-glimmer');
        if (kind === 'local' && !localReady) problem('The local server is not serving the muse-glimmer alias. Check its setup.');
        return { ...status(), busy: false };
      }, 15000);
    }),
    run: input => guarded(() => withRequest(async signal => {
      if (!input || !['spark', 'image', 'voice', 'glimmer'].includes(input.tool)) problem('Choose a Meta tool.');
      const kind = input.tool === 'glimmer' ? 'local' : 'cloud';
      if (kind === 'cloud' && input.consent !== true) problem('Confirm that this prompt or recording may be sent to Meta, with possible usage charges.');
      const model = { spark: input.model, image: 'muse-image-1.0', voice: 'muse-voice-transcribe-1.0', glimmer: 'muse-glimmer' }[input.tool];
      if (input.tool === 'spark' && !MODELS.slice(0, 2).includes(model)) problem('Choose an available Spark model.');
      if (kind === 'cloud' && !cloudModels.includes(model)) problem('Check your API access first. This model was not found for the saved key.');
      if (kind === 'local' && !localReady) problem('Check the local Glimmer connection first.');
      if (input.tool === 'voice') {
        const wav = validateWav(input.audio);
        const form = new FormData();
        form.append('request', new Blob([JSON.stringify({ model, mode: 'DIARIZATION', audioEncoding: 'WAV' })], { type: 'application/json' }));
        form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'recording.wav');
        const result = await request(kind, '/asr/transcribe', { method: 'POST', body: form }, signal);
        if (typeof result.transcript !== 'string') problem('Meta did not return a transcript.');
        return { ok: true, text: result.transcript, turns: (Array.isArray(result.turns) ? result.turns : []).slice(0, 5000).map(t => ({ startMs: Number.isFinite(t.startMs) ? t.startMs : null, endMs: Number.isFinite(t.endMs) ? t.endMs : null, speaker: typeof t.speaker === 'string' ? t.speaker.slice(0, 40) : '', transcript: typeof t.transcript === 'string' ? t.transcript : '' })) };
      }
      const prompt = textInput(input.prompt);
      if (input.tool === 'image') {
        if (!['1024x1024', '1536x1024', '1024x1536'].includes(input.size)) problem('Choose square, landscape, or portrait.');
        const result = await request(kind, '/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt, n: 1, size: input.size, output_format: 'png', response_format: 'b64_json', tool_enablement: { enable_web_search: false, enable_image_search: false, enable_shell: false } }) }, signal, 24_000_000);
        const base64 = result.data?.[0]?.b64_json;
        if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || !Buffer.from(base64, 'base64').subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) problem('Meta did not return a valid PNG image.');
        return { ok: true, image: 'data:image/png;base64,' + base64 };
      }
      const parameters = kind === 'cloud' ? { max_completion_tokens: 8192, reasoning_effort: 'low' } : { max_tokens: 8192, chat_template_kwargs: { reasoning_strength: 'low' } };
      const result = await request(kind, '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false, ...parameters }) }, signal);
      const choice = result.choices?.[0], text = choice?.message?.content;
      if (typeof text !== 'string' || !text.trim()) problem(choice?.finish_reason === 'length' ? 'The model used its output budget before producing an answer. Try a shorter prompt.' : 'The model returned no text answer.');
      return { ok: true, text, warning: choice.finish_reason === 'length' ? 'The answer reached the output limit and may be incomplete.' : '' };
    })),
    cancel: () => { pending?.controller.abort(); return { ok: true }; },
    shutdown: () => pending?.controller.abort(),
  };
}

function registerMetaWorkspace(ipcMain, options) {
  let service;
  const get = () => service ||= createMetaWorkspace(options);
  const methods = ['status', 'saveKey', 'forgetKey', 'check', 'run', 'cancel'];
  CHANNELS.forEach((channel, index) => ipcMain.handle(channel, async (event, input) => {
    // Only the desktop app's top frame; never a remote/mobile RPC or iframe.
    const frame = event?.senderFrame;
    if (!frame || frame !== event.sender?.mainFrame || !/^(app:\/\/voice\/|http:\/\/127\.0\.0\.1:5173\/)/.test(frame.url)) return { ok: false, error: 'Meta AI is available only in the desktop app.' };
    return get()[methods[index]](input);
  }));
  return () => service?.shutdown();
}
module.exports = { createMetaWorkspace, registerMetaWorkspace, validateWav, CHANNELS };
