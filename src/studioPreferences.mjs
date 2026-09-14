// App appearance is independent of lesson, slide and exported-video themes.
export const APP_THEME_KEY = 'pattan-studio-app-theme-v1';

export function loadAppTheme(storage) {
  try {
    const saved = storage.getItem(APP_THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (_) {}
  return 'dark';
}

export function saveAppTheme(storage, theme) {
  try { storage.setItem(APP_THEME_KEY, theme === 'light' ? 'light' : 'dark'); }
  catch (_) { /* The current window can still change theme if storage is blocked. */ }
}

export const WHATSAPP_RECIPIENT = '917386726193';

// Public status is text only. Never retain arbitrary links or credentials.
export function safeWhatsAppText(value, limit = 700) {
  if (typeof value !== 'string') return '';
  return value
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

export function safeWhatsAppError(failure, fallback = 'WhatsApp drafts could not complete that request. Please retry.') {
  return safeWhatsAppText(typeof failure === 'string' ? failure : failure?.message, 500) || fallback;
}

const validDraftId = id => typeof id === 'string' && id.length > 0 && id.length <= 256 && !/[\u0000-\u001f\u007f]/.test(id);
const draftTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value.slice(0, 80) : '';

export function normalizeWhatsAppStatus(result) {
  if (result?.mode !== 'drafts') {
    throw new Error('Restart the app to load WhatsApp drafts. This screen cannot enable an older automatic sender.');
  }
  if (!result.ok || typeof result.enabled !== 'boolean') {
    const failure = new Error(safeWhatsAppError(result.error, 'Could not read the WhatsApp draft setting. Please retry.'));
    if (typeof result.enabled === 'boolean') failure.whatsAppStatus = normalizeWhatsAppStatus({ ...result, ok: true });
    throw failure;
  }
  const seen = new Set();
  const drafts = (Array.isArray(result.drafts) ? result.drafts : []).filter(draft => {
    if (!draft || !validDraftId(draft.id) || !['completed', 'failed'].includes(draft.status) || seen.has(draft.id)) return false;
    seen.add(draft.id);
    return true;
  }).slice(0, 100).map(draft => ({
    id: draft.id,
    status: draft.status,
    processName: safeWhatsAppText(draft.processName, 96) || 'Process',
    details: safeWhatsAppText(draft.details) || (draft.status === 'failed' ? 'The process failed. No reason was reported.' : 'The process completed successfully.'),
    at: draftTime(draft.at),
    openedAt: draftTime(draft.openedAt),
  }));
  const attempt = result.lastAttempt;
  return {
    ok: true, mode: 'drafts', enabled: result.enabled,
    recipient: WHATSAPP_RECIPIENT,
    pending: drafts.length,
    drafts,
    configurationError: result.configurationError ? safeWhatsAppError(result.configurationError) : '',
    lastAttempt: attempt && ['draft_ready', 'opened', 'open_failed'].includes(attempt.status) ? {
      status: attempt.status,
      at: draftTime(attempt.at),
      processName: safeWhatsAppText(attempt.processName, 160),
      error: attempt.error ? safeWhatsAppError(attempt.error) : '',
    } : null,
  };
}

async function callWhatsAppSetting(api, method, ...args) {
  if (typeof api?.[method] !== 'function') throw new Error('Open the updated desktop app to manage WhatsApp drafts.');
  return normalizeWhatsAppStatus(await api[method](...args));
}

export function readWhatsAppStatus(api) {
  return callWhatsAppSetting(api, 'getWhatsAppAutoSend');
}

export async function readWhatsAppPreference(api) {
  return (await readWhatsAppStatus(api)).enabled;
}

export function changeWhatsAppEnabled(api, enabled) {
  if (typeof enabled !== 'boolean') throw new TypeError('Choose On or Off for WhatsApp drafts.');
  return callWhatsAppSetting(api, 'setWhatsAppAutoSend', enabled);
}

export function openWhatsAppDraft(api, id, target) {
  if (!validDraftId(id) || !['app', 'web'].includes(target)) throw new TypeError('Choose a draft and where to open it.');
  if (api?.isMobileRemote) throw new Error('Open this draft from the desktop app.');
  return callWhatsAppSetting(api, 'openWhatsAppDraft', { id, target });
}

export function dismissWhatsAppDraft(api, id) {
  if (!validDraftId(id)) throw new TypeError('Choose a draft to dismiss.');
  return callWhatsAppSetting(api, 'dismissWhatsAppDraft', id);
}

// Matches the backend's message formatter; timestamps and IDs stay out of chat.
export function formatWhatsAppDraft(draft) {
  return `Pattan Workspace\nStatus: ${draft.status === 'completed' ? 'Completed' : 'Failed'}\nProcess: ${draft.processName}\nDetails: ${draft.details}`;
}

export function describeWhatsAppAttempt(attempt) {
  if (!attempt) return 'No draft activity in this session.';
  const labels = {
    draft_ready: 'A draft is ready to review',
    opened: 'WhatsApp opened — review the draft and click Send yourself',
    open_failed: 'Could not open WhatsApp',
  };
  const label = labels[attempt.status] || 'Draft activity unavailable';
  return `${label}${attempt.processName ? ` · ${safeWhatsAppText(attempt.processName, 160)}` : ''}${attempt.error ? ` · ${safeWhatsAppError(attempt.error)}` : ''}`;
}

export function formatWhatsAppDraftTime(value) {
  return draftTime(value) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Time unavailable';
}
