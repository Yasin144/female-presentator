// frontend/ot-whatsapp-after-out.js
// After-OUT Automatic WhatsApp Daily Statement Controller
// Fixed Recipient: +91 7386726193 (917386726193)
// Uses Official WhatsApp Business Platform Cloud API via PattanSecureWhatsApp Native Bridge & HTTPS Backend Relay.
// Strictly NO wa.me links, NO prefilled drafts, NO accessibility/UI tapping, NO embedded WA_ACCESS_TOKEN in APK.

export const FIXED_WHATSAPP_RECIPIENT_E164 = '917386726193';
export const FIXED_WHATSAPP_RECIPIENT_DISPLAY = '+91 7386726193';
export const WHATSAPP_FIXED_RECIPIENT_E164 = FIXED_WHATSAPP_RECIPIENT_E164;
export const WHATSAPP_FIXED_RECIPIENT_DISPLAY = FIXED_WHATSAPP_RECIPIENT_DISPLAY;
export const DEFAULT_WA_TEMPLATE_NAME = 'daily_ot_statement';
export const WA_STATEMENT_STORAGE_KEY = 'pattan.ot.whatsappStatementState.v1';

const STATUS_LABELS = Object.freeze({
  disabled: 'Automatic send is OFF',
  not_configured: 'Automatic send is not configured',
  pending: 'Submitting daily statement…',
  accepted: 'Accepted by WhatsApp',
  delivered: 'Delivered to +91 7386726193',
  read: 'Read by +91 7386726193',
  unknown_timeout: 'Send status unknown — check status before retrying',
  failed: 'Not sent — retry available',
});

export function getWhatsAppStatusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.not_configured;
}

function formatMinsCompact(mins) {
  const mTotal = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(mTotal / 60);
  const m = mTotal % 60;
  if (h === 0 && m === 0) return '0h 00m';
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function formatTime12h(timeStr) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || '').trim());
  if (!m) return String(timeStr || '--:--');
  const hh24 = Math.max(0, Math.min(23, Number(m[1]) || 0));
  const mm = Math.max(0, Math.min(59, Number(m[2]) || 0));
  const period = hh24 >= 12 ? 'PM' : 'AM';
  const hh12 = hh24 % 12 === 0 ? 12 : hh24 % 12;
  return `${String(hh12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${period}`;
}

function formatINR(num) {
  const n = Number(num);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getStorage() {
  if (typeof globalThis !== 'undefined' && globalThis.window && globalThis.window.localStorage) {
    return globalThis.window.localStorage;
  }
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }
  return null;
}

function enrichStatementState(rawState) {
  const recordsByDate =
    rawState?.recordsByDate && typeof rawState.recordsByDate === 'object' ? rawState.recordsByDate : {};
  const sentKeys = rawState?.sentKeys && typeof rawState.sentKeys === 'object' ? rawState.sentKeys : {};
  const enabled = Boolean(rawState?.enabled && (rawState?.consentGiven || rawState?.consentAccepted));
  const consentGiven = Boolean(rawState?.consentGiven || rawState?.consentAccepted);

  const entries = Object.values(recordsByDate).sort((a, b) =>
    String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || ''))
  );
  const latest = entries[0] || null;
  const pendingQueueCount = entries.filter(
    (e) => e && (e.status === 'failed' || e.status === 'pending' || e.status === 'not_configured')
  ).length;

  let relayEndpointUrl = String(rawState?.relayEndpointUrl || '');
  try {
    if (
      typeof globalThis !== 'undefined' &&
      globalThis.window?.PattanSecureWhatsApp &&
      typeof globalThis.window.PattanSecureWhatsApp.getConfig === 'function'
    ) {
      const cfgRaw = globalThis.window.PattanSecureWhatsApp.getConfig();
      const cfg = typeof cfgRaw === 'string' ? JSON.parse(cfgRaw) : cfgRaw;
      if (cfg && cfg.endpointUrl) relayEndpointUrl = String(cfg.endpointUrl);
    }
  } catch (_) {}

  const lastStatus = latest?.status || 'idle';
  const lastStatusLabel = latest
    ? latest.statusLabel || getWhatsAppStatusLabel(latest.status)
    : enabled
      ? 'Ready (Auto-Send after OUT)'
      : STATUS_LABELS.disabled;

  return {
    enabled,
    consentGiven,
    consentAccepted: consentGiven,
    consentedAt: rawState?.consentedAt || null,
    recipient: FIXED_WHATSAPP_RECIPIENT_E164,
    recipientDisplay: FIXED_WHATSAPP_RECIPIENT_DISPLAY,
    templateName: rawState?.templateName || DEFAULT_WA_TEMPLATE_NAME,
    relayEndpointUrl,
    lastStatus,
    lastStatusLabel,
    lastDateSent: latest?.date || null,
    lastMessageId: latest?.messageId || null,
    lastError: latest?.error || '',
    pendingQueueCount,
    recordsByDate,
    sentKeys,
    updatedAt: rawState?.updatedAt || null,
  };
}

export function loadWhatsAppStatementState() {
  try {
    const storage = getStorage();
    if (!storage) {
      return enrichStatementState({});
    }
    const raw = storage.getItem(WA_STATEMENT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return enrichStatementState(parsed);
    }
  } catch (_) {}
  return enrichStatementState({});
}

export const loadWhatsAppAutoSendState = loadWhatsAppStatementState;

export function saveWhatsAppStatementState(nextState) {
  const enriched = enrichStatementState({
    ...nextState,
    updatedAt: new Date().toISOString(),
  });
  try {
    const storage = getStorage();
    if (storage) {
      storage.setItem(WA_STATEMENT_STORAGE_KEY, JSON.stringify(enriched));
    }
  } catch (_) {}
  try {
    if (typeof globalThis !== 'undefined' && globalThis.window && typeof globalThis.window.dispatchEvent === 'function') {
      globalThis.window.dispatchEvent(new CustomEvent('pattan:wa-statement-state-updated', { detail: enriched }));
      globalThis.window.dispatchEvent(new CustomEvent('pattan:ot-whatsapp-status-changed', { detail: enriched }));
    }
  } catch (_) {}
  return enriched;
}

/**
 * Queries native PattanSecureWhatsApp bridge (if available) + local consent state.
 */
export function getSecureWhatsAppBridgeConfig() {
  const local = loadWhatsAppStatementState();
  let nativeConfig = null;
  let hasSendMethod = false;
  try {
    if (typeof globalThis !== 'undefined' && globalThis.window?.PattanSecureWhatsApp) {
      hasSendMethod =
        typeof globalThis.window.PattanSecureWhatsApp.sendStatement === 'function' ||
        typeof globalThis.window.PattanSecureWhatsApp.sendStatementJson === 'function';
      if (typeof globalThis.window.PattanSecureWhatsApp.getConfig === 'function') {
        const res = globalThis.window.PattanSecureWhatsApp.getConfig();
        nativeConfig = typeof res === 'string' ? JSON.parse(res) : res;
      }
    }
  } catch (_) {}

  const configured = Boolean(
    nativeConfig
      ? nativeConfig.configured || nativeConfig.endpointUrl
      : hasSendMethod || local.relayEndpointUrl
  );
  const enabled = Boolean(local.enabled && local.consentGiven && (nativeConfig ? nativeConfig.enabled !== false : true));

  return {
    enabled,
    configured,
    consentGiven: local.consentGiven,
    consentedAt: local.consentedAt,
    recipient: FIXED_WHATSAPP_RECIPIENT_E164,
    recipientDisplay: FIXED_WHATSAPP_RECIPIENT_DISPLAY,
    templateName: (nativeConfig && nativeConfig.templateName) || local.templateName || DEFAULT_WA_TEMPLATE_NAME,
    relayUrl: (nativeConfig && (nativeConfig.relayUrl || nativeConfig.endpointUrl)) || local.relayEndpointUrl || '',
  };
}

/**
 * Updates the "Automatically send WhatsApp statement after OUT" switch.
 * Enabling requires explicit user consent acknowledging transmission to +91 7386726193.
 */
export function setWhatsAppAutoSendEnabled(enable, explicitConsentConfirmed = false) {
  const current = loadWhatsAppStatementState();
  if (enable && !explicitConsentConfirmed && !current.consentGiven) {
    throw new Error(
      'Explicit user consent is required before enabling automatic WhatsApp statements to +91 7386726193.'
    );
  }
  const nowIso = new Date().toISOString();
  const next = saveWhatsAppStatementState({
    ...current,
    enabled: Boolean(enable),
    consentGiven: enable ? true : Boolean(explicitConsentConfirmed),
    consentedAt: enable ? (current.consentedAt || nowIso) : current.consentedAt,
  });

  try {
    if (
      typeof globalThis !== 'undefined' &&
      globalThis.window?.PattanSecureWhatsApp &&
      typeof globalThis.window.PattanSecureWhatsApp.setEnabled === 'function'
    ) {
      globalThis.window.PattanSecureWhatsApp.setEnabled(Boolean(enable), Boolean(next.consentGiven));
    }
  } catch (_) {}

  return next;
}

/**
 * Configures the HTTPS relay endpoint and per-device relay credential inside the native Android Keystore bridge.
 * The credential is passed directly to the native bridge and never stored in localStorage.
 */
export function configureNativeWhatsAppRelay({
  endpointUrl,
  relayUrl,
  clientToken,
  deviceRelayToken,
  templateName = DEFAULT_WA_TEMPLATE_NAME,
} = {}) {
  const cleanUrl = String(endpointUrl || relayUrl || '').trim();
  const cleanToken = String(clientToken || deviceRelayToken || '').trim();
  const current = loadWhatsAppStatementState();
  try {
    if (
      typeof globalThis !== 'undefined' &&
      globalThis.window?.PattanSecureWhatsApp &&
      typeof globalThis.window.PattanSecureWhatsApp.configureRelay === 'function'
    ) {
      globalThis.window.PattanSecureWhatsApp.configureRelay(cleanUrl, cleanToken);
    }
  } catch (_) {}
  return saveWhatsAppStatementState({
    ...current,
    relayEndpointUrl: cleanUrl || current.relayEndpointUrl,
    templateName: templateName || DEFAULT_WA_TEMPLATE_NAME,
  });
}

/**
 * Validates that a punch-out event detail represents a complete, valid saved OUT record
 * and builds the sanitized statement payload using ONLY existing calculator outputs.
 * Never includes expense records, raw notification text, bank account numbers, OTPs, or secrets.
 */
export function buildSanitizedDailyOutStatement(detail) {
  if (!detail || typeof detail !== 'object') {
    return { valid: false, error: 'Missing punch-out event detail' };
  }
  const { date, record, settings, rates, calculation } = detail;
  const isoDate = String(date || record?.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return { valid: false, error: 'Invalid or missing punch date' };
  }
  if (!record || typeof record !== 'object') {
    return { valid: false, error: 'Missing saved day record' };
  }
  if (record.status === 'leave') {
    return { valid: false, error: 'Leave record does not have an OUT punch statement' };
  }

  const inTime = String(record.inTime || '').trim();
  const outTime = String(record.outTime || '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(inTime) || !/^\d{1,2}:\d{2}$/.test(outTime)) {
    return { valid: false, error: 'Incomplete IN/OUT time in punch record' };
  }

  if (!calculation || typeof calculation !== 'object') {
    return { valid: false, error: 'Missing existing salary calculator output' };
  }

  const workedMins = Number(calculation.workedMins ?? record.workedMins);
  if (!Number.isFinite(workedMins) || workedMins <= 0) {
    return { valid: false, error: 'Worked duration must be greater than 0 minutes' };
  }

  const basePay = Number(calculation.basePay);
  const otPay = Number(calculation.otPay ?? 0);
  const totalPay = Number(calculation.totalPay);
  if (!Number.isFinite(basePay) || !Number.isFinite(totalPay) || totalPay < 0) {
    return { valid: false, error: 'Invalid calculator pay totals' };
  }

  const standardShiftMins = Number.isFinite(Number(calculation.standardShiftMins))
    ? Number(calculation.standardShiftMins)
    : Number.isFinite(Number(rates?.shiftMins))
      ? Number(rates.shiftMins)
      : null;

  const otMins = Number.isFinite(Number(calculation.otMins))
    ? Math.max(0, Math.round(Number(calculation.otMins)))
    : Math.max(0, Math.round((Number(calculation.otHours) || 0) * 60));

  const otHours = Number.isFinite(Number(calculation.otHours))
    ? Number(Number(calculation.otHours).toFixed(4))
    : Number((otMins / 60).toFixed(4));

  const otHourlyRate = Number.isFinite(Number(rates?.otHourlyRate))
    ? Number(Number(rates.otHourlyRate).toFixed(2))
    : null;

  const extraAllowance = Number.isFinite(Number(calculation.extraAllowance ?? record.extraAllowance))
    ? Number(Number(calculation.extraAllowance ?? record.extraAllowance).toFixed(2))
    : 0;

  // Deterministic idempotency key derived from the saved OUT record
  const idempotencyKey = [
    'out_stmt',
    isoDate,
    inTime,
    outTime,
    Math.round(workedMins),
    otMins,
    Math.round(totalPay * 100),
  ].join('_');

  const statementFields = {
    date: isoDate,
    status: String(record.status || 'present'),
    inTime,
    inTimeFormatted: formatTime12h(inTime),
    outTime,
    outTimeFormatted: formatTime12h(outTime),
    workedMins: Math.round(workedMins),
    workedDurationFormatted: formatMinsCompact(workedMins),
    ...(standardShiftMins !== null
      ? {
          standardShiftMins: Math.round(standardShiftMins),
          standardShiftFormatted: formatMinsCompact(standardShiftMins),
        }
      : {}),
    otMins,
    otHours,
    otDurationFormatted: formatMinsCompact(otMins),
    basePay: Number(basePay.toFixed(2)),
    basePayFormatted: `₹${formatINR(basePay)}`,
    ...(otHourlyRate !== null
      ? {
          otHourlyRate,
          otRateFormatted: `₹${formatINR(otHourlyRate)}/hr`,
        }
      : {}),
    otPay: Number(otPay.toFixed(2)),
    otPayFormatted: `₹${formatINR(otPay)}`,
    allowance: extraAllowance,
    allowanceFormatted: `₹${formatINR(extraAllowance)}`,
    dailyTotal: Number(totalPay.toFixed(2)),
    dailyTotalFormatted: `₹${formatINR(totalPay)}`,
    employeeName: String(settings?.employeeName || 'Yasin Pattan').slice(0, 60),
  };

  return {
    valid: true,
    idempotencyKey,
    recipient: FIXED_WHATSAPP_RECIPIENT_E164,
    templateName: DEFAULT_WA_TEMPLATE_NAME,
    statement: statementFields,
  };
}

async function invokeNativeBridgeSend(requestPayload) {
  if (typeof window === 'undefined' || !window.PattanSecureWhatsApp) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      status: 'not_configured',
      error: 'Automatic send is not configured',
    };
  }

  try {
    // Support both object-based PattanSecureWhatsApp.sendStatement({ request })
    // and Android @JavascriptInterface string-based sendStatementJson(jsonStr)
    if (typeof window.PattanSecureWhatsApp.sendStatement === 'function') {
      const rawRes = await window.PattanSecureWhatsApp.sendStatement({ request: requestPayload });
      const parsed = typeof rawRes === 'string' ? JSON.parse(rawRes) : rawRes;
      return parsed || { ok: false, status: 'failed', error: 'Empty response from native bridge' };
    }
    if (typeof window.PattanSecureWhatsApp.sendStatementJson === 'function') {
      const rawRes = window.PattanSecureWhatsApp.sendStatementJson(JSON.stringify({ request: requestPayload }));
      const parsed = typeof rawRes === 'string' ? JSON.parse(rawRes) : rawRes;
      return parsed || { ok: false, status: 'failed', error: 'Empty response from native bridge' };
    }
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (/timeout|timed out/i.test(msg)) {
      return {
        ok: false,
        code: 'TIMEOUT_UNCERTAIN',
        status: 'unknown_timeout',
        error: 'Send status unknown — check status before retrying',
      };
    }
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      status: 'failed',
      error: 'Not sent — retry available',
    };
  }

  return {
    ok: false,
    code: 'NOT_CONFIGURED',
    status: 'not_configured',
    error: 'Automatic send is not configured',
  };
}

/**
 * Handles a saved OUT punch event or an explicit retry/resend action.
 */
export async function processSavedOutStatement(detail, options = {}) {
  const { isRetry = false, isGuardedResend = false, userConfirmedResend = false } = options;

  // 1. Validate the OUT punch record first
  const built = buildSanitizedDailyOutStatement(detail);
  if (!built.valid) {
    return {
      ok: false,
      skipped: true,
      reason: 'invalid_record',
      error: built.error,
    };
  }

  const state = loadWhatsAppStatementState();
  const bridgeConfig = getSecureWhatsAppBridgeConfig();
  const isoDate = built.statement.date;
  const baseKey = built.idempotencyKey;

  // 2. Check if automatic-send switch is OFF (and not an explicit retry/resend when enabled)
  if (!state.enabled || !state.consentGiven) {
    return {
      ok: false,
      skipped: true,
      status: 'disabled',
      statusLabel: getWhatsAppStatusLabel('disabled'),
      reason: 'auto_send_disabled',
    };
  }

  // 3. Guarded Resend check
  if (isGuardedResend && !userConfirmedResend) {
    return {
      ok: false,
      skipped: true,
      reason: 'resend_confirmation_required',
      error: 'Deliberate resend requires explicit user confirmation.',
    };
  }

  // 4. Deduplication check: never resend the same saved OUT record unless explicitly confirmed via guarded Resend
  const existingKeyEntry = state.sentKeys[baseKey];
  if (
    existingKeyEntry &&
    !isGuardedResend &&
    ['accepted', 'delivered', 'read', 'pending', 'unknown_timeout'].includes(existingKeyEntry.status)
  ) {
    return {
      ok: existingKeyEntry.status === 'accepted' || existingKeyEntry.status === 'delivered' || existingKeyEntry.status === 'read',
      deduplicated: true,
      status: existingKeyEntry.status,
      statusLabel: getWhatsAppStatusLabel(existingKeyEntry.status),
      idempotencyKey: baseKey,
      messageId: existingKeyEntry.messageId || null,
    };
  }

  // 5. Check if Cloud API / Native Relay is configured
  if (!bridgeConfig.configured) {
    const notConfEntry = {
      date: isoDate,
      idempotencyKey: baseKey,
      status: 'not_configured',
      statusLabel: getWhatsAppStatusLabel('not_configured'),
      updatedAt: new Date().toISOString(),
      detailSnapshot: {
        date: isoDate,
        record: detail.record,
        settings: detail.settings,
        rates: detail.rates,
        calculation: detail.calculation,
      },
      statement: built.statement,
    };
    saveWhatsAppStatementState({
      ...state,
      recordsByDate: { ...state.recordsByDate, [isoDate]: notConfEntry },
      sentKeys: { ...state.sentKeys, [baseKey]: notConfEntry },
    });
    return {
      ok: false,
      status: 'not_configured',
      statusLabel: getWhatsAppStatusLabel('not_configured'),
      error: 'Automatic send is not configured',
      idempotencyKey: baseKey,
    };
  }

  const effectiveIdempotencyKey = isGuardedResend && userConfirmedResend
    ? `${baseKey}_resend_${Date.now()}`
    : baseKey;

  // 6. Mark as pending before network submission
  const pendingEntry = {
    date: isoDate,
    idempotencyKey: effectiveIdempotencyKey,
    baseKey,
    status: 'pending',
    statusLabel: getWhatsAppStatusLabel('pending'),
    updatedAt: new Date().toISOString(),
    detailSnapshot: {
      date: isoDate,
      record: detail.record,
      settings: detail.settings,
      rates: detail.rates,
      calculation: detail.calculation,
    },
    statement: built.statement,
  };
  saveWhatsAppStatementState({
    ...state,
    recordsByDate: { ...state.recordsByDate, [isoDate]: pendingEntry },
    sentKeys: { ...state.sentKeys, [baseKey]: pendingEntry },
  });

  // 7. Send via native PattanSecureWhatsApp bridge
  const requestPayload = {
    idempotencyKey: effectiveIdempotencyKey,
    recipient: FIXED_WHATSAPP_RECIPIENT_E164,
    templateName: bridgeConfig.templateName || DEFAULT_WA_TEMPLATE_NAME,
    forceResend: Boolean(isGuardedResend && userConfirmedResend),
    isRetry: Boolean(isRetry),
    statement: built.statement,
  };

  const bridgeRes = await invokeNativeBridgeSend(requestPayload);

  // 8. Interpret response strictly:
  // - API success means "accepted" by Meta ("Accepted by WhatsApp"), NOT "delivered" unless webhook confirmed.
  // - Timeout after submission means "unknown_timeout" ("Send status unknown — check status before retrying").
  // - Offline / error means "failed" ("Not sent — retry available").
  let finalStatus = 'failed';
  if (bridgeRes.status === 'delivered' && bridgeRes.webhookVerified) {
    finalStatus = 'delivered';
  } else if (bridgeRes.status === 'read' && bridgeRes.webhookVerified) {
    finalStatus = 'read';
  } else if (bridgeRes.ok || bridgeRes.status === 'accepted') {
    finalStatus = 'accepted';
  } else if (bridgeRes.code === 'TIMEOUT_UNCERTAIN' || bridgeRes.status === 'unknown_timeout') {
    finalStatus = 'unknown_timeout';
  } else if (bridgeRes.code === 'NOT_CONFIGURED' || bridgeRes.status === 'not_configured') {
    finalStatus = 'not_configured';
  } else {
    finalStatus = 'failed';
  }

  const finalEntry = {
    ...pendingEntry,
    status: finalStatus,
    statusLabel: getWhatsAppStatusLabel(finalStatus),
    messageId: bridgeRes.messageId || null,
    webhookVerified: Boolean(bridgeRes.webhookVerified),
    error: bridgeRes.error || '',
    updatedAt: new Date().toISOString(),
  };

  const latestState = loadWhatsAppStatementState();
  saveWhatsAppStatementState({
    ...latestState,
    recordsByDate: { ...latestState.recordsByDate, [isoDate]: finalEntry },
    sentKeys: { ...latestState.sentKeys, [baseKey]: finalEntry },
  });

  return {
    ok: finalStatus === 'accepted' || finalStatus === 'delivered' || finalStatus === 'read',
    status: finalStatus,
    statusLabel: finalEntry.statusLabel,
    idempotencyKey: effectiveIdempotencyKey,
    messageId: finalEntry.messageId,
    error: finalEntry.error,
  };
}

/**
 * Retries a failed saved day's statement without altering attendance or pay.
 */
export async function retryFailedDailyStatement(isoDate) {
  const state = loadWhatsAppStatementState();
  const targetDate = isoDate || state.lastDateSent;
  const entry = targetDate ? state.recordsByDate?.[targetDate] : null;
  if (!entry || !entry.detailSnapshot) {
    return {
      ok: false,
      reason: 'EMPTY_QUEUE',
      error: `No saved statement record found${targetDate ? ` for ${targetDate}` : ''}`,
    };
  }
  if (entry.status === 'unknown_timeout') {
    return {
      ok: false,
      status: 'unknown_timeout',
      statusLabel: getWhatsAppStatusLabel('unknown_timeout'),
      error: 'Send status unknown — check status before retrying to avoid duplicate messages.',
    };
  }
  return processSavedOutStatement(entry.detailSnapshot, { isRetry: true });
}

/**
 * Deliberately resends a saved day's statement only when the user explicitly confirms.
 * Supports either (isoDate, userConfirmed) or ({ date, record, settings, rates, calculation, userConfirmed }).
 */
export async function resendDailyStatementWithConfirmation(arg1, arg2 = false) {
  const isObj = arg1 && typeof arg1 === 'object';
  const userConfirmed = isObj ? Boolean(arg1.userConfirmed) : Boolean(arg2);
  if (!userConfirmed) {
    return {
      ok: false,
      reason: 'CONFIRMATION_REQUIRED',
      error: 'Explicit confirmation is required to resend a daily statement.',
    };
  }
  if (isObj && arg1.record && arg1.calculation) {
    return processSavedOutStatement(arg1, {
      isGuardedResend: true,
      userConfirmedResend: true,
    });
  }
  const isoDate = isObj ? arg1.date : arg1;
  const state = loadWhatsAppStatementState();
  const entry = state.recordsByDate?.[isoDate];
  if (!entry || !entry.detailSnapshot) {
    return { ok: false, error: `No saved statement record found for ${isoDate}` };
  }
  return processSavedOutStatement(entry.detailSnapshot, {
    isGuardedResend: true,
    userConfirmedResend: true,
  });
}

/**
 * Applies a verified webhook status update (e.g. 'delivered' or 'read') from the relay server.
 */
export function applyVerifiedWebhookStatusUpdate({
  date,
  idempotencyKey,
  messageId,
  status,
  deliveryStatus,
  webhookVerified = true,
} = {}) {
  const nextStatus = status || deliveryStatus;
  if (!webhookVerified) return loadWhatsAppStatementState();
  if (!['accepted', 'delivered', 'read', 'failed'].includes(nextStatus)) return loadWhatsAppStatementState();
  const state = loadWhatsAppStatementState();
  let targetDate = date;
  if (!targetDate) {
    for (const [d, rec] of Object.entries(state.recordsByDate || {})) {
      if (
        (idempotencyKey && (rec.idempotencyKey === idempotencyKey || rec.baseKey === idempotencyKey)) ||
        (messageId && rec.messageId === messageId)
      ) {
        targetDate = d;
        break;
      }
    }
  }
  if (!targetDate || !state.recordsByDate[targetDate]) return state;
  const existing = state.recordsByDate[targetDate];
  const updated = {
    ...existing,
    status: nextStatus,
    statusLabel: getWhatsAppStatusLabel(nextStatus),
    webhookVerified: true,
    updatedAt: new Date().toISOString(),
  };
  const baseKey = existing.baseKey || existing.idempotencyKey;
  return saveWhatsAppStatementState({
    ...state,
    recordsByDate: { ...state.recordsByDate, [targetDate]: updated },
    sentKeys: baseKey ? { ...state.sentKeys, [baseKey]: updated } : state.sentKeys,
  });
}

let listenerRegistered = false;

/**
 * Registers the global 'pattan:ot-punch-out-saved' listener once per window lifecycle.
 */
export function initAfterOutWhatsAppListener() {
  if (typeof window === 'undefined') return () => {};
  if (listenerRegistered) return () => {};
  listenerRegistered = true;

  const onPunchOutSaved = (event) => {
    const detail = event?.detail;
    void processSavedOutStatement(detail);
  };

  const onWaNativeResult = (event) => {
    const detail = event?.detail;
    if (!detail || !detail.date) return;
    if (detail.webhookVerified && ['delivered', 'read'].includes(detail.status)) {
      applyVerifiedWebhookStatusUpdate(detail);
    }
  };

  window.addEventListener('pattan:ot-punch-out-saved', onPunchOutSaved);
  window.addEventListener('pattan:wa-native-result', onWaNativeResult);

  return () => {
    listenerRegistered = false;
    window.removeEventListener('pattan:ot-punch-out-saved', onPunchOutSaved);
    window.removeEventListener('pattan:wa-native-result', onWaNativeResult);
  };
}
