'use strict';

// A fresh hidden Electron profile, real built renderer, and isolated fake bridge.
// This deliberately does not import main.cjs/preload.cjs or create a local server.
const { app, BrowserWindow, protocol, session, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'tmp', 'app-smoke');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const report = { startedAt: new Date().toISOString(), profile, isolation: 'Separate profile; test-only IPC bridge; all HTTP(S) intercepted; websocket/file navigation blocked', screens: [], errors: [], console: [], missingAssets: [], mockedNetwork: [], blockedBridge: [] };
const timeout = setTimeout(() => finish(new Error('Isolated UI smoke test timed out')), 90000);
let window;
let finished = false;
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  if (error) report.failure = String(error.stack || error);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (window && !window.isDestroyed()) window.destroy();
  console.log(JSON.stringify({ output, screens: report.screens.map(screen => screen.name), errors: report.errors.length, missingAssets: report.missingAssets.length, failure: report.failure || null }));
  app.exit(error ? 1 : 0);
}
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4' };
function mockNetwork(request) {
  const url = new URL(request.url);
  report.mockedNetwork.push({ method: request.method, url: url.origin + url.pathname });
  if (request.method === 'GET' && /\/health\/?$/.test(url.pathname)) return new Response(JSON.stringify({ ok: true, status: 'ok', ready: true, loaded: true, busy: false, model_loaded: true, voices: [] }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  if (request.method === 'GET' && url.hostname === 'fonts.googleapis.com') return new Response('', { headers: { 'Content-Type': 'text/css', 'Access-Control-Allow-Origin': '*' } });
  return new Response(JSON.stringify({ ok: false, error: 'External request disabled for isolated UI QA' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}

app.whenReady().then(async () => {
  const isolatedSession = session.fromPartition('qa-app-smoke-' + path.basename(profile));
  await isolatedSession.protocol.handle('http', mockNetwork);
  await isolatedSession.protocol.handle('https', mockNetwork);
  isolatedSession.webRequest.onBeforeRequest({ urls: ['ws://*/*', 'wss://*/*', 'file://*/*'] }, (_details, callback) => callback({ cancel: true }));
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  await isolatedSession.protocol.handle('app', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'voice' || request.method !== 'GET') return new Response('Blocked in smoke test', { status: 403 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (relative === 'api/mobile-link' || relative === 'mobile-link.json') return new Response(JSON.stringify({ wifiUrl: 'http://127.0.0.1:8433', mobileUrl: '', status: 'smoke-test' }), { headers: { 'Content-Type': 'application/json' } });
    const file = path.resolve(root, relative);
    const ext = path.extname(file).toLowerCase();
    if (!file.startsWith(root + path.sep) || /(^|[/\\])\./.test(relative) || !mime[ext]) return new Response('Blocked asset', { status: 403 });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      report.missingAssets.push(relative);
      return new Response('Not Found', { status: 404 });
    }
    return new Response(fs.readFileSync(file), { headers: { 'Content-Type': mime[ext], 'Cache-Control': 'no-store' } });
  });

  // Inspect only API method names, never evaluate the production preload.
  const preloadText = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
  const apiMethods = [...preloadText.matchAll(/^  ([A-Za-z][A-Za-z0-9]+):/gm)].map(match => match[1]);
  ipcMain.on('qa-smoke-report', (_event, item) => {
    if (item.kind === 'blocked-bridge') report.blockedBridge.push(item.detail);
    else report.errors.push(item);
  });
  window = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { session: isolatedSession, preload: path.join(__dirname, 'qa-app-smoke-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false, additionalArguments: ['--qa-api-methods=' + Buffer.from(JSON.stringify(apiMethods)).toString('base64')] } });
  window.webContents.setFrameRate(30);
  window.webContents.setAudioMuted(true);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('app://voice/')) event.preventDefault(); });
  window.webContents.on('console-message', details => { report.console.push({ level: details.level, message: details.message, sourceId: details.sourceId, lineNumber: details.lineNumber }); });
  window.webContents.on('render-process-gone', (_event, details) => finish(new Error('Smoke renderer ended: ' + details.reason)));
  await window.loadURL('app://voice/renderer-dist/index.html');
  await window.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + 18000;
    while (!window.__presentatorLegacyBootPromise && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    if (!window.__presentatorLegacyBootPromise) throw new Error('Legacy engine did not begin loading');
    await window.__presentatorLegacyBootPromise;
    await document.fonts.ready;
    return true;
  })()`);

  async function capture(name, expected) {
    await window.webContents.executeJavaScript(`(async () => {
      const deadline = Date.now() + 8000;
      while (!document.body.innerText.includes(${JSON.stringify(expected)})) {
        if (Date.now() > deadline) throw new Error('Navigation did not commit: ' + ${JSON.stringify(expected)});
        await new Promise(r => setTimeout(r, 50));
      }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    })()`);
    const state = await window.webContents.executeJavaScript(`(() => {
      const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      const visibleText = document.body.innerText;
      return { title: document.title, text: visibleText.slice(0, 22000), bodyLength: visibleText.length,
        headings: [...document.querySelectorAll('h1,h2,h3')].filter(visible).map(el => el.innerText),
        buttons: [...document.querySelectorAll('button')].filter(visible).map(el => ({ text: el.innerText, title: el.title, id: el.id, disabled: el.disabled })),
        nav: [...document.querySelectorAll('.app-nav-button')].map(el => ({ text: el.innerText, active: el.dataset.active })),
        loadedLegacyScripts: [...document.querySelectorAll('script[data-presentator-src]')].map(el => ({ src: el.src, loaded: el.dataset.loaded })),
        failedImages: [...document.images].filter(el => visible(el) && el.src && el.complete && el.naturalWidth === 0).map(el => el.src) };
    })()`);
    assert.ok(state.text.includes(expected), name + ' expected visible text: ' + expected);
    assert.ok(!/module crashed|Caption Burner stopped|The video screen hit an error/.test(state.text), name + ' did not show an error boundary');
    const screenshot = path.join(output, name + '.png');
    // A hidden compositor can return its previous surface on the first capture.
    // Offscreen painting plus a warm capture ensures this is the committed view.
    await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise(resolve => setTimeout(resolve, 250));
    fs.writeFileSync(screenshot, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    report.screens.push({ name, screenshot, ...state });
  }
  async function clickButton(text) {
    await window.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('button')].find(el => el.innerText.trim() === ${JSON.stringify(text)} && el.getClientRects().length);
      if (!button) throw new Error('Missing visible navigation: ' + ${JSON.stringify(text)});
      button.click();
    })()`);
  }
  await capture('01-presentator', 'Presentator Workspace');
  await clickButton('Quote Studio');
  await capture('02-quotes', 'Legendary Quote Studio');
  await clickButton('My Exporter');
  await capture('03-exporter', 'Make your video');
  await clickButton('Video Resizer');
  await capture('04-resizer', 'Video Ratio Master');
  await clickButton('Presentator');
  const contextDraw = await window.webContents.executeJavaScript(`(() => {
    if (typeof drawPdfContextScene !== 'function') throw new Error('PDF Context renderer missing');
    if (state.pdf.pages.length) throw new Error('Isolated profile unexpectedly contains PDF pages');
    drawPdfContextScene();
    return { ok: true, width: canvas.width, height: canvas.height, selectedPageCount: 0, dataUrl: canvas.toDataURL('image/png') };
  })()`);
  const contextScreenshot = path.join(output, '06-pdf-context-empty.png');
  fs.writeFileSync(contextScreenshot, Buffer.from(contextDraw.dataUrl.split(',')[1], 'base64'));
  delete contextDraw.dataUrl;
  report.pdfContext = { ...contextDraw, screenshot: contextScreenshot };
  await window.webContents.executeJavaScript(`(() => { const button = document.querySelector('button[title="Caption Burner (Hugging Face Whisper)"]'); if (!button) throw new Error('Caption button missing'); button.click(); })()`);
  await capture('05-caption', 'Upload video file');
  if (report.errors.length) throw new Error('Uncaught renderer errors: ' + JSON.stringify(report.errors));
  if (report.missingAssets.length) throw new Error('Missing local assets: ' + [...new Set(report.missingAssets)].join(', '));
  finish();
}).catch(finish);
