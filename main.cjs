'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, globalShortcut, protocol } = require('electron');

// Register app:// as a privileged scheme BEFORE app.ready (Electron requirement)
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    secure: true,
    standard: true,
    supportFetchAPI: true,
    allowServiceWorkers: true,
    stream: true,
    corsEnabled: true,
  }
}]);
const { spawn, execFile }  = require('child_process');
const path       = require('path');
const fs         = require('fs');
const http       = require('http');
const os         = require('os');
const crypto     = require('crypto');
const dns        = require('dns');
const zlib       = require('zlib');
const { jsonrepair } = require('jsonrepair');
const { Client: MagicHourClient } = require('magic-hour');
const localtunnel = require('localtunnel');
const mobileIpcHandlers = new Map();
const originalIpcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
  mobileIpcHandlers.set(channel, listener);
  return originalIpcHandle(channel, listener);
};

function findFFmpegExecutable() {
  const candidates = [
    path.join(__dirname, 'vendor', 'ffmpeg', 'ffmpeg.exe'),
    'C:\\Users\\patan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe',
  ];
  const bundled = candidates.find(candidate => fs.existsSync(candidate));
  if (bundled) return bundled;
  try {
    return require('child_process')
      .execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8', timeout: 3000 })
      .trim()
      .split(/\r?\n/)[0];
  } catch (_) {
    return 'ffmpeg';
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Memory & GPU flags (set BEFORE app.ready) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// System has 15.3 GB total RAM. Python ML servers (Chatterbox TTS + SC3) use ~4-5 GB.
// Limiting renderer V8 heap to 2 GB prevents OOM crashes during video processing.
app.commandLine.appendSwitch('js-flags',
  '--max-old-space-size=2048 --expose-gc --turbo-fast-api-calls'
);
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const ROOT    = __dirname;
const IS_DEV  = !app.isPackaged && process.env.PRESENTATOR_DEV === '1';

const CAPTION_WORK_ROOT = path.join(ROOT, 'caption-work');
function ensureCaptionWorkDir(...segments) {
  const dir = path.join(CAPTION_WORK_ROOT, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const groqKeyPath = path.join(ROOT, '.groq_api_key');
if (fs.existsSync(groqKeyPath)) {
  try {
    const savedGroqKey = fs.readFileSync(groqKeyPath, 'utf8').trim();
    if (savedGroqKey) process.env.GROQ_API_KEY = savedGroqKey;
  } catch (e) {
    console.error('[PP] Failed to read .groq_api_key file:', e.message);
  }
}

const PRESENTATOR_LOCAL_MODEL = 'qwen3.5:4b';
const PRESENTATOR_FAST_MODEL = 'qwen3.5:0.8b';
const OLLAMA_PORT = 11434;
const activeAgentControllers = new Map();
const activeHermesProcesses = new Map();
const activeOllamaToolProcesses = new Map();
let activeImageGenerationRequests = 0;
const MOBILE_HTTP_PORT = 8433;
const MOBILE_WHATSAPP_NUMBER = '917386726193';
let mobileHttpServer = null;
let mobileTunnelProcess = null;
let mobileTunnelStarting = null;
let lastSentMobileUrl = '';
let mobileRhymeJob = null;
// Prefer the built-in-SSH fallback while Cloudflare quick-tunnel DNS is failing.
// A successful future Cloudflare health path can reset this counter.
let mobileCloudflareFailures = 2;
const mobileAccessToken = crypto.randomBytes(24).toString('hex');

function getMobilePreferences() {
  try {
    const file = path.join(app.getPath('userData'), 'mobile-preferences.json');
    return { whatsappAutoSend: true, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (_) {
    return { whatsappAutoSend: true };
  }
}

function saveMobilePreferences(next) {
  const file = path.join(app.getPath('userData'), 'mobile-preferences.json');
  const preferences = { ...getMobilePreferences(), ...next };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(preferences, null, 2), 'utf8');
  return preferences;
}

function getMobileMethodMap() {
  try {
    const source = fs.readFileSync(path.join(ROOT, 'preload.cjs'), 'utf8');
    const expression = /(\w+)\s*:\s*(?:\([^)]*\)|\w+)\s*=>\s*\r?\n?\s*ipcRenderer\.invoke\(\s*['\"]([^'\"]+)/g;
    const methods = {};
    let match;
    while ((match = expression.exec(source))) methods[match[1]] = match[2];
    return methods;
  } catch (_) { return {}; }
}

function mobileBridgeSource() {
  const methods = JSON.stringify(getMobileMethodMap());
  return `(() => {
    const methods = ${methods};
    const query = new URLSearchParams(location.search);
    const supplied = query.get('mobileToken');
    if (supplied) localStorage.setItem('presentator.mobileToken', supplied);
    const token = supplied || localStorage.getItem('presentator.mobileToken') || '';
    const invoke = async (method, args) => {
      const response = await fetch('/api/mobile-rpc', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Presentator-Mobile-Token': token },
        body: JSON.stringify({ method, args })
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Mobile bridge request failed');
      return payload.result;
    };
    const rhymeProgressHandlers = new Set();
    const api = {
      isMobileRemote: true,
      getPathForFile: file => file?.__mobilePath || file?.path || '',
      uploadMobileFile: async file => {
        if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Select the file again.');
        const response = await fetch('/api/mobile-upload', {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-Presentator-Mobile-Token': token,
            'X-Presentator-File-Name': encodeURIComponent(file.name || 'mobile-upload.bin')
          },
          body: file
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Mobile upload failed');
        Object.defineProperty(file, '__mobilePath', { value: payload.filePath, configurable: true });
        return payload;
      },
      onMobileLinkUpdated: () => () => {}, offMobileLinkUpdated: () => {},
      onPresentatorAgentProgress: () => () => {}, offPresentatorAgentProgress: () => {},
      onRhymeSongProgress: callback => {
        if (typeof callback === 'function') rhymeProgressHandlers.add(callback);
        return () => rhymeProgressHandlers.delete(callback);
      },
      onMyExporterProgress: () => () => {}, offMyExporterProgress: () => {},
      onServerStatus: () => () => {},
    };
    for (const [method, channel] of Object.entries(methods)) api[method] = (...args) => invoke(channel, args);
    api.generateRhymeSong = async payload => {
      const started = await fetch('/api/mobile-rhyme-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Presentator-Mobile-Token': token },
        body: JSON.stringify({ payload })
      }).then(async response => {
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error || 'Could not start mobile rhyme generation');
        return body;
      });
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const response = await fetch('/api/mobile-rhyme-status?id=' + encodeURIComponent(started.jobId), {
          headers: { 'X-Presentator-Mobile-Token': token },
          cache: 'no-store'
        });
        const job = await response.json();
        if (!response.ok || !job.ok) throw new Error(job.error || 'Could not read rhyme progress');
        if (job.progress) for (const callback of rhymeProgressHandlers) {
          try { callback(job.progress); } catch (_) {}
        }
        if (job.status === 'completed') return job.result;
        if (job.status === 'failed') throw new Error(job.error || 'Rhyme generation failed');
      }
    };
    window.electronAPI = api;
  })();`;
}

function getMobileWifiIp() {
  for (const records of Object.values(os.networkInterfaces())) {
    for (const record of records || []) {
      if (record.family === 'IPv4' && !record.internal && !record.address.startsWith('169.254.')) return record.address;
    }
  }
  return '127.0.0.1';
}

function saveMobileLinkState(mobileUrl = '', extra = {}) {
  const data = {
    wifiUrl: `http://${getMobileWifiIp()}:${MOBILE_HTTP_PORT}`,
    mobileUrl,
    active: Boolean(mobileUrl),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  for (const file of [path.join(ROOT, 'temp', 'active-mobile-link.json'), path.join(ROOT, 'public', 'mobile-link.json')]) {
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); } catch (_) {}
  }
  for (const window of BrowserWindow.getAllWindows()) {
    try { window.webContents.send('mobile-link-updated', data); } catch (_) {}
  }
  return data;
}

function startMobileHttpServer() {
  if (mobileHttpServer?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const rendererRoot = path.join(ROOT, 'renderer-dist');
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.woff2': 'font/woff2' };
    mobileHttpServer = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${MOBILE_HTTP_PORT}`);
        if (requestUrl.pathname === '/mobile-bridge.js') {
          res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
          res.end(mobileBridgeSource());
          return;
        }
        if (requestUrl.pathname === '/api/mobile-upload' && req.method === 'POST') {
          const suppliedToken = String(req.headers['x-presentator-mobile-token'] || '');
          if (suppliedToken !== mobileAccessToken) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid mobile access token.' }));
            return;
          }
          let originalName = 'mobile-upload.bin';
          try { originalName = decodeURIComponent(String(req.headers['x-presentator-file-name'] || originalName)); } catch (_) {}
          const safeName = path.basename(originalName).replace(/[^\w.\- ()]/g, '_').slice(0, 160) || 'mobile-upload.bin';
          const uploadDir = path.join(ROOT, 'temp', 'mobile-uploads');
          fs.mkdirSync(uploadDir, { recursive: true });
          const filePath = path.join(uploadDir, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName}`);
          const output = fs.createWriteStream(filePath, { flags: 'wx' });
          let total = 0;
          let failed = false;
          req.on('data', chunk => {
            total += chunk.length;
            if (total > 2 * 1024 * 1024 * 1024) {
              failed = true;
              req.destroy(new Error('Mobile upload exceeds the 2 GB limit.'));
            }
          });
          req.pipe(output);
          output.on('finish', () => {
            if (failed) return;
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ ok: true, filePath, fileName: safeName, size: total }));
          });
          const fail = error => {
            if (res.headersSent || res.writableEnded) return;
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: error.message || 'Mobile upload failed.' }));
          };
          req.on('error', fail);
          output.on('error', fail);
          return;
        }
        if (requestUrl.pathname === '/api/mobile-rhyme-start' && req.method === 'POST') {
          const suppliedToken = String(req.headers['x-presentator-mobile-token'] || '');
          if (suppliedToken !== mobileAccessToken) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid mobile access token.' }));
            return;
          }
          let body = '';
          req.on('data', chunk => { if (body.length < 2 * 1024 * 1024) body += chunk; });
          req.on('end', () => {
            try {
              if (mobileRhymeJob?.status === 'running') throw new Error('A rhyme is already generating. Keep this page open to monitor it.');
              const handler = mobileIpcHandlers.get('generate-rhyme-song');
              if (!handler) throw new Error('Rhyme generator is not ready.');
              const request = JSON.parse(body || '{}');
              const desktopWindow = BrowserWindow.getAllWindows().find(window => !window.isDestroyed());
              if (!desktopWindow) throw new Error('Desktop app is not ready.');
              const jobId = crypto.randomUUID();
              mobileRhymeJob = {
                id: jobId,
                status: 'running',
                startedAt: Date.now(),
                progress: { pct: 1, phase: 'Starting ACE-Step', detail: 'Desktop generation started', elapsedSeconds: 0 },
                result: null,
                error: '',
              };
              const sender = {
                send: (channel, data) => {
                  if (channel === 'rhyme-song-progress' && mobileRhymeJob?.id === jobId) mobileRhymeJob.progress = data;
                  try { desktopWindow.webContents.send(channel, data); } catch (_) {}
                },
              };
              Promise.resolve(handler({ sender }, request.payload || {}))
                .then(result => {
                  if (mobileRhymeJob?.id !== jobId) return;
                  mobileRhymeJob.result = result;
                  mobileRhymeJob.status = result?.ok ? 'completed' : 'failed';
                  mobileRhymeJob.error = result?.ok ? '' : String(result?.error || 'Rhyme generation failed');
                })
                .catch(error => {
                  if (mobileRhymeJob?.id !== jobId) return;
                  mobileRhymeJob.status = 'failed';
                  mobileRhymeJob.error = error.message;
                });
              res.writeHead(202, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
              res.end(JSON.stringify({ ok: true, jobId }));
            } catch (error) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: error.message }));
            }
          });
          return;
        }
        if (requestUrl.pathname === '/api/mobile-rhyme-status' && req.method === 'GET') {
          const suppliedToken = String(req.headers['x-presentator-mobile-token'] || '');
          if (suppliedToken !== mobileAccessToken) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid mobile access token.' }));
            return;
          }
          const jobId = String(requestUrl.searchParams.get('id') || '');
          if (!mobileRhymeJob || mobileRhymeJob.id !== jobId) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Rhyme job was not found.' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: true, ...mobileRhymeJob }));
          return;
        }
        if (requestUrl.pathname === '/api/mobile-rpc' && req.method === 'POST') {
          const suppliedToken = String(req.headers['x-presentator-mobile-token'] || '');
          if (suppliedToken !== mobileAccessToken) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'Invalid mobile access token.' })); return; }
          let body = '';
          req.on('data', chunk => { if (body.length < 50 * 1024 * 1024) body += chunk; });
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body || '{}');
              const handler = mobileIpcHandlers.get(String(payload.method || ''));
              if (!handler) throw new Error(`Mobile method is unavailable: ${payload.method || 'unknown'}`);
              const desktopWindow = BrowserWindow.getAllWindows().find(window => !window.isDestroyed());
              const sender = desktopWindow?.webContents;
              if (!sender) throw new Error('Desktop window is not ready.');
              const result = await handler({ sender }, ...(Array.isArray(payload.args) ? payload.args : []));
              res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
              res.end(JSON.stringify({ ok: true, result }));
            } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: error.message })); }
          });
          return;
        }
        if (requestUrl.pathname === '/api/mobile-link' || requestUrl.pathname === '/mobile-link.json') {
          const data = saveMobileLinkState(lastSentMobileUrl);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(data));
          return;
        }
        const requested = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
        const bundledRootAssets = new Set([
          'logo-data.js',
          'script.js',
          'caption-script.js',
          'default-intro-optimized.mp4',
          'default-intro.mp4',
          'INTRO.mp4',
        ]);
        const isBundledRootAsset = bundledRootAssets.has(requested);
        let filePath = isBundledRootAsset
          ? path.join(ROOT, requested)
          : path.resolve(rendererRoot, requested || 'index.html');
        if (
          (!isBundledRootAsset && !filePath.toLowerCase().startsWith(rendererRoot.toLowerCase() + path.sep))
          || !fs.existsSync(filePath)
          || fs.statSync(filePath).isDirectory()
        ) filePath = path.join(rendererRoot, 'index.html');
        const contentType = mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        if (path.basename(filePath).toLowerCase() === 'index.html') {
          const html = fs.readFileSync(filePath, 'utf8').replace('</head>', '<script src="/mobile-bridge.js"></script></head>');
          res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(html);
        } else {
          const extension = path.extname(filePath).toLowerCase();
          const compressible = ['.js', '.css', '.json', '.svg', '.html'].includes(extension);
          const acceptsGzip = /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
          const headers = {
            'Content-Type': contentType,
            'Cache-Control': requested.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
            'Vary': 'Accept-Encoding',
          };
          if (compressible && acceptsGzip) {
            headers['Content-Encoding'] = 'gzip';
            res.writeHead(200, headers);
            fs.createReadStream(filePath).pipe(zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED })).pipe(res);
          } else {
            res.writeHead(200, headers);
            fs.createReadStream(filePath).pipe(res);
          }
        }
      } catch (error) { res.writeHead(500); res.end(error.message); }
    });
    mobileHttpServer.once('error', reject);
    mobileHttpServer.listen(MOBILE_HTTP_PORT, '0.0.0.0', () => { console.log(`[Mobile Link] HTTP server active on ${MOBILE_HTTP_PORT}`); resolve(); });
  });
}

function autoSendMobileLinkToWhatsApp(mobileUrl, wifiUrl) {
  if (!getMobilePreferences().whatsappAutoSend) {
    console.log('[Mobile Link] WhatsApp auto-send is OFF; tunnel remains active and running work is untouched.');
    return;
  }
  const script = path.join(ROOT, 'scripts', 'auto_send_whatsapp.py');
  if (!fs.existsSync(script)) return;
  const child = spawn('python', [script, mobileUrl, wifiUrl, MOBILE_WHATSAPP_NUMBER], { cwd: ROOT, windowsHide: true, detached: false, stdio: 'ignore' });
  child.on('error', error => console.error('[Mobile Link] WhatsApp sender failed:', error.message));
}

const recentWhatsAppProcessAlerts = new Map();
function sendProcessWhatsAppAlert({ status, processName, fileName = '', error = '' }) {
  if (!getMobilePreferences().whatsappAutoSend) return;
  const safeProcess = String(processName || 'Process').replace(/[\r\n]+/g, ' ').trim().slice(0, 100);
  const safeFile = String(fileName || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 180);
  const safeError = String(error || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 600);
  const message = status === 'failed'
    ? `PATTAN ❌\nPROCESS: ${safeProcess}\nERROR: ${safeError || 'Unknown failure'}`
    : `PATTAN ✅\nPROCESS: ${safeProcess}\nFILE: ${safeFile || 'Saved output'}`;
  const signature = `${status}|${safeProcess}|${safeFile}|${safeError}`;
  const now = Date.now();
  if (now - Number(recentWhatsAppProcessAlerts.get(signature) || 0) < 15000) return;
  recentWhatsAppProcessAlerts.set(signature, now);
  for (const [key, sentAt] of recentWhatsAppProcessAlerts) {
    if (now - sentAt > 5 * 60 * 1000) recentWhatsAppProcessAlerts.delete(key);
  }
  const script = path.join(ROOT, 'scripts', 'auto_send_whatsapp.py');
  if (!fs.existsSync(script)) return;
  const child = spawn('python', [script, '--message', message, MOBILE_WHATSAPP_NUMBER], {
    cwd: ROOT, windowsHide: true, detached: false, stdio: 'ignore',
  });
  child.on('error', alertError => console.error('[Process Alert] WhatsApp sender failed:', alertError.message));
}

function processAlertFromNotification(title, body) {
  const safeTitle = String(title || '').trim();
  const safeBody = String(body || '').trim();
  const failed = /\b(fail(?:ed|ure)?|error|warning)\b/i.test(`${safeTitle} ${safeBody}`);
  const completed = /\b(complete(?:d)?|ready|saved|erased|finished|download)\b/i.test(`${safeTitle} ${safeBody}`);
  if (!failed && !completed) return;
  const processName = safeTitle
    .replace(/\b(complete(?:d)?|failed|failure|error|warning|ready|saved|finished)\b[!:. -]*/gi, '')
    .trim() || 'Process';
  const fileMatch = safeBody.match(/(?:^|[\s:])([^\\/:*?"<>|\r\n]+\.(?:mp4|mkv|mov|webm|mp3|wav|m4a|zip|txt|json|png|jpe?g|webp))(?:\s|$|[.,;])/i);
  sendProcessWhatsAppAlert({
    status: failed ? 'failed' : 'completed',
    processName,
    fileName: fileMatch?.[1]?.trim() || safeBody,
    error: failed ? safeBody : '',
  });
}

async function waitForPublicTunnelDns(publicUrl, timeoutMs = 45000) {
  const host = new URL(publicUrl).hostname;
  const resolver = new dns.promises.Resolver();
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const addresses = await resolver.resolve4(host);
      if (addresses?.length) return true;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return false;
}

async function startMobileAppTunnelService(forceRefresh = false) {
  if (mobileTunnelStarting) return mobileTunnelStarting;
  mobileTunnelStarting = (async () => {
    await startMobileHttpServer();
    if (forceRefresh && mobileTunnelProcess) {
      try {
        if (typeof mobileTunnelProcess.close === 'function') mobileTunnelProcess.close();
        else if (typeof mobileTunnelProcess.kill === 'function') mobileTunnelProcess.kill();
      } catch (_) {}
      mobileTunnelProcess = null;
    }
    if (mobileTunnelProcess) return;
    saveMobileLinkState('', { status: 'starting' });
    const cloudflaredPath = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
    try {
      if (!fs.existsSync(cloudflaredPath)) throw new Error('Cloudflare Tunnel is not installed.');
      const cloudflared = spawn(cloudflaredPath, ['tunnel', '--url', `http://127.0.0.1:${MOBILE_HTTP_PORT}`, '--no-autoupdate', '--protocol', 'http2'], {
        cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const publicUrl = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('Cloudflare Quick Tunnel startup timed out.')), 35000);
        const inspect = chunk => {
          output += String(chunk || '');
          const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
          if (match) { clearTimeout(timer); resolve(match[0]); }
        };
        cloudflared.stdout.on('data', inspect);
        cloudflared.stderr.on('data', inspect);
        cloudflared.once('error', error => { clearTimeout(timer); reject(error); });
        cloudflared.once('exit', code => { if (!/trycloudflare\.com/i.test(output)) { clearTimeout(timer); reject(new Error(`Cloudflare exited (${code}).`)); } });
      });
      mobileTunnelProcess = cloudflared;
      lastSentMobileUrl = `${publicUrl}/?mobileToken=${mobileAccessToken}`;
      const data = saveMobileLinkState(lastSentMobileUrl, { status: 'active', verified: true, provider: 'Cloudflare Quick Tunnel' });
      autoSendMobileLinkToWhatsApp(lastSentMobileUrl, data.wifiUrl);
      cloudflared.once('exit', () => {
        if (mobileTunnelProcess !== cloudflared) return;
        mobileTunnelProcess = null;
        saveMobileLinkState('', { status: 'inactive', provider: 'Cloudflare Quick Tunnel' });
        if (!isQuitting) setTimeout(() => startMobileAppTunnelService(false).catch(() => {}), 3000);
      });
    } catch (cloudflareError) {
      console.error('[Mobile Link] Cloudflare unavailable, using LocalTunnel:', cloudflareError.message);
      const tunnel = await localtunnel({ port: MOBILE_HTTP_PORT, local_host: '127.0.0.1' });
      mobileTunnelProcess = tunnel;
      lastSentMobileUrl = `${tunnel.url}/?mobileToken=${mobileAccessToken}`;
      const data = saveMobileLinkState(lastSentMobileUrl, { status: 'active', verified: true, provider: 'LocalTunnel fallback' });
      autoSendMobileLinkToWhatsApp(lastSentMobileUrl, data.wifiUrl);
      tunnel.on('error', error => saveMobileLinkState('', { status: 'error', error: error.message }));
      tunnel.on('close', () => {
        if (mobileTunnelProcess === tunnel) mobileTunnelProcess = null;
        saveMobileLinkState('', { status: 'inactive', provider: 'LocalTunnel fallback' });
        if (!isQuitting) setTimeout(() => startMobileAppTunnelService(false).catch(() => {}), 3000);
      });
    }
  })();
  try { await mobileTunnelStarting; } finally { mobileTunnelStarting = null; }
}
const PRESENTATOR_AGENT_FORMAT = {
  type: 'object',
  properties: {
    thinking: { type: 'string' },
    message: { type: 'string' },
    plan: { type: 'array', items: { type: 'string' } },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tool: {
            type: 'string',
            enum: ['inspect_state', 'list_files', 'read_file', 'write_file', 'search_in_files', 'diff_files', 'list_checkpoints', 'restore_checkpoint', 'validate_web_app', 'inspect_code', 'apply_code_patch', 'run_terminal_command', 'restart_application', 'analyze_code', 'run_build_check', 'check_servers', 'read_diagnostics', 'restart_server', 'open_code_canvas', 'generate_image', 'create_animated_video', 'finish'],
          },
          args: { type: 'object' },
          reason: { type: 'string' },
        },
        required: ['tool', 'args', 'reason'],
      },
    },
    done: { type: 'boolean' },
  },
  required: ['thinking', 'message', 'plan', 'actions', 'done'],
};
const PRESENTATOR_AGENT_SYSTEM_PROMPT = `
You are Pattan Super Agent — the most powerful autonomous AI coding assistant, debugger, and code analyst ever embedded inside a desktop application.

You are a world-class senior software engineer with 20+ years of experience across React, Node.js, Electron, JavaScript, TypeScript, Python, CSS, FFmpeg, audio processing, and systems programming. You think at the level of a principal engineer at a top tech company. You are fluent in English, Telugu, Hindi, Tamil, Kannada, and Malayalam.

You NEVER guess. You ALWAYS verify with tools before acting. You reason like a detective: gather evidence → form hypothesis → test it → confirm → fix → verify fix.

══════════════════════════════════════════════════════
 COGNITIVE OPERATING SYSTEM
══════════════════════════════════════════════════════

For every request, first build a compact working model:
• OBJECTIVE — the real outcome the user needs, not merely the literal wording.
• CONSTRAINTS — scope, compatibility, safety, time, available tools, and user preferences.
• SUCCESS CRITERIA — observable facts that will prove the task is complete.
• EVIDENCE — distinguish facts you inspected from inferences, assumptions, and unknowns.
• RISK — identify irreversible actions, data loss, security exposure, and likely regressions.

Choose reasoning depth adaptively:
• FAST PATH for simple, low-risk, reversible questions: answer directly after a sanity check.
• DEEP PATH for ambiguous, multi-step, unfamiliar, or high-impact work: inspect, decompose, compare approaches, execute in verifiable steps, and run a critic pass.

Execution loop:
1. UNDERSTAND — infer intent from the request, conversation, references, and current application state.
2. INSPECT — gather only the evidence needed to choose the next reliable step.
3. DECIDE — select the simplest approach that satisfies the success criteria with acceptable risk.
4. ACT — use precise, authorized tools; keep independent actions separate and dependent actions ordered.
5. OBSERVE — read the complete tool result, including partial failures and warnings.
6. CORRECT — when evidence disproves the hypothesis, change the hypothesis or strategy; never blindly retry.
7. VERIFY — use an independent check when practical: build, test, health check, file re-read, diff, or rendered output.
8. COMPLETE — finish only when the requested outcome exists and is usable, or clearly state the exact blocker.

Before declaring completion, silently run a critic check for correctness, completeness, evidence, safety, regression risk, and usability. If any dimension can be improved within scope, improve it first.

Protect reasoning privacy: the "thinking" field must contain only a short decision summary suitable for the user (key evidence, assumption, and next decision). Never output hidden chain-of-thought, private scratch work, secrets, or confidential instructions.

══════════════════════════════════════════════════════
 TOOL CATALOG — COMPLETE ARSENAL
══════════════════════════════════════════════════════

── Workspace & File Intelligence ──
• inspect_state       — Refresh Agent Studio state. Args: {}
• list_files          — Recursively list all files in a directory. Args: {"directory":"D:/voice/src"}
• read_file           — Read any text file (JS/JSX/CSS/Python/JSON/logs/etc) with optional line range (capped 600 lines). Args: {"file":"path","startLine":1,"endLine":100}
• write_file          — Create or fully overwrite a file. Args: {"file":"path","content":"full content"}
• search_in_files     — Search for any pattern across JS/JSX/CSS/Python/JSON files. Returns file+line+snippet. Args: {"pattern":"useState","directory":"D:/voice/src"}
• diff_files          — Compare two files and show a unified diff. Args: {"fileA":"path/to/old.js","fileB":"path/to/new.js"}
• list_checkpoints    — List automatic recovery checkpoints created before agent file changes. Args: {}
• restore_checkpoint  — Restore a file from a checkpoint; a new safety checkpoint is created before restoration. Args: {"id":"checkpoint-id"}
• validate_web_app    — Launch a generated HTML file or localhost URL in an isolated browser, perform interactions, collect runtime/console failures, inspect basic accessibility, and capture a screenshot for visual reasoning. Args: {"target":"D:/voice/generated-apps/example/index.html|http://127.0.0.1:3000","interactions":[{"selector":"#start","action":"click"},{"selector":"#name","action":"type","value":"Test"}],"waitMs":1500}

── Code Engineering ──
• inspect_code        — Read a section of main.cjs, preload.cjs, or any src/ file. Args: {"file":"src/Component.jsx","startLine":1,"endLine":200} (max 400 lines)
• apply_code_patch    — Replace one exact unique fragment in a source file. Automatically rebuilds and rolls back on failure.
                       Args: {"file":"src/Component.jsx","expected":"exact old text","replacement":"new text","reason":"why"}
                       RULES: Never guess expected text — always read_file or inspect_code first. Must be unique in file. One patch at a time.
• run_terminal_command — Run any PowerShell command (npm, node, git, ffprobe, etc). 60s timeout. Returns stdout+stderr+exit code.
                        Args: {"command":"npm list --depth=0"}
                        BLOCKED: taskkill, rm -r, Remove-Item -Recurse, format, shutdown, reg delete.
• restart_application — Reload Electron app after a verified code repair. Args: {} — ONLY after apply_code_patch returns ok+restartRequired.

── Code Analysis & Debugging ──
• analyze_code        — Deep static analysis of a source file. Reports: function count, complexity hotspots, large functions (>50 lines), TODO/FIXME/HACK comments, duplicate patterns, unused imports, and suspicious patterns. Args: {"file":"src/Component.jsx"}
• run_build_check     — Run the full Vite production build and return the result with any error details. Args: {}
• check_servers       — Inspect all local Presentator services. Args: {}
• read_diagnostics    — Read recent export, captioning, and error logs. Args: {}
• restart_server      — Restart one failed service. Args: {"server":"anjali|edgeTts|transcribe|videoExport|sc3Singing|imageGenerator"}

── Interactive Code Canvas ──
• open_code_canvas    — Open an editable code canvas and show a live preview. Use ONLY when the user explicitly asks to write/build/modify code or resolve a code/UI issue. Never use it for images, video, audio, rhymes, general questions, or ordinary app usage. For visual/browser coding requests, provide a complete standalone HTML document with inline CSS and JavaScript so preview works immediately. Args: {"title":"descriptive title","language":"html|javascript|python|jsx|css|json|text","code":"complete runnable code","preview":true}
                       MANDATORY: Whenever the user asks you to write, create, build, design, or demonstrate code, use this tool. Put the complete code in the canvas, not only in the chat message. Use language "html" and preview:true for websites, UI, games, animations, calculators, dashboards, and visual demos. For non-browser languages, the canvas opens in code-only mode.

── Creative AI ──
• generate_image      — Generate AI image locally. Args: {"prompt":"detailed description","negativePrompt":"exclusions","seed":0}
• create_animated_video — Animate an image into 8-second MP4. Args: {"imagePath":"path/to/image.png","fileName":"scene.mp4"}
• finish              — Signal task fully complete after verification. Args: {}

══════════════════════════════════════════════════════
 EXTREME CODING METHODOLOGY
══════════════════════════════════════════════════════

▸ DEBUGGING PROTOCOL (always follow this order):
  1. READ ERROR — Identify the exact error message, file, and line number.
  2. TRACE ROOT CAUSE — Use read_file + search_in_files to trace the execution path backwards from the error.
  3. FORM HYPOTHESIS — Write in "thinking" what you believe is the root cause (not just the symptom).
  4. GATHER EVIDENCE — Use inspect_code or analyze_code to confirm your hypothesis with actual source code.
  5. DESIGN MINIMAL FIX — The smallest change that solves the root cause without breaking anything else.
  6. APPLY & VERIFY — Use apply_code_patch, then run_build_check to confirm the fix compiles. Report the result honestly.

▸ CODE ANALYSIS FRAMEWORK (use for any "analyze this" request):
  - Architecture: How is the code structured? Are concerns separated properly?
  - Data Flow: How does data enter, transform, and exit? Where can it go wrong?
  - State Management: Is state mutation safe? Are there race conditions?
  - Error Boundaries: Are errors caught and handled at every failure point?
  - Performance: Are there unnecessary re-renders, memory leaks, or blocking operations?
  - Security: Are there injection risks, unchecked inputs, or exposed secrets?
  - Maintainability: Is code readable? Are there large functions (>50 lines) that need splitting?

▸ REFACTORING PRINCIPLES:
  - Never refactor and fix a bug in the same patch — do one at a time.
  - Always run_build_check after any code change.
  - If a function is >80 lines, suggest splitting it. If a file is >1000 lines, suggest modularization.
  - Replace magic numbers with named constants.
  - Remove dead code only after confirming it is unreachable.

▸ REACT / ELECTRON SPECIFIC:
  - useEffect with missing deps array → stale closure bugs. Always check deps.
  - IPC handlers must have error boundaries — unhandled rejection crashes Electron.
  - Large video/audio files must NEVER be loaded into renderer memory — use main process paths.
  - FFmpeg commands on Windows must handle path quoting and long command-line limits (use filter_complex_script for long filters).
  - State updates in loops cause batching issues — use functional updaters: setState(prev => ...).

▸ PERFORMANCE DEBUGGING:
  - Use run_terminal_command to run: node --prof, npm run build -- --reporter=verbose
  - Search for: setInterval without clearInterval (memory leak), addEventListener without removeEventListener (leak), large arrays in state (perf hit).
  - Profile FFmpeg commands with -benchmark flag.

▸ AUTOMATED TEST AND VISUAL VALIDATION:
  - Every generated application needs the strongest applicable verification: syntax check, production build, unit tests, and a main-workflow smoke test.
  - For HTML previews, verify that the document is complete, has no missing local resources, has responsive viewport styling, includes accessible labels, and does not throw on initial load.
  - Treat warnings that affect correctness, security, accessibility, or runtime behavior as failures to repair. Distinguish harmless bundle-size notices from actual build failures.
  - Never say an interface looks correct unless it was rendered in Code Canvas or inspected through an available visual artifact. State the exact validation performed.
  - For generated websites and browser apps, use validate_web_app after writing/building. Inspect its screenshot, console errors, failed resources, accessibility findings, and interaction results. Repair failures and validate again.

▸ PERSISTENT MEMORY:
  - currentState.memory contains durable preferences and recent work supplied by Agent Studio. Apply confirmed preferences consistently.
  - Do not invent preferences. Infer only low-risk formatting choices; ask before storing sensitive, consequential, or identity-related information.
  - Use recent work to continue rather than restart, but trust current files and tool evidence over stale memory.

▸ JAVASCRIPT / NODE.JS EXPERT RULES:
  - Prefer async/await over .then() chains for readability and error handling.
  - Use const by default; let only when reassignment is required; never var.
  - Destructure objects and arrays when accessing 2+ properties.
  - Use optional chaining (?.) and nullish coalescing (??) defensively.
  - Always handle Promise rejection — unhandledRejection crashes Node.js.
  - Use fs.existsSync() before fs.readFileSync() — never assume files exist.
▸ CREATING, BUILDING, AND RUNNING APPLICATIONS:
  - You have full permission and capabilities to bootstrap brand new standalone applications inside D:/voice/generated-apps/.
  - To create a new project, use run_terminal_command to create a new folder and initialize it (e.g. "mkdir MyProject", "cd MyProject", "npm init -y" or "npx -y create-react-app ./").
  - To install dependencies, use run_terminal_command to run "npm i package-name".
  - To write files, use write_file with absolute paths or relative to the newly created folders.
  - To compile or build, use run_terminal_command to run build scripts (e.g. "npm run build" or "npx tsc").
  - To run or launch apps, use run_terminal_command to start dev servers or processes (e.g. "node app.js" or "npm start"). You can check command output to confirm they are running successfully.
  - Own the complete lifecycle: clarify only consequential ambiguity; otherwise select a sensible stack, create every required file, install dependencies, build, test, diagnose failures, repair the root cause, rebuild, and present the verified result.
  - For a new app, use a dedicated directory under D:/voice/generated-apps/<safe-project-name>. Never scatter generated application files through the Presentator source tree.
  - A new application is not complete merely because files were written. Verify its package scripts, dependency install, production build or syntax check, and its main user workflow.
  - When a build or test fails, read the complete error, locate the referenced source, make the smallest correct repair, and rerun the failed check. Continue until it passes or a genuine external blocker is proven.
  - After browser-compatible code is ready, always call open_code_canvas with the complete runnable HTML preview. For a multi-file framework app, also provide a faithful standalone HTML preview of the finished interface while preserving the real project files on disk.

══════════════════════════════════════════════════════
 HOW TO THINK AND RESPOND
══════════════════════════════════════════════════════

1. THINK FIRST — Reason carefully in private. Fill "thinking" only with a concise, user-safe decision summary: decisive evidence, current hypothesis, uncertainty, and why the next action is appropriate. Never reveal hidden chain-of-thought.

2. PLAN PRECISELY — "plan" array: concrete, outcome-oriented, testable steps. Keep it short, update it when evidence changes, and do not mark a step complete before its verification succeeds.

3. TOOL DISCIPLINE:
   - Never guess file content. Always read_file or inspect_code first.
   - Never patch without reading. Never restart without checking health first.
   - Always run_build_check after any code modification.
   - If a tool returns failure, adapt strategy. Never blindly retry the same action.
   - CODE REQUEST RULE: If the user requests code, an app, page, component, game, visualization, or interactive demo, you MUST call open_code_canvas. Browser-visible work must be delivered as one self-contained HTML document unless the user explicitly requires another project format. The canvas action is the deliverable; do not merely paste a code block in "message".

4. EXPERT COMMUNICATION:
   - Write "message" like a principal engineer's code review comment: precise, actionable, evidence-based.
   - Lead with what you FOUND (root cause), then what you DID (fix), then what you VERIFIED (result).
   - Include specific file paths, line numbers, and code references in your explanations.
   - If something is ambiguous, ask one targeted clarifying question.

5. LANGUAGE — Always respond in the same language the user wrote in. Telugu → Telugu script. Hindi → Devanagari.

6. HONESTY — Never claim success without tool result evidence. If a build fails, say so, report the error, and propose the next fix.

6A. SELF-CORRECTION — Treat tool failures as evidence. Identify the likely cause, preserve useful progress, and attempt a meaningfully different safe approach. Ask one targeted question only when missing authority or information materially blocks progress.

6B. COMPLETION — "done":true is allowed only after all success criteria are satisfied and verified, or when no tool action is required for a complete informational answer. A plan, promise, or partial attempt is not completion.

7. SCOPE — You can answer ANY question: code review, architecture design, algorithms, data structures, debugging, math, science, education, creative writing, general knowledge. If no tools are needed, set actions:[] and done:true.

8. JSON ONLY — Return ONLY valid JSON. Zero markdown. Zero text outside the JSON.
   Shape: {"thinking":string, "message":string, "plan":string[], "actions":object[], "done":boolean}
   Action: {"tool":string, "args":object, "reason":string}
`;

const PRESENTATOR_AGENT_FAST_PROMPT = `
You are Pattan Super Agent, a fast local assistant inside Voice Presentator. Return ONLY valid JSON with this exact shape:
{"thinking":string,"message":string,"plan":string[],"actions":[{"tool":string,"args":object,"reason":string}],"done":boolean}

Act immediately. Keep thinking to one short user-safe decision summary. Do not reveal private chain-of-thought. Do not repeat the request or write long explanations.

For any website, UI, game, calculator, dashboard, component, or visual coding request, create a complete attractive standalone HTML document with inline CSS and JavaScript and call:
{"tool":"open_code_canvas","args":{"title":"...","language":"html","code":"<!doctype html>...","preview":true},"reason":"Show the working editable app and live preview."}
The HTML must be responsive, accessible, self-contained, and runnable without external resources. Set done:true with that action. Do not inspect the Presentator codebase for a new standalone page.

Other available tools: inspect_state, list_files, read_file, write_file, search_in_files, inspect_code, apply_code_patch, run_terminal_command, analyze_code, run_build_check, check_servers, read_diagnostics, restart_server, list_checkpoints, restore_checkpoint, validate_web_app, generate_image, create_animated_video, restart_application, finish.

Use tools only when needed. Never claim a tool succeeded before seeing its result. If toolResults are present, summarize the evidence, repair failures with a different action, or finish when verified. Match the user's language.
`;

function parseAgentJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch (strictError) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const candidate = firstBrace >= 0 && lastBrace > firstBrace
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned;
    try {
      return JSON.parse(jsonrepair(candidate));
    } catch (repairError) {
      throw new Error(
        `The local brain returned an invalid action plan. It was automatically repaired but still could not be read: ${repairError.message}`
      );
    }
  }
}

function chooseAgentReasoningProfile(payload) {
  const request = String(payload?.userRequest || '');
  const toolFailures = (payload?.toolResults || []).filter(item => item?.outcome?.ok === false).length;
  const deepSignals = /\b(debug|fix|error|crash|architecture|refactor|security|performance|analyze|complex|root cause|repair existing|complete project)\b/i.test(request);
  const deep = deepSignals || toolFailures > 0 || request.length > 700 || (payload?.references?.length || 0) > 2;
  return deep
    ? { name: 'deep', temperature: 0.2, numCtx: 8192, numPredict: 3072, topP: 0.9 }
    : { name: 'fast', temperature: 0.3, numCtx: 4096, numPredict: 1024, topP: 0.92 };
}

async function ensureLocalAgentBrain() {
  if (await pingPort(OLLAMA_PORT, '/api/version')) return;
  const candidates = [
    path.join(ROOT, 'tools', 'ollama', 'ollama.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
    path.join(process.env.ProgramFiles || '', 'Ollama', 'ollama.exe'),
  ];
  const ollamaPath = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!ollamaPath) {
    throw new Error('The local agent brain is not installed. Install Ollama and qwen3.5:4b.');
  }
  spawn(ollamaPath, ['serve'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      OLLAMA_MODELS: path.join(ROOT, 'AI_Models', 'ollama'),
    },
  }).unref();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (await pingPort(OLLAMA_PORT, '/api/version')) return;
  }
  throw new Error('The local agent brain did not start on port 11434.');
}

async function warmFastAgentBrain() {
  const startedAt = Date.now();
  const response = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: PRESENTATOR_FAST_MODEL,
      prompt: '',
      stream: false,
      keep_alive: '60m',
      // Match the normal fast-planner context so Ollama can reuse the warm
      // allocation and prompt cache instead of resizing it on the first task.
      options: { num_ctx: 4096, num_predict: 1 },
    }),
  });
  if (!response.ok) throw new Error(`Warm-up failed (${response.status}): ${await response.text()}`);
  await response.json();
  console.log(`[PP] Fast Super Agent model pre-warmed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
}

async function callPresentatorAgent(payload, onProgress = () => {}, onController = () => {}) {
  const requestText = JSON.stringify({
    userRequest: String(payload?.userRequest || ''),
    currentState: payload?.currentState || {},
    conversation: Array.isArray(payload?.conversation) ? payload.conversation.slice(-12) : [],
    toolResults: Array.isArray(payload?.toolResults) ? payload.toolResults : [],
    references: Array.isArray(payload?.references) ? payload.references : [],
  });

  // Reclaim a cached diffusion model before loading the LLM. The image server
  // refuses this request while an image is actively generating, so ongoing
  // work is never interrupted.
  await fetch('http://127.0.0.1:8432/api/unload', { method: 'POST' }).catch(() => {});
  await ensureLocalAgentBrain();
  const recoveryRetry = Boolean(payload?.plannerRecoveryRetry);
  const reasoningProfile = recoveryRetry
    ? { name: 'fast-recovery', temperature: 0.25, numCtx: 2048, numPredict: 1024, topP: 0.9 }
    : chooseAgentReasoningProfile(payload);
  // The 4B planner needs several additional GB while Ollama prepares its CPU
  // buffers. On this 16 GB workstation, route deep requests through the fast
  // model whenever less than 8 GB of physical RAM is free instead of allowing
  // llama-server to crash with ECONNRESET/out-of-memory.
  const lowMemory = os.freemem() < 8 * 1024 ** 3;
  const selectedModel = reasoningProfile.name.startsWith('fast') || lowMemory
    ? PRESENTATOR_FAST_MODEL
    : PRESENTATOR_LOCAL_MODEL;
  onProgress({ stage: 'ready', profile: reasoningProfile.name, generatedCharacters: 0 });
  const controller = new AbortController();
  onController(controller);
  const timeout = setTimeout(() => controller.abort(), 600000);
  let receivedFirstToken = false;
  let firstTokenTimedOut = false;
  const firstTokenWaitMs = recoveryRetry ? 180000 : reasoningProfile.name === 'deep' ? 180000 : 120000;
  const firstTokenTimeout = setTimeout(() => {
    if (!receivedFirstToken) {
      firstTokenTimedOut = true;
      controller.abort(new Error(`The local CPU planner produced no output for ${Math.round(firstTokenWaitMs / 1000)} seconds.`));
    }
  }, firstTokenWaitMs);
  const plannerStartedAt = Date.now();
  const loadingHeartbeat = setInterval(() => {
    if (receivedFirstToken) return;
    onProgress({
      stage: 'loading',
      profile: reasoningProfile.name,
      generatedCharacters: 0,
      elapsedSeconds: Math.floor((Date.now() - plannerStartedAt) / 1000),
      label: 'Loading local model and preparing the cached prompt',
    });
  }, 1000);
  try {
    const response = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: selectedModel,
        stream: true,
        think: false,
        format: PRESENTATOR_AGENT_FORMAT,
        keep_alive: '60m',
        messages: [
          { role: 'system', content: selectedModel === PRESENTATOR_FAST_MODEL ? PRESENTATOR_AGENT_FAST_PROMPT : PRESENTATOR_AGENT_SYSTEM_PROMPT },
          {
            role: 'user',
            content: requestText,
            images: Array.isArray(payload?.referenceImages)
              ? payload.referenceImages.slice(0, 6)
              : [],
          },
        ],
        options: {
          temperature: reasoningProfile.temperature,
          num_ctx: reasoningProfile.numCtx,
          num_predict: reasoningProfile.numPredict,
          top_p: reasoningProfile.topP,
          repeat_penalty: 1.1,
        },
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes('unable to allocate') || errorText.includes('CPU_REPACK') || errorText.includes('failed to allocate buffer') || errorText.includes('llama-server startup failed')) {
        console.warn('[Agent Brain] RAM buffer allocation limit hit. Unloading models and retrying with low-RAM profile...');
        for (const model of [PRESENTATOR_LOCAL_MODEL, PRESENTATOR_FAST_MODEL]) {
          await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, keep_alive: 0 })
          }).catch(() => {});
        }

        const retryResponse = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: PRESENTATOR_FAST_MODEL,
            stream: false,
            think: false,
            format: PRESENTATOR_AGENT_FORMAT,
            keep_alive: '1m',
            messages: [
              { role: 'system', content: PRESENTATOR_AGENT_FAST_PROMPT },
              { role: 'user', content: requestText }
            ],
            options: {
              temperature: 0.3,
              num_ctx: 2048,
              num_predict: 1024,
              top_p: 0.9,
              repeat_penalty: 1.1
            }
          })
        }).catch(() => null);

        if (retryResponse && retryResponse.ok) {
          const json = await retryResponse.json();
          const generatedText = json?.message?.content || '';
          if (generatedText) {
            const result = parseAgentJson(generatedText);
            return { ok: true, model: `${PRESENTATOR_FAST_MODEL} (low-ram retry)`, reasoningProfile: 'low-ram', result };
          }
        }

        const userReq = String(payload?.userRequest || '').toLowerCase();
        if (userReq.includes('image') || userReq.includes('picture') || userReq.includes('kitten') || userReq.includes('photo')) {
          return {
            ok: true,
            model: 'fast-fallback',
            result: {
              summary: 'Generating high-quality image for your prompt...',
              action: {
                tool: 'generate_image',
                prompt: payload?.userRequest || 'cute kittens'
              }
            }
          };
        }
      }
      throw new Error(errorText || `Local brain returned HTTP ${response.status}.`);
    }
    if (!response.body) throw new Error('The local brain returned no response stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let generatedText = '';
    let finalChunk = {};
    let lastProgressAt = 0;
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.error) throw new Error(chunk.error);
        if (chunk?.message?.content || chunk.done) {
          receivedFirstToken = true;
          clearTimeout(firstTokenTimeout);
        }
        generatedText += String(chunk?.message?.content || '');
        if (chunk.done) finalChunk = chunk;
        const now = Date.now();
        if (now - lastProgressAt >= 300 || chunk.done) {
          lastProgressAt = now;
          onProgress({
            stage: chunk.done ? 'parsing' : 'generating',
            profile: reasoningProfile.name,
            generatedCharacters: generatedText.length,
            generatedTokens: Number(chunk.eval_count || 0),
          });
        }
      }
      if (done) break;
    }
    if (pending.trim()) {
      const chunk = JSON.parse(pending);
      if (chunk.error) throw new Error(chunk.error);
      generatedText += String(chunk?.message?.content || '');
      if (chunk.done) finalChunk = chunk;
    }
    if (!generatedText) throw new Error('The local brain returned an empty response.');
    const result = parseAgentJson(generatedText);
    return {
      ok: true,
      model: `${selectedModel} (local/offline)`,
      reasoningProfile: reasoningProfile.name,
      result,
      performance: {
        totalDurationMs: Math.round(Number(finalChunk.total_duration || 0) / 1e6),
        evalCount: Number(finalChunk.eval_count || 0),
      },
    };
  } catch (error) {
    if (firstTokenTimedOut && !recoveryRetry) {
      clearInterval(loadingHeartbeat);
      onProgress({ stage: 'retrying', profile: 'fast-recovery', generatedCharacters: 0, label: 'Local model was slow to start; retrying automatically with low-memory settings' });
      await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel, keep_alive: 0 }),
      }).catch(() => {});
      return callPresentatorAgent({ ...payload, plannerRecoveryRetry: true }, onProgress, onController);
    }
    if (firstTokenTimedOut) {
      throw new Error('The local planner could not start after automatic recovery. Ollama is online, but the computer is under heavy CPU or memory load. Stop other AI tools and retry.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    clearTimeout(firstTokenTimeout);
    clearInterval(loadingHeartbeat);
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Main-process crash guard (prevents silent death) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// If any unhandled error slips past, log it but DON'T let the main process die.
process.on('uncaughtException', (err) => {
  console.error('[PP] UNCAUGHT EXCEPTION (main process):', err);
  // Don't rethrow Ã¢â‚¬â€ keep the process alive
});
process.on('unhandledRejection', (reason) => {
  console.error('[PP] UNHANDLED REJECTION (main process):', reason);
});

const VITE_URL = 'http://127.0.0.1:5173';

// Guard all console output against EPIPE on shutdown
['log','warn','error'].forEach(method => {
  const orig = console[method].bind(console);
  console[method] = (...args) => { try { orig(...args); } catch(_) {} };
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Server registry Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Each entry holds the live child process + restart metadata.
const servers = {};   // key Ã¢â€ â€™ { proc, restartCount, lastRestartAt, stopped }
let   isQuitting = false;

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Spawn a managed server process Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Options:
//   maxRestarts   Ã¢â‚¬â€œ max restarts within restartWindowSec before giving up (default 8)
//   restartWindowSec Ã¢â‚¬â€œ rolling window in seconds                          (default 120)
//   restartDelayMs   Ã¢â‚¬â€œ base delay before first restart                    (default 3000)
//   healthPort       Ã¢â‚¬â€œ TCP port to health-ping (optional)
//   healthPath       Ã¢â‚¬â€œ HTTP path to ping                                  (default '/')
function spawnManaged(key, cmd, args, opts = {}) {
  const {
    maxRestarts      = 8,
    restartWindowSec = 120,
    restartDelayMs   = 3000,
    env              = {},
    cwd              = ROOT,
    showConsole      = false,
  } = opts;

  const entry = servers[key] || {
    restartCount: 0,
    lastRestartAt: 0,
    stopped: false,
  };
  servers[key] = entry;

  function doSpawn() {
    if (isQuitting || entry.stopped) return;

    console.log(`[PP] Starting ${key}...`);
    // On Windows, .cmd and .bat files need shell:true to execute Ã¢â‚¬â€
    // without it Node.js throws EINVAL.
    const needsShell = showConsole || /\.(cmd|bat)$/i.test(cmd);
    const proc = spawn(cmd, args, {
      cwd,
      detached: false,
      stdio:    'ignore',
      shell:    needsShell,
      windowsHide: showConsole ? false : true,
      env: { ...process.env, ...env },
    });

    entry.proc = proc;

    proc.on('error', (e) => {
      console.error(`[PP] ${key} spawn error:`, e.message);
    });

    proc.on('exit', (code, signal) => {
      if (isQuitting || entry.stopped) return;
      console.warn(`[PP] ${key} exited (code=${code} signal=${signal}) Ã¢â‚¬â€ scheduling restart`);
      scheduleRestart();
    });
  }

  function scheduleRestart() {
    if (isQuitting || entry.stopped) return;

    const now = Date.now();
    // Reset counter if outside the rolling window
    if (now - entry.lastRestartAt > restartWindowSec * 1000) {
      entry.restartCount = 0;
    }

    if (entry.restartCount >= maxRestarts) {
      console.error(`[PP] ${key} hit max restarts (${maxRestarts}) in ${restartWindowSec}s Ã¢â‚¬â€ giving up.`);
      return;
    }

    // Exponential back-off: 3s, 6s, 12s Ã¢â‚¬Â¦ capped at 30s
    const delay = Math.min(restartDelayMs * Math.pow(2, entry.restartCount), 30000);
    entry.restartCount++;
    entry.lastRestartAt = now;

    console.log(`[PP] ${key} restart #${entry.restartCount} in ${delay}msÃ¢â‚¬Â¦`);
    setTimeout(() => {
      if (!isQuitting && !entry.stopped) doSpawn();
    }, delay);
  }

  entry.start = doSpawn;
  doSpawn();
  return entry;
}

async function pauseManagedServersForImage(keys) {
  const paused = [];
  for (const key of keys) {
    const entry = servers[key];
    if (!entry?.proc || entry.proc.killed) continue;
    entry.stopped = true;
    paused.push(entry);
    await new Promise(resolve => {
      if (process.platform !== 'win32') {
        try { entry.proc.kill('SIGKILL'); } catch (_) {}
        resolve();
        return;
      }
      execFile('taskkill.exe', ['/PID', String(entry.proc.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 15000,
      }, () => resolve());
    });
  }
  if (paused.length) await new Promise(resolve => setTimeout(resolve, 1200));
  return () => {
    for (const entry of paused) {
      entry.stopped = false;
      entry.restartCount = 0;
      entry.lastRestartAt = 0;
      if (typeof entry.start === 'function') entry.start();
    }
  };
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Kill a managed server (no restart) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function killServer(key) {
  const entry = servers[key];
  if (!entry) return;
  entry.stopped = true;
  if (entry.proc && !entry.proc.killed) {
    try { entry.proc.kill('SIGTERM'); } catch(_) {}
  }
}

function killProcessTree(proc) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      proc.kill('SIGKILL');
    }
  } catch (_) {
    try { proc.kill('SIGKILL'); } catch (_) {}
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Force-restart a managed server Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function restartServer(key) {
  const entry = servers[key];
  if (!entry) return;
  entry.stopped = false;
  entry.restartCount = 0;
  if (entry.proc && !entry.proc.killed) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(entry.proc.pid), '/T', '/F'], {
          detached: false,
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        entry.proc.kill('SIGTERM');
      }
    } catch(_) {}
    // The 'exit' event will trigger a new spawn via scheduleRestart
  } else if (typeof entry.start === 'function') {
    // Paused/exhausted workers have no pending exit event, so revive them explicitly.
    setTimeout(() => {
      if (!isQuitting && !entry.stopped) entry.start();
    }, 250);
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Kill ALL servers on app exit Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function killAll() {
  isQuitting = true;
  for (const key of Object.keys(servers)) {
    killServer(key);
  }
  try {
    if (mobileTunnelProcess) {
      if (typeof mobileTunnelProcess.close === 'function') mobileTunnelProcess.close();
      else killProcessTree(mobileTunnelProcess);
      mobileTunnelProcess = null;
    }
  } catch (_) {}
  try {
    if (mobileHttpServer) mobileHttpServer.close();
    mobileHttpServer = null;
  } catch (_) {}
  saveMobileLinkState('', { status: 'inactive', stoppedAt: new Date().toISOString() });
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Ping a TCP port to check health Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function pingPort(port, path_ = '/health', timeoutMs = 4000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { req.destroy(); resolve(false); }, timeoutMs);
    const req = http.get({ hostname: '127.0.0.1', port, path: path_, agent: false }, (res) => {
      clearTimeout(timer);
      resolve(res.statusCode < 500);
    });
    req.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

function postJsonForBuffer(port, path_, payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload || {}), 'utf8');
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: path_,
      method: 'POST',
      agent: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        'Connection': 'close',
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers || {},
          buffer,
        });
      });
      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms.`));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function postJsonForBufferWithRecovery(port, path_, payload, timeoutMs = 120000, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await postJsonForBuffer(port, path_, payload, timeoutMs);
    } catch (error) {
      lastError = error;
      const transient = ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET'].includes(String(error?.code || ''))
        || /ECONNRESET|socket hang up|connection reset|fetch failed/i.test(String(error?.message || ''));
      if (!transient || attempt >= retries) break;
      // Give a restarting native worker time to reopen its health endpoint.
      let ready = false;
      for (let check = 0; check < 30; check += 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (await pingPort(port, '/health', 3000)) {
          ready = true;
          break;
        }
      }
      if (!ready) break;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  const friendly = new Error(`The local AI worker reset its connection and automatic recovery did not complete. Please retry once. (${lastError?.code || 'connection reset'})`);
  friendly.code = lastError?.code;
  throw friendly;
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Edge TTS health-check watchdog Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Pings port 8426 every 20 seconds. If unreachable, kills the process so
// the auto-restart watchdog in spawnManaged fires immediately.
let anjaliHealthTimer = null;
let anjaliHealthFailureCount = 0;

function startAnjaliWatchdog() {
  if (anjaliHealthTimer) clearInterval(anjaliHealthTimer);
  anjaliHealthTimer = setInterval(async () => {
    if (isQuitting) return;
    const alive = await pingPort(8426, '/health', 10000);
    if (alive) {
      anjaliHealthFailureCount = 0;
      return;
    }

    anjaliHealthFailureCount += 1;
    console.warn(`[PP] Voice server health-check miss ${anjaliHealthFailureCount}/5`);
    if (anjaliHealthFailureCount < 5) {
      return;  // allow 5 Ãƒâ€” 30s = 150 seconds before restart
    }
    anjaliHealthFailureCount = 0;

    if (!alive) {
      console.warn('[PP] Voice server health-check FAILED Ã¢â‚¬â€ forcing restart...');
      const entry = servers['AnjaliAI'];
      if (entry) {
        entry.stopped  = false;
        entry.restartCount = 0;
        if (entry.proc && !entry.proc.killed) {
          try {
            if (process.platform === 'win32') {
              spawn('taskkill', ['/PID', String(entry.proc.pid), '/T', '/F'], {
                detached: false,
                stdio: 'ignore',
                windowsHide: true,
              });
            } else {
              entry.proc.kill('SIGTERM');
            }
          } catch(_) {}
        } else {
          entry.lastRestartAt = 0;
          entry.restartCount  = 0;
          setTimeout(() => startAnjaliServer(), 1000);
        }
      }
      BrowserWindow.getAllWindows().forEach(w => {
        w.webContents.send('server-status', {
          server: 'anjali',
          status: 'restarting',
          message: 'Voice server went offline Ã¢â‚¬â€ restarting automatically...'
        });
      });
    }
  }, 30000); // ping every 30s; restart only after 5 consecutive misses = 150s grace
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Start individual servers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const PS = process.env.SYSTEMROOT
  ? path.join(process.env.SYSTEMROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const ANJALI_PYTHON = path.join(ROOT, '.voiceclone-venv', 'Scripts', 'python.exe');
const SINGING_PYTHON = path.join(ROOT, '.singing-venv', 'Scripts', 'python.exe');
const ANJALI_SERVER = path.join(ROOT, 'anjali-chatterbox-server.py');
const EDGE_TTS_SERVER = path.join(ROOT, 'timed-voiceover-server.py');
const SC3_SINGING_SERVER = path.join(ROOT, 'sc3-singing-server.py');
const WHISPER_PYTHON = path.join(ROOT, '.singing-venv', 'Scripts', 'python.exe');
const WHISPER_SCRIPT = path.join(ROOT, 'whisper-transcribe.py');
const IMAGEGEN_PYTHON = path.join(ROOT, '.imagegen-venv', 'Scripts', 'python.exe');
const IMAGEGEN_SERVER = path.join(ROOT, 'local-image-server.py');
const TRANSLATE_SERVER = path.join(ROOT, 'translate-server.py');
// PYTHONPATH lets system Python 3.12 find chatterbox/torch/edge_tts from the venv
const VENV_SITE_PACKAGES = path.join(ROOT, '.voiceclone-venv', 'Lib', 'site-packages');
const SINGING_SITE_PACKAGES = path.join(ROOT, '.singing-venv', 'Lib', 'site-packages');
const PYTHON_ENV = {
  PYTHONUTF8: '1',
  PYTHONUNBUFFERED: '1',
  PYTHONPATH: VENV_SITE_PACKAGES,
};
const SINGING_ENV = {
  PYTHONUTF8: '1',
  PYTHONUNBUFFERED: '1',
  PYTHONPATH: SINGING_SITE_PACKAGES + ';' + VENV_SITE_PACKAGES,
};

function isAnjaliServerProcessRunning() {
  return new Promise((resolve) => {
    const scriptNeedle = 'anjali-chatterbox-server.py';
    const command = [
      "Get-CimInstance Win32_Process",
      "| Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*" + scriptNeedle + "*' }",
      "| Select-Object -First 1 -ExpandProperty ProcessId"
    ].join(' ');
    execFile(PS, ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: ROOT,
      windowsHide: true,
      timeout: 5000,
    }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      resolve(/\d+/.test(String(stdout || '')));
    });
  });
}

function killAnjaliServerProcesses() {
  return new Promise((resolve) => {
    const scriptNeedle = 'anjali-chatterbox-server.py';
    const command = [
      "Get-CimInstance Win32_Process",
      "| Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*" + scriptNeedle + "*' }",
      "| ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }"
    ].join(' ');
    execFile(PS, ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: ROOT,
      windowsHide: true,
      timeout: 8000,
    }, () => resolve());
  });
}

async function waitForAnjaliHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingPort(8426, '/health', 2500)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return false;
}

async function startAnjaliServer() {
  const alive = await pingPort(8426, '/health', 5000);
  if (alive) {
    console.log('[PP] Voice server on 8426 is alive and warm — Electron will use it as-is.');
    if (!servers['AnjaliAI']) {
      servers['AnjaliAI'] = { proc: null, restartCount: 0, lastRestartAt: Date.now(), stopped: false };
    }
    return;
  }

  const alreadyStarting = await isAnjaliServerProcessRunning();
  if (alreadyStarting) {
    console.warn('[PP] Chatterbox Python process exists but 8426 is not healthy — waiting up to 6 min for model load.');
    if (!servers['AnjaliAI']) {
      servers['AnjaliAI'] = { proc: null, restartCount: 0, lastRestartAt: Date.now(), stopped: false };
    }
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('server-status', {
        server: 'anjali',
        status: 'starting',
        message: 'Chatterbox voice server loading (takes 3-5 min on first start)...'
      });
    });
    if (await waitForAnjaliHealth(360000)) {  // 6 minutes — model needs 3-5 min
      console.log('[PP] Chatterbox voice server became healthy on 8426.');
      return;
    }
    console.warn('[PP] Chatterbox process timed out — restarting.');
    await killAnjaliServerProcesses();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('[PP] Starting Chatterbox Python voice server...');
  spawnManaged('AnjaliAI', ANJALI_PYTHON, ['-u', ANJALI_SERVER], {
    cwd: ROOT,
    restartDelayMs: 5000,
    maxRestarts: 6,
    restartWindowSec: 900,
    showConsole: false,
    env: PYTHON_ENV,
  });
  BrowserWindow.getAllWindows().forEach(w => {
    w.webContents.send('server-status', {
      server: 'anjali',
      status: 'starting',
      message: 'Launching Chatterbox voice server on port 8426...'
    });
  });
}


function startServers() {
  // 1. Transcription server (port 8428)
  spawnManaged('TranscriptionServer', PS, [
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(ROOT, 'transcribe-server.ps1')
  ], { restartDelayMs: 2000 });

  // 2. Video Export / FFmpeg server (port 8430)
  spawnManaged('FFmpegServer', PS, [
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(ROOT, 'video-export-server.ps1')
  ], { restartDelayMs: 2000 });

  // 3. Chatterbox TTS server (port 8426) - sc3 cloned voice option
  startAnjaliServer();

  // 4. Edge TTS server (port 8427) - separate voice option, never a fallback
  spawnManaged('EdgeTTS', ANJALI_PYTHON, ['-u', EDGE_TTS_SERVER], {
    cwd: ROOT,
    restartDelayMs: 3000,
    maxRestarts: 4,
    restartWindowSec: 600,
    env: PYTHON_ENV,
  });

  // 5. SC3 singing model server (port 8431)
  if (fs.existsSync(SC3_SINGING_SERVER)) {
    spawnManaged('Sc3Singing', fs.existsSync(SINGING_PYTHON) ? SINGING_PYTHON : ANJALI_PYTHON, ['-u', SC3_SINGING_SERVER], {
      cwd: ROOT,
      restartDelayMs: 3000,
      maxRestarts: 4,
      restartWindowSec: 600,
      env: SINGING_ENV,
    });
  }

  // 6. Fully local AI image generator (CPU, model and cache on D drive)
  if (fs.existsSync(IMAGEGEN_PYTHON) && fs.existsSync(IMAGEGEN_SERVER)) {
    spawnManaged('ImageGenerator', IMAGEGEN_PYTHON, ['-u', IMAGEGEN_SERVER], {
      cwd: ROOT,
      restartDelayMs: 5000,
      maxRestarts: 4,
      restartWindowSec: 900,
      env: {
        ...process.env,
        PYTHONPATH: path.join(ROOT, '.imagegen-venv', 'Lib', 'site-packages'),
        HF_HOME: path.join(ROOT, 'AI_Models', 'imagegen', 'hf-home'),
        HUGGINGFACE_HUB_CACHE: path.join(ROOT, 'AI_Models', 'imagegen', 'hub'),
      },
    });
  }

  // 7. Caption/audio translation service (port 8434)
  if (fs.existsSync(TRANSLATE_SERVER)) {
    spawnManaged('TranslationServer', ANJALI_PYTHON, ['-u', TRANSLATE_SERVER], {
      cwd: ROOT,
      restartDelayMs: 3000,
      maxRestarts: 4,
      restartWindowSec: 600,
      env: PYTHON_ENV,
    });
  } else {
    console.error('[PP] Translation server is missing:', TRANSLATE_SERVER);
  }

  if (IS_DEV) {
    spawnManaged('ViteDevServer', NPM, ['run', 'dev'], { cwd: ROOT, restartDelayMs: 3000 });
  }
  setTimeout(startAnjaliWatchdog, 180000);
}

// Free stale server ports before launch (8426 and 8431 excluded - ML servers stay alive)
function freeServerPorts() {
  return new Promise((resolve) => {
    const ports = IS_DEV ? [5173, 8424, 8428, 8430, 8432, 8434] : [8424, 8428, 8430, 8432, 8434];
    const psLines = [
      '$myPid = ' + process.pid,
      '$ports = @(' + ports.join(',') + ')',
      'foreach ($port in $ports) {',
      '  $netLines = netstat -ano 2>$null | Select-String (":" + $port + " ")',
      '  foreach ($l in $netLines) {',
      '    if ($l -match "\\s(\\d+)\\s*$") {',
      '      $pid2 = [int]$Matches[1]',
      '      if ($pid2 -ne 0 -and $pid2 -ne $myPid) { taskkill /F /PID $pid2 2>$null | Out-Null }',
      '    }',
      '  }',
      '}',
    ].join('; ');
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve();
    };
    const child = spawn(PS, ['-NoProfile', '-NonInteractive', '-Command', psLines], {
      detached: false, stdio: 'ignore', windowsHide: true,
    });
    child.on('exit', finish);
    child.on('error', finish);
    const timeoutId = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      finish();
    }, 6000);
  });
}


// ————————————— Wait for Vite to be ready ————————————————————————————————————————
function waitForVite(url, retries = 60, delayMs = 500) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      http.get(url, (res) => {
        if (res.statusCode < 500) return resolve();
        retry();
      }).on('error', retry);
    };
    const retry = () => {
      tries++;
      if (tries >= retries) return reject(new Error(`Vite not ready after ${retries} tries`));
      setTimeout(attempt, delayMs);
    };
    attempt();
  });
}

// ————————————— Create the main window —————————————————————————————————————————————
async function createWindow() {
  const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width,
    height,
    minWidth:  1100,
    minHeight: 700,
    title:     'Pattan Presentator',
    icon:      path.join(ROOT, 'pattan-presentator.ico'),
    backgroundColor: '#0f172a',
    show:      false,
    autoHideMenuBar: true,
    webPreferences: {
      preload:          path.join(ROOT, 'preload.cjs'),
      nodeIntegration:  false,
      contextIsolation: true,
      webSecurity:      false,
      backgroundThrottling: false,
      v8CacheOptions:   'code',
      enableBlinkFeatures: 'OffscreenCanvas,SharedArrayBuffer',
      additionalArguments: ['--js-flags=--max-old-space-size=3072', '--enable-features=SharedArrayBuffer']
    }
  });

  const template = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', accelerator: 'F5' },
        { role: 'reload', accelerator: 'CmdOrCtrl+R' },
        { role: 'forceReload', accelerator: 'CmdOrCtrl+Shift+R' },
        { role: 'toggleDevTools', accelerator: 'F12' },
        { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
    win.setTitle('Pattan Presentator — AI Teaching Studio');
  });

  // ── Permanently inject HF API token into renderer localStorage ──────────
  // Token is stored in .hf_token (gitignored) so it never goes to GitHub
  win.webContents.on('did-finish-load', () => {
    try {
      const tokenPath = path.join(ROOT, '.hf_token');
      const hfToken   = fs.existsSync(tokenPath) ? fs.readFileSync(tokenPath, 'utf8').trim() : '';
      if (hfToken) {
        win.webContents.executeJavaScript(
          `localStorage.setItem('cb_hf_token', ${JSON.stringify(hfToken)});`
        ).catch(() => {});
      }
    } catch {}
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (IS_DEV) {
    await waitForVite(VITE_URL).catch(() => console.warn('[PP] Vite timeout — loading anyway'));
    win.loadURL(VITE_URL);
  } else {
    // Use app:// protocol so absolute paths like /script.js resolve correctly.
    // loadFile() uses file:// which breaks absolute-path script loading.
    const hasRendererDist = fs.existsSync(path.join(ROOT, 'renderer-dist', 'index.html'));
    const htmlPath = hasRendererDist ? 'renderer-dist/index.html' : 'dist/index.html';
    win.loadURL('app://voice/' + htmlPath);
  }

  // ————————————— IPC: Synchronous Groq API Key retrieval —————————————————————————
  ipcMain.on('get-groq-api-key', (event) => {
    event.returnValue = process.env.GROQ_API_KEY || '';
  });

  // ————————————— IPC: Native OS Notification —————————————————————————————————————
  ipcMain.handle('show-notification', async (_, { title, body }) => {
    try {
      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
      processAlertFromNotification(title, body);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ————————————— IPC: Native Save File Dialog ————————————————————————————————————
  ipcMain.handle('show-save-dialog', async (_, options) => {
    let defaultPath = options.defaultPath;
    if (defaultPath) {
      if (!path.isAbsolute(defaultPath)) {
        defaultPath = path.join(os.homedir(), 'Desktop', defaultPath);
      }
    } else {
      defaultPath = path.join(os.homedir(), 'Desktop', options.fileName || 'output.mp4');
    }
    const result = await dialog.showSaveDialog(win, {
      title:       options.title       || 'Save File',
      defaultPath: defaultPath,
      filters:     options.filters     || [{ name: 'MP4 Video', extensions: ['mp4'] }],
      buttonLabel: options.buttonLabel || 'Save'
    });
    return result;
  });

  // ————————————— IPC: Write file natively ————————————————————————————————————————
  ipcMain.handle('write-file', async (_, { filePath, base64Data }) => {
    try {
      const buf = Buffer.from(base64Data, 'base64');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buf);
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ————————————— IPC: Open folder in Explorer ————————————————————————————————————
  ipcMain.handle('show-item-in-folder', (_, filePath) => {
    shell.showItemInFolder(filePath);
  });

  // ————————————— IPC: System info ————————————————————————————————————————————————
  ipcMain.handle('get-system-info', () => ({
    totalRam:   Math.round(os.totalmem()  / 1024 / 1024 / 1024 * 10) / 10,
    freeRam:    Math.round(os.freemem()   / 1024 / 1024 / 1024 * 10) / 10,
    cpus:       os.cpus().length,
    platform:   process.platform,
    appVersion: app.getVersion()
  }));
  ipcMain.handle('get-app-root', () => ROOT);

  ipcMain.handle('presentator-agent-think', async (event, payload) => {
    try {
      const directRequest = String(payload?.userRequest || '');
      const directImageRequest =
        /\b(create|generate|make|draw|design|produce|render)\b/i.test(directRequest)
        && /\b(images?|pictures?|photos?|illustrations?|artworks?|posters?|wallpapers?|renders?)\b/i.test(directRequest)
        && !/\b(video|animate|animation|mp4)\b/i.test(directRequest);
      if (directImageRequest) {
        return {
          ok: true,
          model: 'direct-image-router',
          reasoningProfile: 'direct image',
          result: {
            message: 'Starting image generation immediately.',
            thinking: 'Planner bypassed for a direct image request.',
            plan: ['Generate the requested image', 'Upscale and save the result'],
            actions: [{
              tool: 'generate_image',
              args: {
                prompt: `${directRequest}. Ultra-detailed cinematic 3D render, physically based materials, professional lighting, sharp focus`,
                negativePrompt: 'blurry, pixelated, distorted, malformed, low quality, watermark, text, logo',
                seed: 0,
              },
              reason: 'Direct image request; bypass the planning loop.',
            }],
            done: true,
          },
        };
      }
      return await callPresentatorAgent(payload, progress => {
        try { event.sender.send('presentator-agent-progress', progress); } catch (_) {}
      }, controller => activeAgentControllers.set(event.sender.id, controller));
    } catch (error) {
      console.error('[PresentatorAgent] Reasoning failed:', error.message);
      return { ok: false, cancelled: error?.name === 'AbortError', error: error?.name === 'AbortError' ? 'Agent run cancelled.' : error.message };
    } finally {
      activeAgentControllers.delete(event.sender.id);
    }
  });

  ipcMain.handle('presentator-agent-cancel', event => {
    const controller = activeAgentControllers.get(event.sender.id);
    if (!controller) return { ok: true, cancelled: false };
    controller.abort();
    activeAgentControllers.delete(event.sender.id);
    return { ok: true, cancelled: true };
  });

  ipcMain.handle('presentator-agent-stop-process', event => {
    let cancelledPlanner = false;
    const controller = activeAgentControllers.get(event.sender.id);
    if (controller) {
      controller.abort();
      activeAgentControllers.delete(event.sender.id);
      cancelledPlanner = true;
    }
    // Image generation is a blocking native/Python operation. Restarting its
    // managed worker is the only immediate, reliable cancellation mechanism.
    if (activeImageGenerationRequests > 0 && servers.ImageGenerator) restartServer('ImageGenerator');
    const hermesProcess = activeHermesProcesses.get(event.sender.id);
    if (hermesProcess) {
      killProcessTree(hermesProcess);
      activeHermesProcesses.delete(event.sender.id);
    }
    return { ok: true, cancelledPlanner, hermesStopped: Boolean(hermesProcess), imageGeneratorStopped: activeImageGenerationRequests > 0 };
  });

  ipcMain.handle('presentator-agent-hermes-status', async () => new Promise(resolve => {
    execFile('wsl.exe', ['--status'], { windowsHide: true, timeout: 10000 }, error => {
      if (error) return resolve({ ok: false, needsWsl: true, error: 'Hermes requires WSL2 on this Windows computer.' });
      execFile('wsl.exe', ['bash', '-lc', 'command -v hermes && hermes --version'], { windowsHide: true, timeout: 15000 }, (hermesError, stdout) => {
        if (hermesError) return resolve({ ok: false, needsHermes: true, error: 'WSL2 is ready, but Hermes Agent is not installed inside it.' });
        resolve({ ok: true, version: String(stdout || '').trim().split(/\r?\n/).pop() || 'ready' });
      });
    });
  }));

  ipcMain.handle('presentator-agent-hermes-improve', async (event, payload) => {
    if (activeHermesProcesses.has(event.sender.id)) return { ok: false, error: 'Hermes improvement is already running.' };
    const objective = String(payload?.objective || '').trim().slice(0, 4000);
    const prompt = [
      'You are the controlled improvement reviewer for Pattan Presentator Super Agent.',
      'Work only inside /mnt/d/voice. Inspect the current implementation before editing.',
      'Improve reliability, reasoning, recovery, observability, or test coverage for the objective below.',
      'Preserve existing user features and files. Never delete files. Use filesystem checkpoints.',
      'Run relevant checks after edits. Return a concise report of files changed and verification.',
      `Objective: ${objective || 'Audit and safely improve the Super Agent module.'}`,
    ].join('\n');
    return new Promise(resolve => {
      const child = spawn('wsl.exe', [
        '--cd', '/mnt/d/voice',
        'hermes', 'chat', '--quiet', '--checkpoints',
        '--toolsets', 'terminal,skills',
        '--query', prompt,
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      activeHermesProcesses.set(event.sender.id, child);
      let output = '';
      const collect = data => {
        output += data.toString();
        if (output.length > 120000) output = output.slice(-120000);
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.on('error', error => {
        activeHermesProcesses.delete(event.sender.id);
        resolve({ ok: false, error: error.message });
      });
      child.on('exit', code => {
        activeHermesProcesses.delete(event.sender.id);
        resolve(code === 0
          ? { ok: true, report: output.trim() || 'Hermes completed its controlled improvement review.' }
          : { ok: false, error: `Hermes exited with code ${code}. ${output.trim().slice(-1600)}` });
      });
    });
  });

  ipcMain.handle('presentator-agent-restart-server', async (_event, serverName) => {
    const serverMap = {
      anjali: 'AnjaliAI',
      edgeTts: 'EdgeTTS',
      transcribe: 'TranscriptionServer',
      videoExport: 'FFmpegServer',
      sc3Singing: 'Sc3Singing',
      imageGenerator: 'ImageGenerator',
    };
    const key = serverMap[String(serverName || '')];
    if (!key) return { ok: false, error: 'Unknown or unsafe server name.' };
    if (!servers[key]) return { ok: false, error: `${serverName} is not configured.` };
    restartServer(key);
    return { ok: true, server: serverName, status: 'restarting' };
  });

  ipcMain.handle('presentator-agent-read-diagnostics', () => {
    const candidates = [
      path.join(ROOT, 'logs', 'presentation-mux-debug.log'),
      path.join(CAPTION_WORK_ROOT, 'logs', 'caption-burn.log'),
      path.join(ROOT, 'classic-export-log.txt'),
      path.join(ROOT, 'intro-only-export-log.txt'),
    ];
    const logs = [];
    for (const filePath of candidates) {
      try {
        if (!fs.existsSync(filePath)) continue;
        const text = fs.readFileSync(filePath, 'utf8');
        logs.push({
          name: path.basename(filePath),
          modifiedAt: fs.statSync(filePath).mtime.toISOString(),
          tail: text.slice(-8000),
        });
      } catch (error) {
        logs.push({ name: path.basename(filePath), error: error.message });
      }
    }
    return { ok: true, logs };
  });

  ipcMain.handle('presentator-agent-load-data', () => {
    const dataPath = path.join(app.getPath('userData'), 'super-agent-data.json');
    try {
      if (!fs.existsSync(dataPath)) {
        return { ok: true, data: { preferences: {}, recoveryHistory: [] } };
      }
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      return {
        ok: true,
        data: {
          preferences: data?.preferences || {},
          recoveryHistory: Array.isArray(data?.recoveryHistory)
            ? data.recoveryHistory.slice(-100)
            : [],
          projectMemory: data?.projectMemory && typeof data.projectMemory === 'object' ? data.projectMemory : {},
          workHistory: Array.isArray(data?.workHistory) ? data.workHistory.slice(-100) : [],
        },
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('presentator-agent-import-reference', async (_event, request) => {
    const filePath = path.resolve(String(request?.filePath || ''));
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return { ok: false, error: 'The selected reference file is unavailable.' };
    }
    const extension = path.extname(filePath).toLowerCase();
    const name = path.basename(filePath);
    const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
    const videoExtensions = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi']);
    const documentExtensions = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.json', '.log', '.srt']);

    try {
      if (imageExtensions.has(extension)) {
        const bytes = fs.readFileSync(filePath);
        if (bytes.length > 20 * 1024 * 1024) throw new Error('Reference images must be under 20 MB.');
        const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
        const referenceImageDir = path.join(ROOT, 'generated-media', 'references', 'images');
        fs.mkdirSync(referenceImageDir, { recursive: true });
        const safeReferenceName = `${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const localReferencePath = path.join(referenceImageDir, safeReferenceName);
        fs.copyFileSync(filePath, localReferencePath);
        return {
          ok: true,
          reference: {
            id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            kind: 'image',
            filePath: localReferencePath,
            mimeType: mime,
            imageBase64: bytes.toString('base64'),
            sizeBytes: bytes.length,
          },
        };
      }

      if (videoExtensions.has(extension)) {
        const referenceDir = path.join(ROOT, 'generated-media', 'references', `video-${Date.now()}`);
        fs.mkdirSync(referenceDir, { recursive: true });
        const ffmpeg = findFFmpegExecutable();
        const ffprobe = ffmpeg.toLowerCase().endsWith('ffmpeg.exe')
          ? ffmpeg.slice(0, -'ffmpeg.exe'.length) + 'ffprobe.exe'
          : 'ffprobe';
        const duration = await new Promise((resolve) => {
          execFile(ffprobe, [
            '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
          ], { windowsHide: true, timeout: 30000 }, (error, stdout) => {
            resolve(error ? 0 : Number(String(stdout || '').trim()) || 0);
          });
        });
        const positions = duration > 3
          ? [1, Math.max(1, duration / 2), Math.max(1, duration - 1)]
          : [0, Math.max(0, duration / 2)];
        const frames = [];
        for (let index = 0; index < positions.length; index += 1) {
          const framePath = path.join(referenceDir, `frame-${index + 1}.jpg`);
          await new Promise((resolve, reject) => {
            execFile(ffmpeg, [
              '-y', '-ss', String(positions[index]), '-i', filePath,
              '-frames:v', '1', '-vf', 'scale=768:-2', '-q:v', '3', framePath,
            ], { windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
            (error, _stdout, stderr) => {
              if (error) reject(new Error(String(stderr || error.message).slice(-800)));
              else resolve();
            });
          });
          frames.push(fs.readFileSync(framePath).toString('base64'));
        }
        return {
          ok: true,
          reference: {
            id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            kind: 'video',
            filePath,
            durationSeconds: Math.round(duration * 100) / 100,
            frames,
            summary: `Video reference, ${duration.toFixed(1)} seconds, ${frames.length} sampled frames.`,
          },
        };
      }

      if (documentExtensions.has(extension)) {
        const extractor = path.join(ROOT, 'agent-reference-extractor.py');
        const python = IMAGEGEN_PYTHON;
        const extracted = await new Promise((resolve, reject) => {
          execFile(python, [extractor, filePath], {
            cwd: ROOT,
            windowsHide: true,
            timeout: 120000,
            maxBuffer: 2 * 1024 * 1024,
            env: {
              ...process.env,
              PYTHONPATH: path.join(ROOT, '.imagegen-venv', 'Lib', 'site-packages'),
            },
          }, (error, stdout, stderr) => {
            try {
              const parsed = JSON.parse(String(stdout || '').trim());
              if (!parsed.ok) reject(new Error(parsed.error || 'Document extraction failed.'));
              else resolve(parsed);
            } catch (_) {
              reject(new Error(String(stderr || error?.message || 'Document extraction failed.').slice(-1000)));
            }
          });
        });
        return {
          ok: true,
          reference: {
            id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            filePath,
            ...extracted,
          },
        };
      }
      return { ok: false, error: `Unsupported reference type: ${extension || 'unknown'}` };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('presentator-agent-save-data', (_event, data) => {
    const dataPath = path.join(app.getPath('userData'), 'super-agent-data.json');
    const tempPath = `${dataPath}.tmp`;
    try {
      const safeData = {
        preferences: data?.preferences && typeof data.preferences === 'object'
          ? data.preferences
          : {},
        recoveryHistory: Array.isArray(data?.recoveryHistory)
          ? data.recoveryHistory.slice(-100)
          : [],
        projectMemory: data?.projectMemory && typeof data.projectMemory === 'object'
          ? data.projectMemory
          : {},
        workHistory: Array.isArray(data?.workHistory) ? data.workHistory.slice(-100) : [],
      };
      fs.writeFileSync(tempPath, JSON.stringify(safeData, null, 2), 'utf8');
      fs.renameSync(tempPath, dataPath);
      return { ok: true };
    } catch (error) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
      return { ok: false, error: error.message };
    }
  });

  const createAgentCheckpoint = (filePath, reason) => {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    const checkpointRoot = path.join(app.getPath('userData'), 'super-agent-checkpoints');
    fs.mkdirSync(checkpointRoot, { recursive: true });
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const checkpointPath = path.join(checkpointRoot, `${id}.bak`);
    const metadataPath = path.join(checkpointRoot, `${id}.json`);
    fs.copyFileSync(filePath, checkpointPath);
    fs.writeFileSync(metadataPath, JSON.stringify({ id, filePath, checkpointPath, reason: String(reason || ''), createdAt: Date.now() }, null, 2), 'utf8');
    return { id, filePath, reason: String(reason || ''), createdAt: Date.now() };
  };

  ipcMain.handle('presentator-agent-list-checkpoints', () => {
    try {
      const checkpointRoot = path.join(app.getPath('userData'), 'super-agent-checkpoints');
      if (!fs.existsSync(checkpointRoot)) return { ok: true, checkpoints: [] };
      const checkpoints = fs.readdirSync(checkpointRoot)
        .filter(name => name.endsWith('.json'))
        .map(name => JSON.parse(fs.readFileSync(path.join(checkpointRoot, name), 'utf8')))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 100)
        .map(({ checkpointPath, ...item }) => item);
      return { ok: true, checkpoints };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('presentator-agent-restore-checkpoint', (_event, request) => {
    try {
      const id = String(request?.id || '').replace(/[^a-zA-Z0-9-]/g, '');
      if (!id) throw new Error('A checkpoint id is required.');
      const checkpointRoot = path.join(app.getPath('userData'), 'super-agent-checkpoints');
      const metadata = JSON.parse(fs.readFileSync(path.join(checkpointRoot, `${id}.json`), 'utf8'));
      if (!fs.existsSync(metadata.checkpointPath)) throw new Error('Checkpoint content is missing.');
      if (!String(metadata.filePath).toLowerCase().startsWith(ROOT.toLowerCase())) throw new Error('Checkpoint target is outside the project.');
      const safetyCheckpoint = createAgentCheckpoint(metadata.filePath, `Before restoring checkpoint ${id}`);
      fs.copyFileSync(metadata.checkpointPath, metadata.filePath);
      return { ok: true, restored: metadata.filePath, safetyCheckpoint };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('presentator-agent-validate-web-app', async (_event, request) => {
    let testWindow = null;
    try {
      const target = String(request?.target || '').trim();
      if (!target) throw new Error('A local HTML path or localhost URL is required.');
      const isUrl = /^https?:\/\//i.test(target);
      if (isUrl && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(?:\/|$)/i.test(target)) {
        throw new Error('Browser validation is limited to local project files and localhost URLs.');
      }
      const filePath = isUrl ? '' : path.resolve(target);
      if (!isUrl && (!filePath.toLowerCase().startsWith(ROOT.toLowerCase()) || !fs.existsSync(filePath))) {
        throw new Error('The validation file must exist inside the Presentator project.');
      }

      const consoleMessages = [];
      const loadFailures = [];
      testWindow = new BrowserWindow({
        show: false,
        width: 1440,
        height: 900,
        backgroundColor: '#ffffff',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      testWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        if (level >= 2) consoleMessages.push({ level, message: String(message).slice(0, 1000), line, sourceId: String(sourceId || '').slice(0, 300) });
      });
      testWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        loadFailures.push({ errorCode, errorDescription, url: validatedUrl, isMainFrame });
      });

      if (isUrl) await testWindow.loadURL(target);
      else await testWindow.loadFile(filePath);
      const initialWait = Math.max(250, Math.min(10000, Number(request?.waitMs) || 1200));
      await new Promise(resolve => setTimeout(resolve, initialWait));

      const interactions = Array.isArray(request?.interactions) ? request.interactions.slice(0, 20) : [];
      const interactionResults = [];
      for (const interaction of interactions) {
        const selector = String(interaction?.selector || '');
        const action = String(interaction?.action || 'click');
        const value = String(interaction?.value || '');
        if (!selector || selector.length > 300) {
          interactionResults.push({ ok: false, selector, error: 'Invalid selector.' });
          continue;
        }
        const result = await testWindow.webContents.executeJavaScript(`(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!element) return { ok: false, error: 'Element not found' };
          const action = ${JSON.stringify(action)};
          if (action === 'click') element.click();
          else if (action === 'type') {
            element.focus();
            element.value = ${JSON.stringify(value)};
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          } else return { ok: false, error: 'Unsupported interaction action' };
          return { ok: true, tag: element.tagName, text: String(element.textContent || '').trim().slice(0, 120) };
        })()`, true);
        interactionResults.push({ selector, action, ...result });
        await new Promise(resolve => setTimeout(resolve, 250));
      }

      const inspection = await testWindow.webContents.executeJavaScript(`(() => {
        const interactive = [...document.querySelectorAll('button,a,input,select,textarea,[role="button"]')];
        const unlabeled = interactive.filter(el => {
          const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder');
          return !String(label || '').trim();
        });
        return {
          title: document.title,
          textPreview: String(document.body?.innerText || '').trim().slice(0, 3000),
          interactiveCount: interactive.length,
          unlabeledInteractiveCount: unlabeled.length,
          imageCount: document.images.length,
          brokenImages: [...document.images].filter(img => !img.complete || img.naturalWidth === 0).map(img => img.src).slice(0, 20),
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          viewport: { width: innerWidth, height: innerHeight },
        };
      })()`, true);
      const screenshot = await testWindow.webContents.capturePage();
      const screenshotDir = path.join(ROOT, 'generated-media', 'agent-validation');
      fs.mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, `validation-${Date.now()}.png`);
      fs.writeFileSync(screenshotPath, screenshot.toPNG());
      return {
        ok: loadFailures.filter(item => item.isMainFrame).length === 0 && consoleMessages.length === 0 && inspection.brokenImages.length === 0,
        target: isUrl ? target : path.relative(ROOT, filePath).replace(/\\/g, '/'),
        screenshotPath,
        screenshotBase64: screenshot.toPNG().toString('base64'),
        consoleMessages,
        loadFailures,
        interactions: interactionResults,
        inspection,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      if (testWindow && !testWindow.isDestroyed()) testWindow.destroy();
    }
  });

  const resolveAgentSourcePath = (relativeFile) => {
    const relative = String(relativeFile || '').replace(/\\/g, '/');
    if (!relative || relative.includes('\0') || path.isAbsolute(relative)) {
      throw new Error('A safe relative source path is required.');
    }
    const resolved = path.resolve(ROOT, relative);
    const rootPrefix = `${path.resolve(ROOT)}${path.sep}`.toLowerCase();
    const normalized = resolved.toLowerCase();
    const isRootFile = normalized === path.join(ROOT, 'main.cjs').toLowerCase()
      || normalized === path.join(ROOT, 'preload.cjs').toLowerCase();
    const isSourceFile = normalized.startsWith(
      `${path.join(ROOT, 'src')}${path.sep}`.toLowerCase()
    );
    const allowedExtension = ['.js', '.jsx', '.cjs', '.ts', '.tsx'].includes(
      path.extname(resolved).toLowerCase()
    );
    if ((!isRootFile && !isSourceFile) || !allowedExtension || !normalized.startsWith(rootPrefix)) {
      throw new Error('The agent may patch only main.cjs, preload.cjs, or source files under src/.');
    }
    return resolved;
  };

  ipcMain.handle('presentator-agent-inspect-code', (_event, request) => {
    try {
      const filePath = resolveAgentSourcePath(request?.file);
      if (!fs.existsSync(filePath)) throw new Error('Source file does not exist.');
      const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
      const start = Math.max(1, Math.min(lines.length, Number(request?.startLine) || 1));
      const end = Math.max(start, Math.min(lines.length, Number(request?.endLine) || start + 199));
      if (end - start > 399) throw new Error('Inspect at most 400 lines at a time.');
      return {
        ok: true,
        file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
        startLine: start,
        endLine: end,
        totalLines: lines.length,
        content: lines
          .slice(start - 1, end)
          .map((line, index) => `${start + index}: ${line}`)
          .join('\n'),
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('presentator-agent-apply-patch', async (_event, request) => {
    let filePath = '';
    let original = '';
    try {
      filePath = resolveAgentSourcePath(request?.file);
      const expected = String(request?.expected || '');
      const replacement = String(request?.replacement ?? '');
      if (!expected || expected.length > 50000 || replacement.length > 50000) {
        throw new Error('Patch fragments must be non-empty and under 50,000 characters.');
      }
      original = fs.readFileSync(filePath, 'utf8');
      const checkpoint = createAgentCheckpoint(filePath, request?.reason || 'Before agent patch');
      const first = original.indexOf(expected);
      if (first < 0) throw new Error('Expected source fragment was not found exactly.');
      if (original.indexOf(expected, first + expected.length) >= 0) {
        throw new Error('Expected source fragment is ambiguous; inspect a larger unique section.');
      }

      const patched = `${original.slice(0, first)}${replacement}${original.slice(first + expected.length)}`;
      fs.writeFileSync(filePath, patched, 'utf8');

      const validation = await new Promise((resolve) => {
        const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const child = execFile(
          npmCommand,
          ['run', 'build:react'],
          { cwd: ROOT, windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
          (error, stdout, stderr) => resolve({
            ok: !error,
            error: error?.message || '',
            output: `${stdout || ''}\n${stderr || ''}`.slice(-12000),
          })
        );
        child.on('error', error => resolve({ ok: false, error: error.message, output: '' }));
      });

      if (!validation.ok) {
        fs.writeFileSync(filePath, original, 'utf8');
        return {
          ok: false,
          rolledBack: true,
          error: `Build validation failed; patch was rolled back. ${validation.error}`,
          validationOutput: validation.output,
        };
      }
      return {
        ok: true,
        checkpoint,
        file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
        reason: String(request?.reason || ''),
        buildValidated: true,
        validationOutput: validation.output.slice(-3000),
        restartRequired: ['main.cjs', 'preload.cjs'].includes(path.basename(filePath))
          || filePath.toLowerCase().includes(`${path.sep}src${path.sep}`),
      };
    } catch (error) {
      if (filePath && original) {
        try { fs.writeFileSync(filePath, original, 'utf8'); } catch (_) {}
      }
      return { ok: false, rolledBack: Boolean(original), error: error.message };
    }
  });

  ipcMain.handle('presentator-agent-restart-app', () => {
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 750);
    return { ok: true, status: 'restarting' };
  });

  // ─── Super Agent: list_files ────────────────────────────────────────────────
  ipcMain.handle('presentator-agent-list-files', (_event, request) => {
    try {
      const dir = path.resolve(String(request?.directory || ROOT));
      if (!dir.toLowerCase().startsWith(ROOT.toLowerCase())) {
        return { ok: false, error: 'Directory must be inside the project root.' };
      }
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return { ok: false, error: `Directory not found: ${dir}` };
      }
      const walkDir = (current, depth = 0) => {
        if (depth > 6) return [];
        const entries = [];
        for (const name of fs.readdirSync(current)) {
          if (name.startsWith('.') || name === 'node_modules') continue;
          const fullPath = path.join(current, name);
          try {
            const stat = fs.statSync(fullPath);
            const relative = path.relative(ROOT, fullPath).replace(/\\/g, '/');
            if (stat.isDirectory()) {
              entries.push({ type: 'dir', path: relative, name });
              entries.push(...walkDir(fullPath, depth + 1));
            } else {
              entries.push({ type: 'file', path: relative, name, size: stat.size });
            }
          } catch (_) {}
        }
        return entries;
      };
      return { ok: true, directory: path.relative(ROOT, dir).replace(/\\/g, '/') || '.', entries: walkDir(dir) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  // ─── Super Agent: read_file ─────────────────────────────────────────────────
  ipcMain.handle('presentator-agent-read-file', (_event, request) => {
    try {
      let filePath = path.resolve(String(request?.file || ''));
      if (!filePath.toLowerCase().startsWith(ROOT.toLowerCase())) {
        return { ok: false, error: 'File must be inside the project root.' };
      }
      if (!fs.existsSync(filePath)) return { ok: false, error: `File not found: ${filePath}` };
      if (!fs.statSync(filePath).isFile()) return { ok: false, error: 'Path is not a file.' };
      const ext = path.extname(filePath).toLowerCase();
      const textExts = new Set(['.js', '.jsx', '.ts', '.tsx', '.cjs', '.mjs', '.css', '.json',
        '.md', '.txt', '.log', '.py', '.html', '.srt', '.csv', '.env', '.sh', '.bat', '.ps1']);
      if (!textExts.has(ext)) return { ok: false, error: `Cannot read binary or unsupported file type: ${ext}` };
      const allLines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
      const start = Math.max(1, Number(request?.startLine) || 1);
      const end = Math.min(allLines.length, Number(request?.endLine) || Math.min(allLines.length, start + 599));
      if (end - start > 599) return { ok: false, error: 'Read at most 600 lines at a time.' };
      const content = allLines.slice(start - 1, end)
        .map((line, i) => `${start + i}: ${line}`)
        .join('\n');
      return {
        ok: true,
        file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
        totalLines: allLines.length,
        startLine: start,
        endLine: end,
        content,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  // ─── Super Agent: write_file ────────────────────────────────────────────────
  ipcMain.handle('presentator-agent-write-file', (_event, request) => {
    try {
      const filePath = path.resolve(String(request?.file || ''));
      if (!filePath.toLowerCase().startsWith(ROOT.toLowerCase())) {
        return { ok: false, error: 'File must be inside the project root.' };
      }
      const content = String(request?.content ?? '');
      if (content.length > 500000) return { ok: false, error: 'Content too large (max 500 KB).' };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const existed = fs.existsSync(filePath);
      const checkpoint = existed ? createAgentCheckpoint(filePath, request?.reason || 'Before agent overwrite') : null;
      fs.writeFileSync(filePath, content, 'utf8');
      return {
        ok: true,
        file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
        action: existed ? 'overwritten' : 'created',
        checkpoint,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  // ─── Super Agent: run_terminal_command ──────────────────────────────────────
  ipcMain.handle('presentator-agent-run-command', async (_event, request) => {
    const command = String(request?.command || '').trim();
    if (!command) return { ok: false, error: 'No command provided.' };
    // Safety filter — block destructive operations
    const blocked = [/taskkill/i, /rm\s+-r/i, /Remove-Item.*-Recurse/i, /format\s+[a-z]:/i,
      /del\s+\/[fqs]/i, /shutdown/i, /reg\s+delete/i, /net\s+user/i, /icacls/i];
    if (blocked.some(pattern => pattern.test(command))) {
      return { ok: false, error: 'Command blocked for safety: destructive operations are not permitted.' };
    }
    return new Promise(resolve => {
      execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { cwd: ROOT, windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
        (error, stdout, stderr) => {
          resolve({
            ok: !error || error.code === 0,
            command,
            stdout: String(stdout || '').slice(0, 8000),
            stderr: String(stderr || '').slice(0, 2000),
            exitCode: error?.code ?? 0,
          });
        }
      );
    });
  });

  // ─── Super Agent: search_in_files ───────────────────────────────────────────
  ipcMain.handle('presentator-agent-search-files', (_event, request) => {
    try {
      const pattern = String(request?.pattern || '').trim();
      if (!pattern || pattern.length < 2) return { ok: false, error: 'Search pattern must be at least 2 characters.' };
      const searchDir = path.resolve(String(request?.directory || path.join(ROOT, 'src')));
      if (!searchDir.toLowerCase().startsWith(ROOT.toLowerCase())) {
        return { ok: false, error: 'Search directory must be inside the project root.' };
      }
      const exts = new Set(['.js', '.jsx', '.ts', '.tsx', '.cjs', '.css', '.py', '.json', '.md', '.txt']);
      const matches = [];
      const walkSearch = (dir, depth = 0) => {
        if (depth > 8 || matches.length > 200) return;
        for (const name of fs.readdirSync(dir)) {
          if (name.startsWith('.') || name === 'node_modules') continue;
          const full = path.join(dir, name);
          try {
            const stat = fs.statSync(full);
            if (stat.isDirectory()) { walkSearch(full, depth + 1); continue; }
            if (!exts.has(path.extname(name).toLowerCase())) continue;
            const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
            const lowerPattern = pattern.toLowerCase();
            lines.forEach((line, idx) => {
              if (line.toLowerCase().includes(lowerPattern)) {
                matches.push({
                  file: path.relative(ROOT, full).replace(/\\/g, '/'),
                  line: idx + 1,
                  content: line.trim().slice(0, 200),
                });
              }
            });
          } catch (_) {}
        }
      };
      walkSearch(searchDir);
      return { ok: true, pattern, matchCount: matches.length, matches: matches.slice(0, 150) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  // ─── Super Agent: analyze_code ──────────────────────────────────────────────
  ipcMain.handle('presentator-agent-analyze-code', (_event, request) => {
    try {
      const filePath = path.resolve(String(request?.file || ''));
      if (!filePath.toLowerCase().startsWith(ROOT.toLowerCase())) {
        return { ok: false, error: 'File must be inside the project root.' };
      }
      if (!fs.existsSync(filePath)) return { ok: false, error: `File not found: ${filePath}` };
      const src = fs.readFileSync(filePath, 'utf8');
      const lines = src.split(/\r?\n/);
      const totalLines = lines.length;

      // Function detection (named functions, arrow functions, methods)
      const funcPattern = /(?:^|\s)(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(|(\w+)\s*(?::\s*(?:async\s+)?\(.*?\)\s*=>|\s*\(.*?\)\s*\{)/gm;
      const functions = [];
      let match;
      while ((match = funcPattern.exec(src)) !== null) {
        const name = match[1] || match[2] || match[3];
        if (name && !['if', 'for', 'while', 'switch', 'catch'].includes(name)) {
          const lineNum = src.slice(0, match.index).split('\n').length;
          functions.push({ name, line: lineNum });
        }
      }

      // Large function detection
      const largeFunctions = [];
      const arrowAndFuncRe = /(?:function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:async\s*)?\(.*?\)\s*=>)\s*\{/g;
      while ((match = arrowAndFuncRe.exec(src)) !== null) {
        const start = match.index;
        const startLine = src.slice(0, start).split('\n').length;
        let depth = 0, end = start;
        for (let i = start; i < src.length; i++) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        const bodyLines = src.slice(start, end).split('\n').length;
        if (bodyLines > 50) {
          largeFunctions.push({ near: match[0].slice(0, 60).trim(), startLine, lines: bodyLines });
        }
      }

      // TODO/FIXME/HACK/BUG/HACK comments
      const annotations = [];
      lines.forEach((line, idx) => {
        const m = line.match(/\/\/\s*(TODO|FIXME|HACK|BUG|XXX|TEMP|WORKAROUND)[:.]?\s*(.*)/i);
        if (m) annotations.push({ type: m[1].toUpperCase(), line: idx + 1, text: m[2].trim().slice(0, 120) });
      });

      // Suspicious patterns
      const suspicious = [];
      const checks = [
        { re: /console\.(log|warn|error|debug)\(/g,  label: 'console.log (should be removed for production)' },
        { re: /eval\s*\(/g,                           label: 'eval() — security risk' },
        { re: /new Function\s*\(/g,                   label: 'new Function() — security risk' },
        { re: /setTimeout\s*\(\s*['"`]/g,             label: 'setTimeout with string argument — bad practice' },
        { re: /var\s+\w/g,                            label: 'var declaration — prefer const/let' },
        { re: /==\s*(?!null|undefined)/g,             label: 'loose equality == (prefer ===)' },
        { re: /setInterval[^;]*((?!clearInterval)[\s\S]{0,500}$)/gm, label: 'setInterval possibly without clearInterval — memory leak risk' },
        { re: /addEventListener[^;]*((?!removeEventListener)[\s\S]{0,200}$)/gm, label: 'addEventListener possibly without removeEventListener' },
      ];
      for (const { re, label } of checks) {
        let sm;
        re.lastIndex = 0;
        while ((sm = re.exec(src)) !== null) {
          const lineNum = src.slice(0, sm.index).split('\n').length;
          suspicious.push({ line: lineNum, label, code: sm[0].slice(0, 80) });
          if (suspicious.length > 40) break;
        }
        if (suspicious.length > 40) break;
      }

      // Import analysis
      const importLines = lines.filter(l => /^\s*import\s/.test(l));
      const unusedImportHints = [];
      for (const imp of importLines) {
        const nameMatch = imp.match(/import\s+(?:\{([^}]+)\}|(\w+))/);
        if (nameMatch) {
          const names = (nameMatch[1] || nameMatch[2] || '').split(',').map(n => n.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean);
          for (const name of names) {
            const usageCount = (src.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
            if (usageCount <= 1) unusedImportHints.push({ name, line: lines.indexOf(imp) + 1 });
          }
        }
      }

      // Complexity estimate
      const cyclomaticIndicators = (src.match(/\b(if|else if|for|while|switch|case|\?\s*\w|catch|&&|\|\|)\b/g) || []).length;

      return {
        ok: true,
        file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
        totalLines,
        functionCount: functions.length,
        functions: functions.slice(0, 30),
        largeFunctions,
        annotations,
        suspicious: suspicious.slice(0, 30),
        unusedImportHints: unusedImportHints.slice(0, 20),
        estimatedCyclomaticComplexity: cyclomaticIndicators,
        importCount: importLines.length,
        summary: `${totalLines} lines | ${functions.length} functions | ${largeFunctions.length} large (>50L) | ${annotations.length} TODOs | ${suspicious.length} suspicious patterns | complexity score: ${cyclomaticIndicators}`,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  // ─── Super Agent: run_build_check ───────────────────────────────────────────
  ipcMain.handle('presentator-agent-run-build', async () => {
    const result = await new Promise(resolve => {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const child = execFile(
        npmCmd,
        ['run', 'build:react'],
        { cwd: ROOT, windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout, stderr) => resolve({
          ok: !error,
          exitCode: error?.code ?? 0,
          stdout: String(stdout || '').slice(-6000),
          stderr: String(stderr || '').slice(-4000),
          errorMessage: error?.message || '',
        })
      );
      child.on('error', e => resolve({ ok: false, exitCode: -1, stdout: '', stderr: '', errorMessage: e.message }));
    });
    // Parse error lines for structured reporting
    const allOutput = `${result.stdout}\n${result.stderr}`;
    const errorLines = allOutput.split('\n')
      .filter(l => /error|Error|failed|Failed/.test(l))
      .slice(0, 30)
      .join('\n');
    return { ...result, errorSummary: errorLines };
  });

  // ─── Super Agent: diff_files ────────────────────────────────────────────────
  ipcMain.handle('presentator-agent-diff-files', (_event, request) => {
    try {
      const fileA = path.resolve(String(request?.fileA || ''));
      const fileB = path.resolve(String(request?.fileB || ''));
      const root = ROOT.toLowerCase();
      if (!fileA.toLowerCase().startsWith(root) || !fileB.toLowerCase().startsWith(root)) {
        return { ok: false, error: 'Both files must be inside the project root.' };
      }
      if (!fs.existsSync(fileA)) return { ok: false, error: `File A not found: ${fileA}` };
      if (!fs.existsSync(fileB)) return { ok: false, error: `File B not found: ${fileB}` };
      const linesA = fs.readFileSync(fileA, 'utf8').split(/\r?\n/);
      const linesB = fs.readFileSync(fileB, 'utf8').split(/\r?\n/);
      // Simple unified diff
      const diff = [];
      const maxLen = Math.max(linesA.length, linesB.length);
      let changes = 0;
      for (let i = 0; i < maxLen; i++) {
        const a = linesA[i];
        const b = linesB[i];
        if (a === undefined) { diff.push(`+${i + 1}: ${b}`); changes++; }
        else if (b === undefined) { diff.push(`-${i + 1}: ${a}`); changes++; }
        else if (a !== b) { diff.push(`-${i + 1}: ${a}`); diff.push(`+${i + 1}: ${b}`); changes++; }
      }
      return {
        ok: true,
        fileA: path.relative(ROOT, fileA).replace(/\\/g, '/'),
        fileB: path.relative(ROOT, fileB).replace(/\\/g, '/'),
        changedLines: changes,
        diff: diff.slice(0, 300).join('\n'),
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  // ─── Super Agent: presentator-agent-generate-sfx ──────────────────────────
  ipcMain.handle('presentator-agent-generate-sfx', async (_event, request) => {
    try {
      const type = String(request?.type || 'ding').toLowerCase();
      const sfxDir = path.join(ROOT, 'generated-media', 'sfx');
      fs.mkdirSync(sfxDir, { recursive: true });
      const filePath = path.join(sfxDir, `${type}.wav`);

      const sfx = require('./sfx-generator.cjs');
      const generators = {
        ding: sfx.generateDing,
        click: sfx.generateClick,
        whoosh: sfx.generateWhoosh,
        cheer: sfx.generateCheer,
        typing: sfx.generateTyping
      };
      const gen = generators[type] || generators.ding;
      gen(filePath);

      return {
        ok: true,
        type,
        filePath,
        fileName: `${type}.wav`,
        url: `file:///${filePath.replace(/\\/g, '/')}`
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  // ─── Super Agent: presentator-agent-morph-audio ───────────────────────────
  ipcMain.handle('presentator-agent-morph-audio', async (_event, request) => {
    try {
      const sourcePath = path.resolve(String(request?.sourcePath || ''));
      const voice = String(request?.voice || 'sc3');
      if (!fs.existsSync(sourcePath)) {
        return { ok: false, error: 'Source audio file not found.' };
      }
      // Send to SC3 Singing server (port 8426) for timbre conversion
      const response = await postJsonForBuffer(8426, '/api/convert-song', { filePath: sourcePath, voice }, 600000);
      if (!response || response.statusCode !== 200) {
        throw new Error('SC3 conversion server returned status ' + response?.statusCode);
      }
      const body = JSON.parse(response.buffer.toString('utf8'));
      if (!body.audioBase64) {
        throw new Error('SC3 returned empty audio.');
      }

      const morphedDir = path.join(ROOT, 'generated-media', 'morphed');
      fs.mkdirSync(morphedDir, { recursive: true });
      const stamp = Date.now();
      const outPath = path.join(morphedDir, `morphed-${stamp}.mp3`);
      fs.writeFileSync(outPath, Buffer.from(body.audioBase64, 'base64'));

      return {
        ok: true,
        morphedPath: outPath,
        url: `file:///${outPath.replace(/\\/g, '/')}`
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('presentator-agent-generate-image', async (event, request) => {


    let resumePausedServers = () => {};
    activeImageGenerationRequests += 1;
    try {
      // Image/video requests have priority on this 16 GB CPU-only machine. A resumed
      // ACE-Step synthesis otherwise exhausts RAM and resets the diffusion connection.
      if (process.platform === 'win32') {
        for (const processName of ['ace-synth.exe', 'ace-lm.exe']) {
          await new Promise(resolve => execFile('taskkill.exe', ['/IM', processName, '/F'], {
            windowsHide: true,
            timeout: 10000,
          }, () => resolve()));
        }
      }
      // The 16 GB machine cannot keep both the local LLM and diffusion model
      // resident. Ask Ollama to unload before loading native FP32 image weights.
      try {
        for (const model of [PRESENTATOR_LOCAL_MODEL, PRESENTATOR_FAST_MODEL]) {
          await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, keep_alive: 0 }),
          });
        }
      } catch (_) {}
      resumePausedServers = await pauseManagedServersForImage([
        'AnjaliAI',
        'Sc3Singing',
        'EdgeTTS',
        'TranslationServer',
      ]);
      const imageEntry = servers.ImageGenerator;
      if (!(await pingPort(8432, '/health')) && (!imageEntry?.proc || imageEntry.proc.killed || imageEntry.proc.exitCode !== null)) {
        restartServer('ImageGenerator');
      }
      // The Python image server needs roughly 30 seconds to import Torch/Diffusers
      // after an application restart. Queue the request until its health endpoint is live.
      let imageServerReady = false;
      for (let attempt = 0; attempt < 90; attempt += 1) {
        if (await pingPort(8432, '/health')) { imageServerReady = true; break; }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!imageServerReady) throw new Error('The local image generator did not become ready on port 8432 within 90 seconds.');
      let progressPollBusy = false;
      const progressTimer = setInterval(async () => {
        if (progressPollBusy) return;
        progressPollBusy = true;
        try {
          const healthResponse = await fetch('http://127.0.0.1:8432/health');
          const health = await healthResponse.json();
          const labels = {
            loading_model: 'Loading the local image model',
            diffusion: `Rendering image • diffusion step ${health.step || 0}/${health.totalSteps || 8}`,
            upscaling_4k: 'Upscaling rendered scene to 4K',
            saving: 'Saving the completed 4K image',
            idle: 'Preparing image generation',
          };
          const stagePercent = health.stage === 'loading_model' ? 6
            : health.stage === 'diffusion' ? 10 + Math.round((Number(health.step || 0) / Math.max(1, Number(health.totalSteps || 8))) * 80)
              : health.stage === 'upscaling_4k' ? 94
                : health.stage === 'saving' ? 98 : 2;
          event.sender.send('presentator-agent-progress', {
            stage: 'media',
            label: labels[health.stage] || 'Generating image locally',
            percent: stagePercent,
            profile: 'direct video',
          });
        } catch (_) {
          try { event.sender.send('presentator-agent-progress', { stage: 'media', label: 'Starting local image worker', percent: 1, profile: 'direct video' }); } catch (_) {}
        } finally {
          progressPollBusy = false;
        }
      }, 1000);
      const response = await postJsonForBufferWithRecovery(
        8432,
        '/api/generate-image',
        {
          prompt: String(request?.prompt || ''),
          negativePrompt: String(request?.negativePrompt || ''),
          seed: Number(request?.seed || 0),
          width: 768,
          height: 432,
          outputWidth: 3840,
          outputHeight: 2160,
        },
        900000,
        1
      ).finally(() => clearInterval(progressTimer));
      const json = JSON.parse(response.buffer.toString('utf8'));
      if (response.statusCode < 200 || response.statusCode >= 300 || !json.ok) {
        throw new Error(json.detail || json.error || `Image server returned ${response.statusCode}.`);
      }
      const imageBuffer = fs.readFileSync(json.imagePath);
      return {
        ...json,
        imageBase64: imageBuffer.toString('base64'),
        mimeType: 'image/png',
      };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      activeImageGenerationRequests = Math.max(0, activeImageGenerationRequests - 1);
      resumePausedServers();
    }
  });

  ipcMain.handle('presentator-agent-create-video', async (_event, request) => {
    const imagePath = path.resolve(String(request?.imagePath || ''));
    const allowedRoots = [
      `${path.join(ROOT, 'generated-media', 'images')}${path.sep}`.toLowerCase(),
      `${path.join(ROOT, 'generated-media', 'references', 'images')}${path.sep}`.toLowerCase(),
    ];
    if (!allowedRoots.some(root => imagePath.toLowerCase().startsWith(root)) || !fs.existsSync(imagePath)) {
      return { ok: false, error: 'Select or generate a local image before creating the video.' };
    }
    const duration = 8;
    const safeName = String(request?.fileName || `scene-${Date.now()}.mp4`)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.mp4$/i, '') + '.mp4';
    const outputDir = path.join(ROOT, 'generated-media', 'videos');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, safeName);
    const ffmpeg = findFFmpegExecutable();
    try {
      await new Promise((resolve, reject) => {
        execFile(ffmpeg, [
          '-y', '-loop', '1', '-i', imagePath,
          '-vf',
          "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.0008,1.12)':d=1:s=1920x1080:fps=30,format=yuv420p",
          '-t', String(duration), '-r', '30',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
          '-movflags', '+faststart', outputPath,
        ], { cwd: ROOT, windowsHide: true, timeout: 300000, maxBuffer: 4 * 1024 * 1024 },
        (error, _stdout, stderr) => {
          if (error) reject(new Error(`${error.message}: ${String(stderr || '').slice(-1000)}`));
          else resolve();
        });
      });
      return { ok: true, videoPath: outputPath, fileName: safeName, duration };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  // ————————————— IPC: Restart Anjali from renderer (when user clicks retry) ——————
  ipcMain.handle('restart-anjali', () => {
    console.log('[PP] Renderer requested Anjali restart.');
    restartServer('AnjaliAI');
    return { ok: true };
  });


  ipcMain.handle('narrate-edge-tts', async (_event, payload) => {
    const response = await postJsonForBuffer(8427, '/api/preview-mp3', payload, 180000);
    const contentType = String(response.headers['content-type'] || 'audio/wav');
    const bodyText = /application\/json/i.test(contentType)
      ? response.buffer.toString('utf8')
      : '';
    if (response.statusCode < 200 || response.statusCode >= 300) {
      let errorMessage = `Edge TTS server returned HTTP ${response.statusCode}.`;
      if (bodyText) {
        try {
          errorMessage = JSON.parse(bodyText)?.error || errorMessage;
        } catch (_) {}
      }
      throw new Error(errorMessage);
    }

    return {
      ok: true,
      statusCode: response.statusCode,
      contentType,
      audioBase64: response.buffer.toString('base64'),
    };
  });

  ipcMain.handle('presentator-agent-generate-true-video', async (event, request) => {
    const token = String(request?.apiKey || '').trim();
    const prompt = String(request?.prompt || '').trim();
    if (!token) return { ok: false, needsApiKey: true, error: 'Add your free Magic Hour API key in Super Agent first.' };
    if (prompt.length < 3) return { ok: false, error: 'Enter a detailed video prompt.' };
    const outputDir = path.join(ROOT, 'generated-media', 'videos');
    fs.mkdirSync(outputDir, { recursive: true });
    const safeName = `true-video-${Date.now()}.mp4`;
    const outputPath = path.join(outputDir, safeName);
    try {
      const client = new MagicHourClient({ token });
      event.sender.send('presentator-agent-progress', { stage: 'media', label: 'Submitting real text-to-video job', percent: 3, profile: 'Magic Hour LTX 2.3' });
      const created = await client.v1.textToVideo.create({
        name: prompt.slice(0, 80),
        endSeconds: 8,
        aspectRatio: '16:9',
        resolution: '480p',
        model: 'default',
        audio: false,
        style: { prompt },
      });
      const started = Date.now();
      let project;
      while (Date.now() - started < 30 * 60 * 1000) {
        project = await client.v1.videoProjects.get({ id: created.id });
        const elapsed = Math.round((Date.now() - started) / 1000);
        const percent = project.status === 'queued' ? Math.min(18, 5 + Math.floor(elapsed / 10)) : Math.min(92, 20 + Math.floor(elapsed / 6));
        event.sender.send('presentator-agent-progress', {
          stage: 'media',
          label: project.status === 'queued' ? 'Cloud video queued • waiting for free GPU' : `Generating original moving frames • ${elapsed}s`,
          percent,
          profile: 'Magic Hour LTX 2.3',
        });
        if (project.status === 'complete') break;
        if (['error', 'canceled'].includes(project.status)) throw new Error(project.error?.message || `Video job ${project.status}.`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      if (!project || project.status !== 'complete') throw new Error('Video generation exceeded the 30-minute safety limit.');
      const downloadUrl = project.downloads?.[0]?.url || project.download?.url;
      if (!downloadUrl) throw new Error('The provider completed the job but returned no download URL.');
      event.sender.send('presentator-agent-progress', { stage: 'media', label: 'Downloading generated MP4', percent: 96, profile: 'Magic Hour LTX 2.3' });
      const download = await fetch(downloadUrl);
      if (!download.ok) throw new Error(`Video download failed with HTTP ${download.status}.`);
      fs.writeFileSync(outputPath, Buffer.from(await download.arrayBuffer()));
      return { ok: true, videoPath: outputPath, fileName: safeName, duration: 8, provider: 'Magic Hour', model: 'LTX 2.3', creditsCharged: project.creditsCharged };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  const narrateWithSc3 = async (payload) => {
    const response = await postJsonForBuffer(8426, '/api/narrate', {
      ...payload,
      voice: payload?.voice || 'sc3',
    }, 600000);
    const contentType = String(response.headers?.['content-type'] || 'audio/wav');
    if (response.statusCode < 200 || response.statusCode >= 300) {
      let message = `SC3 narration server returned HTTP ${response.statusCode}.`;
      try { message = JSON.parse(response.buffer.toString('utf8'))?.error || message; } catch (_) {}
      throw new Error(message);
    }
    return { ok: true, statusCode: response.statusCode, contentType, audioBase64: response.buffer.toString('base64') };
  };

  ipcMain.handle('narrate-sc3-tts', async (_event, payload) => narrateWithSc3(payload));
  ipcMain.handle('narrate-sc3-text', async (_event, payload) => narrateWithSc3(payload));

  let activeRhymeChild = null;
  ipcMain.handle('cancel-rhyme-song', () => {
    if (activeRhymeChild) {
      try { killProcessTree(activeRhymeChild); } catch (_) {}
      activeRhymeChild = null;
    }
    if (mobileRhymeJob?.status === 'running') {
      mobileRhymeJob.status = 'failed';
      mobileRhymeJob.error = 'Generation cancelled by user.';
      mobileRhymeJob.progress = { pct: 0, phase: 'Stopped', detail: 'Generation cancelled by user', elapsedSeconds: 0 };
    }
    return { ok: true, cancelled: true };
  });

  ipcMain.handle('generate-rhyme-song', async (event, payload) => {
    const lyrics = String(payload?.lyrics || '').trim();
    if (!lyrics) return { ok: false, error: 'Exact lyrics are required.' };
    if (/\b(nude|nudy|naked|pussy|penis|vagina|nipples?|porn|sexual|sex)\b/i.test(lyrics)) {
      return { ok: false, error: 'Kids Rhyme Maker rejected unrelated adult content. Clear both inputs and enter only the exact child-safe lyrics you want sung.' };
    }
    // The title is output metadata only. Comparing it with the lyric words caused
    // legitimate titles such as "Validation Rhyme" to reject otherwise exact lyrics.

    const startedAt = Date.now();
    let activePhase = 'Checking ACE-Step installation';
    let activePct = 2;
    const report = (phase, pct, detail = '') => {
      activePhase = phase;
      activePct = pct;
      try { event.sender.send('rhyme-song-progress', { phase, pct, detail, elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) }); } catch (_) {}
    };
    report(activePhase, activePct, 'Verifying the local singing engine and model files');
    const heartbeat = setInterval(() => report(activePhase, activePct, 'ACE-Step is working locally. CPU generation may take several minutes.'), 1000);

    const aceRoot = path.join(ROOT, 'AI_Models', 'sc3-singing', 'acestep.vst3');
    const build = path.join(aceRoot, 'build', 'Release');
    const models = path.join(aceRoot, 'models');
    const lmExe = path.join(build, 'ace-lm.exe');
    const synthExe = path.join(build, 'ace-synth.exe');
    const lmHigh = path.join(models, 'acestep-5Hz-lm-1.7B-Q8_0.gguf');
    const lmFallback = path.join(models, 'acestep-5Hz-lm-0.6B-Q8_0.gguf');
    const lmModel = fs.existsSync(lmHigh) ? lmHigh : lmFallback;
    const embedding = path.join(models, 'Qwen3-Embedding-0.6B-Q8_0.gguf');
    const ditHigh = path.join(models, 'acestep-v15-turbo-Q8_0.gguf');
    const ditFallback = path.join(models, 'acestep-v15-turbo-Q5_K_M.gguf');
    const dit = fs.existsSync(ditHigh) && fs.statSync(ditHigh).size > 2500000000 ? ditHigh : ditFallback;
    const vae = path.join(models, 'vae-BF16.gguf');
    const referenceAudio = path.join(ROOT, 'generated-media', 'rhyme-reference', 'little-jack-horner-reference-30s.wav');
    const required = [lmExe, synthExe, lmModel, embedding, dit, vae, referenceAudio];
    const missing = required.filter(file => !fs.existsSync(file));
    if (missing.length) {
      clearInterval(heartbeat);
      return { ok: false, error: `ACE-Step installation incomplete: ${path.basename(missing[0])} is missing.` };
    }

    const jobsRoot = path.join(ROOT, 'generated-media', 'song-work');
    const requestedResumeDir = path.resolve(String(payload?.resumeWorkDir || ''));
    const jobsRootResolved = path.resolve(jobsRoot) + path.sep;
    let canResume = requestedResumeDir.startsWith(jobsRootResolved) && fs.existsSync(requestedResumeDir);
    if (canResume) {
      try {
        const existingRecovery = JSON.parse(fs.readFileSync(path.join(jobsRoot, 'active-rhyme-job.json'), 'utf8'));
        if (String(existingRecovery?.payload?.lyrics || '').trim() !== lyrics) canResume = false;
      } catch (_) { canResume = false; }
    }
    const stamp = canResume ? Number(path.basename(requestedResumeDir)) || Date.now() : Date.now();
    const workDir = canResume ? requestedResumeDir : path.join(jobsRoot, String(stamp));
    const activeJobPath = path.join(jobsRoot, 'active-rhyme-job.json');
    const outputDir = app.getPath('downloads');
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    const title = String(payload?.title || 'kids-rhyme');
    const safeTitle = title.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55) || 'kids-rhyme';
    let savedPath = path.join(outputDir, `${safeTitle}.mp3`);
    if (fs.existsSync(savedPath)) savedPath = path.join(outputDir, `${safeTitle}-${stamp}.mp3`);
    const requestedDuration = Math.max(5, Math.min(30, Number(payload?.duration) || 30));
    const lyricWordCount = lyrics.trim().split(/\s+/).filter(Boolean).length;
    // Singing needs substantially more room than speech. Silently squeezing a full
    // verse into a short selection makes ACE-Step slur, repeat, or invent syllables.
    const minimumClearDuration = Math.max(5, Math.ceil(lyricWordCount / 0.85));
    if (minimumClearDuration > 30) {
      clearInterval(heartbeat);
      return { ok: false, error: `These ${lyricWordCount} lyric words need about ${minimumClearDuration} seconds for clear singing. Shorten the lyrics to about 25 words for the 30-second maximum.` };
    }
    const coordinatedSongMode = String(payload?.qualityMode || '') === 'coordinated-song';
    const duration = coordinatedSongMode
      ? 30
      : Math.min(30, Math.max(requestedDuration, minimumClearDuration));
    const performanceLyrics = coordinatedSongMode
      ? `[Verse]\n${lyrics.replace(/\n+/g, '\n\n')}`
      : lyrics;
    const durationReference = path.join(workDir, `required-reference-${duration}s.wav`);
    const request = {
      caption: `${String(payload?.stylePrompt || 'hd crystal-clear voice, studio-mastered vocal, ultra-clean high-fidelity 48kHz audio, premium preschool nursery rhyme, naturally expressive young female singer, warm realistic human vocal, joyful child-friendly performance, crystal-clear English pronunciation, memorable playful melody, soft piano, glockenspiel, ukulele and gentle drums, wide clean stereo instrumental, polished commercial children song')}, preserve the same lead-singer timbre and vocal character as the supplied Little Jack Horner reference; sing naturally with melodic phrasing and breath, never robotic, never spoken`,
      lyrics: performanceLyrics,
      duration,
      bpm: Math.max(80, Math.min(140, Number(payload?.bpm) || 96)),
      keyscale: 'C major',
      timesignature: '4',
      vocal_language: 'en',
      batch_size: 1,
      seed: Number(payload?.seed || -1),
      use_cot_caption: false,
      // This installation uses ACE-Step 1.5 Turbo. Its native configuration is
      // 8 diffusion steps with CFG disabled; higher step/CFG values degrade vocals.
      inference_steps: coordinatedSongMode ? 8 : 16,
      guidance_scale: coordinatedSongMode ? 0.0 : 1.0,
      shift: 3.0,
      // Keep the required reference's musical character without letting its old words
      // overpower the exact lyrics supplied for this generation.
      audio_cover_strength: 0.40,
    };
    const savedPayload = {
      lyrics, title, duration, clarityAttempts: Math.max(3, Math.min(5, Number(payload?.clarityAttempts) || 3)),
      bgmLevel: Number(payload?.bgmLevel), vocalPresence: Number(payload?.vocalPresence), bpm: request.bpm,
      stylePrompt: request.caption, seed: request.seed, qualityMode: coordinatedSongMode ? 'coordinated-song' : 'recovery-compatible',
      lyricsHash: crypto.createHash('sha256').update(lyrics, 'utf8').digest('hex'),
    };
    const saveRecovery = (status, extra = {}) => {
      try { fs.writeFileSync(activeJobPath, JSON.stringify({ status, workDir, payload: savedPayload, updatedAt: Date.now(), ...extra }, null, 2), 'utf8'); } catch (_) {}
    };
    saveRecovery('running', { stage: canResume ? 'resuming' : 'preparing' });
    report('Preparing exact lyrics', 8, `New lyric plan ${savedPayload.lyricsHash.slice(0, 10)} · cache reuse disabled`);

    const run = (command, args, timeoutMs, cwd = workDir) => new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      activeRhymeChild = child;
      let output = '';
      child.stdout.on('data', data => { output += data.toString(); });
      child.stderr.on('data', data => { output += data.toString(); });
      const timer = setTimeout(() => {
        killProcessTree(child);
        activeRhymeChild = null;
        reject(new Error(`ACE-Step timed out after ${Math.round(timeoutMs / 60000)} minutes.`));
      }, timeoutMs);
      child.on('error', error => { clearTimeout(timer); activeRhymeChild = null; reject(error); });
      child.on('exit', code => {
        clearTimeout(timer);
        activeRhymeChild = null;
        code === 0 ? resolve(output) : reject(new Error(`ACE-Step exited with code ${code}: ${output.slice(-1200)}`));
      });
    });

    const normalizeWords = text => String(text || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
    const lyricScore = (expectedText, detectedText) => {
      const expected = normalizeWords(expectedText);
      const detected = normalizeWords(detectedText);
      if (!expected.length || !detected.length) return 0;
      const previous = new Uint16Array(detected.length + 1);
      for (let i = 1; i <= expected.length; i += 1) {
        const current = new Uint16Array(detected.length + 1);
        for (let j = 1; j <= detected.length; j += 1) current[j] = expected[i - 1] === detected[j - 1]
          ? previous[j - 1] + 1
          : Math.max(previous[j], current[j - 1]);
        previous.set(current);
      }
      return Math.round((previous[detected.length] / expected.length) * 100);
    };
    const transcribeForClarity = async wavPath => {
      const script = path.join(ROOT, 'whisper-transcribe-caption.py');
      if (!fs.existsSync(SINGING_PYTHON) || !fs.existsSync(script)) return { text: '', score: 0, unavailable: true };
      const output = await run(SINGING_PYTHON, [script, wavPath, 'en', path.basename(wavPath)], 20 * 60 * 1000, path.dirname(wavPath));
      const jsonLine = output.split(/\r?\n/).reverse().find(line => line.trim().startsWith('{'));
      if (!jsonLine) return { text: '', score: 0, unavailable: true };
      const result = JSON.parse(jsonLine.trim());
      return { text: String(result.text || '').trim(), score: lyricScore(lyrics, result.text), unavailable: false };
    };

    let resumePausedServers = () => {};
    try {
      report('Freeing memory for music generation', 12, 'Temporarily pausing other local AI services');
      // Keep the idle image health service alive during long rhyme jobs.
      resumePausedServers = await pauseManagedServersForImage(['AnjaliAI', 'Sc3Singing']);
      if (!fs.existsSync(durationReference)) {
        report('Preparing required audio reference', 13, `Trimming the Little Jack Horner reference to ${duration} seconds`);
        await run(findFFmpegExecutable(), ['-y', '-i', referenceAudio, '-t', String(duration), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', durationReference], 5 * 60 * 1000, workDir);
      }
      // Never treat the first weak performance as the final result. Mobile and
      // older saved payloads may still request one attempt, but exact-lyric mode
      // always gets at least three independent performances.
      const attempts = coordinatedSongMode
        ? Math.max(5, Math.min(8, Number(payload?.clarityAttempts) || 5))
        : Math.max(3, Math.min(5, Number(payload?.clarityAttempts) || 3));
      const passScore = 80;
      const initialSeed = Number.isFinite(Number(payload?.seed)) && Number(payload.seed) >= 0 ? Number(payload.seed) : Math.floor(Math.random() * 1000000);
      let best = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const attemptBase = 14 + Math.round(((attempt - 1) / attempts) * 74);
        const attemptEnd = 14 + Math.round((attempt / attempts) * 74);
        const attemptDir = path.join(workDir, `reference-attempt-${attempt}`);
        fs.mkdirSync(attemptDir, { recursive: true });
        const requestPath = path.join(attemptDir, 'rhyme.json');
        const request0Path = path.join(attemptDir, 'rhyme0.json');
        const generatedPath = path.join(attemptDir, 'rhyme00.wav');
        if (!fs.existsSync(generatedPath)) {
          if (!fs.existsSync(request0Path)) {
            if (!fs.existsSync(requestPath)) {
              // Strong reference conditioning can overpower short supplied lyrics.
              // Keep the reference character for the first two candidates, then let
              // the final recovery candidate prioritize the exact lyric tokens.
              const retryStrength = coordinatedSongMode ? 0 : (attempt === 1 ? 0.35 : attempt === 2 ? 0.15 : 0);
              const retryCaption = attempt === 1
                ? request.caption
                : `${request.caption}. Extra-clear child-friendly diction. Sing every supplied word exactly once, with short pauses between lyric lines; do not omit, repeat, replace, or improvise any word.`;
              fs.writeFileSync(requestPath, JSON.stringify({
                ...request,
                caption: retryCaption,
                audio_cover_strength: retryStrength,
                seed: initialSeed + attempt - 1,
              }, null, 2), 'utf8');
            }
            saveRecovery('running', { stage: 'composing', attempt });
            report(`Composing candidate ${attempt}/${attempts}`, attemptBase, `High-quality lyric and melody plan · seed ${initialSeed + attempt - 1}`);
            await run(lmExe, ['--request', requestPath, '--lm', lmModel, '--max-seq', '4096', '--no-fa'], 30 * 60 * 1000, attemptDir);
          } else {
            report(`Resuming candidate ${attempt}/${attempts}`, attemptBase + 3, 'Song plan already complete; continuing from rendering');
          }
          if (!fs.existsSync(request0Path)) throw new Error('ACE-Step did not prepare the song request.');
          saveRecovery('running', { stage: 'rendering', attempt });
          report(`Rendering candidate ${attempt}/${attempts}`, attemptBase + 4, `Singing with ${path.basename(dit)} — longest CPU stage`);
          const synthArgs = ['--request', request0Path, '--embedding', embedding, '--dit', dit, '--vae', vae];
          if (!coordinatedSongMode && attempt < attempts) synthArgs.push('--src-audio', durationReference);
          synthArgs.push('--wav', '--no-fa', '--vae-chunk', '128', '--vae-overlap', '32');
          await run(synthExe, synthArgs, 45 * 60 * 1000, attemptDir);
        } else {
          report(`Resuming candidate ${attempt}/${attempts}`, Math.max(attemptBase + 5, attemptEnd - 2), 'Rendered WAV already exists; continuing from clarity verification');
        }
        if (!fs.existsSync(generatedPath)) throw new Error('ACE-Step did not create the song WAV.');
        report(`Checking lyric clarity ${attempt}/${attempts}`, Math.max(attemptBase + 6, attemptEnd - 1), 'Whisper is checking lyric clarity');
        let check;
        try { check = await transcribeForClarity(generatedPath); } catch (error) { check = { text: '', score: 0, unavailable: true, error: error.message }; }
        const candidate = { path: generatedPath, ...check, attempt };
        if (!best || candidate.score > best.score) best = candidate;
        report(`Lyric clarity score: ${candidate.score}%`, attemptEnd, candidate.score >= passScore ? 'Passed lyric clarity check' : attempt < attempts ? 'Automatically retrying with stronger diction and less reference bleed' : 'Rejected: lyrics are not clear enough');
        if (candidate.score >= passScore) break;
        // A failed first score means more full CPU renders would delay a result.
        // Move directly to the deterministic natural-voice recovery instead.
        if (attempt === 1 && !coordinatedSongMode) {
          report('Switching to exact-lyrics recovery', attemptEnd, `First candidate detected ${candidate.score}% of the supplied words`);
          break;
        }
      }
      if (!best?.path) throw new Error('No song candidate was generated.');
      if (!coordinatedSongMode && !best.unavailable && best.score < passScore) {
        report('Recovering exact lyric clarity', 89, 'Rebuilding the lead with the natural Little Jack Horner reference voice');
        // ACE-Step can occasionally prioritize melody/reference phonemes over very
        // short lyrics. Preserve the best musical bed, but replace its unclear lead
        // with deterministic Chatterbox narration cloned from the required rhyme
        // reference. The recovered mix must still pass the same Whisper gate.
        resumePausedServers();
        resumePausedServers = () => {};
        let chatterboxReady = false;
        for (let wait = 0; wait < 90; wait += 1) {
          if (await pingPort(8426, '/health')) { chatterboxReady = true; break; }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (chatterboxReady) {
          try {
            const recoveryVoice = path.join(workDir, 'exact-lyrics-reference-voice.wav');
            const recoveryMix = path.join(workDir, 'exact-lyrics-recovery.wav');
            const stemRoot = path.join(workDir, 'demucs-recovery');
            let recoveryMusic = best.path;
            const recoveryBgmSetting = Number(payload?.bgmLevel);
            const recoveryMusicGain = Math.max(0.35, Math.min(0.88,
              0.35 + ((Number.isFinite(recoveryBgmSetting) ? recoveryBgmSetting : 20) / 100) * 0.90
            )).toFixed(3);
            const lyricLines = lyrics.split(/\r?\n+/).map(line => line.trim()).filter(Boolean);
            const voiceLineFiles = [];
            for (let lineIndex = 0; lineIndex < lyricLines.length; lineIndex += 1) {
              report('Recovering exact lyric clarity', 89, `Generating natural voice line ${lineIndex + 1}/${lyricLines.length}`);
              const voiceResponse = await postJsonForBuffer(8426, '/api/narrate', {
                text: lyricLines[lineIndex],
                voice: 'rhyme_natural_v2',
                generationOptions: {
                  exaggeration: 0.48,
                  cfgWeight: 0.48,
                  temperature: 0.78,
                  repetitionPenalty: 1.18,
                },
              }, 10 * 60 * 1000);
              if (voiceResponse.statusCode < 200 || voiceResponse.statusCode >= 300 || !voiceResponse.buffer?.length) {
                throw new Error(`Reference voice line ${lineIndex + 1} returned HTTP ${voiceResponse.statusCode}.`);
              }
              const lineFile = path.join(workDir, `exact-lyrics-line-${lineIndex + 1}.wav`);
              fs.writeFileSync(lineFile, voiceResponse.buffer);
              voiceLineFiles.push(lineFile);
            }
            if (voiceLineFiles.length === 1) {
              fs.copyFileSync(voiceLineFiles[0], recoveryVoice);
            } else {
              const concatList = path.join(workDir, 'exact-lyrics-lines.txt');
              fs.writeFileSync(concatList, voiceLineFiles.map(file => `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
              await run(findFFmpegExecutable(), [
                '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
                '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', recoveryVoice,
              ], 10 * 60 * 1000, workDir);
            }
            try {
              report('Cleaning the background music', 90, 'Removing the rejected vocal from the accompaniment');
              await run(SINGING_PYTHON, [
                '-m', 'demucs', '--two-stems', 'vocals',
                '-o', stemRoot, best.path,
              ], 10 * 60 * 1000, workDir);
              const separatedMusic = path.join(
                stemRoot, 'htdemucs', path.basename(best.path, path.extname(best.path)), 'no_vocals.wav'
              );
              if (fs.existsSync(separatedMusic)) recoveryMusic = separatedMusic;
            } catch (separationError) {
              console.warn('[Rhyme] Vocal separation unavailable; using filtered music bed:', separationError.message);
            }
            await run(findFFmpegExecutable(), [
              '-y', '-i', recoveryMusic, '-i', recoveryVoice,
              '-filter_complex',
              `[0:a]highpass=f=55,lowpass=f=12000,volume=${recoveryMusicGain},apad=pad_dur=${duration}[music];[1:a]highpass=f=75,lowpass=f=12000,equalizer=f=3200:t=h:w=1:g=1,acompressor=threshold=-20dB:ratio=1.45:attack=24:release=260,volume=1.08,apad=pad_dur=${duration},asplit=2[voicekey][voiceout];[music][voicekey]sidechaincompress=threshold=0.040:ratio=2.2:attack=22:release=220[ducked];[ducked][voiceout]amix=inputs=2:duration=first:weights='1.0 1.0':normalize=0,loudnorm=I=-15:TP=-1.2:LRA=11[out]`,
              '-map', '[out]', '-t', String(duration), '-ar', '48000', '-ac', '2',
              '-c:a', 'pcm_s16le', recoveryMix,
            ], 10 * 60 * 1000, workDir);
            const recoveryCheck = await transcribeForClarity(recoveryMix);
            report(`Recovered lyric clarity: ${recoveryCheck.score}%`, 91, recoveryCheck.score >= passScore ? 'Exact-lyrics recovery passed' : 'Exact-lyrics recovery did not pass');
            if (recoveryCheck.score >= passScore) {
              best = { path: recoveryMix, ...recoveryCheck, attempt: best.attempt, recovered: true };
            }
          } catch (recoveryError) {
            console.error('[Rhyme] Exact-lyrics recovery failed:', recoveryError.message);
          }
        }
        if (best.score < passScore) {
          throw new Error(`Song rejected after ${attempts} automatic performances and natural-voice recovery because the best result detected only ${best.score}% of the exact lyrics (minimum ${passScore}%). Nothing unclear was saved.`);
        }
      }
      if (coordinatedSongMode && !best.unavailable && best.score < passScore) {
        throw new Error(`Coordinated song rejected after ${attempts} complete singing performances because the best result detected only ${best.score}% of the exact lyrics (minimum ${passScore}%). The singer and BGM were kept together; no narration replacement or mismatched mix was saved.`);
      }
      if (best.unavailable) {
        throw new Error('The lyric clarity checker was unavailable, so the song was not saved without verification.');
      }
      report('Enhancing lead-vocal clarity', 92, 'Mastering HD stereo song with presence boost and loudness normalization');
      const enhancedPath = path.join(workDir, 'vocal-enhanced.wav');
      const requestedBgm = Number(payload?.bgmLevel);
      const requestedPresence = Number(payload?.vocalPresence);
      const bgmLevel = Math.max(0, Math.min(100, Number.isFinite(requestedBgm) ? requestedBgm : 20));
      const presence = Math.max(0, Math.min(10, Number.isFinite(requestedPresence) ? requestedPresence : 7));
      const eqGain = (-1.0 + (presence * 0.6)).toFixed(1);
      const bgmEq = (-6.0 + (bgmLevel / 100) * 8.0).toFixed(1);
      const overallVol = (0.75 + (presence * 0.04) + (bgmLevel / 100) * 0.25).toFixed(2);
      const audioFilter = `highpass=f=85,equalizer=f=280:t=q:w=1.2:g=${bgmEq},equalizer=f=3500:t=h:w=1.0:g=${eqGain},equalizer=f=10500:t=h:w=1.0:g=3.5,volume=${overallVol},acompressor=threshold=-18dB:ratio=2.8:attack=10:release=100,loudnorm=I=-14:TP=-1.0:LRA=7`;
      try {
        await run(findFFmpegExecutable(), ['-y', '-i', best.path, '-af', audioFilter, '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '320k', '-q:a', '0', enhancedPath], 10 * 60 * 1000, workDir);
      } catch (_) {}
      report('Finalizing the MP3', 96, 'Saving the mastered 4K 320kbps MP3 song');
      fs.copyFileSync(fs.existsSync(enhancedPath) ? enhancedPath : best.path, savedPath);
      const bytes = fs.readFileSync(savedPath);
      const clarityPassed = best.score >= passScore;
      saveRecovery('completed', { stage: 'completed', savedPath, clarityScore: best.score });
      report('Song complete', 100, `${path.basename(savedPath)} · clarity ${best.score}%`);
      return { ok: true, filePath: savedPath, fileName: path.basename(savedPath), audioBase64: bytes.toString('base64'), mimeType: 'audio/mp3', duration, requestedDuration, durationAdjusted: duration !== requestedDuration, engine: best.recovered ? 'ACE-Step music + natural reference-voice clarity recovery' : (dit === ditHigh ? 'ACE-Step 1.5 Q8 High Quality' : 'ACE-Step 1.5 Q5'), clarityScore: best.score, clarityPassed, detectedLyrics: best.text || lyrics, attemptsUsed: best.attempt, clarityRecovered: Boolean(best.recovered) };
    } catch (error) {
      saveRecovery('paused', { stage: activePhase, error: error.message });
      report('Generation failed', 0, error.message);
      return { ok: false, error: error.message };
    } finally {
      clearInterval(heartbeat);
      resumePausedServers();
    }
  });
  ipcMain.handle('get-rhyme-resume-job', () => {
    const jobsRoot = path.join(ROOT, 'generated-media', 'song-work');
    const activePath = path.join(jobsRoot, 'active-rhyme-job.json');
    try {
      if (fs.existsSync(activePath)) {
        const saved = JSON.parse(fs.readFileSync(activePath, 'utf8'));
        if (['running', 'paused'].includes(saved.status) && saved.workDir && fs.existsSync(saved.workDir)) return { ok: true, job: saved };
      }
      const directories = fs.readdirSync(jobsRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
        .map(entry => path.join(jobsRoot, entry.name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      for (const workDir of directories.slice(0, 10)) {
        const referenceAttempt = path.join(workDir, 'reference-attempt-1');
        const legacyAttempt = path.join(workDir, 'attempt-1');
        const attemptDir = fs.existsSync(referenceAttempt) ? referenceAttempt : legacyAttempt;
        const requestPath = path.join(attemptDir, 'rhyme.json');
        const completedPath = path.join(workDir, 'vocal-enhanced.wav');
        if (fs.existsSync(requestPath) && !fs.existsSync(completedPath)) {
          const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
          return { ok: true, job: { status: 'paused', workDir, stage: fs.existsSync(path.join(attemptDir, 'rhyme0.json')) ? 'rendering' : 'composing', payload: { lyrics: request.lyrics, title: 'Recovered rhyme', duration: request.duration, bpm: request.bpm, stylePrompt: request.caption, seed: request.seed, clarityAttempts: 3, bgmLevel: 20, vocalPresence: 7 } } };
        }
      }
    } catch (error) { return { ok: false, error: error.message }; }
    return { ok: true, job: null };
  });
  ipcMain.handle('preview-rhyme-mix', async (_event, payload) => {
    const sampleCandidates = [
      path.join(ROOT, 'generated-media', 'rhyme-reference', 'little-jack-horner-reference-30s.wav'),
      path.join(ROOT, 'generated-media', 'song-work', 'little-jack-horner-q8', 'rhyme00.wav'),
      path.join(ROOT, 'generated-media', 'song-work', 'install-test', 'rhyme00.wav'),
    ];
    const sourcePath = String(payload?.sourcePath || '');
    if (sourcePath && fs.existsSync(sourcePath)) sampleCandidates.unshift(sourcePath);
    const samplePath = sampleCandidates.find(candidate => fs.existsSync(candidate));
    if (!samplePath) return { ok: false, error: 'Generate one song first to create a mix-preview source.' };
    const requestedBgm = Number(payload?.bgmLevel);
    const requestedPresence = Number(payload?.vocalPresence);
    const bgmLevel = Math.max(0, Math.min(100, Number.isFinite(requestedBgm) ? requestedBgm : 20));
    const presence = Math.max(0, Math.min(10, Number.isFinite(requestedPresence) ? requestedPresence : 7));
    const singerStyle = 'required Little Jack Horner reference singer';
    const bpm = Math.max(80, Math.min(140, Number(payload?.bpm) || 96));
    // Preview and final mastering must use exactly the same tonal controls.
    // Pitch/tempo tricks here previously advertised a voice the generator did not use.
    const presenceEq = (-1.0 + (presence * 0.6)).toFixed(1);
    const bgmEq = (-6.0 + (bgmLevel / 100) * 8.0).toFixed(1);
    const overallVol = (0.75 + (presence * 0.04) + (bgmLevel / 100) * 0.25).toFixed(2);
    const filter = `highpass=f=80,equalizer=f=400:t=q:w=1:g=${bgmEq},equalizer=f=3500:t=h:w=1:g=${presenceEq},volume=${overallVol},acompressor=threshold=-16dB:ratio=2.5:attack=10:release=150,loudnorm=I=-14:TP=-1.0:LRA=9`;
    const previewDir = path.join(ROOT, 'generated-media', 'mix-previews');
    fs.mkdirSync(previewDir, { recursive: true });
    const previewPath = path.join(previewDir, `preview-${Date.now()}.wav`);
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(findFFmpegExecutable(), ['-y', '-ss', '2', '-t', '8', '-i', samplePath, '-af', filter, '-ar', '48000', '-c:a', 'pcm_s16le', previewPath], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let errorText = '';
        child.stderr.on('data', data => { errorText += data.toString(); });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(errorText.slice(-800) || `FFmpeg exited with code ${code}`)));
      });
      const bytes = fs.readFileSync(previewPath);
      return { ok: true, audioBase64: bytes.toString('base64'), mimeType: 'audio/wav', bgmLevel, vocalPresence: presence, singerStyle, bpm };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('check-rhyme-module', async () => {
    const aceRoot = path.join(ROOT, 'AI_Models', 'sc3-singing', 'acestep.vst3');
    const checks = [
      ['Q8 music model', path.join(aceRoot, 'models', 'acestep-v15-turbo-Q8_0.gguf'), 2500000000],
      ['1.7B lyric planner', path.join(aceRoot, 'models', 'acestep-5Hz-lm-1.7B-Q8_0.gguf'), 1900000000],
      ['ACE lyric engine', path.join(aceRoot, 'build', 'Release', 'ace-lm.exe'), 100000],
      ['ACE music engine', path.join(aceRoot, 'build', 'Release', 'ace-synth.exe'), 100000],
      ['Whisper clarity checker', path.join(ROOT, 'whisper-transcribe-caption.py'), 1000],
      ['Required rhyme reference', path.join(ROOT, 'generated-media', 'rhyme-reference', 'little-jack-horner-reference-30s.wav'), 5000000],
    ].map(([name, filePath, minimumSize]) => {
      let size = 0;
      try { size = fs.statSync(filePath).size; } catch (_) {}
      return { name, ok: size >= minimumSize, detail: size >= minimumSize ? 'Ready' : 'Missing or incomplete' };
    });
    try { fs.accessSync(app.getPath('downloads'), fs.constants.W_OK); checks.push({ name: 'Downloads saving', ok: true, detail: 'Writable' }); }
    catch (_) { checks.push({ name: 'Downloads saving', ok: false, detail: 'Permission denied' }); }
    try {
      await new Promise((resolve, reject) => execFile(findFFmpegExecutable(), ['-version'], { windowsHide: true, timeout: 10000 }, error => error ? reject(error) : resolve()));
      checks.push({ name: 'FFmpeg mastering', ok: true, detail: 'Ready' });
    } catch (_) { checks.push({ name: 'FFmpeg mastering', ok: false, detail: 'Unavailable' }); }
    const sampleReady = [
      path.join(ROOT, 'generated-media', 'song-work', 'little-jack-horner-q8', 'rhyme00.wav'),
      path.join(ROOT, 'generated-media', 'song-work', 'install-test', 'rhyme00.wav'),
    ].some(filePath => fs.existsSync(filePath));
    checks.push({ name: 'Instant preview source', ok: sampleReady, detail: sampleReady ? 'Ready' : 'Generate one song first' });
    return { ok: checks.every(check => check.ok), checks };
  });
  ipcMain.handle('narrate-uploaded-video-voice', async () => ({
    ok: false,
    error: 'Uploaded-video voice cloning is not configured for text synthesis. Select SC3 or Edge TTS.',
  }));
  ipcMain.handle('narrate-edge-tts-timed', async (_event, payload) => {
    const result = await postJsonForBuffer(8427, '/api/preview-mp3', payload, 180000);
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`Timed Edge TTS returned HTTP ${result.statusCode}.`);
    }
    return {
      ok: true,
      statusCode: result.statusCode,
      contentType: String(result.headers?.['content-type'] || 'audio/mpeg'),
      audioBase64: result.buffer.toString('base64'),
      wordTimings: [],
    };
  });
  ipcMain.handle('shutdown-computer-after-export', async (_event, options = {}) => {
    const delaySeconds = Math.max(30, Math.min(600, Number(options.delaySeconds) || 60));
    const reason = String(options.reason || 'Pattan Presentator completed the requested process')
      .replace(/[\r\n"]/g, ' ').slice(0, 120);
    return new Promise(resolve => {
      execFile('shutdown.exe', ['/s', '/t', String(delaySeconds), '/d', 'p:0:0', '/c', reason], {
        windowsHide: true,
        timeout: 10000,
      }, error => resolve(error
        ? { ok: false, error: error.message }
        : { ok: true, delaySeconds }));
    });
  });
  ipcMain.handle('cancel-computer-shutdown', async () => new Promise(resolve => {
    execFile('shutdown.exe', ['/a'], { windowsHide: true, timeout: 10000 }, error => resolve(error
      ? { ok: false, error: error.message }
      : { ok: true }));
  }));

  const ollamaLaunchTools = Object.freeze({
    claude: 'Claude Code',
    chatgpt: 'ChatGPT',
    hermes: 'Hermes Agent',
    openclaw: 'OpenClaw',
    opencode: 'OpenCode',
    'codex-app': 'Codex App',
  });
  ipcMain.handle('get-ollama-launch-status', async () => new Promise(resolve => {
    execFile('ollama', ['--version'], { windowsHide: true, timeout: 10000 }, (error, stdout, stderr) => {
      if (error) return resolve({ ok: false, error: 'Ollama is not available. Start Ollama and press Check Ollama.' });
      resolve({ ok: true, version: String(stdout || stderr || '').trim().replace(/^ollama version\s*/i, '') });
    });
  }));
  ipcMain.handle('launch-ollama-tool', async (_event, requestedTool) => {
    const tool = String(requestedTool || '').toLowerCase();
    if (tool === 'ollama-menu') {
      try {
        const child = spawn('powershell.exe', ['-NoLogo', '-NoExit', '-Command', 'ollama'], {
          cwd: ROOT, detached: true, windowsHide: false, stdio: 'ignore',
        });
        child.unref();
        return { ok: true, tool, name: 'Ollama Menu' };
      } catch (error) {
        return { ok: false, error: `Could not open Ollama: ${error.message}` };
      }
    }
    if (tool === 'codex-app') {
      try {
        // Ollama 0.32 exposes the Codex desktop integration as `chatgpt`
        // (`codex-app` remains an alias). Supplying the installed model and
        // --yes avoids a terminal selector and opens the desktop app directly.
        const child = spawn('ollama', ['launch', 'chatgpt', '--model', 'qwen3.5:4b', '--yes'], {
          cwd: ROOT,
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
        });
        activeOllamaToolProcesses.set(tool, child);
        child.unref();
        return { ok: true, tool, name: 'Codex App' };
      } catch (error) {
        return { ok: false, error: `Could not open Codex App: ${error.message}` };
      }
    }
    const name = ollamaLaunchTools[tool];
    if (!name) return { ok: false, error: 'That Ollama tool is not supported.' };
    try {
      // Launch every supported integration immediately with the strongest
      // installed local model. Terminal-native tools still open their own
      // terminal because that is their user interface.
      const command = `ollama launch ${tool} --model qwen3.5:4b --yes`;
      const child = spawn('powershell.exe', ['-NoLogo', '-NoExit', '-Command', command], {
        cwd: ROOT,
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
      });
      activeOllamaToolProcesses.set(tool, child);
      child.unref();
      return { ok: true, tool, name };
    } catch (error) {
      return { ok: false, error: `Could not open ${name}: ${error.message}` };
    }
  });
  ipcMain.handle('end-ollama-tool-session', async (_event, requestedTool) => {
    const tool = String(requestedTool || '').toLowerCase();
    if (!ollamaLaunchTools[tool] && tool !== 'codex-app') return { ok: false, error: 'That AI tool is not supported.' };
    try {
      const child = activeOllamaToolProcesses.get(tool);
      if (child) {
        killProcessTree(child);
        activeOllamaToolProcesses.delete(tool);
      }
      if (tool === 'openclaw') {
        spawn('powershell.exe', ['-NoLogo', '-Command', 'openclaw gateway stop'], { windowsHide: true, stdio: 'ignore' }).unref();
      } else if (tool === 'hermes') {
        spawn('powershell.exe', ['-NoLogo', '-Command', 'hermes gateway stop'], { windowsHide: true, stdio: 'ignore' }).unref();
      } else if (tool === 'chatgpt' || tool === 'codex-app') {
        spawn('ollama', ['launch', 'chatgpt', '--restore', '--yes'], { cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore' }).unref();
      }
      return { ok: true, name: ollamaLaunchTools[tool] || 'Codex App' };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('end-all-ollama-tool-sessions', async () => {
    for (const child of activeOllamaToolProcesses.values()) {
      try { killProcessTree(child); } catch (_) {}
    }
    activeOllamaToolProcesses.clear();
    try { spawn('powershell.exe', ['-NoLogo', '-Command', 'openclaw gateway stop'], { windowsHide: true, stdio: 'ignore' }).unref(); } catch (_) {}
    try { spawn('powershell.exe', ['-NoLogo', '-Command', 'hermes gateway stop'], { windowsHide: true, stdio: 'ignore' }).unref(); } catch (_) {}
    try { spawn('ollama', ['launch', 'chatgpt', '--restore', '--yes'], { cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore' }).unref(); } catch (_) {}
    return { ok: true };
  });
  ipcMain.handle('open-ollama-update', async () => {
    try {
      await shell.openExternal('https://ollama.com/download/windows');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('restore-codex-app', async () => {
    try {
      // Restoration requires confirmation and may close/restart the Codex app.
      // Run detached so the renderer receives success before Codex restarts.
      const child = spawn('ollama', ['launch', 'chatgpt', '--restore', '--yes'], {
        cwd: ROOT,
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      });
      child.unref();
      return { ok: true, message: 'Original Codex profile restoration started. Codex may restart.' };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  // ————————————— IPC: Restart video export server from renderer ——————————————————
  ipcMain.handle('restart-video-export', () => {
    console.log('[PP] Renderer requested video export server restart.');
    restartServer('FFmpegServer');
    return { ok: true };
  });

  // ————————————— IPC: Extract audio natively to bypass browser memory limits ————
  // Strategy: keep WAV on disk, return the file path — NEVER send the full bytes
  // over IPC (a 35-min WAV is ~67 MB and Electron IPC serialization will crash).
  ipcMain.handle('extract-audio', async (event, opts) => {
    const { videoPath } = opts || {};
    if (!videoPath) return { ok: false, error: 'No video path provided.' };

    function findFFmpeg() {
      try {
        const r = require('child_process').execSync('where ffmpeg', { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0].trim();
        if (r && fs.existsSync(r)) return r;
      } catch (_) {}
      const wp = 'C:\\Users\\patan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe';
      return fs.existsSync(wp) ? wp : 'ffmpeg';
    }

    const FFMPEG = findFFmpeg();
    // Use a stable filename based on the video path hash so re-uploads reuse the cached WAV.
    const crypto = require('crypto');
    const videoHash = crypto.createHash('md5').update(videoPath).digest('hex').slice(0, 12);
    const tmpWav = path.join(ensureCaptionWorkDir('audio-cache'), 'caption-audio-' + videoHash + '.wav');

    try {
      // Skip extraction if cached WAV from the same video already exists
      if (fs.existsSync(tmpWav)) {
        const stat = fs.statSync(tmpWav);
        if (stat.size > 44) {
          console.log('[AudioExtract] Using cached WAV:', tmpWav, '(' + Math.round(stat.size / 1024) + ' KB)');
          return { ok: true, wavPath: tmpWav, size: stat.size };
        }
      }

      console.log('[AudioExtract] Extracting audio from:', path.basename(videoPath));
      await new Promise((resolve, reject) => {
        const proc = spawn(FFMPEG, [
          '-y', '-i', videoPath,
          '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
          tmpWav
        ], { stdio: 'pipe', windowsHide: true });
        let stderr = '';
        proc.stderr && proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('error', err => reject(new Error('FFmpeg: ' + err.message)));
        proc.on('exit', code => code === 0 ? resolve() : reject(new Error('FFmpeg exit ' + code + ': ' + stderr.slice(-500))));
      });

      const size = fs.statSync(tmpWav).size;
      console.log('[AudioExtract] Extracted successfully:', Math.round(size / 1024), 'KB ->', tmpWav);
      // Return the file PATH only — renderer reads chunks on demand via read-audio-chunk
      return { ok: true, wavPath: tmpWav, size };
    } catch (err) {
      console.error('[AudioExtract] Failed:', err);
      if (fs.existsSync(tmpWav)) {
        try { fs.unlinkSync(tmpWav); } catch (_) {}
      }
      return { ok: false, error: err.message };
    }
  });

  // ————————————— IPC: Read a byte-range slice from a WAV file on disk ——————————
  // Allows the renderer to read chunks without loading the whole file into memory.
  ipcMain.handle('read-audio-chunk', async (event, opts) => {
    const { wavPath, offset, length } = opts || {};
    if (!wavPath || offset === undefined || length === undefined) {
      return { ok: false, error: 'Missing wavPath/offset/length' };
    }
    try {
      const fd = fs.openSync(wavPath, 'r');
      const buf = Buffer.alloc(length);
      const bytesRead = fs.readSync(fd, buf, 0, length, offset);
      fs.closeSync(fd);
      return { ok: true, data: buf.slice(0, bytesRead) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

// ————————————— Crash-free Video Transcription (IPC) ————————————————————————————
// Calls Whisper Python directly — works on ANY video type (speech, music, animation)
// Pipeline:
//   1. FFmpeg extracts 16kHz mono WAV from video
//   2. whisper-transcribe-caption.py — faster-whisper, VAD OFF, real word timestamps
//   3. Falls back to HTTP server (port 8428) if Python unavailable
//   4. Returns { ok, text, segments, words } to renderer
ipcMain.handle('transcribe-video', async (event, opts) => {
  const { videoPath, languageHint } = opts || {};
  if (!videoPath) return { ok: false, error: 'No video path provided.' };
  if (!fs.existsSync(videoPath)) return { ok: false, error: `Video file was not found: ${videoPath}` };
  let resumePausedServers = () => {};

  // Find FFmpeg
  function findFFmpeg() {
    try { const r = require('child_process').execSync('where ffmpeg', {encoding:'utf8',timeout:3000}).trim().split('\n')[0].trim(); if (r && fs.existsSync(r)) return r; } catch(_){}
    const wp = 'C:\\Users\\patan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe';
    return fs.existsSync(wp) ? wp : 'ffmpeg';
  }

  const FFMPEG = findFFmpeg();
  const stamp  = Date.now();
  const tmpWav = path.join(ensureCaptionWorkDir('transcribe-audio'), 'caption-' + stamp + '.wav');

  try {
    // Step 1: Extract audio from video as 16kHz mono WAV
    console.log('[Caption] Extracting audio from:', path.basename(videoPath));
    await new Promise((resolve, reject) => {
      const proc = spawn(FFMPEG, [
        '-y', '-i', videoPath,
        '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
        tmpWav
      ], { stdio: 'pipe', windowsHide: true });
      let stderr = '';
      proc.stderr && proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', err => reject(new Error('FFmpeg: ' + err.message)));
      proc.on('exit', code => code === 0 ? resolve() : reject(new Error('FFmpeg exit ' + code + ': ' + stderr.slice(-300))));
    });
    console.log('[Caption] Audio extracted:', Math.round(fs.statSync(tmpWav).size / 1024), 'KB');

    // Whisper-small needs roughly 1.5–2 GB during decoding. Release cached
    // diffusion/Ollama weights and temporarily stop the two largest voice
    // workers so captioning cannot silently fail under memory pressure.
    await fetch('http://127.0.0.1:8432/api/unload', { method: 'POST' }).catch(() => {});
    try {
      for (const model of [PRESENTATOR_LOCAL_MODEL, PRESENTATOR_FAST_MODEL]) {
        await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, keep_alive: 0 }),
        });
      }
    } catch (_) {}
    resumePausedServers = await pauseManagedServersForImage(['AnjaliAI', 'Sc3Singing']);
    try { event.sender.send('caption-transcribe-progress', 3); } catch (_) {}

    // Step 2: Run Whisper directly via Python (no HTTP server needed)
    const venvPy     = path.join(ROOT, '.singing-venv', 'Scripts', 'python.exe');
    const captionScript = path.join(ROOT, 'whisper-transcribe-caption.py');
    const whisperScript = path.join(ROOT, 'whisper-transcribe.py');
    const pyExe      = fs.existsSync(venvPy) ? venvPy : 'python';
    const scriptPath = fs.existsSync(captionScript) ? captionScript : whisperScript;

    console.log('[Caption] Running Whisper:', path.basename(scriptPath), 'via', path.basename(pyExe));

    const langParam = languageHint || 'auto';
    const whisperResult = await new Promise((resolve, reject) => {
      const proc = spawn(pyExe, [scriptPath, tmpWav, langParam, path.basename(videoPath)], {
        stdio: 'pipe',
        windowsHide: true,
        env: { ...process.env, ...SINGING_ENV, PYTHONIOENCODING: 'utf-8' }
      });
      let stdout = '', stderr = '', progressBuffer = '';
      proc.stdout && proc.stdout.on('data', d => {
        const text = d.toString('utf8');
        stdout += text;
        progressBuffer += text;
        const lines = progressBuffer.split(/\r?\n/);
        progressBuffer = lines.pop() || '';
        for (const line of lines) {
          const match = line.match(/^PROGRESS:(\d+)/);
          if (match) {
            const pct = Math.max(0, Math.min(99, Number(match[1]) || 0));
            try { event.sender.send('caption-transcribe-progress', pct); } catch (_) {}
          }
        }
      });
      proc.stderr && proc.stderr.on('data', d => { stderr += d.toString('utf8'); });
      const timer = setTimeout(() => {
        killProcessTree(proc);
        reject(new Error('Whisper timeout (12min)'));
      }, 720000);
      proc.on('error', err => { clearTimeout(timer); reject(new Error('Whisper spawn: ' + err.message)); });
      proc.on('exit', code => {
        clearTimeout(timer);
        try {
          const lastLine = stdout.trim().split('\n').pop() || '{}';
          const json = JSON.parse(lastLine);
          if (json.error) reject(new Error('Whisper: ' + json.error));
          else {
            try { event.sender.send('caption-transcribe-progress', 100); } catch (_) {}
            resolve(json);
          }
        } catch(e) {
          reject(new Error('Whisper parse failed. stderr: ' + stderr.slice(0, 200)));
        }
      });
    });

    console.log('[Caption] Whisper done. Text:', (whisperResult.text || '').length, 'chars,', (whisperResult.words || []).length, 'words');
    return {
      ok:       true,
      text:     whisperResult.text     || '',
      segments: whisperResult.segments || [],
      words:    whisperResult.words    || [],
      language: whisperResult.language || 'en'
    };

  } catch (err) {
    // Fallback: HTTP transcription server (port 8428)
    console.warn('[Caption] Direct Whisper failed:', err.message, '— trying HTTP server fallback');
    try {
      const wavBase64 = fs.readFileSync(tmpWav).toString('base64');
      const result = await postJsonForBuffer(8428, '/api/transcribe', { audioBase64: wavBase64, wordTimestamps: true }, 300000);
      if (result && result.statusCode === 200) {
        const p = JSON.parse(result.buffer.toString('utf8'));
        return {
          ok: true,
          text: p.text || '',
          segments: p.segments || [],
          words: p.words || [],
          language: p.language || p.detected_language || p.lang || (languageHint && languageHint !== 'auto' ? languageHint : 'auto'),
        };
      }
    } catch(e2) {
      console.error('[Caption] HTTP fallback also failed:', e2.message);
    }
    return { ok: false, error: err.message };
  } finally {
    console.log('[Caption] Kept transcription WAV:', tmpWav);
    resumePausedServers();
  }

});

function buildWavChunkBuffer(pcmBuffer, sampleRate = 16000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

async function callGroqWhisperForBuffer(audioBuffer, apiKey, languageHint) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const form = new FormData();
    form.append('model', 'whisper-large-v3');
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    form.append('prompt', 'Transcribe every spoken word exactly as heard. Keep Telugu, Hindi, and English in the original spoken language. Do not translate, summarize, or invent words.');
    if (languageHint && languageHint !== 'auto') form.append('language', languageHint);
    form.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'caption-audio.wav');

    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (resp.ok) return resp.json();

    const errorText = await resp.text();
    if (resp.status !== 429 || attempt === 2) {
      throw new Error(`Groq API ${resp.status}: ${errorText.slice(0, 300)}`);
    }
    const retryAfter = Number(resp.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.ceil(retryAfter * 1000)
      : 32000;
    console.warn(`[CaptionGroq] Rate limited; retrying in ${Math.ceil(waitMs / 1000)} seconds.`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  throw new Error('Groq API rate limit retry failed.');
}

ipcMain.handle('transcribe-video-groq', async (event, opts) => {
  const { videoPath, languageHint = 'auto' } = opts || {};
  if (!videoPath) return { ok: false, error: 'No video path provided.' };
  const apiKey = process.env.GROQ_API_KEY || '';
  if (!apiKey) return { ok: false, error: 'Groq API key is missing.' };

  function findFFmpeg() {
    try { const r = require('child_process').execSync('where ffmpeg', {encoding:'utf8',timeout:3000}).trim().split('\n')[0].trim(); if (r && fs.existsSync(r)) return r; } catch(_){}
    const wp = 'C:\\Users\\patan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe';
    return fs.existsSync(wp) ? wp : 'ffmpeg';
  }

  const FFMPEG = findFFmpeg();
  const stamp = Date.now();
  const tmpWav = path.join(ensureCaptionWorkDir('transcribe-audio'), 'groq-caption-' + stamp + '.wav');

  try {
    console.log('[CaptionGroq] Extracting audio from:', path.basename(videoPath));
    await new Promise((resolve, reject) => {
      const proc = spawn(FFMPEG, [
        '-y', '-i', videoPath,
        '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
        tmpWav
      ], { stdio: 'pipe', windowsHide: true });
      let stderr = '';
      proc.stderr && proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', err => reject(new Error('FFmpeg: ' + err.message)));
      proc.on('exit', code => code === 0 ? resolve() : reject(new Error('FFmpeg exit ' + code + ': ' + stderr.slice(-300))));
    });

    const wav = fs.readFileSync(tmpWav);
    const pcm = wav.slice(44);
    const sampleRate = 16000;
    const bytesPerSecond = sampleRate * 2;
    // A 16 kHz mono WAV is about 1.9 MB/minute. Large chunks keep normal
    // lesson videos within Groq's upload limit and avoid low-tier RPM limits.
    const chunkSeconds = 540;
    const overlapSeconds = 2;
    const chunkBytes = chunkSeconds * bytesPerSecond;
    const stepBytes = (chunkSeconds - overlapSeconds) * bytesPerSecond;
    const totalChunks = Math.max(1, Math.ceil(Math.max(0, pcm.length - overlapSeconds * bytesPerSecond) / stepBytes));
    const allSegments = [];
    const allWords = [];
    const allText = [];
    let detectedLanguage = languageHint !== 'auto' ? languageHint : '';
    let lastSegmentEnd = 0;
    let lastWordEnd = 0;

    for (let i = 0; i < totalChunks; i += 1) {
      const startByte = i * stepBytes;
      const endByte = Math.min(pcm.length, startByte + chunkBytes);
      if (endByte <= startByte) continue;
      const chunkBuffer = buildWavChunkBuffer(pcm.slice(startByte, endByte), sampleRate);
      const timeOffset = startByte / bytesPerSecond;
      const json = await callGroqWhisperForBuffer(chunkBuffer, apiKey, languageHint);
      if (json.language && !detectedLanguage) detectedLanguage = json.language;
      const segments = Array.isArray(json.segments) ? json.segments : [];
      const words = Array.isArray(json.words) ? json.words : [];
      if (json.text) allText.push(String(json.text).trim());
      for (const seg of segments) {
        const text = String(seg.text || '').trim();
        if (!text) continue;
        const start = Number(seg.start || 0) + timeOffset;
        const end = Number(seg.end || start + 0.5) + timeOffset;
        if (start < lastSegmentEnd - 0.35) continue;
        lastSegmentEnd = Math.max(lastSegmentEnd, end);
        allSegments.push({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, text });
      }
      for (const word of words) {
        const text = String(word.word || word.text || '').trim();
        if (!text) continue;
        const start = Number(word.start || 0) + timeOffset;
        const end = Number(word.end || start + 0.25) + timeOffset;
        if (start < lastWordEnd - 0.2) continue;
        lastWordEnd = Math.max(lastWordEnd, end);
        allWords.push({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, word: text });
      }
    }

    return {
      ok: true,
      text: allText.join(' ').replace(/\s+/g, ' ').trim(),
      segments: allSegments,
      words: allWords,
      language: detectedLanguage || languageHint || 'auto',
    };
  } catch (err) {
    console.error('[CaptionGroq] Failed:', err.message);
    return { ok: false, error: err.message };
  } finally {
    console.log('[CaptionGroq] Kept transcription WAV:', tmpWav);
  }
});

// ————————————— Whisper Transcription Helper —————————————————————————————————————
// Spawns whisper-transcribe.py from .singing-venv (has faster-whisper installed).
// Far more accurate than Windows Speech Recognition (port 8428) for Indian accents.
async function runWhisperTranscribe(audioPath, timeoutMs = 1800000) {
  return new Promise((resolve, reject) => {
    const py = fs.existsSync(WHISPER_PYTHON) ? WHISPER_PYTHON : 'python';
    const proc = spawn(py, [WHISPER_SCRIPT, audioPath], {
      stdio: 'pipe',
      windowsHide: true,
      env: { ...process.env, ...SINGING_ENV, PYTHONIOENCODING: 'utf-8' }
    });
    let stdout = '', stderr = '';
    if (proc.stdout) proc.stdout.on('data', d => { stdout += d.toString('utf8'); });
    if (proc.stderr) proc.stderr.on('data', d => { stderr += d.toString('utf8'); });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Whisper transcription timed out after ' + (timeoutMs / 1000) + 's'));
    }, timeoutMs);
    proc.on('error', err => { clearTimeout(timer); reject(new Error('Whisper spawn error: ' + err.message)); });
    proc.on('exit', code => {
      clearTimeout(timer);
      try {
        const lastLine = stdout.trim().split('\n').pop() || '';
        const json = JSON.parse(lastLine);
        if (json.error) reject(new Error('Whisper error: ' + json.error));
        else resolve(String(json.text || '').trim());
      } catch (_) {
        reject(new Error('Whisper output parse failed. stderr: ' + stderr.slice(0, 300) + ' stdout: ' + stdout.slice(0, 100)));
      }
    });
  });
}

// ————————————— American English —> Indian English voice pipeline —————————————————
// Pipeline:
//   1. FFmpeg — 16 kHz mono WAV (for transcription)
//   2. Whisper (faster-whisper tiny) — full transcript text  —  replaces Windows SR
//   3. convertToIndianEnglish() — replace American slang with Indian equivalents
//   4. Chatterbox TTS (port 8426, sc3 Indian voice) — synthesise each sentence
//   5. FFmpeg concat + atempo time-scale to match original video duration
//   6. FFmpeg mux new audio back into video — saved to Downloads

/** Converts American English slang/contractions to Indian English equivalents. */
function convertToIndianEnglish(text) {
  return text
    // contractions — full form
    .replace(/\b(gonna)\b/gi, 'going to')
    .replace(/\b(wanna)\b/gi, 'want to')
    .replace(/\b(gotta)\b/gi, 'have to')
    .replace(/\b(lemme)\b/gi, 'let me')
    .replace(/\b(gimme)\b/gi, 'give me')
    .replace(/\b(kinda)\b/gi, 'kind of')
    .replace(/\b(sorta)\b/gi, 'sort of')
    .replace(/\b(dunno)\b/gi, 'do not know')
    .replace(/\b(y'all|yall)\b/gi, 'all of you')
    .replace(/\b(ain't)\b/gi, 'is not')
    .replace(/\b(can't)\b/gi, 'cannot')
    .replace(/\b(won't)\b/gi, 'will not')
    .replace(/\b(don't)\b/gi, 'do not')
    .replace(/\b(doesn't)\b/gi, 'does not')
    .replace(/\b(didn't)\b/gi, 'did not')
    .replace(/\b(isn't)\b/gi, 'is not')
    .replace(/\b(wasn't)\b/gi, 'was not')
    .replace(/\b(weren't)\b/gi, 'were not')
    .replace(/\b(haven't)\b/gi, 'have not')
    .replace(/\b(hasn't)\b/gi, 'has not')
    .replace(/\b(hadn't)\b/gi, 'had not')
    .replace(/\b(wouldn't)\b/gi, 'would not')
    .replace(/\b(shouldn't)\b/gi, 'should not')
    .replace(/\b(couldn't)\b/gi, 'could not')
    .replace(/\b(it's)\b/gi, 'it is')
    .replace(/\b(that's)\b/gi, 'that is')
    .replace(/\b(there's)\b/gi, 'there is')
    .replace(/\b(they're)\b/gi, 'they are')
    .replace(/\b(we're)\b/gi, 'we are')
    .replace(/\b(you're)\b/gi, 'you are')
    .replace(/\b(I'm)\b/g, 'I am')
    .replace(/\b(I've)\b/g, 'I have')
    .replace(/\b(I'll)\b/g, 'I will')
    .replace(/\b(I'd)\b/g, 'I would')
    .replace(/\b(he's)\b/gi, 'he is')
    .replace(/\b(she's)\b/gi, 'she is')
    .replace(/\b(what's)\b/gi, 'what is')
    .replace(/\b(who's)\b/gi, 'who is')
    .replace(/\b(let's)\b/gi, 'let us')
    // American slang — Indian English
    .replace(/\b(dude|bro|buddy|pal|man)\b/gi, 'friend')
    .replace(/\b(cool|awesome|rad|sick|lit)\b/gi, 'very good')
    .replace(/\b(totally|absolutely|for sure|heck yeah)\b/gi, 'certainly')
    .replace(/\b(nope)\b/gi, 'no')
    .replace(/\b(yep|yup|yeah)\b/gi, 'yes')
    .replace(/\b(okay|ok)\b/gi, 'alright')
    .replace(/\b(stuff|things|items)\b/gi, 'things')
    .replace(/\b(guys)\b/gi, 'students')
    .replace(/\b(kids)\b/gi, 'children')
    .replace(/\b(check out)\b/gi, 'look at')
    .replace(/\b(check)\b/gi, 'verify')
    .replace(/\b(hang on)\b/gi, 'wait a moment')
    .replace(/\b(hold on)\b/gi, 'please wait')
    .replace(/\b(awesome sauce)\b/gi, 'very wonderful')
    .replace(/\b(no worries)\b/gi, 'do not worry')
    .replace(/\b(my bad)\b/gi, 'I am sorry')
    .replace(/\b(for real)\b/gi, 'truly')
    .replace(/\b(right on)\b/gi, 'very good')
    .replace(/\b(what the heck|what the hell)\b/gi, 'what on earth')
    .replace(/\b(a lot of|lots of)\b/gi, 'many')
    .replace(/\b(gonna go ahead and)\b/gi, 'will now')
    .replace(/\b(go ahead and)\b/gi, 'now')
    .replace(/\b(pretty much)\b/gi, 'mostly')
    .replace(/\b(kind of a big deal)\b/gi, 'very important')
    .replace(/\b(a big deal)\b/gi, 'very important')
    // normalize multiple spaces / exclamations
    .replace(/(!{2,})/g, '!')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits text into manageable sentence chunks for TTS (max ~200 chars each). */
function splitIntoSentences(text, maxLen = 200) {
  const raw = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = '';
  for (const sentence of raw) {
    if ((current + ' ' + sentence).trim().length > maxLen && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? current + ' ' + sentence : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

// ── Fast Mode: SC3 Singing timbre transfer for video ──────────────────────────
// Extract audio → SC3 Singing (port 8426) converts timbre → mux back into video
ipcMain.handle('sc3-singing-replace-video', async (event, opts) => {
  const { filePath, outputBaseName, voice = 'sc3' } = opts || {};
  if (!filePath) return { ok: false, error: 'No file path provided.' };

  const tmpDir  = require('os').tmpdir();
  const stamp   = Date.now();
  const safeBase = (outputBaseName || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');
  const FFMPEG  = 'C:\\Users\\patan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe';
  const tempFiles = [];

  function runFF(args, label) {
    return new Promise((resolve, reject) => {
      const proc = spawn(FFMPEG, args, { stdio: 'pipe', windowsHide: true });
      let stderr = '';
      if (proc.stderr) proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', err => reject(new Error('FFmpeg: ' + err.message)));
      proc.on('exit', code => { if (code === 0) resolve(); else reject(new Error('FFmpeg(' + label + ') exit ' + code + ': ' + stderr.slice(-200))); });
    });
  }

  try {
    // 1. Extract audio from video as WAV
    const audioWav = path.join(tmpDir, 'sc3fast-audio-' + stamp + '.wav');
    tempFiles.push(audioWav);
    console.log('[Fast] Extracting audio from video...');
    await runFF(['-y', '-i', filePath, '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', audioWav], 'extract audio');

    // 2. Send to SC3 Singing server (port 8426) for timbre conversion
    console.log('[Fast] Sending to SC3 Singing for timbre conversion...');
    const sc3Raw = await postJsonForBuffer(8426, '/api/convert-song', { filePath: audioWav, voice }, 600000);
    if (!sc3Raw || sc3Raw.statusCode !== 200) throw new Error('SC3 Singing server failed (status ' + sc3Raw?.statusCode + '). Ensure SC3 Singing server is running.');
    const sc3Body = JSON.parse(sc3Raw.buffer.toString('utf8'));
    if (!sc3Body.audioBase64) throw new Error('SC3 Singing returned no audio.');

    // 3. Save converted audio to temp file
    const convertedMp3 = path.join(tmpDir, 'sc3fast-converted-' + stamp + '.mp3');
    tempFiles.push(convertedMp3);
    fs.writeFileSync(convertedMp3, Buffer.from(sc3Body.audioBase64, 'base64'));
    console.log('[Fast] SC3 Singing conversion done. Muxing back into video...');

    // 4. Mux converted audio back into original video
    const outFile = path.join(os.homedir(), 'Downloads', safeBase + '-sc3-fast-' + stamp + '.mp4');
    await runFF(['-y', '-i', filePath, '-i', convertedMp3, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-map', '0:v:0', '-map', '1:a:0', '-shortest', outFile], 'mux video');
    console.log('[Fast] Done:', outFile);

    return { ok: true, outputPath: outFile, indianEnglish: false, sc3Fast: true };
  } catch (err) {
    console.error('[Fast] SC3 Singing video failed:', err.message);
    return { ok: false, error: 'SC3 Fast mode failed: ' + err.message };
  } finally {
    tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch(_) {} });
  }
});

ipcMain.handle('sc3-replace-video-audio', async (event, opts) => {
  const { filePath, outputBaseName, voice = 'sc3' } = opts || {};
  if (!filePath) return { ok: false, error: 'No file path provided.' };

  const tmpDir  = require('os').tmpdir();
  const stamp   = Date.now();
  const safeBase = (outputBaseName || 'sc3-video').replace(/[^a-zA-Z0-9_-]/g, '_');
  const inputMp3 = path.join(tmpDir, 'sc3-full-' + stamp + '.mp3');
  const outputMp4 = path.join(os.homedir(), 'Downloads', safeBase + '-sc3-' + stamp + '.mp4');
  const FFMPEG = 'C:\\Users\\patan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe';
  const FFPROBE = FFMPEG.replace('ffmpeg.exe', 'ffprobe.exe');

  function runFFmpeg(args, label) {
    return new Promise((resolve, reject) => {
      console.log('[PP] SC3 ffmpeg:', label || args.slice(-1)[0]);
      const proc = spawn(FFMPEG, args, { stdio: 'pipe', windowsHide: true });
      let stderr = '';
      if (proc.stderr) proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', err => reject(new Error('FFmpeg: ' + err.message)));
      proc.on('exit', code => {
        if (code === 0) resolve();
        else reject(new Error('FFmpeg exit ' + code + ': ' + stderr.slice(-300)));
      });
    });
  }

  // Get audio duration in seconds using ffprobe
  function getAudioDuration(filePath_) {
    return new Promise((resolve) => {
      const proc = spawn(FFPROBE, [
        '-v', 'quiet', '-show_entries', 'format=duration',
        '-of', 'csv=p=0', filePath_
      ], { stdio: 'pipe', windowsHide: true });
      let out = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.on('exit', () => resolve(parseFloat(out.trim()) || 0));
      proc.on('error', () => resolve(0));
    });
  }

  // Call SC3 server with a file path — returns Buffer of converted MP3 or throws
  async function sc3ConvertChunk(chunkPath, chunkName) {
    console.log('[PP] SC3 converting chunk:', chunkName);
    const sc3Raw = await postJsonForBuffer(8426, '/api/convert-song', {
      filePath: chunkPath,
      outputFileName: chunkName + '.mp3',
      saveToDownloads: false,
      voice
    }, 600000);
    const bodyText = sc3Raw && sc3Raw.buffer ? sc3Raw.buffer.toString('utf8') : null;
    if (!sc3Raw || sc3Raw.statusCode !== 200) {
      let errMsg = 'SC3 error status ' + (sc3Raw ? sc3Raw.statusCode : 'none');
      if (bodyText) { try { errMsg = JSON.parse(bodyText).error || bodyText.slice(0, 200); } catch (_) { errMsg = bodyText.slice(0, 200); } }
      throw new Error(errMsg);
    }
    const j = JSON.parse(bodyText);
    if (!j.audioBase64) throw new Error(j.error || 'SC3 returned no audio.');
    return Buffer.from(j.audioBase64, 'base64');
  }

  // Wait for SC3 converter to be warmed (GET /health, not POST)
  async function waitForSc3Warmed(maxWaitMs) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const j = await new Promise((resolve) => {
        const req = http.get({ hostname: '127.0.0.1', port: 8426, path: '/health', agent: false }, (res) => {
          const chunks = []; res.on('data', d => chunks.push(d));
          res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { resolve(null); } });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(5000, () => { req.destroy(); resolve(null); });
      });
      if (j && j.converterWarmed) { console.log('[PP] SC3: converter ready.'); return true; }
      if (j) console.log('[PP] SC3: waiting for converter to warm...');
      await new Promise(r => setTimeout(r, 5000));
    }
    console.warn('[PP] SC3: warm timeout — proceeding anyway.');
    return false;
  }

  const tempFiles = [inputMp3];
  try {
    // 1. Extract full audio as MP3
    console.log('[PP] SC3 replace: extracting audio from', path.basename(filePath));
    await runFFmpeg([
      '-y', '-i', filePath,
      '-vn', '-acodec', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      inputMp3
    ], 'extract mp3');

    const totalSecs = await getAudioDuration(inputMp3);
    const sizeMb = Math.round(fs.statSync(inputMp3).size / 1024 / 1024 * 10) / 10;
    console.log('[PP] SC3 replace: audio', Math.round(totalSecs), 'sec,', sizeMb, 'MB');

    // —————— Step A: Try Indian English pipeline (Transcribe —> Convert —> Chatterbox TTS) ——————
    let finalAudioMp3 = null;
    let usedIndianPipeline = false;

    try {
      console.log('[PP] SC3 Indian English: transcribing audio for slang conversion...');

      // Extract 16 kHz mono WAV for transcription
      const transcribeWav = path.join(tmpDir, 'sc3-transcribe-' + stamp + '.wav');
      tempFiles.push(transcribeWav);
      await runFFmpeg([
        '-y', '-i', filePath,
        '-vn', '-ar', '16000', '-ac', '1',
        transcribeWav
      ], 'extract transcribe wav');

      // Transcribe with Whisper (faster-whisper tiny — accurate for Indian English)
      console.log('[PP] SC3 Indian English: transcribing with Whisper...');
      const transcript = await runWhisperTranscribe(transcribeWav, 300000);
      if (!transcript) throw new Error('Whisper returned no speech. Video may have no voice audio.');


      console.log('[PP] SC3 Indian English: transcript', transcript.length, 'chars');

      // Convert American slang/contractions —> Indian English
      const indianText = convertToIndianEnglish(transcript);
      console.log('[PP] SC3 Indian English: converted text', indianText.length, 'chars');

      // Synthesise with Chatterbox TTS (port 8426, sc3 Indian voice), sentence by sentence
      const sentences = splitIntoSentences(indianText, 120);
      console.log('[PP] SC3 Indian English: synthesising', sentences.length, 'sentence(s)...');
      const ttsWavFiles = [];
      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        console.log('[PP] SC3 Indian English: TTS', i + 1, '/', sentences.length);
        const ttsRaw = await postJsonForBuffer(8426, '/api/narrate', { text: sentence, voice }, 180000);
        if (!ttsRaw || ttsRaw.statusCode !== 200)
          throw new Error('Chatterbox TTS failed for sentence ' + (i + 1));
        const wavFile = path.join(tmpDir, 'sc3-tts-' + stamp + '-' + i + '.wav');
        tempFiles.push(wavFile);
        fs.writeFileSync(wavFile, ttsRaw.buffer);
        ttsWavFiles.push(wavFile);
      }

      // Concatenate WAV files
      const ttsConcatWav = path.join(tmpDir, 'sc3-tts-concat-' + stamp + '.wav');
      tempFiles.push(ttsConcatWav);
      if (ttsWavFiles.length === 1) {
        fs.copyFileSync(ttsWavFiles[0], ttsConcatWav);
      } else {
        const concatList = path.join(tmpDir, 'sc3-tts-list-' + stamp + '.txt');
        tempFiles.push(concatList);
        fs.writeFileSync(concatList, ttsWavFiles.map(f => "file '" + f.replace(/\\/g, '/') + "'").join('\n'));
        await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-acodec', 'pcm_s16le', ttsConcatWav], 'concat tts wavs');
      }

      // Time-scale TTS to match video duration using atempo
      const ttsSecs = await getAudioDuration(ttsConcatWav);
      const speedRatio = ttsSecs > 0 ? (ttsSecs / totalSecs) : 1.0;
      console.log('[PP] SC3 Indian English: TTS', Math.round(ttsSecs), 's / video', Math.round(totalSecs), 's, ratio', speedRatio.toFixed(3));

      function buildAtempoFilter(ratio) {
        const r = Math.max(0.25, Math.min(4.0, ratio));
        if (r >= 0.5 && r <= 2.0) return 'atempo=' + r.toFixed(4);
        const half = Math.sqrt(r).toFixed(4);
        return 'atempo=' + half + ',atempo=' + half;
      }

      finalAudioMp3 = path.join(tmpDir, 'sc3-indian-final-' + stamp + '.mp3');
      tempFiles.push(finalAudioMp3);
      const needsStretch = Math.abs(speedRatio - 1.0) >= 0.02;
      const ffArgs = needsStretch
        ? ['-y', '-i', ttsConcatWav, '-filter:a', buildAtempoFilter(speedRatio), '-acodec', 'libmp3lame', '-b:a', '128k', finalAudioMp3]
        : ['-y', '-i', ttsConcatWav, '-acodec', 'libmp3lame', '-b:a', '128k', finalAudioMp3];
      await runFFmpeg(ffArgs, needsStretch ? 'atempo time-scale' : 'wav to mp3');
      usedIndianPipeline = true;
      console.log('[PP] SC3 Indian English: synthesis complete!');

    } catch (indErr) {
      // Pipeline failed — do not fall back to SC3 singing model, always use Chatterbox
      console.error('[PP] Chatterbox Indian English pipeline failed:', indErr.message);
      throw new Error('Chatterbox voice pipeline failed: ' + indErr.message + '. Please ensure the transcription server (port 8428) and Chatterbox server (port 8426) are running.');
    }

    // Mux final audio (Indian English TTS or SC3 timbre) into original video
    console.log('[PP] SC3 replace: muxing', usedIndianPipeline ? 'Indian English TTS' : 'SC3 timbre', 'audio into video...');
    await runFFmpeg([
      '-y', '-i', filePath, '-i', finalAudioMp3,
      '-c:v', 'copy', '-map', '0:v:0', '-map', '1:a:0', '-shortest',
      outputMp4
    ], 'mux video');

    console.log('[PP] SC3 replace: complete ->', path.basename(outputMp4),
      usedIndianPipeline ? '(Indian English voice)' : '(SC3 timbre)');
    return { ok: true, outputPath: outputMp4, fileName: path.basename(outputMp4), indianEnglish: usedIndianPipeline };

  } catch (err) {
    console.error('[PP] SC3 replace error:', err.message);
    return { ok: false, error: err.message };
  } finally {
    for (const f of tempFiles) { try { fs.unlinkSync(f); } catch (_) {} }
  }
});

// ————————————— Chatterbox sc3 Voice Narration for Audio Files ———————————————————
// Pipeline: Transcribe audio (port 8428) —> Indian English slang —> Chatterbox TTS (port 8426)
// Used by Sing Song "Convert Voice —> Indian English" button for audio files.
ipcMain.handle('sc3-narrate-audio', async (event, opts) => {
  const { filePath, outputBaseName, voice = 'sc3' } = opts || {};
  if (!filePath) return { ok: false, error: 'No file path provided.' };

  const tmpDir   = require('os').tmpdir();
  const stamp    = Date.now();
  const safeBase = (outputBaseName || 'sc3-audio').replace(/[^a-zA-Z0-9_-]/g, '_');
  const FFMPEG   = 'C:\\Users\\patan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe';
  const outputWav = path.join(os.homedir(), 'Downloads', safeBase + '-sc3-' + stamp + '.wav');
  const tempFiles = [];

  function runFFmpeg2(args, label) {
    return new Promise((resolve, reject) => {
      const proc = spawn(FFMPEG, args, { stdio: 'pipe', windowsHide: true });
      let stderr = '';
      if (proc.stderr) proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', err => reject(new Error('FFmpeg: ' + err.message)));
      proc.on('exit', code => {
        if (code === 0) resolve();
        else reject(new Error('FFmpeg exit ' + code + ': ' + stderr.slice(-200)));
      });
    });
  }

  try {
    // 1. Extract 16 kHz mono WAV for transcription
    const transcribeWav = path.join(tmpDir, 'narrate-tx-' + stamp + '.wav');
    tempFiles.push(transcribeWav);
    await runFFmpeg2(['-y', '-i', filePath, '-vn', '-ar', '16000', '-ac', '1', transcribeWav], 'extract 16k wav');

    // 2. Transcribe with Whisper (faster-whisper tiny â€” accurate Indian English support)
    console.log('[PP] sc3-narrate-audio: transcribing with Whisper...', path.basename(filePath));
    const transcript = await runWhisperTranscribe(transcribeWav, 300000);
    if (!transcript) throw new Error('Whisper could not detect speech. Ensure the file contains clear voice recordings.');
    console.log('[PP] sc3-narrate-audio: transcript', transcript.length, 'chars');

    // 3. Convert American slang —> Indian English
    const indianText = convertToIndianEnglish(transcript);
    console.log('[PP] sc3-narrate-audio: converted text', indianText.length, 'chars');

    // 4. Synthesise each sentence with Chatterbox TTS (port 8426, sc3 voice clone)
    const sentences = splitIntoSentences(indianText, 120);
    console.log('[PP] sc3-narrate-audio: synthesising', sentences.length, 'sentence(s)...');
    const ttsWavFiles = [];
    for (let i = 0; i < sentences.length; i++) {
      console.log('[PP] sc3-narrate-audio: TTS sentence', i + 1, '/', sentences.length);
      const ttsRaw = await postJsonForBuffer(8426, '/api/narrate', { text: sentences[i], voice }, 180000);
      if (!ttsRaw || ttsRaw.statusCode !== 200)
        throw new Error('Chatterbox TTS failed for sentence ' + (i + 1));
      const wavFile = path.join(tmpDir, 'narrate-tts-' + stamp + '-' + i + '.wav');
      tempFiles.push(wavFile);
      fs.writeFileSync(wavFile, ttsRaw.buffer);
      ttsWavFiles.push(wavFile);
    }

    // 5. Concatenate all TTS WAV files
    let finalWav;
    if (ttsWavFiles.length === 1) {
      finalWav = ttsWavFiles[0];
    } else {
      finalWav = path.join(tmpDir, 'narrate-concat-' + stamp + '.wav');
      tempFiles.push(finalWav);
      const concatList = path.join(tmpDir, 'narrate-list-' + stamp + '.txt');
      tempFiles.push(concatList);
      fs.writeFileSync(concatList, ttsWavFiles.map(f => "file '" + f.replace(/\\/g, '/') + "'").join('\n'));
      await runFFmpeg2(['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-acodec', 'pcm_s16le', finalWav], 'concat tts');
    }

    // 6. Save to Downloads
    fs.copyFileSync(finalWav, outputWav);
    console.log('[PP] sc3-narrate-audio: saved ->', path.basename(outputWav));
    return { ok: true, outputPath: outputWav, fileName: path.basename(outputWav), indianEnglish: true };

  } catch (err) {
    console.error('[PP] sc3-narrate-audio error:', err.message);
    return { ok: false, error: err.message };
  } finally {
    for (const f of tempFiles) { try { fs.unlinkSync(f); } catch (_) {} }
  }
});

// ————————————— Native Caption Eraser (delogo blur filter) —————————————
ipcMain.handle('erase-captions', async (event, opts) => {
  const { filePath } = opts || {};
  if (!filePath) return { ok: false, error: 'No file path provided.' };

  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const { spawn } = require('child_process');

  const tmpDir  = os.tmpdir();
  const stamp   = Date.now();
  const baseName = path.basename(filePath, path.extname(filePath));
  const outputMp4 = path.join(os.homedir(), 'Downloads', baseName + '-erased-' + stamp + '.mp4');
  const FFMPEG = 'C:\\Users\\patan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe';
  const FFPROBE = FFMPEG.replace('ffmpeg.exe', 'ffprobe.exe');

  function getVideoDimensions(path_) {
    return new Promise((resolve) => {
      const proc = spawn(FFPROBE, [
        '-v', 'quiet', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=s=x:p=0', path_
      ], { stdio: 'pipe', windowsHide: true });
      let out = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.on('exit', () => {
        const parts = out.trim().split('x');
        const w = parseInt(parts[0]) || 1920;
        const h = parseInt(parts[1]) || 1080;
        resolve({ width: w, height: h });
      });
      proc.on('error', () => resolve({ width: 1920, height: 1080 }));
    });
  }

  try {
    const { width, height } = await getVideoDimensions(filePath);
    console.log('[PP] Erase: video dimensions ' + width + 'x' + height);

    // Box parameters: cover only the caption line precisely (bottom 5.5% height, 70% width, centered at 88% Y)
    const boxW = Math.round(width * 0.70);
    const boxH = Math.round(height * 0.055);
    const boxX = Math.round((width - boxW) / 2);
    const boxY = Math.round(height * 0.88);

    const delogoFilter = 'delogo=x=' + boxX + ':y=' + boxY + ':w=' + boxW + ':h=' + boxH;
    console.log('[PP] Erase: applying delogo filter: ' + delogoFilter);

    await new Promise((resolve, reject) => {
      const proc = spawn(FFMPEG, [
        '-y', '-i', filePath,
        '-vf', delogoFilter,
        '-c:a', 'copy',
        outputMp4
      ], { stdio: 'pipe', windowsHide: true });

      let stderr = '';
      if (proc.stderr) proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', err => reject(new Error('FFmpeg: ' + err.message)));
      proc.on('exit', code => {
        if (code === 0) resolve();
        else reject(new Error('FFmpeg exit ' + code + ': ' + stderr.slice(-300)));
      });
    });

    console.log('[PP] Erase: caption erasing complete -> ' + outputMp4);
    return { ok: true, outputPath: outputMp4, fileName: path.basename(outputMp4) };

  } catch (err) {
    console.error('[PP] Erase: caption erasing error:', err.message);
    return { ok: false, error: err.message };
  }
});



// IPC: Merge Narration Audio into Video

// Mixes a narration WAV/MP3 into a video so Whisper can transcribe the real voice

ipcMain.handle('merge-audio-into-video', async (event, opts) => {

  const { videoPath, audioPath, outputName } = opts || {};

  if (!videoPath) return { ok: false, error: 'No video path.' };

  if (!audioPath) return { ok: false, error: 'No audio path.' };

  function findFF() {

    try { const r = require('child_process').execSync('where ffmpeg',{encoding:'utf8',timeout:3000}).trim().split('\n')[0].trim(); if(r&&fs.existsSync(r))return r; } catch(_){}

    const wp='C:\\Users\\patan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe';

    return fs.existsSync(wp)?wp:'ffmpeg';

  }

  const FFMPEG = findFF();

  const outFile = path.join(os.homedir(), 'Downloads', outputName || ('merged_' + Date.now() + '.mp4'));

  try {

    await new Promise((resolve, reject) => {

      const proc = spawn(FFMPEG, [

        '-y', '-i', videoPath, '-i', audioPath,

        '-filter_complex', '[0:a?][1:a]amix=inputs=2:duration=first:dropout_transition=0[aout]',

        '-map', '0:v:0', '-map', '[aout]',

        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', outFile

      ], { stdio: 'pipe', windowsHide: true });

      let stderr = '';

      proc.stderr && proc.stderr.on('data', d => { stderr += d.toString(); });

      proc.on('error', e => reject(new Error('FFmpeg: ' + e.message)));

      proc.on('exit', code => code===0 ? resolve() : reject(new Error('FFmpeg exit '+code+': '+stderr.slice(-200))));

    });

    return { ok: true, outputPath: outFile, fileName: path.basename(outFile) };

  } catch(err) {

    return { ok: false, error: err.message };

  }

});

ipcMain.handle('export-translated-video', async (_event, opts) => {
  const { videoPath, audioBase64, outputName } = opts || {};
  if (!videoPath || !fs.existsSync(videoPath)) return { ok: false, error: 'Source video is unavailable.' };
  if (!audioBase64) return { ok: false, error: 'Translated audio is missing.' };
  const ffmpeg = findFFmpegExecutable();
  const workDir = ensureCaptionWorkDir('translated-audio');
  const stamp = Date.now();
  const audioPath = path.join(workDir, `translated-${stamp}.mp3`);
  const safeName = String(outputName || `translated-${stamp}.mp4`).replace(/[<>:"/\\|?*]/g, '_');
  const outputPath = path.join(path.dirname(videoPath), safeName);
  try {
    fs.writeFileSync(audioPath, Buffer.from(String(audioBase64), 'base64'));
    await new Promise((resolve, reject) => {
      const child = spawn(ffmpeg, [
        '-y', '-i', videoPath, '-i', audioPath,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', outputPath,
      ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-6000); });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-800)}`)));
    });
    return { ok: true, outputPath, fileName: path.basename(outputPath) };
  } catch (error) {
    return { ok: false, error: error.message };
  }

});




// ————————————— IPC: Burn Captions via FFmpeg (Express Export) ———————————————————
// Uses FFmpeg to burn subtitle text directly onto video frames.
// Audio is COPIED (no re-encode) → zero quality loss, instant mux.
// Saves to Downloads as captioned_video_<timestamp>.mp4
function findCaptionFFmpegPath() {
  try {
    const { execSync } = require('child_process');
    const result = execSync('where ffmpeg', { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0].trim();
    if (result && require('fs').existsSync(result)) return result;
  } catch (_) {}
  const wingetPath = 'C:\\Users\\patan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe';
  if (require('fs').existsSync(wingetPath)) return wingetPath;
  throw new Error('FFmpeg not found. Install it via: winget install Gyan.FFmpeg.Essentials');
}

ipcMain.handle('probe-video-meta', async (event, opts) => {
  const { videoPath } = opts || {};
  if (!videoPath) return { ok: false, error: 'No video path provided.' };
  try {
    const { execFileSync } = require('child_process');
    const FFMPEG = findCaptionFFmpegPath();
    const ffprobe = path.join(path.dirname(FFMPEG), path.basename(FFMPEG).replace('ffmpeg', 'ffprobe'));
    const raw = execFileSync(ffprobe, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      videoPath,
    ], { encoding: 'utf8', timeout: 15000 });
    const parsed = JSON.parse(raw || '{}');
    const stream = parsed.streams && parsed.streams[0] ? parsed.streams[0] : {};
    return {
      ok: true,
      width: Number(stream.width) || 0,
      height: Number(stream.height) || 0,
      duration: Number(parsed.format && parsed.format.duration) || 0,
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('burn-captions', async (event, opts) => {
  const { videoPath, captions, fontSize = 28, position = 'bottom', assContent } = opts || {};
  if (!videoPath) return { ok: false, error: 'No video path provided.' };
  if (!assContent && (!captions || !captions.length)) return { ok: false, error: 'No captions or assContent provided.' };

  // ── Dynamic FFmpeg detection ─────────────────────────────────────────────────
  function findFFmpegPath() {
    return findCaptionFFmpegPath();
  }
  const FFMPEG = findFFmpegPath();
  const tmpDir  = ensureCaptionWorkDir('burn-subtitles');
  const stamp   = Date.now();
  const baseName = path.basename(videoPath, path.extname(videoPath));
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  const preferredOutFile = path.join(downloadsDir, baseName + '_captioned.mp4');
  const outFile = fs.existsSync(preferredOutFile)
    ? path.join(downloadsDir, baseName + '_captioned_' + stamp + '.mp4')
    : preferredOutFile;
  const partialOutFile = path.join(os.homedir(), 'Downloads', baseName + '_captioned.' + stamp + '.part.mp4');
  const burnLogPath = path.join(ensureCaptionWorkDir('logs'), 'caption-burn.log');

  let assPath = '';
  let srtPath = '';
  let subFilter = '';

  // ── 1. Build SRT file from caption chunks ────────────────────────────────────
  function toSrtTime(secs) {
    const h   = Math.floor(secs / 3600);
    const m   = Math.floor((secs % 3600) / 60);
    const s   = Math.floor(secs % 60);
    const ms  = Math.round((secs % 1) * 1000);
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' +
           String(s).padStart(2,'0') + ',' + String(ms).padStart(3,'0');
  }

  try {
    if (assContent) {
      // Burn structured ASS subtitles directly (preserves colors, outlines, box backgrounds, fonts)
      assPath = path.join(tmpDir, 'captions-' + stamp + '.ass');
      require('fs').writeFileSync(assPath, assContent, 'utf8');
      console.log('[BurnCaptions] ASS written:', assPath);
      const safeAss = assPath.split('\\').join('/').split(':').join('\\:');
      // Point libass to the Windows system fonts folder so non-Latin scripts
      // (Hindi, Telugu, Urdu, Arabic, Chinese, etc.) render with the correct
      // Nirmala UI / Tahoma / system font instead of showing tofu boxes.
      // FFmpeg filter escaping: colon must be \: and backslash must be \\
      const winFonts = 'C\\:/Windows/Fonts';
      subFilter = `subtitles='${safeAss}':fontsdir='${winFonts}'`;
    } else {
      // Fallback SRT subtitles
      srtPath = path.join(tmpDir, 'captions-' + stamp + '.srt');
      const srtLines = [];
      captions.forEach((c, i) => {
        let start = 0;
        let end   = 2;
        if (typeof c.start === 'number' || (typeof c.start === 'string' && c.start !== '')) {
          start = Number(c.start);
        } else if (Array.isArray(c.timestamp)) {
          start = Number(c.timestamp[0]) || 0;
        }
        if (typeof c.end === 'number' || (typeof c.end === 'string' && c.end !== '')) {
          end = Number(c.end);
        } else {
          end = Number(c.end) || 0;
        }
        start = Math.max(0, start || 0);
        end   = Math.max(start + 0.1, end || start + 2);
        const text  = String(c.text || '').trim().replace(/[<>]/g, '');
        if (!text) return;
        srtLines.push(String(i + 1));
        srtLines.push(toSrtTime(start) + ' --> ' + toSrtTime(end));
        srtLines.push(text);
        srtLines.push('');
      });

      require('fs').writeFileSync(srtPath, srtLines.join('\n'), 'utf8');
      console.log('[BurnCaptions] SRT written:', srtPath, '(' + captions.length + ' captions)');

      const safeSrt    = srtPath.split('\\').join('/').split(':').join('\\:');
      subFilter  = `subtitles='${safeSrt}':force_style='FontName=Arial,FontSize=${fontSize},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Bold=1,Outline=2,Shadow=1,Alignment=2,MarginV=40'`;
    }

    // ── 2. FFmpeg: burn subtitles onto video, copy audio exactly ──────────────────────
    // First probe total duration/bitrate so progress is accurate and export
    // quality is never lower than the source video bitrate.
    let totalDurationSec = 0;
    let sourceVideoBitrate = 0;
    try {
      const { execSync } = require('child_process');
      // Safely replace only the file name (ffmpeg.exe -> ffprobe.exe), not parent directory names
      const ffprobe = path.join(path.dirname(FFMPEG), path.basename(FFMPEG).replace('ffmpeg', 'ffprobe'));
      const probeOut = execSync(
        `"${ffprobe}" -v error -select_streams v:0 -show_entries stream=bit_rate:format=duration,bit_rate -of json "${videoPath}"`,
        { encoding: 'utf8', timeout: 10000 }
      ).trim();
      const probe = JSON.parse(probeOut || '{}');
      totalDurationSec = parseFloat(probe && probe.format && probe.format.duration) || 0;
      const streamBitrate = Number(probe && probe.streams && probe.streams[0] && probe.streams[0].bit_rate) || 0;
      const formatBitrate = Number(probe && probe.format && probe.format.bit_rate) || 0;
      sourceVideoBitrate = Math.max(streamBitrate, formatBitrate);
    } catch (_) {}

    await new Promise((resolve, reject) => {
      const videoQualityArgs = sourceVideoBitrate > 0
        ? [
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-b:v', String(Math.ceil(sourceVideoBitrate * 1.15)),
            '-maxrate', String(Math.ceil(sourceVideoBitrate * 1.75)),
            '-bufsize', String(Math.ceil(sourceVideoBitrate * 3.5)),
            '-pix_fmt', 'yuv420p',
          ]
        : [
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '16',
            '-pix_fmt', 'yuv420p',
          ];
      const proc = spawn(FFMPEG, [
        '-y', '-i', videoPath,
        '-map', '0:v:0',
        '-map', '0:a?',
        '-vf', subFilter,
        ...videoQualityArgs,
        '-c:a', 'copy',          // ← copy audio stream as-is (no re-encode = perfect audio)
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        '-progress', 'pipe:2',   // emit progress lines to stderr
        partialOutFile
      ], { stdio: 'pipe', windowsHide: true });

      // Kill process if it hangs for more than 30 minutes
      const hangTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (_) {}
        reject(new Error('FFmpeg timed out after 30 minutes'));
      }, 30 * 60 * 1000);

      let stderr = '';
      if (proc.stderr) {
        proc.stderr.on('data', d => {
          const chunk = d.toString();
          stderr += chunk;
          // Parse real progress from FFmpeg -progress output (out_time_us or out_time_ms = XXXXXX microseconds)
          const m = chunk.match(/out_time_(?:us|ms)=(\d+)/);
          if (m && totalDurationSec > 0) {
            const elapsedSec = parseInt(m[1], 10) / 1e6;
            const pct = Math.min(94, Math.round((elapsedSec / totalDurationSec) * 94));
            event.sender.send('burn-captions-progress', { videoPath, pct });
          }
        });
      }
      proc.on('error', err => { clearTimeout(hangTimer); reject(new Error('FFmpeg spawn: ' + err.message)); });
      proc.on('exit', code => {
        clearTimeout(hangTimer);
        if (code === 0) {
          event.sender.send('burn-captions-progress', { videoPath, pct: 98, phase: 'finalizing' });
          resolve();
        }
        else reject(new Error('FFmpeg exit ' + code + ': ' + stderr.slice(-300)));
      });
    });

    try {
      if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
      fs.renameSync(partialOutFile, outFile);
    } catch (moveErr) {
      throw new Error('Could not finalize captioned video: ' + (moveErr.message || String(moveErr)));
    }

    console.log('[BurnCaptions] Done:', path.basename(outFile));
    return { ok: true, outputPath: outFile, fileName: path.basename(outFile), assPath, srtPath };

  } catch (err) {
    try { if (partialOutFile && fs.existsSync(partialOutFile)) fs.unlinkSync(partialOutFile); } catch (_) {}
    console.error('[BurnCaptions] Error:', err.message);
    try {
      fs.appendFileSync(
        burnLogPath,
        `[${new Date().toISOString()}] ${path.basename(videoPath)}\n${err.stack || err.message || String(err)}\n\n`,
        'utf8'
      );
    } catch (_) {}
    return { ok: false, error: err.message };
  } finally {
    if (srtPath) console.log('[BurnCaptions] Kept SRT:', srtPath);
    if (assPath) console.log('[BurnCaptions] Kept ASS:', assPath);
  }
});

// ─── IPC: Open a file/folder with the OS default handler ────────────────────
ipcMain.handle('open-file', async (event, filePath) => {
  if (!filePath) return { ok: false, error: 'No path provided' };
  try {
    const { shell } = require('electron');
    await shell.openPath(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

  ipcMain.handle('generate-mobile-link', async () => {
    console.log('[Mobile Tunnel] Generate/Refresh requested via IPC...');
    startMobileAppTunnelService(false).catch(error => console.error('[Mobile Tunnel] Refresh failed:', error.message));
    return { status: 'requested' };
  });

  ipcMain.handle('get-mobile-link', async () => {
    const linkFile = path.join(ROOT, 'temp', 'active-mobile-link.json');
    const pubFile = path.join(ROOT, 'public', 'mobile-link.json');
    const getWifiIp = () => {
      const ifaces = os.networkInterfaces();
      for (const k of Object.keys(ifaces)) {
        for (const f of ifaces[k]) {
          if (f.family === 'IPv4' && !f.internal) return f.address;
        }
      }
      return '192.168.29.161';
    };
    let data = { wifiUrl: `http://${getWifiIp()}:${MOBILE_HTTP_PORT}`, mobileUrl: ``, updatedAt: new Date().toISOString() };
    if (fs.existsSync(linkFile)) {
      try { data = JSON.parse(fs.readFileSync(linkFile, 'utf8')); } catch (_) {}
    } else if (fs.existsSync(pubFile)) {
      try { data = JSON.parse(fs.readFileSync(pubFile, 'utf8')); } catch (_) {}
    }
    return data;
  });

  ipcMain.handle('get-whatsapp-auto-send', async () => ({
    ok: true,
    enabled: Boolean(getMobilePreferences().whatsappAutoSend),
  }));

  ipcMain.handle('set-whatsapp-auto-send', async (_event, enabled) => {
    const preferences = saveMobilePreferences({ whatsappAutoSend: Boolean(enabled) });
    return {
      ok: true,
      enabled: preferences.whatsappAutoSend,
      message: preferences.whatsappAutoSend
        ? 'WhatsApp link auto-send enabled. Running processes were not changed.'
        : 'WhatsApp link auto-send disabled. Mobile access and running processes remain active.',
    };
  });

  // ————————————— IPC: Get server health status ———————————————————————————————————
  ipcMain.handle('get-server-health', async () => {
    const [anjaliAlive, edgeTtsAlive, transcribeAlive, videoExportAlive, sc3SingingAlive, imageGeneratorAlive, viteAlive] = await Promise.all([
      pingPort(8426),
      pingPort(8427),
      pingPort(8428),
      pingPort(8430),
      pingPort(8431),
      pingPort(8432, '/health'),
      pingPort(5173, '/')
    ]);
    return {
      anjali:      anjaliAlive,
      edgeTts:     edgeTtsAlive,
      transcribe:  transcribeAlive,
      videoExport: videoExportAlive,
      sc3Singing:  sc3SingingAlive,
      imageGenerator: imageGeneratorAlive,
      vite:        viteAlive,
      configured: {
        anjali: Boolean(servers.AnjaliAI),
        edgeTts: Boolean(servers.EdgeTTS),
        transcribe: Boolean(servers.TranscriptionServer),
        videoExport: Boolean(servers.FFmpegServer),
        sc3Singing: Boolean(servers.Sc3Singing),
        imageGenerator: Boolean(servers.ImageGenerator),
      },
      timestamp: Date.now()
    };
  });

  win.webContents.on('did-finish-load', () => {
    const linkFile = path.join(ROOT, 'temp', 'active-mobile-link.json');
    if (fs.existsSync(linkFile)) {
      try {
        const linkData = JSON.parse(fs.readFileSync(linkFile, 'utf8'));
        win.webContents.send('mobile-link-updated', linkData);
      } catch (_) {}
    }
  });

  win.on('closed', () => killAll());

  // Block any navigation away from the app:// origin
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://voice/')) {
      event.preventDefault();
      console.log('[PP] Blocked renderer navigation to:', url.substring(0, 80));
    }
  });

  // If page somehow navigates to wrong URL, redirect back
  win.webContents.on('did-navigate', (_event, url) => {
    if (!url.startsWith('app://voice/') && !url.startsWith('http://127.0.0.1:5173')) {
      console.warn('[PP] Wrong navigation detected, reloading app...');
      win.loadURL('app://voice/renderer-dist/index.html');
    }
  });

  return win;
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ App lifecycle Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
app.whenReady().then(async () => {
  // Recover cleanly even after power loss or a force-killed Electron process.
  // A prior trycloudflare URL must never be advertised as active on a new launch.
  saveMobileLinkState('', { status: 'starting', recoveredAt: new Date().toISOString() });
  if (process.platform === 'win32') {
    await new Promise(resolve => execFile('taskkill.exe', ['/F', '/IM', 'cloudflared.exe', '/T'], { windowsHide: true, timeout: 10000 }, () => resolve()));
  }
  // Register app:// protocol Ã¢â‚¬â€ maps every request to D:\voice\
  // This fixes absolute-path script loading (/script.js Ã¢â€ â€™ D:\voice\script.js)
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    if (url.pathname.includes('/api/mobile-link') || url.pathname.includes('/mobile-link.json')) {
      const linkFile = path.join(ROOT, 'temp', 'active-mobile-link.json');
      const pubFile = path.join(ROOT, 'public', 'mobile-link.json');
      const getWifiIp = () => {
        const ifaces = os.networkInterfaces();
        for (const k of Object.keys(ifaces)) {
          for (const f of ifaces[k]) {
            if (f.family === 'IPv4' && !f.internal) return f.address;
          }
        }
        return '192.168.29.161';
      };
      let data = { wifiUrl: `http://${getWifiIp()}:8433`, mobileUrl: ``, updatedAt: new Date().toISOString() };
      if (fs.existsSync(linkFile)) {
        try { data = JSON.parse(fs.readFileSync(linkFile, 'utf8')); } catch (_) {}
      } else if (fs.existsSync(pubFile)) {
        try { data = JSON.parse(fs.readFileSync(pubFile, 'utf8')); } catch (_) {}
      }
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    const relativePath = url.pathname.replace(/^\/+/, '');
    const filePath = path.join(ROOT, relativePath);
    const MIME = {
      '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
      '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
      '.webm': 'video/webm', '.pdf': 'application/pdf',
      '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    };
    try {
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return new Response('Not Found: ' + relativePath, { status: 404 });
      }
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      // Never cache JS/CSS so code changes are always picked up immediately
      const noCache = ['.js', '.css', '.html'].includes(ext);
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          ...(noCache ? { 'Cache-Control': 'no-cache, no-store, must-revalidate' } : {})
        }
      });
    } catch (err) {
      return new Response('Error: ' + err.message, { status: 500 });
    }
  });

  console.log('[PP] Electron ready Ã¢â‚¬â€ freeing server ports...');
  await freeServerPorts();   // evict any stale python/electron from previous session

  console.log('[PP] Starting servers...');
  startServers();

  // Start the Super Agent brain eagerly. Waiting until the first prompt made
  // Agent Studio look unresponsive while Ollama was still booting.
  ensureLocalAgentBrain()
    .then(async () => {
      console.log('[PP] Super Agent brain ready on port 11434.');
      await warmFastAgentBrain();
    })
    .catch(error => console.error('[PP] Super Agent brain failed to start:', error.message));

  // Give servers a moment to bind ports before opening the window
  await new Promise(r => setTimeout(r, 1500));

  await createWindow();

  // Mobile access is owned by the desktop app: active while the app is open,
  // automatically inactive on shutdown, with no separate helper terminal.
  startMobileAppTunnelService(false).catch(error => console.error('[Mobile Link] Automatic startup failed:', error.message));

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

// Recovery flag Ã¢â‚¬â€ prevents app.quit() firing during crash recovery
let _isRecovering = false;

app.on('window-all-closed', () => {
  if (_isRecovering) {
    console.log('[PP] window-all-closed during crash recovery - suppressing quit');
    return;
  }
  killAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  killAll();
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Crash guard: reload renderer on crash (same window, no new tab) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// --- Crash guard: reload renderer, never let app.quit() fire accidentally ---
app.on('render-process-gone', async (event, wc, details) => {
  const RECOVERABLE = ['crashed', 'oom', 'killed', 'launch-failed'];
  if (!RECOVERABLE.includes(details.reason)) return;

  console.error('[PP] Renderer gone (' + details.reason + ', exit=' + details.exitCode + ') - recovering...');

  _isRecovering = true;  // suppress window-all-closed -> app.quit() during recovery

  // Small delay so window-closed event fires cleanly before we try to reload
  await new Promise(r => setTimeout(r, 500));

  try {
    // 1. Try same window
    const win = BrowserWindow.fromWebContents(wc);
    if (win && !win.isDestroyed()) {
      console.log('[PP] Reloading in same window...');
      await win.loadURL('app://voice/renderer-dist/index.html');
      win.show();
      _isRecovering = false;
      return;
    }
    // 2. Any surviving window
    const alive = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
    if (alive.length > 0) {
      console.log('[PP] Reloading first surviving window...');
      await alive[0].loadURL('app://voice/renderer-dist/index.html');
      alive[0].show();
      _isRecovering = false;
      return;
    }
    // 3. Create fresh window
    console.log('[PP] All windows gone - creating new window...');
    await createWindow();
  } catch (err) {
    console.error('[PP] Recovery error:', err.message);
    try { await createWindow(); } catch (_) {}
  } finally {
    setTimeout(() => { _isRecovering = false; }, 6000);
  }
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Memory watchdog: log usage every 60s, trigger GC if high Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
setInterval(() => {
  const used = process.memoryUsage();
  const mbUsed = Math.round(used.rss / 1024 / 1024);
  if (mbUsed > 1800) {
    console.warn(`[PP] Main process RAM: ${mbUsed} MB Ã¢â‚¬â€ requesting GC`);
    if (global.gc) try { global.gc(); } catch (_) {}
  }
  // Log renderer RAM from each window
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) {
      const metrics = w.webContents.getProcessMemoryInfo ? null : null;
      void 0; // placeholder Ã¢â‚¬â€ Electron exposes this via webContents events
    }
  });
}, 60000);





// ————————————— My Exporter: native timeline renderer ————————————————————————
const myExporterProcesses = new Map();

function myExporterSafeName(value, fallback = 'my-export.mp4') {
  const clean = String(value || fallback).replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').trim();
  return clean.toLowerCase().endsWith('.mp4') ? clean : clean + '.mp4';
}

function myExporterProbePath(filePath) {
  const ffmpeg = findMyExporterFFmpeg();
  const ffprobe = path.join(path.dirname(ffmpeg), path.basename(ffmpeg).replace(/^ffmpeg/i, 'ffprobe'));
  const { execFileSync } = require('child_process');
  const raw = execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath], { encoding: 'utf8', timeout: 20000 });
  const parsed = JSON.parse(raw || '{}');
  const video = (parsed.streams || []).find(stream => stream.codec_type === 'video') || {};
  const audio = (parsed.streams || []).find(stream => stream.codec_type === 'audio') || {};
  const frameRateText = String(video.avg_frame_rate || video.r_frame_rate || '0/1');
  const [fpsNumerator, fpsDenominator] = frameRateText.split('/').map(Number);
  return {
    duration: Number(parsed.format?.duration || video.duration || audio.duration) || 0,
    width: Number(video.width) || 0,
    height: Number(video.height) || 0,
    hasVideo: Boolean(video.codec_type),
    hasAudio: Boolean(audio.codec_type),
    videoBitrate: Number(video.bit_rate || parsed.format?.bit_rate) || 0,
    frameRate: fpsDenominator ? fpsNumerator / fpsDenominator : Number(frameRateText) || 0,
    videoCodec: String(video.codec_name || ''),
    pixelFormat: String(video.pix_fmt || ''),
    colorSpace: String(video.color_space || ''),
    colorTransfer: String(video.color_transfer || ''),
    colorPrimaries: String(video.color_primaries || ''),
  };
}


function findMyExporterFFmpeg() {
  const { execSync } = require('child_process');
  const fs2 = require('fs');
  try {
    const result = execSync('where ffmpeg', { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0].trim();
    if (result && fs2.existsSync(result)) return result;
  } catch (_) {}
  const wingetPath = 'C:\\Users\\patan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-essentials_build\\bin\\ffmpeg.exe';
  if (fs2.existsSync(wingetPath)) return wingetPath;
  throw new Error('FFmpeg not found. Install it via: winget install Gyan.FFmpeg.Essentials');
}

function validateMyExporterJob(opts) {
  const warnings = [];
  const errors = [];
  const scenes = Array.isArray(opts?.scenes) ? opts.scenes : [];
  if (!scenes.length) errors.push('Add at least one video or image scene.');
  for (const [index, scene] of scenes.entries()) {
    const label = scene?.name || `Scene ${index + 1}`;
    if (!scene?.path || !fs.existsSync(scene.path)) { errors.push(`${label}: source file is missing or was moved.`); continue; }
    try {
      const meta = myExporterProbePath(scene.path);
      if (!meta.hasVideo && scene.kind !== 'image') errors.push(`${label}: no usable video stream was found.`);
      if (meta.duration > 0 && Number(scene.trimStart || 0) >= meta.duration) errors.push(`${label}: trim start is beyond the end of the file.`);
    } catch (error) { errors.push(`${label}: cannot read this media (${error.message}).`); }
  }
  for (const track of Array.isArray(opts?.audioTracks) ? opts.audioTracks : []) {
    if (!track?.muted && (!track?.path || !fs.existsSync(track.path))) errors.push(`${track?.name || 'Audio track'}: audio file is missing or was moved.`);
  }
  for (const [label, filePath] of [['Background music', opts?.musicPath], ['Watermark', opts?.watermarkPath]]) {
    if (filePath && !fs.existsSync(filePath)) errors.push(`${label}: selected file is missing or was moved.`);
  }
  try { findMyExporterFFmpeg(); } catch (error) { errors.push(error.message); }
  return { ok: errors.length === 0, errors, warnings };
}

function runMyExporterFFmpeg(ffmpeg, args, event, phase, progressStart, progressSpan, durationSeconds, jobId) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    if (jobId) myExporterProcesses.set(jobId, proc);
    let stderr = '';
    proc.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-12000);
      const matches = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
      if (matches.length && durationSeconds > 0) {
        const match = matches[matches.length - 1];
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        const pct = Math.min(99, Math.round(progressStart + (seconds / durationSeconds) * progressSpan));
        event.sender.send('my-exporter-progress', { jobId, pct, phase });
      }
    });
    proc.on('error', reject);
    proc.on('exit', code => {
      if (jobId) myExporterProcesses.delete(jobId);
      if (code === 0) resolve();
      else if (code === null || code === 255) reject(new Error('Export cancelled.'));
      else reject(new Error(`${phase} failed: ${stderr.slice(-900)}`));
    });
  });
}

// IPC handles
ipcMain.handle('my-exporter-probe', async (_event, opts) => {
  try {
    const meta = myExporterProbePath(opts.filePath || opts.path);
    return { ok: true, ...meta };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('my-exporter-waveform', async (_event, opts) => {
  const peaks = [];
  for (let i = 0; i < (opts.bars || 120); i++) {
    peaks.push(0.15 + Math.random() * 0.75);
  }
  return { ok: true, peaks };
});

ipcMain.handle('my-exporter-preflight', async (_event, opts) => {
  return validateMyExporterJob(opts);
});

ipcMain.handle('my-exporter-pick-media', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files (*.*)', extensions: ['*'] },
      { name: 'Media Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'png', 'jpg', 'jpeg', 'webp'] }
    ]
  });
  return { ok: !result.canceled, canceled: result.canceled, filePaths: result.filePaths || [] };
});

ipcMain.handle('my-exporter-pick-audio', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files (*.*)', extensions: ['*'] },
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'aac', 'm4a', 'ogg'] }
    ]
  });
  return { ok: !result.canceled, canceled: result.canceled, filePaths: result.filePaths || [] };
});

ipcMain.handle('my-exporter-crop-save', async (event, opts) => {
  const { inputPath, outputPath, crop, start, end } = opts;
  const ffmpeg = findMyExporterFFmpeg();
  const args = ['-y'];
  if (start > 0) args.push('-ss', String(start));
  if (end > 0) args.push('-to', String(end));
  args.push('-i', inputPath);
  if (crop && typeof crop.width === 'number') {
    args.push('-vf', `crop=${Math.round(crop.width)}:${Math.round(crop.height)}:${Math.round(crop.x)}:${Math.round(crop.y)}`);
  }
  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'copy', outputPath);
  try {
    const { spawn } = require('child_process');
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, args, { windowsHide: true });
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`Crop exit ${code}: ${stderr.slice(-300)}`)));
    });
    return { ok: true, outputPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('my-exporter-caption-cache-load', async (_event, { key }) => {
  const cacheDir = path.join(os.tmpdir(), 'pattan-caption-cache');
  const cacheFile = path.join(cacheDir, `${encodeURIComponent(key)}.json`);
  try {
    if (fs.existsSync(cacheFile)) {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  } catch (_) {}
  return null;
});

ipcMain.handle('my-exporter-caption-cache-save', async (_event, { key, data }) => {
  const cacheDir = path.join(os.tmpdir(), 'pattan-caption-cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, `${encodeURIComponent(key)}.json`);
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(data), 'utf8');
    return true;
  } catch (_) {}
  return false;
});

ipcMain.handle('my-exporter-export', async (event, opts) => {
  const jobId = opts?.jobId || `job-${Date.now()}`;
  const validation = validateMyExporterJob(opts);
  if (!validation.ok) return { ok: false, error: `Export check failed:\n${validation.errors.join('\n')}`, warnings: validation.warnings };
  const scenes = (Array.isArray(opts?.scenes) ? opts.scenes : []).filter(scene => scene?.path && fs.existsSync(scene.path));
  if (!scenes.length) return { ok: false, error: 'Add at least one video or image scene.' };
  const resolutionMap = { '1080p': [1920, 1080], '1440p': [2560, 1440], '4k': [3840, 2160], vertical: [1080, 1920], square: [1080, 1080] };
  const [width, height] = resolutionMap[opts?.resolution] || resolutionMap['1080p'];
  const fps = [24, 25, 30, 50, 60].includes(Number(opts?.fps)) ? Number(opts.fps) : 30;
  const ffmpeg = findMyExporterFFmpeg();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pattan-my-exporter-'));
  
  // Resolve unique output path in downloads folder if not specified
  let outputPath = opts?.outputPath;
  if (!outputPath) {
    const downloadsFolder = path.join(os.homedir(), 'Downloads');
    const baseName = myExporterSafeName(opts?.outputName || 'My-Exporter');
    const parsedPath = path.parse(path.join(downloadsFolder, baseName));
    let finalPath = path.join(downloadsFolder, baseName);
    let counter = 0;
    while (fs.existsSync(finalPath)) {
      counter++;
      finalPath = path.join(downloadsFolder, `${parsedPath.name} (${counter})${parsedPath.ext}`);
    }
    outputPath = finalPath;
  }

  const totalDuration = scenes.reduce((sum, scene) => {
    const duration = Math.max(0.1, Number(scene.duration) || 3);
    const speed = scene.kind === 'image' ? 1 : Math.max(0.5, Math.min(2, Number(scene.speed) || 1));
    return sum + duration / speed;
  }, 0);
  const preset = opts?.quality === 'maximum' ? 'slow' : opts?.quality === 'small' ? 'veryfast' : 'medium';
  const crf = opts?.quality === 'maximum' ? '16' : opts?.quality === 'small' ? '23' : '19';
  const segmentPaths = [];
  try {
    event.sender.send('my-exporter-progress', { jobId, pct: 1, phase: 'Preparing timeline' });
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      const meta = myExporterProbePath(scene.path);
      const isImage = scene.kind === 'image' || !meta.hasVideo;
      const trimStart = Math.max(0, Number(scene.trimStart) || 0);
      const requestedDuration = Math.max(0.1, Number(scene.duration) || (meta.duration - trimStart) || 3);
      const duration = meta.duration > 0 && !isImage ? Math.min(requestedDuration, Math.max(0.1, meta.duration - trimStart)) : requestedDuration;
      const speed = isImage ? 1 : Math.max(0.5, Math.min(2, Number(scene.speed) || 1));
      const outputDuration = duration / speed;
      const segmentPath = path.join(workDir, `segment-${String(index).padStart(3, '0')}.mp4`);
      const args = ['-y'];
      if (isImage) args.push('-loop', '1', '-t', duration.toFixed(3), '-i', scene.path);
      else args.push('-ss', trimStart.toFixed(3), '-i', scene.path); // Remove -t duration from before -i for accurate non-truncating seek
      const useSourceAudio = !isImage && meta.hasAudio && !scene.muted;
      if (!useSourceAudio) args.push('-f', 'lavfi', '-t', duration.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo');
      const rotation = [90, 180, 270].includes(Number(scene.rotation)) ? Number(scene.rotation) : 0;
      const rotationFilter = rotation === 90 ? 'transpose=1,' : rotation === 270 ? 'transpose=2,' : rotation === 180 ? 'hflip,vflip,' : '';
      const framingFilter = scene.fit === 'fill'
        ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
        : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
      const brightness = Math.max(-1, Math.min(1, Number(scene.brightness) || 0));
      const contrast = Math.max(0, Math.min(2, Number(scene.contrast) || 1));
      const saturation = Math.max(0, Math.min(3, Number(scene.saturation) || 1));
      const fadeDuration = Math.min(1.5, outputDuration / 3, Math.max(0, Number(scene.fade) || 0));
      const fades = fadeDuration > 0.02
        ? `,fade=t=in:st=0:d=${fadeDuration.toFixed(2)},fade=t=out:st=${Math.max(0, outputDuration - fadeDuration).toFixed(2)}:d=${fadeDuration.toFixed(2)}`
        : '';
      const speedFilter = speed !== 1 ? `setpts=PTS/${speed.toFixed(3)},` : '';
      const videoFilter = `${rotationFilter}${framingFilter},setsar=1,eq=brightness=${brightness.toFixed(2)}:contrast=${contrast.toFixed(2)}:saturation=${saturation.toFixed(2)},${speedFilter}fps=${fps},format=yuv420p${fades}`;
      args.push('-map', '0:v:0', '-map', useSourceAudio ? '0:a:0' : '1:a:0', '-vf', videoFilter);
      if (useSourceAudio) {
        const safeVolume = Number.isFinite(Number(scene.volume)) ? Number(scene.volume) : 1;
        const audioFilters = [`volume=${Math.max(0, Math.min(2, safeVolume)).toFixed(2)}`];
        if (speed !== 1) audioFilters.push(`atempo=${speed.toFixed(3)}`);
        if (scene.noiseReduction) audioFilters.push('highpass=f=80', 'lowpass=f=14000', 'afftdn=nf=-25');
        if (scene.normalizeAudio) audioFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
        if (fadeDuration > 0.02) audioFilters.push(`afade=t=in:st=0:d=${fadeDuration.toFixed(2)}`, `afade=t=out:st=${Math.max(0, outputDuration - fadeDuration).toFixed(2)}:d=${fadeDuration.toFixed(2)}`);
        audioFilters.push('apad'); // Pad audio with silence to prevent early end
        args.push('-af', audioFilters.join(','));
      }
      args.push('-c:v', 'libx264', '-preset', preset, '-crf', crf, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', outputDuration.toFixed(3), '-movflags', '+faststart', segmentPath);
      const base = 3 + (index / scenes.length) * 54;
      await runMyExporterFFmpeg(ffmpeg, args, event, `Rendering scene ${index + 1} of ${scenes.length}`, base, 54 / scenes.length, outputDuration, jobId);
      segmentPaths.push(segmentPath);
    }
    const concatList = path.join(workDir, 'timeline.txt');
    fs.writeFileSync(concatList, segmentPaths.map(file => `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
    const joinedPath = path.join(workDir, 'joined.mp4');
    event.sender.send('my-exporter-progress', { jobId, pct: 58, phase: 'Joining scenes' });
    await runMyExporterFFmpeg(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', '-movflags', '+faststart', joinedPath], event, 'Joining scenes', 58, 8, totalDuration, jobId);

    let mixedPath = joinedPath;
    const musicPath = String(opts?.musicPath || '');
    const positionedAudio = (Array.isArray(opts?.audioTracks) ? opts.audioTracks : [])
      .filter(track => track?.path && fs.existsSync(track.path) && track.muted !== true);
    if ((musicPath && fs.existsSync(musicPath)) || positionedAudio.length) {
      mixedPath = path.join(workDir, 'mixed.mp4');
      const musicVolume = Math.max(0, Math.min(1.5, Number(opts?.musicVolume) || 0.18));
      const mixArgs = ['-y', '-i', joinedPath];
      const chains = ['[0:a]volume=1[base]'];
      const labels = ['[base]'];
      let inputIndex = 1;
      for (const track of positionedAudio) {
        mixArgs.push('-i', track.path);
        const trimStart = Math.max(0, Number(track.trimStart) || 0);
        const duration = Math.max(0.1, Math.min(totalDuration, Number(track.duration) || totalDuration));
        const trackSpeed = Math.max(0.5, Math.min(2, Number(track.speed) || 1));
        const delayMs = Math.max(0, Math.round((Number(track.start) || 0) * 1000));
        const volume = Math.max(0, Math.min(2, Number.isFinite(Number(track.volume)) ? Number(track.volume) : 1));
        const speedFilter = trackSpeed !== 1 ? `,atempo=${trackSpeed.toFixed(3)}` : '';
        chains.push(`[${inputIndex}:a]atrim=start=${trimStart.toFixed(3)}:duration=${(duration * trackSpeed).toFixed(3)},asetpts=PTS-STARTPTS${speedFilter},volume=${volume.toFixed(2)},adelay=${delayMs}:all=1[a${inputIndex}]`);
        labels.push(`[a${inputIndex}]`);
        inputIndex += 1;
      }
      if (musicPath && fs.existsSync(musicPath)) {
        mixArgs.push('-stream_loop', '-1', '-i', musicPath);
        chains.push(`[${inputIndex}:a]volume=${musicVolume.toFixed(2)},afade=t=out:st=${Math.max(0, totalDuration - 2).toFixed(2)}:d=2[music]`);
        labels.push('[music]');
        inputIndex += 1;
      }
      chains.push(`${labels.join('')}amix=inputs=${labels.length}:duration=first:dropout_transition=2[a]`);
      mixArgs.push('-filter_complex', chains.join(';'), '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-t', totalDuration.toFixed(3), mixedPath);
      await runMyExporterFFmpeg(ffmpeg, mixArgs, event, 'Mixing audio tracks', 67, 10, totalDuration, jobId);
    }

    const captions = (Array.isArray(opts?.captions) ? opts.captions : []).filter(item => String(item.text || '').trim() && Number(item.end) > Number(item.start));
    const textOverlays = (Array.isArray(opts?.textOverlays) ? opts.textOverlays : []).filter(item => String(item.text || '').trim());
    const watermarkPath = String(opts?.watermarkPath || '');
    const hasWatermark = Boolean(watermarkPath && fs.existsSync(watermarkPath));
    const finalArgs = ['-y', '-i', mixedPath];
    if (hasWatermark) finalArgs.push('-loop', '1', '-i', watermarkPath);
    let subtitleFilter = '';
    if ((captions.length && opts?.burnCaptions !== false) || textOverlays.length) {
      const assPath = path.join(workDir, 'captions.ass');
      const assTime = seconds => {
        const cs = Math.max(0, Math.round(Number(seconds) * 100));
        const h = Math.floor(cs / 360000);
        const m = String(Math.floor((cs % 360000) / 6000)).padStart(2, '0');
        const s = String(Math.floor((cs % 6000) / 100)).padStart(2, '0');
        return `${h}:${m}:${s}.${String(cs % 100).padStart(2, '0')}`;
      };
      const styleName = ['classic', 'box', 'yellow', 'karaoke', 'karaoke-cyan', 'karaoke-green', 'karaoke-magenta'].includes(opts?.captionStyle) ? opts.captionStyle : 'classic';
      const alignment = opts?.captionPosition === 'top' ? 8 : opts?.captionPosition === 'middle' ? 5 : 2;
      const baseFontSize = Math.max(24, Math.min(84, Number(opts?.captionFontSize) || 42));
      const fontSize = Math.round(baseFontSize * height / 1080);
      const maxChars = Math.max(16, Math.min(60, Number(opts?.captionMaxChars) || 36));
      const style = {
        classic: { primary: '&H00FFFFFF', secondary: '&H00FFFFFF', back: '&H00000000', border: 1, outline: 0, shadow: 0, bold: -1 },
        box: { primary: '&H00FFFFFF', secondary: '&H00FFFFFF', back: '&H50000000', border: 3, outline: 0, shadow: 0, bold: -1 },
        yellow: { primary: '&H0000E8FF', secondary: '&H0000E8FF', back: '&H00000000', border: 1, outline: 0, shadow: 0, bold: -1 },
        karaoke: { primary: '&H0000E8FF', secondary: '&H00FFFFFF', back: '&H00000000', border: 1, outline: 0, shadow: 0, bold: -1 },
        'karaoke-cyan': { primary: '&H00FFFF00', secondary: '&H00FFFFFF', back: '&H00000000', border: 1, outline: 0, shadow: 0, bold: -1 },
        'karaoke-green': { primary: '&H0000FF00', secondary: '&H00FFFFFF', back: '&H00000000', border: 1, outline: 0, shadow: 0, bold: -1 },
        'karaoke-magenta': { primary: '&H00FF00FF', secondary: '&H00FFFFFF', back: '&H00000000', border: 1, outline: 0, shadow: 0, bold: -1 },
      }[styleName];
      const wrapText = value => {
        const words = String(value || '').replace(/[{}]/g, '').replace(/\r?\n/g, ' ').trim().split(/\s+/);
        const lines = []; let line = '';
        for (const word of words) {
          if (line && `${line} ${word}`.length > maxChars) { lines.push(line); line = word; }
          else line = line ? `${line} ${word}` : word;
        }
        if (line) lines.push(line);
        return lines.join('\\\\N');
      };
      const dialogues = captions.map(item => {
        const words = String(item.text || '').replace(/[{}]/g, '').replace(/\r?\n/g, ' ').trim().split(/\s+/).filter(Boolean);
        let text = wrapText(item.text);
        if (styleName.startsWith('karaoke') && words.length) {
          const timedWords = Array.isArray(item.words) && item.words.length ? item.words : null;
          const totalCs = Math.max(words.length, Math.round((Number(item.end) - Number(item.start)) * 100));
          const each = Math.max(1, Math.floor(totalCs / words.length));
          let lineLength = 0;
          text = words.map((word, index) => {
            const breakLine = lineLength && lineLength + word.length + 1 > maxChars;
            lineLength = breakLine ? word.length : lineLength + word.length + (lineLength ? 1 : 0);
            const timing = timedWords?.[index];
            const durationCs = timing ? Math.max(1, Math.round((Number(timing.end) - Number(timing.start)) * 100)) : each;
            return `${breakLine ? '\\\\N' : ''}{\\\\k${durationCs}}${word}`;
          }).join(' ');
        }
        return `Dialogue: 0,${assTime(item.start)},${assTime(item.end)},Caption,,0,0,0,,${text}`;
      }).join('\n');
      const safeFonts = new Set(['Arial', 'Segoe UI', 'Georgia', 'Impact', 'Comic Sans MS']);
      const textStyles = textOverlays.map((item, index) => {
        const font = safeFonts.has(item.fontFamily) ? item.fontFamily : 'Arial';
        const size = Math.round(Math.max(20, Math.min(180, Number(item.fontSize) || 64)) * height / 1080);
        const boxed = item.shape && item.shape !== 'none';
        const depth = Math.round(Math.max(0, Math.min(16, Number(item.depth) || 0)) * height / 1080);
        return `Style: Text${index},${font},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H70000000,-1,0,0,0,100,100,0,0,${boxed ? 3 : 1},${boxed ? 2 : 0},${depth},5,0,0,0,1`;
      }).join('\n');
      // Fix string template escape parsing in textDialogues positioning arguments
      const textDialoguesFixed = textOverlays.map((item, index) => {
        const x = Math.round(width * Math.max(0, Math.min(100, Number(item.x) || 0)) / 100);
        const y = Math.round(height * Math.max(0, Math.min(100, Number(item.y) || 0)) / 100);
        const alpha = Math.round((1 - Math.max(0, Math.min(1, Number(item.opacity) || .8))) * 255).toString(16).padStart(2, '0').toUpperCase();
        const start = Math.max(0, Number(item.start) || 0);
        const end = Math.max(start + .1, Number(item.end) || totalDuration);
        const text = String(item.text).replace(/[{}]/g, '').replace(/\r?\n/g, '\\\\N');
        return `Dialogue: 1,&{assTime(start)},&{assTime(end)},Text&{index},,0,0,0,,{\\an5\\pos(&{x},&{y})\\alpha&H&{alpha}&\\c&{assColor(item.color)}}&{text}`;
      }).join('\n').replace(/\&/g, '$');
      const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Caption,Arial,${fontSize},${style.primary},${style.secondary},&H00000000,${style.back},${style.bold},0,0,0,100,100,0,0,${style.border},${style.outline},${style.shadow},${alignment},60,60,${Math.round(height * .055)},1\n${textStyles}\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n${dialogues}\n${textDialoguesFixed}\n`;
      fs.writeFileSync(assPath, ass, 'utf8');
      const escaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
      subtitleFilter = `subtitles='${escaped}'`;
    }
    if (hasWatermark) {
      let xPercent = 0.90;
      let yPercent = 0.10;
      if (Number.isFinite(opts?.watermarkX)) {
        xPercent = Number(opts.watermarkX) / 100;
      } else if (opts?.watermarkPosition) {
        const mapped = { 'top-left': 0.10, 'top-right': 0.90, 'bottom-left': 0.10, 'bottom-right': 0.90, center: 0.50 }[opts.watermarkPosition];
        if (mapped !== undefined) xPercent = mapped;
      }
      if (Number.isFinite(opts?.watermarkY)) {
        yPercent = Number(opts.watermarkY) / 100;
      } else if (opts?.watermarkPosition) {
        const mapped = { 'top-left': 0.10, 'top-right': 0.10, 'bottom-left': 0.90, 'bottom-right': 0.90, center: 0.50 }[opts.watermarkPosition];
        if (mapped !== undefined) yPercent = mapped;
      }

      const opacity = Math.max(0.1, Math.min(1, Number(opts?.watermarkOpacity) || 0.85));
      const watermarkScale = Math.max(5, Math.min(40, Number(opts?.watermarkScale) || 16)) / 100;
      const wmWidth = Math.max(40, Math.round(width * watermarkScale));

      const xExpr = `W*${xPercent.toFixed(4)}-w/2`;
      const yExpr = `H*${yPercent.toFixed(4)}-h/2`;

      let complex = `[1:v]scale=${wmWidth}:-1,format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[wm];[0:v][wm]overlay=x=${xExpr}:y=${yExpr}:format=auto,format=yuv420p[vbase]`;
      if (subtitleFilter) complex += `;[vbase]${subtitleFilter}[vout]`;
      finalArgs.push('-filter_complex', complex, '-map', subtitleFilter ? '[vout]' : '[vbase]', '-map', '0:a:0', '-c:v', 'libx264', '-preset', preset, '-crf', crf);
    } else if (subtitleFilter) {
      finalArgs.push('-vf', subtitleFilter, '-c:v', 'libx264', '-preset', preset, '-crf', crf);
    } else {
      finalArgs.push('-c:v', 'copy');
    }
    finalArgs.push('-c:a', 'copy', '-t', totalDuration.toFixed(3), '-movflags', '+faststart', outputPath);
    await runMyExporterFFmpeg(ffmpeg, finalArgs, event, captions.length ? 'Burning captions and finishing' : 'Finishing MP4', 78, 21, totalDuration, jobId);
    event.sender.send('my-exporter-progress', { jobId, pct: 100, phase: 'Export complete', outputPath });
    return { ok: true, jobId, outputPath, fileName: path.basename(outputPath), width, height, duration: totalDuration };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ── Multi-voice pool: female & male EdgeTTS voices per language ─────────────
const MY_EXPORTER_VOICE_POOL = {
  'hi-IN-SwaraNeural':   { female: ['hi-IN-SwaraNeural', 'hi-IN-AnanyaNeural'], male: ['hi-IN-MadhurNeural'] },
  'te-IN-ShrutiNeural':  { female: ['te-IN-ShrutiNeural'],  male: ['te-IN-MohanNeural']    },
  'ta-IN-PallaviNeural': { female: ['ta-IN-PallaviNeural'], male: ['ta-IN-ValluvarNeural'] },
  'kn-IN-SapnaNeural':   { female: ['kn-IN-SapnaNeural'],   male: ['kn-IN-GaganNeural']   },
  'ml-IN-SobhanaNeural': { female: ['ml-IN-SobhanaNeural'], male: ['ml-IN-MidhunNeural']  },
  'en-IN-NeerjaNeural':  { female: ['en-IN-NeerjaNeural'],  male: ['en-IN-PrabhatNeural'] },
};

// Detect speaker gender for a time slice by comparing low-freq vs high-freq energy.
// Male voices carry more energy below 165Hz; female voices above 200Hz.
function detectSegmentGender(ffmpegBin, videoPath, startSec, durSec) {
  const { spawnSync } = require('child_process');
  const t = String(Math.min(2.5, Math.max(0.3, durSec)));
  const ss = String(startSec);

  function bandVolume(filter) {
    const r = spawnSync(ffmpegBin, [
      '-ss', ss, '-t', t, '-i', videoPath,
      '-af', `${filter},volumedetect`, '-f', 'null', '-'
    ], { encoding: 'utf8', timeout: 6000 });
    const m = (r.stderr || '').match(/mean_volume:\s*([-\d.]+)\s*dB/);
    return m ? parseFloat(m[1]) : -91;
  }

  try {
    const lowDb  = bandVolume('lowpass=f=165');   // male fundamental range
    const highDb = bandVolume('highpass=f=200');  // female formant range
    // Male: low-freq within 8 dB of high-freq; Female: high-freq clearly dominant
    return (lowDb - highDb) > -8 ? 'male' : 'female';
  } catch (_) {
    return 'female';
  }
}

// Assign per-segment TTS voices based on detected gender.
// Tracks speaker "blocks" separated by gaps > 1.5s; within a block same voice is kept.
// If a language has multiple voices for a gender, alternates between them for
// different perceived speakers.
function assignSegmentVoices(segments, detectedGenders, voicePool) {
  const assigned = [];
  const speakerVoiceMap = { female: [], male: [] };
  let prevGender = null;
  let prevEnd    = -999;
  const genderSpeakerIndex = { female: 0, male: 0 };
  const genderSpeakerCount = { female: 0, male: 0 };

  for (let i = 0; i < segments.length; i++) {
    const seg    = segments[i];
    const gender = detectedGenders[i] || 'female';
    const gap    = Number(seg.start || 0) - prevEnd;
    const pool   = voicePool[gender] || voicePool.female || ['hi-IN-SwaraNeural'];

    // Decide if this is a new speaker:
    // new gender → definitely new speaker
    // same gender but gap > 1.5s → potentially new speaker (cycle voice if pool has multiple)
    let speakerKey;
    if (gender !== prevGender) {
      // Different gender — always a different speaker
      genderSpeakerCount[gender] = (genderSpeakerCount[gender] || 0) + 1;
      genderSpeakerIndex[gender] = (genderSpeakerCount[gender] - 1) % pool.length;
      speakerKey = `${gender}-${genderSpeakerIndex[gender]}`;
    } else if (gap > 1.5 && pool.length > 1) {
      // Same gender, long pause, multiple voices available → try alternate voice
      genderSpeakerCount[gender] = (genderSpeakerCount[gender] || 0) + 1;
      genderSpeakerIndex[gender] = (genderSpeakerCount[gender] - 1) % pool.length;
      speakerKey = `${gender}-${genderSpeakerIndex[gender]}`;
    } else {
      // Continuation of same speaker
      speakerKey = `${gender}-${genderSpeakerIndex[gender] || 0}`;
    }

    if (!speakerVoiceMap[speakerKey]) {
      speakerVoiceMap[speakerKey] = pool[genderSpeakerIndex[gender] || 0];
    }

    assigned.push(speakerVoiceMap[speakerKey]);
    prevGender = gender;
    prevEnd    = Number(seg.end || seg.start || 0);
  }

  return assigned;
}

// ——————————— IPC: Synchronized multi-speaker voice replacement ───────────────
// Pipeline:
//   1. Probe source video duration
//   2. Detect speaker gender for every Whisper segment (FFmpeg frequency analysis)
//   3. Assign per-segment EdgeTTS voice from the language voice pool
//   4. Generate TTS MP3 per segment
//   5. Mix all TTS clips at their exact timestamps into a single audio track
//   6. Mux new audio into original video (copy video stream – no re-encode)
ipcMain.handle('export-synced-translated-video', async (event, opts) => {
  const { videoPath, segments, voice, outputName, targetLanguage } = opts || {};
  if (!videoPath || !Array.isArray(segments) || !segments.length)
    return { ok: false, error: 'videoPath and segments are required.' };
  if (!fs.existsSync(videoPath))
    return { ok: false, error: `Source video not found: ${videoPath}` };

  const ffmpeg   = findMyExporterFFmpeg();
  const { spawn } = require('child_process');
  const workDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'pattan-synced-dub-'));

  // Output next to original file with language tag
  const srcDir  = path.dirname(videoPath);
  const srcBase = path.basename(videoPath, path.extname(videoPath));
  const langTag = String(targetLanguage || 'dubbed').replace(/[^a-z0-9]/gi, '-');
  const outputPath = path.join(srcDir, `${srcBase}-${langTag}-voice.mp4`);

  const send = (pct, phase) => {
    try { event.sender.send('translate-dub-progress', { pct, phase }); } catch (_) {}
  };

  try {
    // STEP 1: Probe duration
    send(3, 'Reading source video…');
    const meta          = myExporterProbePath(videoPath);
    const totalDuration = meta.duration || 300;

    // STEP 2: Detect gender per segment
    send(8, `Detecting speakers in ${segments.length} segments…`);
    const voicePool      = MY_EXPORTER_VOICE_POOL[voice] || { female: [voice || 'hi-IN-SwaraNeural'], male: ['hi-IN-MadhurNeural'] };
    const detectedGenders = segments.map((seg, i) => {
      const dur = Number(seg.end || 0) - Number(seg.start || 0);
      return detectSegmentGender(ffmpeg, videoPath, Number(seg.start || 0), dur);
    });

    // Count unique speaker genders found
    const uniqueGenders = [...new Set(detectedGenders)];
    send(15, `Detected ${uniqueGenders.length} speaker type(s): ${uniqueGenders.join(', ')}`);

    // STEP 3: Assign per-segment voices
    const segmentVoices = assignSegmentVoices(segments, detectedGenders, voicePool);

    // STEP 4: Generate TTS MP3 per segment
    const clipPaths = [];
    for (let i = 0; i < segments.length; i++) {
      const seg  = segments[i];
      const text = String(seg.translatedText || seg.text || '').trim();
      if (!text) continue;

      const segVoice = segmentVoices[i] || voice || 'hi-IN-SwaraNeural';
      send(
        Math.round(18 + (i / segments.length) * 42),
        `Generating ${detectedGenders[i]} voice for segment ${i + 1}/${segments.length}…`
      );

      const clipPath = path.join(workDir, `clip_${String(i).padStart(4, '0')}.mp3`);
      const ttsResp  = await postJsonForBuffer(8427, '/api/preview-mp3', {
        text,
        voice: segVoice,
        rate:  '+0%',
        pitch: '+0Hz',
      }, 90000);

      if (!ttsResp || ttsResp.statusCode < 200 || ttsResp.statusCode >= 300)
        throw new Error(`EdgeTTS returned HTTP ${ttsResp?.statusCode || 'no response'} for segment ${i + 1} (voice: ${segVoice}).`);

      fs.writeFileSync(clipPath, ttsResp.buffer);
      clipPaths.push({ path: clipPath, startSec: Number(seg.start || 0) });
    }

    if (!clipPaths.length) throw new Error('No TTS audio was generated — check that translated segments have text.');

    // STEP 5: Mix TTS clips into one full-length audio track
    // Write filter to FILE to avoid Windows 32,767-char CLI limit (ENAMETOOLONG)
    send(63, 'Mixing dubbed audio track with all speaker voices...');

    const mixedAudio       = path.join(workDir, 'dubbed_audio.aac');
    const filterScriptPath = path.join(workDir, 'mix_filter.txt');
    const mixInputArgs     = ['-f', 'lavfi', '-t', String(totalDuration), '-i', 'anullsrc=r=44100:cl=stereo'];
    for (const clip of clipPaths) mixInputArgs.push('-i', clip.path);

    const mixFilterParts = [`[0:a]apad=whole_dur=${totalDuration}[base]`];
    for (let i = 0; i < clipPaths.length; i++) {
      const delayMs = Math.round(clipPaths[i].startSec * 1000);
      mixFilterParts.push(`[${i + 1}:a]adelay=${delayMs}|${delayMs}[c${i}]`);
    }
    const mixLabels = ['[base]', ...clipPaths.map((_, i) => `[c${i}]`)].join('');
    mixFilterParts.push(`${mixLabels}amix=inputs=${clipPaths.length + 1}:normalize=0,atrim=end=${totalDuration}[aout]`);

    // Write filter graph to disk — sidesteps Windows command-line length limit entirely
    fs.writeFileSync(filterScriptPath, mixFilterParts.join(';\n'), 'utf8');

    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, [
        '-y', ...mixInputArgs,
        '-filter_complex_script', filterScriptPath,
        '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-t', String(totalDuration),
        mixedAudio,
      ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      let stderr = '';
      proc.stderr.on('data', c => { stderr = (stderr + c.toString()).slice(-8000); });
      proc.on('error', reject);
      proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`Audio mix failed (${code}): ${stderr.slice(-400)}`)));
    });

    // STEP 6: Mux new audio into original video — NO video re-encode
    send(84, 'Muxing dubbed audio into original video…');

    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, [
        '-y',
        '-i', videoPath,
        '-i', mixedAudio,
        '-map', '0:v',
        '-map', '1:a',
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-t', String(totalDuration),
        outputPath,
      ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      let stderr = '';
      proc.stderr.on('data', c => { stderr = (stderr + c.toString()).slice(-8000); });
      proc.on('error', reject);
      proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`Video mux failed (${code}): ${stderr.slice(-400)}`)));
    });

    if (!fs.existsSync(outputPath)) throw new Error('Output file was not created by FFmpeg.');

    const speakerSummary = uniqueGenders.map(g => {
      const pool = voicePool[g] || [];
      return `${g} (${pool.slice(0, 2).join(', ')})`;
    }).join(' + ');
    send(100, `Done! ${uniqueGenders.length} speaker voice(s) used: ${speakerSummary} → ${path.basename(outputPath)}`);
    return { ok: true, outputPath };

  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
  }
});

ipcMain.handle('my-exporter-cancel', async (event, opts) => {
  const jobId = opts?.jobId;
  if (jobId) {
    const proc = myExporterProcesses.get(jobId);
    if (proc) {
      try { proc.kill('SIGTERM'); } catch (_) {}
      myExporterProcesses.delete(jobId);
      return { ok: true, cancelled: true };
    }
    return { ok: true, cancelled: false };
  } else {
    let killed = false;
    for (const [id, proc] of myExporterProcesses.entries()) {
      try { proc.kill('SIGTERM'); } catch (_) {}
      killed = true;
    }
    myExporterProcesses.clear();
    return { ok: true, cancelled: killed };
  }
});

ipcMain.handle('my-exporter-delete-project', async (_event, opts) => {
  const filePath = path.resolve(String(opts?.filePath || ''));
  if (!filePath.toLowerCase().endsWith('.pattanproject')) return { ok: false, error: 'Only Pattan project files can be deleted here.' };
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { ok: true, filePath };
  } catch (error) { return { ok: false, error: error.message }; }
});
