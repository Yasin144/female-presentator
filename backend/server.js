// backend/server.js
// Official WhatsApp Business Platform Cloud API Relay Server for After-OUT Daily Statements
// Security & Privacy Architecture:
// - Keeps WA_ACCESS_TOKEN exclusively server-side (never in the Android APK).
// - Authenticates native Android bridge requests via timing-safe Bearer token.
// - Locks destination strictly to fixed recipient 917386726193 (+91 7386726193).
// - Persists idempotency keys across server restarts without storing salary message bodies.
// - Verifies Meta status webhooks (X-Hub-Signature-256) before marking 'delivered' or 'read'.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const FIXED_RECIPIENT = '917386726193';
export const DEFAULT_TEMPLATE_NAME = 'daily_ot_statement';

function timingSafeCompare(a, b) {
  const strA = String(a || '');
  const strB = String(b || '');
  if (!strA || !strB) return false;
  const bufA = Buffer.from(strA, 'utf8');
  const bufB = Buffer.from(strB, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function loadPersistentStore(storeFilePath) {
  try {
    if (fs.existsSync(storeFilePath)) {
      const parsed = JSON.parse(fs.readFileSync(storeFilePath, 'utf8'));
      return {
        byKey: parsed?.byKey && typeof parsed.byKey === 'object' ? parsed.byKey : {},
        byMessageId: parsed?.byMessageId && typeof parsed.byMessageId === 'object' ? parsed.byMessageId : {},
      };
    }
  } catch (_) {}
  return { byKey: {}, byMessageId: {} };
}

function savePersistentStore(storeFilePath, store) {
  try {
    const dir = path.dirname(storeFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${storeFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmpPath, storeFilePath);
  } catch (_) {}
}

/**
 * Validates incoming statement payload and ensures no forbidden expense/notification/bank fields are present.
 */
export function validateStatementRequest(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid JSON request body' };
  }

  // Reject any payload that includes expense transactions, raw notification text, or secrets
  const forbiddenTopKeys = ['expenses', 'transactions', 'rawText', 'rawNotification', 'otp', 'bankAccount', 'waAccessToken'];
  for (const key of forbiddenTopKeys) {
    if (body[key] !== undefined || (body.statement && body.statement[key] !== undefined)) {
      return { ok: false, error: `Forbidden field "${key}" is not permitted in daily OT statement` };
    }
  }

  const recipient = String(body.recipient || FIXED_RECIPIENT).replace(/[^0-9]/g, '');
  if (recipient !== FIXED_RECIPIENT) {
    return { ok: false, error: `Destination is locked to fixed recipient ${FIXED_RECIPIENT}` };
  }

  const idempotencyKey = String(body.idempotencyKey || '').trim();
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 160) {
    return { ok: false, error: 'Missing or invalid idempotencyKey' };
  }

  const st = body.statement;
  if (!st || typeof st !== 'object') {
    return { ok: false, error: 'Missing statement object' };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(st.date || ''))) {
    return { ok: false, error: 'Invalid statement date (expected YYYY-MM-DD)' };
  }

  if (!/^\d{1,2}:\d{2}$/.test(String(st.inTime || '')) || !/^\d{1,2}:\d{2}$/.test(String(st.outTime || ''))) {
    return { ok: false, error: 'Invalid IN or OUT time' };
  }

  const workedMins = Number(st.workedMins);
  const dailyTotal = Number(st.dailyTotal);
  if (!Number.isFinite(workedMins) || workedMins <= 0 || !Number.isFinite(dailyTotal) || dailyTotal < 0) {
    return { ok: false, error: 'Invalid workedMins or dailyTotal' };
  }

  return {
    ok: true,
    idempotencyKey,
    forceResend: Boolean(body.forceResend),
    templateName: String(body.templateName || DEFAULT_TEMPLATE_NAME).trim(),
    statement: st,
  };
}

/**
 * Builds the official WhatsApp Business Platform Cloud API utility template payload.
 * Uses only existing calculator outputs and omits unavailable fields rather than inventing them.
 */
export function buildCloudApiTemplatePayload(statement, templateName = DEFAULT_TEMPLATE_NAME, langCode = 'en') {
  const parameters = [
    { type: 'text', text: String(statement.date) },
    { type: 'text', text: String(statement.inTimeFormatted || statement.inTime) },
    { type: 'text', text: String(statement.outTimeFormatted || statement.outTime) },
    { type: 'text', text: String(statement.workedDurationFormatted || `${statement.workedMins}m`) },
    { type: 'text', text: String(statement.standardShiftFormatted || 'N/A') },
    { type: 'text', text: String(statement.otDurationFormatted || '0h 00m') },
    { type: 'text', text: String(statement.basePayFormatted || `₹${statement.basePay}`) },
    { type: 'text', text: String(statement.otRateFormatted || 'N/A') },
    { type: 'text', text: String(statement.otPayFormatted || `₹${statement.otPay || 0}`) },
    { type: 'text', text: String(statement.allowanceFormatted || `₹${statement.allowance || 0}`) },
    { type: 'text', text: String(statement.dailyTotalFormatted || `₹${statement.dailyTotal}`) },
  ];

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: FIXED_RECIPIENT,
    type: 'template',
    template: {
      name: templateName,
      language: { code: langCode },
      components: [
        {
          type: 'body',
          parameters,
        },
      ],
    },
  };
}

export function createWhatsAppRelayServer(customConfig = {}) {
  const config = {
    relayDeviceToken: customConfig.relayDeviceToken ?? process.env.RELAY_DEVICE_TOKEN ?? '',
    waPhoneNumberId: customConfig.waPhoneNumberId ?? process.env.WA_PHONE_NUMBER_ID ?? '',
    waAccessToken: customConfig.waAccessToken ?? process.env.WA_ACCESS_TOKEN ?? '',
    waApiVersion: customConfig.waApiVersion ?? process.env.WA_API_VERSION ?? 'v21.0',
    waTemplateName: customConfig.waTemplateName ?? process.env.WA_TEMPLATE_NAME ?? DEFAULT_TEMPLATE_NAME,
    waTemplateLang: customConfig.waTemplateLang ?? process.env.WA_TEMPLATE_LANG ?? 'en',
    waWebhookVerifyToken: customConfig.waWebhookVerifyToken ?? process.env.WA_WEBHOOK_VERIFY_TOKEN ?? '',
    waAppSecret: customConfig.waAppSecret ?? process.env.WA_APP_SECRET ?? '',
    storeFilePath:
      customConfig.storeFilePath ??
      path.join(__dirname, 'data', 'wa-statement-idempotency-store.json'),
    fetchImpl: customConfig.fetchImpl ?? globalThis.fetch,
    rateLimitPerMinute: Number(customConfig.rateLimitPerMinute || 20),
  };

  const store = loadPersistentStore(config.storeFilePath);
  const rateBuckets = new Map();

  function checkRateLimit(clientKey) {
    const now = Date.now();
    const bucket = rateBuckets.get(clientKey) || { count: 0, resetAt: now + 60000 };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + 60000;
    }
    bucket.count += 1;
    rateBuckets.set(clientKey, bucket);
    return bucket.count <= config.rateLimitPerMinute;
  }

  function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  function readRawBody(req, maxBytes = 32768) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      req.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          reject(new Error('Payload too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const pathname = urlObj.pathname;
    const clientIp = req.socket?.remoteAddress || 'local';

    if (!checkRateLimit(clientIp)) {
      return sendJson(res, 429, { ok: false, code: 'RATE_LIMITED', error: 'Too many requests' });
    }

    // 1. Health & Configuration Readiness Check
    if (req.method === 'GET' && pathname === '/api/whatsapp/health') {
      const configured = Boolean(
        config.waPhoneNumberId &&
          config.waAccessToken &&
          !config.waPhoneNumberId.startsWith('replace_') &&
          !config.waAccessToken.startsWith('replace_')
      );
      return sendJson(res, 200, {
        ok: true,
        configured,
        recipient: FIXED_RECIPIENT,
        templateName: config.waTemplateName,
      });
    }

    // 2. Meta Webhook Challenge Verification (GET /api/whatsapp/webhook)
    if (req.method === 'GET' && pathname === '/api/whatsapp/webhook') {
      const mode = urlObj.searchParams.get('hub.mode');
      const token = urlObj.searchParams.get('hub.verify_token');
      const challenge = urlObj.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && config.waWebhookVerifyToken && timingSafeCompare(token, config.waWebhookVerifyToken)) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(String(challenge || ''));
        return;
      }
      return sendJson(res, 403, { ok: false, error: 'Webhook verification failed' });
    }

    // 3. Meta Delivery / Read Status Webhook (POST /api/whatsapp/webhook)
    if (req.method === 'POST' && pathname === '/api/whatsapp/webhook') {
      let rawBody = '';
      try {
        rawBody = await readRawBody(req);
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Invalid webhook body' });
      }

      if (!config.waAppSecret) {
        return sendJson(res, 503, { ok: false, error: 'Webhook app secret not configured' });
      }
      const sigHeader = String(req.headers['x-hub-signature-256'] || '');
      const expectedSig =
        'sha256=' + crypto.createHmac('sha256', config.waAppSecret).update(rawBody, 'utf8').digest('hex');
      if (!timingSafeCompare(sigHeader, expectedSig)) {
        return sendJson(res, 401, { ok: false, error: 'Invalid X-Hub-Signature-256' });
      }

      try {
        const payload = JSON.parse(rawBody);
        const entries = Array.isArray(payload?.entry) ? payload.entry : [];
        for (const entry of entries) {
          const changes = Array.isArray(entry?.changes) ? entry.changes : [];
          for (const change of changes) {
            const statuses = Array.isArray(change?.value?.statuses) ? change.value.statuses : [];
            for (const st of statuses) {
              const msgId = String(st?.id || '');
              const rawStatus = String(st?.status || '').toLowerCase();
              const key = store.byMessageId[msgId];
              if (key && store.byKey[key]) {
                if (['delivered', 'read', 'failed'].includes(rawStatus)) {
                  store.byKey[key].status = rawStatus;
                  store.byKey[key].webhookVerified = true;
                  store.byKey[key].updatedAt = new Date().toISOString();
                }
              }
            }
          }
        }
        savePersistentStore(config.storeFilePath, store);
        return sendJson(res, 200, { ok: true });
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Malformed webhook JSON' });
      }
    }

    // Authenticate Device Relay Token for statement endpoints
    const authHeader = String(req.headers.authorization || '');
    const tokenMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
    const providedToken = tokenMatch ? tokenMatch[1].trim() : '';
    if (!config.relayDeviceToken || !timingSafeCompare(providedToken, config.relayDeviceToken)) {
      return sendJson(res, 401, { ok: false, code: 'UNAUTHORIZED', error: 'Unauthorized device relay credential' });
    }

    // 4. Check Statement Delivery Status by Idempotency Key
    if (req.method === 'GET' && pathname === '/api/whatsapp/ot-statement/status') {
      const key = String(urlObj.searchParams.get('key') || '').trim();
      const record = store.byKey[key];
      if (!record) {
        return sendJson(res, 404, { ok: false, code: 'NOT_FOUND', error: 'Statement key not found' });
      }
      return sendJson(res, 200, {
        ok: true,
        idempotencyKey: record.idempotencyKey,
        date: record.date,
        status: record.status,
        messageId: record.messageId,
        webhookVerified: Boolean(record.webhookVerified),
        updatedAt: record.updatedAt,
      });
    }

    // 5. Submit Daily OT Statement after OUT (POST /api/whatsapp/ot-statement)
    if (req.method === 'POST' && pathname === '/api/whatsapp/ot-statement') {
      let body = null;
      try {
        const raw = await readRawBody(req);
        body = JSON.parse(raw);
      } catch {
        return sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', error: 'Invalid JSON body' });
      }

      const validation = validateStatementRequest(body);
      if (!validation.ok) {
        return sendJson(res, 400, { ok: false, code: 'VALIDATION_ERROR', error: validation.error });
      }

      const { idempotencyKey, forceResend, templateName, statement } = validation;

      // Check server-side prerequisites
      const isCloudConfigured = Boolean(
        config.waPhoneNumberId &&
          config.waAccessToken &&
          !config.waPhoneNumberId.startsWith('replace_') &&
          !config.waAccessToken.startsWith('replace_')
      );
      if (!isCloudConfigured) {
        return sendJson(res, 503, {
          ok: false,
          code: 'NOT_CONFIGURED',
          status: 'not_configured',
          error: 'Automatic send is not configured',
        });
      }

      // Check persistent idempotency store across retries & restarts
      const existing = store.byKey[idempotencyKey];
      if (existing && !forceResend && ['accepted', 'delivered', 'read', 'pending'].includes(existing.status)) {
        return sendJson(res, 200, {
          ok: true,
          deduplicated: true,
          idempotencyKey,
          status: existing.status,
          messageId: existing.messageId || null,
          webhookVerified: Boolean(existing.webhookVerified),
        });
      }

      // Record pending state before calling Meta Cloud API (never store message body!)
      const nowIso = new Date().toISOString();
      store.byKey[idempotencyKey] = {
        idempotencyKey,
        date: statement.date,
        status: 'pending',
        messageId: null,
        webhookVerified: false,
        createdAt: existing?.createdAt || nowIso,
        updatedAt: nowIso,
      };
      savePersistentStore(config.storeFilePath, store);

      const metaPayload = buildCloudApiTemplatePayload(
        statement,
        templateName || config.waTemplateName,
        config.waTemplateLang
      );
      const graphUrl = `https://graph.facebook.com/${config.waApiVersion}/${config.waPhoneNumberId}/messages`;

      try {
        const metaRes = await config.fetchImpl(graphUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.waAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(metaPayload),
        });

        const metaJson = await metaRes.json().catch(() => ({}));
        const messageId = metaJson?.messages?.[0]?.id || null;

        if (!metaRes.ok || !messageId) {
          store.byKey[idempotencyKey].status = 'failed';
          store.byKey[idempotencyKey].updatedAt = new Date().toISOString();
          savePersistentStore(config.storeFilePath, store);
          return sendJson(res, 502, {
            ok: false,
            code: 'CLOUD_API_ERROR',
            status: 'failed',
            error: 'Not sent — retry available',
          });
        }

        // Accepted by Meta Cloud API (not marked delivered until verified webhook arrives)
        store.byKey[idempotencyKey].status = 'accepted';
        store.byKey[idempotencyKey].messageId = messageId;
        store.byKey[idempotencyKey].updatedAt = new Date().toISOString();
        store.byMessageId[messageId] = idempotencyKey;
        savePersistentStore(config.storeFilePath, store);

        return sendJson(res, 200, {
          ok: true,
          idempotencyKey,
          status: 'accepted',
          statusLabel: 'Accepted by WhatsApp',
          messageId,
          webhookVerified: false,
        });
      } catch (err) {
        const isTimeout = /timeout|timed out|abort/i.test(String(err?.message || ''));
        store.byKey[idempotencyKey].status = isTimeout ? 'unknown_timeout' : 'failed';
        store.byKey[idempotencyKey].updatedAt = new Date().toISOString();
        savePersistentStore(config.storeFilePath, store);
        return sendJson(res, isTimeout ? 504 : 502, {
          ok: false,
          code: isTimeout ? 'TIMEOUT_UNCERTAIN' : 'NETWORK_ERROR',
          status: isTimeout ? 'unknown_timeout' : 'failed',
          error: isTimeout
            ? 'Send status unknown — check status before retrying'
            : 'Not sent — retry available',
        });
      }
    }

    return sendJson(res, 404, { ok: false, error: 'Not found' });
  });

  return { server, store, config };
}

// Start server if invoked directly via `node backend/server.js`
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const port = Number(process.env.PORT || 8787);
  const { server } = createWhatsAppRelayServer();
  server.listen(port, () => {
    console.log(`[WhatsApp-Cloud-Relay] Listening on port ${port} for fixed recipient +91 7386726193`);
  });
}
