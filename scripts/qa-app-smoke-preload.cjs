'use strict';

// Test-only bridge. It never invokes production IPC, runs subprocesses, accesses
// user files, or reaches a service. Every operation is a stub in this profile.
const { contextBridge, ipcRenderer } = require('electron');
const encodedMethods = process.argv.find(arg => arg.startsWith('--qa-api-methods='))?.slice('--qa-api-methods='.length) || '';
const methods = JSON.parse(Buffer.from(encodedMethods, 'base64').toString('utf8') || '[]');
const api = { isElectron: true, isMobileRemote: process.argv.includes('--qa-mobile-remote'), platform: 'win32' };
const metaState = { ok: true, hasCloudKey: false, hasLocalKey: false, cloudModels: [], localReady: false, memoryGB: 16, encryptionReady: true };
const health = { anjali: true, edgeTts: true, transcribe: true, videoExport: true, sc3Singing: true, imageGenerator: false, translation: true, vite: false, configured: {} };
const report = (kind, detail) => ipcRenderer.send('qa-smoke-report', { kind, detail });
const whatsapp = {
  ok: true, mode: process.argv.includes('--qa-whatsapp-old-mode') ? 'legacy' : 'drafts', enabled: false,
  recipient: '917386726193', pending: 0, drafts: [], lastAttempt: null,
};
const whatsappSession = { ok: true, mode: 'chrome-session', enabled: false, consent: false,
  recipient: '917386726193', connection: 'off', pending: 0, history: [], error: '' };
let failNextOpen = false;
const whatsappCalls = [], whatsappJobs = [];
const whatsappSeenIds = new Set();
const whatsappStatus = () => JSON.parse(JSON.stringify(whatsapp));
const recordWhatsApp = (method, detail = {}) => {
  whatsappCalls.push(method);
  report('qa-whatsapp', { method, ...detail });
};
for (const method of methods) {
  if (method in api) continue;
  if (/^on[A-Z]/.test(method)) api[method] = () => () => {};
  else if (/^off[A-Z]/.test(method)) api[method] = () => {};
  else api[method] = async () => {
    report('blocked-bridge', method);
    return { ok: false, canceled: true, error: 'Disabled in isolated read-only UI smoke test' };
  };
}
Object.assign(api, {
  whatsAppSessionStatus: async () => ({ ...whatsappSession }),
  whatsAppSessionEnable: async input => {
    if (input.enabled && !whatsappSession.consent && !input.acceptedRisk) return { ...whatsappSession, ok: false, error: 'Consent required.' };
    whatsappSession.consent ||= input.acceptedRisk === true;
    whatsappSession.enabled = input.enabled;
    whatsappSession.connection = input.enabled ? 'scan-qr' : 'off';
    return { ...whatsappSession };
  },
  whatsAppSessionConnect: async () => {
    whatsappSession.connection = 'ready';
    whatsappSession.history = [{ id: 'qa-auto-job', status: 'failed', processName: 'Sing Song', details: 'Voice engine timed out.', delivery: 'delivered', at: new Date().toISOString() }];
    return { ...whatsappSession };
  },
  metaStatus: async () => ({ ...metaState }),
  metaSaveKey: async input => { metaState[input.kind === 'local' ? 'hasLocalKey' : 'hasCloudKey'] = true; return { ...metaState }; },
  metaForgetKey: async kind => { metaState[kind === 'local' ? 'hasLocalKey' : 'hasCloudKey'] = false; if (kind === 'cloud') metaState.cloudModels = []; return { ...metaState }; },
  metaCheck: async kind => { if (kind === 'cloud') metaState.cloudModels = ['muse-spark-1.3', 'muse-image-1.0', 'muse-voice-transcribe-1.0']; else return { ok: false, error: 'Local Glimmer server is unavailable at 127.0.0.1:8080. No model was downloaded or started.' }; return { ...metaState }; },
  metaRun: async () => ({ ok: true, text: 'Isolated QA answer. No request reached Meta.' }),
  metaCancel: async () => ({ ok: true }),
  getMobileLink: async () => ({ wifiUrl: 'http://127.0.0.1:8433', mobileUrl: '', status: 'smoke-test' }),
  getWhatsAppAutoSend: async () => { recordWhatsApp('getWhatsAppAutoSend'); return whatsappStatus(); },
  setWhatsAppAutoSend: async enabled => {
    recordWhatsApp('setWhatsAppAutoSend', { enabled: enabled === true });
    if (typeof enabled !== 'boolean' || whatsapp.mode !== 'drafts') {
      return { ...whatsappStatus(), ok: false, error: 'Reopen the desktop app to load local drafts.' };
    }
    whatsapp.enabled = enabled;
    // Off stops future drafts, but reviewable drafts are not deleted.
    return whatsappStatus();
  },
  reportWhatsAppJob: async job => {
    recordWhatsApp('reportWhatsAppJob', { status: job?.status });
    whatsappJobs.push({ status: job?.status, enabled: whatsapp.enabled });
    if (!job?.id || !['completed', 'failed'].includes(job.status)) return { ok: false, error: 'Invalid job fixture.' };
    if (whatsappSeenIds.has(job.id)) return { ok: true, skipped: 'duplicate' };
    whatsappSeenIds.add(job.id);
    if (!whatsapp.enabled) return { ok: true, skipped: 'disabled' };
    const draft = { id: String(job.id), status: job.status, processName: String(job.processName || 'QA process'),
      details: String(job.details || 'Completed in the isolated QA fixture.'), at: new Date().toISOString() };
    whatsapp.drafts.push(draft);
    whatsapp.pending = whatsapp.drafts.length;
    whatsapp.lastAttempt = { status: 'draft_ready', processName: draft.processName, at: draft.at };
    return { ok: true, drafted: true, id: draft.id };
  },
  openWhatsAppDraft: async input => {
    recordWhatsApp('openWhatsAppDraft', { target: input?.target, id: input?.id });
    if (api.isMobileRemote) return { ...whatsappStatus(), ok: false, error: 'Open this draft from the desktop app.' };
    const draft = whatsapp.drafts.find(item => item.id === input?.id);
    if (!draft || !['app', 'web'].includes(input?.target)) return { ...whatsappStatus(), ok: false, error: 'Choose a reviewable draft and opening target.' };
    if (failNextOpen) {
      failNextOpen = false;
      whatsapp.lastAttempt = { status: 'open_failed', processName: draft.processName, at: new Date().toISOString() };
      return { ...whatsappStatus(), ok: false, error: 'Mock WhatsApp app could not open. Try WhatsApp Web.' };
    }
    draft.openedAt = new Date().toISOString();
    whatsapp.lastAttempt = { status: 'opened', processName: draft.processName, at: draft.openedAt, target: input.target };
    // A recorded mock call is all that happens: no shell, URL or browser open.
    return { ...whatsappStatus(), opened: true, sent: false, message: 'Draft opened for review. Press Send yourself in WhatsApp.' };
  },
  dismissWhatsAppDraft: async input => {
    const id = typeof input === 'string' ? input : input?.id;
    recordWhatsApp('dismissWhatsAppDraft', { id });
    whatsapp.drafts = whatsapp.drafts.filter(item => item.id !== id);
    whatsapp.pending = whatsapp.drafts.length;
    return whatsappStatus();
  },
  getSystemInfo: async () => ({ platform: 'win32', cpus: 4, memory: 16, totalMemoryGB: 16 }),
  getAppRoot: async () => '',
  getServerHealth: async () => health,
  getGroqApiKey: () => '',
  getPathForFile: () => '',
  showSaveDialog: async () => ({ canceled: true }),
  getRhymeResumeJob: async () => ({ ok: false }),
  checkRhymeModule: async () => ({ ok: false, checks: [] }),
});
contextBridge.exposeInMainWorld('electronAPI', api);
contextBridge.exposeInMainWorld('__qaWhatsApp', {
  failNextOpen: () => { failNextOpen = true; },
  snapshot: () => ({ ...whatsappStatus(), calls: [...whatsappCalls], jobs: [...whatsappJobs] }),
});
window.addEventListener('error', event => {
  if (event.error || event.message) report('uncaught', { message: event.message, stack: String(event.error?.stack || ''), filename: event.filename, line: event.lineno });
});
window.addEventListener('unhandledrejection', event => report('unhandled-rejection', { message: String(event.reason?.message || event.reason), stack: String(event.reason?.stack || '') }));
