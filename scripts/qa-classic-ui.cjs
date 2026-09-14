'use strict';

// Isolated visual QA: a fresh profile, the real built renderer, and a test-only
// bridge. Never import main.cjs/preload.cjs, call a live backend, or reload the
// user's window. HTTP(S), sockets, permissions, and external navigation are
// intercepted before loading the app.
const { app, BrowserWindow, protocol, session, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'tmp', 'classic-ui-qa');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
for (const flag of ['disable-background-networking', 'disable-component-update', 'disable-sync', 'disable-gpu']) app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const report = {
  startedAt: new Date().toISOString(), profile,
  isolation: 'Fresh hidden Electron profile, test-only bridge, all HTTP(S) mocked, websockets/file navigation blocked; no live backend or user work touched.',
  limitations: ['Mocked services do not verify live narration, export, or external integrations.', 'External fonts are blocked; screenshots exercise local font fallbacks.'],
  screens: [], interactions: [], errors: [], console: [], missingAssets: [], mockedNetwork: [], blockedBridge: [],
};
let window;
let finished = false;
const timeout = setTimeout(() => finish(new Error('Isolated classic UI QA timed out')), 120000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  if (error) report.failure = String(error.stack || error);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (window && !window.isDestroyed()) window.destroy();
  console.log(JSON.stringify({ output, screens: report.screens.map(screen => screen.name), interactions: report.interactions, errors: report.errors.length, missingAssets: report.missingAssets.length, failure: report.failure || null }));
  app.exit(error ? 1 : 0);
}
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4' };
function mockNetwork(request) {
  const url = new URL(request.url);
  report.mockedNetwork.push({ method: request.method, url: url.origin + url.pathname });
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (request.method === 'GET' && /\/health\/?$/.test(url.pathname)) return new Response(JSON.stringify({ ok: true, status: 'ok', ready: true, loaded: true, busy: false, model_loaded: true, chatterboxReady: true, chatterboxLoading: false, voices: [] }), { headers });
  if (request.method === 'GET' && url.hostname === 'fonts.googleapis.com') return new Response('', { headers: { ...headers, 'Content-Type': 'text/css' } });
  return new Response(JSON.stringify({ ok: false, error: 'External request disabled for isolated classic UI QA' }), { status: 503, headers });
}

app.whenReady().then(async () => {
  const isolatedSession = session.fromPartition('qa-classic-ui-' + path.basename(profile));
  await isolatedSession.protocol.handle('http', mockNetwork);
  await isolatedSession.protocol.handle('https', mockNetwork);
  isolatedSession.webRequest.onBeforeRequest({ urls: ['ws://*/*', 'wss://*/*', 'file://*/*'] }, (_details, callback) => callback({ cancel: true }));
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  await isolatedSession.protocol.handle('app', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'voice' || request.method !== 'GET') return new Response('Blocked in QA', { status: 403 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    // Do not read the user's real link/token file, even in a hidden profile.
    if (relative === 'api/mobile-link' || /(^|\/)mobile-link\.json$/.test(relative)) return new Response(JSON.stringify({ wifiUrl: 'http://127.0.0.1:8433', mobileUrl: '', status: 'classic-ui-qa' }), { headers: { 'Content-Type': 'application/json' } });
    const file = path.resolve(root, relative);
    const ext = path.extname(file).toLowerCase();
    if (!file.startsWith(root + path.sep) || /(^|[/\\])\./.test(relative) || !mime[ext]) return new Response('Blocked asset', { status: 403 });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      report.missingAssets.push(relative);
      return new Response('Not Found', { status: 404 });
    }
    return new Response(fs.readFileSync(file), { headers: { 'Content-Type': mime[ext], 'Cache-Control': 'no-store' } });
  });

  // Enumerate bridge method names only, without evaluating production preload.
  const apiMethods = [...fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8').matchAll(/^  ([A-Za-z][A-Za-z0-9]+):/gm)].map(match => match[1]);
  ipcMain.on('qa-smoke-report', (_event, item) => {
    if (item.kind === 'blocked-bridge') report.blockedBridge.push(item.detail);
    else report.errors.push(item);
  });
  window = new BrowserWindow({ width: 1440, height: 1000, useContentSize: true, show: false, webPreferences: { session: isolatedSession, preload: path.join(__dirname, 'qa-app-smoke-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false, additionalArguments: ['--qa-api-methods=' + Buffer.from(JSON.stringify(apiMethods)).toString('base64')] } });
  window.webContents.setFrameRate(30);
  window.webContents.setAudioMuted(true);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('app://voice/')) event.preventDefault(); });
  window.webContents.on('console-message', details => report.console.push({ level: details.level, message: details.message, sourceId: details.sourceId, lineNumber: details.lineNumber }));
  window.webContents.on('render-process-gone', (_event, details) => finish(new Error('QA renderer ended: ' + details.reason)));
  await window.loadURL('app://voice/renderer-dist/index.html');
  const run = source => window.webContents.executeJavaScript(source);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  await run(`(async () => {
    const deadline = Date.now() + 18000;
    while (!window.__presentatorLegacyBootPromise && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    if (!window.__presentatorLegacyBootPromise) throw new Error('Legacy engine did not begin loading');
    await window.__presentatorLegacyBootPromise;
    await document.fonts.ready;
    const readyDeadline = Date.now() + 8000;
    while (document.getElementById('cb-voice-banner') && !document.getElementById('cb-voice-banner').classList.contains('cb-hidden')) {
      if (Date.now() > readyDeadline) throw new Error('Healthy mock voice status did not settle');
      await new Promise(r => setTimeout(r, 100));
    }
  })()`);

  async function capture(name, expected, workspace) {
    await run(`(async () => {
      const deadline = Date.now() + 8000;
      while (!document.body.innerText.toLowerCase().includes(${JSON.stringify(expected.toLowerCase())})) {
        if (Date.now() > deadline) throw new Error('Expected visible screen: ' + ${JSON.stringify(expected)});
        await new Promise(r => setTimeout(r, 50));
      }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    })()`);
    const state = await run(`(() => {
      const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      const text = document.body.innerText;
      const navLabel = document.querySelector('.studio-nav-item span');
      const navStyle = navLabel ? getComputedStyle(navLabel) : null;
      return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
        navTypography: navStyle ? { family: navStyle.fontFamily, size: navStyle.fontSize, weight: navStyle.fontWeight, smoothing: navStyle.webkitFontSmoothing } : null,
        text: text.slice(0, 22000), headings: [...document.querySelectorAll('h1,h2,h3')].filter(visible).map(el => el.innerText),
        nav: [...document.querySelectorAll('.studio-sidebar button')].filter(visible).map(el => ({ text: el.innerText.trim(), label: el.getAttribute('aria-label'), active: el.getAttribute('aria-current') || el.dataset.active })),
        visibleWorkspaces: [...document.querySelectorAll('[data-workspace]')].filter(visible).map(el => el.dataset.workspace),
        controls: [...document.querySelectorAll('button,input,select,textarea,summary')].filter(visible).map(el => ({ tag: el.tagName, id: el.id, text: el.innerText?.trim().slice(0, 100), label: el.getAttribute('aria-label') })),
        loadedLegacyScripts: [...document.querySelectorAll('script[data-presentator-src]')].map(el => ({ src: el.src, loaded: el.dataset.loaded })),
        failedImages: [...document.images].filter(el => visible(el) && el.src && el.complete && el.naturalWidth === 0).map(el => el.src),
        overflowCandidates: [...document.querySelectorAll('.classic-studio *')].filter(visible).filter(el => { const r=el.getBoundingClientRect(); return r.width > innerWidth + 2 && getComputedStyle(el).position !== 'absolute'; }).slice(0, 20).map(el => ({ tag: el.tagName, id: el.id, class: el.className, width: el.getBoundingClientRect().width })) };
    })()`);
    const screenshot = path.join(output, name + '.png');
    await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await pause(300);
    const png = (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG();
    fs.writeFileSync(screenshot, png);
    report.screens.push({ name, screenshot, sha256: crypto.createHash('sha256').update(png).digest('hex'), ...state });
    if (workspace) assert.deepEqual(state.visibleWorkspaces, [workspace], name + ': only the chosen workspace is visible');
    assert.ok(!/module crashed|Caption Burner stopped|The video screen hit an error/.test(state.text), name + ' did not show an error boundary');
    assert.ok(state.documentWidth <= state.viewport.width + 1 && state.bodyWidth <= state.viewport.width + 1, name + ': body has horizontal overflow: ' + JSON.stringify({ viewport: state.viewport.width, documentWidth: state.documentWidth, bodyWidth: state.bodyWidth }));
    assert.deepEqual(state.failedImages, [], name + ': images load');
  }

  async function clickVisibleButton(label) {
    await run(`(() => {
      const button = [...document.querySelectorAll('button')].find(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && (el.getAttribute('aria-label') === ${JSON.stringify(label)} || el.innerText.trim() === ${JSON.stringify(label)} || el.title === ${JSON.stringify(label)}));
      if (!button) throw new Error('Missing visible button: ' + ${JSON.stringify(label)});
      button.click();
    })()`);
    await pause(100);
  }

  // These semantic labels are deliberately checked against the real shell.
  async function navigate(label) {
    const sidebarHidden = await run(`(() => { const el=document.querySelector('.studio-sidebar'); return !el || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden' || el.getBoundingClientRect().right <= 0; })()`);
    if (sidebarHidden) await clickVisibleButton('Open navigation');
    await clickVisibleButton(label);
    const activeLabels = await run(`[...document.querySelectorAll('.studio-sidebar [aria-current="page"]')].map(el => el.innerText.trim())`);
    assert.deepEqual(activeLabels, [label], 'Only the chosen workspace is marked current');
  }

  async function clickSelector(selector) {
    await run(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if (!el || !el.getClientRects().length) throw new Error('Missing visible control: ' + ${JSON.stringify(selector)}); el.click(); })()`);
    await pause(120);
  }
  async function pressKey(keyCode, modifiers = []) {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await pause(120);
  }

  async function verifySearch(viewport) {
    await clickSelector('.studio-search');
    assert.ok(await run(`!!document.querySelector('[role="dialog"][aria-label="Find a tool or action"]')`), 'Search dialog has an accessible name');
    assert.equal(await run(`document.activeElement?.getAttribute('aria-label')`), 'Search tools and actions', 'Search receives keyboard focus');
    await capture(viewport + '-05-search', 'Go to Presentator');
    await pressKey('Tab', ['shift']);
    assert.equal(await run(`document.activeElement?.getAttribute('aria-label')`), 'Close search', 'Shift+Tab wraps search focus to Close');
    await pressKey('Tab');
    assert.equal(await run(`document.activeElement?.getAttribute('aria-label')`), 'Search tools and actions', 'Tab wraps search focus to its input');
    await pressKey('Escape');
    assert.ok(await run(`!document.querySelector('.studio-command-dialog') && document.activeElement?.classList.contains('studio-search')`), 'Escape closes search and restores trigger focus');
    await clickSelector('.studio-search');
    await clickVisibleButton('Close search');
    assert.ok(await run(`!document.querySelector('.studio-command-dialog') && document.activeElement?.classList.contains('studio-search')`), 'Close search button works and restores focus');
    await pressKey('K', ['control']);
    assert.ok(await run(`!!document.querySelector('.studio-command-dialog')`), 'Ctrl+K opens search');
    await window.webContents.insertText('Video Resizer');
    await pause(120);
    assert.ok(await run(`document.querySelector('.studio-command-dialog')?.innerText.includes('Go to Video Resizer')`), 'Search matches workspace');
    await pressKey('Enter');
    assert.equal(await run(`document.querySelector('.classic-studio')?.dataset.module`), 'resizer', 'Enter executes selected search action');
    assert.ok(await run(`!document.querySelector('.studio-command-dialog')`), 'Command closes after action');
    report.interactions.push({ name: viewport + ': search focus trap, Close button, Escape restoration, Ctrl+K, typed filtering, Enter navigation', ok: true });
    await navigate('Presentator');
  }

  async function searchForTool(query) {
    await pressKey('K', ['control']);
    assert.ok(await run(`!!document.querySelector('.studio-command-dialog')`), 'Ctrl+K exposes the tool finder');
    await window.webContents.insertText(query);
    await pause(100);
    assert.ok(await run(`document.querySelector('.studio-command-dialog')?.innerText.toLowerCase().includes(${JSON.stringify(query.toLowerCase())})`), 'Tool search finds ' + query);
    await pressKey('Enter');
    await pause(500);
    assert.ok(await run(`!document.querySelector('.studio-command-dialog')`), 'Tool search closes after the selected action');
  }

  async function openPreparationTool(id) {
    if (await run(`document.querySelector('.studio-sidebar').hidden`)) await clickVisibleButton('Open navigation');
    const inDisclosure = await run(`!!document.querySelector('.studio-more-lesson-tools [data-studio-tool="${id}"]')`);
    if (inDisclosure && !(await run(`document.querySelector('.studio-more-lesson-tools').open`))) {
      await clickSelector('.studio-more-lesson-tools > summary');
    }
    await clickSelector('[data-studio-tool="' + id + '"]');
    // Navigation deliberately waits for the mounted renderer and scrolls the
    // existing control into view; inspect after that transition settles.
    await pause(500);
  }

  async function verifyOpenPreparationTool(id, label, controlId) {
    const state = await run(`(() => {
      const section = document.getElementById(${JSON.stringify(id)});
      const summary = section?.querySelector(':scope > summary');
      const control = ${JSON.stringify(controlId || '')} ? document.getElementById(${JSON.stringify(controlId || '')}) : summary;
      const inspect = element => {
        if (!element) return { visible: false, reason: 'missing element' };
        let rect = element.getBoundingClientRect();
        let clipped = { top: Math.max(0, rect.top), bottom: Math.min(innerHeight, rect.bottom), left: Math.max(0, rect.left), right: Math.min(innerWidth, rect.right) };
        const hiddenAncestors = [];
        for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (ancestor.hidden || style.display === 'none' || style.visibility === 'hidden') hiddenAncestors.push(ancestor.id || ancestor.tagName);
          if (ancestor.tagName === 'DETAILS' && !ancestor.open && !ancestor.querySelector(':scope > summary')?.contains(element)) hiddenAncestors.push(ancestor.id || 'closed details');
          const parentRect = ancestor.getBoundingClientRect();
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            clipped.top = Math.max(clipped.top, parentRect.top);
            clipped.bottom = Math.min(clipped.bottom, parentRect.bottom);
          }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
            clipped.left = Math.max(clipped.left, parentRect.left);
            clipped.right = Math.min(clipped.right, parentRect.right);
          }
        }
        const topbar = document.querySelector('.studio-topbar');
        if (topbar?.getClientRects().length) clipped.top = Math.max(clipped.top, topbar.getBoundingClientRect().bottom);
        return { visible: !hiddenAncestors.length && clipped.bottom - clipped.top > 8 && clipped.right - clipped.left > 8,
          hiddenAncestors, rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }, clipped };
      };
      return { module: document.querySelector('.classic-studio')?.dataset.module, open: section?.open,
        summary: inspect(summary), control: inspect(control), inputHidden: document.getElementById('inputPanel').classList.contains('hidden'),
        stageHidden: document.getElementById('stagePanel').classList.contains('hidden'),
        breadcrumb: document.querySelector('.studio-breadcrumb strong')?.innerText.trim(),
        currentWorkspaces: [...document.querySelectorAll('.studio-sidebar [aria-current="page"]')].map(el => el.innerText.trim()),
        currentTools: [...document.querySelectorAll('.studio-sidebar [aria-current="location"]')].map(el => el.dataset.studioTool),
        drawerClosed: innerWidth > 960 || document.querySelector('.studio-sidebar').hidden };
    })()`);
    assert.equal(state.module, 'presentator', label + ': navigation returns to the existing Presentator');
    assert.equal(state.open, true, label + ': correct existing section is open');
    assert.equal(state.inputHidden, false, label + ': preparation is visible');
    assert.equal(state.stageHidden, true, label + ': idle preview is no longer covering the tool');
    assert.ok(state.summary.visible, label + ': section summary is visible within the viewport: ' + JSON.stringify(state.summary));
    assert.ok(state.control.visible, label + ': original control is visible without a clipped/hidden ancestor: ' + JSON.stringify(state.control));
    assert.ok(state.breadcrumb.includes(label), label + ': breadcrumb identifies the chosen tool');
    assert.deepEqual(state.currentWorkspaces, ['Presentator'], label + ': Presentator remains the one current workspace');
    assert.deepEqual(state.currentTools, [id], label + ': one section tool is current');
    assert.ok(state.drawerClosed, label + ': compact navigation closes after selection');
    return state;
  }

  async function verifyRestoredModuleAccess(viewport) {
    const fixtureText = 'Isolated navigation fixture: keep this lesson text.';
    await run(`(() => {
      // In-memory fixtures are assigned without change events. No importer,
      // media decoder, narration, transcription, or export starts from them.
      window.__classicToolFixture = { nodes: {}, files: {} };
      for (const [id, name, type] of [['singSongInput', 'qa-song.mp3', 'audio/mpeg'], ['captionVideoInput', 'qa-caption.mp4', 'video/mp4']]) {
        const input = document.getElementById(id);
        const transfer = new DataTransfer();
        transfer.items.add(new File(['navigation-only-fixture'], name, { type }));
        input.files = transfer.files;
        window.__classicToolFixture.nodes[id] = input;
        window.__classicToolFixture.files[id] = input.files[0];
      }
      document.getElementById('lessonInput').value = ${JSON.stringify(fixtureText)};
    })()`);
    await navigate('Quote Studio');
    await openPreparationTool('singSongSection');
    await verifyOpenPreparationTool('singSongSection', 'Sing Song', 'singSongInput');
    await capture(viewport + '-11-sing-song', 'Song MP3', 'presentator');
    await navigate('My Exporter');
    await openPreparationTool('aiCaptionSection');
    await verifyOpenPreparationTool('aiCaptionSection', 'AI Captioning (Local)', 'captionVideoInput');
    await capture(viewport + '-12-local-caption', 'Source Video', 'presentator');
    await navigate('Video Resizer');
    await searchForTool('Sing Song');
    await verifyOpenPreparationTool('singSongSection', 'Sing Song', 'singSongInput');

    if (await run(`document.querySelector('.studio-sidebar').hidden`)) await clickVisibleButton('Open navigation');
    await run(`document.querySelector('.studio-more-lesson-tools').open = false`);
    await clickSelector('.studio-more-lesson-tools > summary');
    const additionalTools = await run(`[...document.querySelectorAll('.studio-more-lesson-tools [data-studio-tool]')].map(el => ({ id: el.dataset.studioTool, label: el.innerText.trim(), visible: !!el.getClientRects().length }))`);
    for (const id of ['audioToTextSection', 'speechToolsSection', 'narrationSection', 'mediaSection', 'templateWorkflowSection', 'serverControlsSection', 'lessonContentSection', 'pdfSection']) {
      assert.ok(additionalTools.some(tool => tool.id === id && tool.visible), 'More tools exposes ' + id);
    }
    await openPreparationTool('audioToTextSection');
    const audioLabel = additionalTools.find(tool => tool.id === 'audioToTextSection').label;
    await verifyOpenPreparationTool('audioToTextSection', audioLabel, 'transcribeAudioInput');
    assert.deepEqual(await run(`Object.entries(window.__classicToolFixture.nodes).map(([id, node]) => ({ id, sameNode: document.getElementById(id) === node, sameFile: document.getElementById(id).files[0] === window.__classicToolFixture.files[id] }))`), [
      { id: 'singSongInput', sameNode: true, sameFile: true },
      { id: 'captionVideoInput', sameNode: true, sameFile: true },
    ], 'Navigation preserves the original protected file inputs and selected files');
    assert.equal(await run(`document.getElementById('lessonInput').value`), fixtureText, 'Navigation preserves entered lesson data');
    assert.ok(await run(`!state.speaking && !state.exportingVideo && !state.generatingNarration`), 'Opening a tool starts no narration, generation, or export');
    report.interactions.push({ name: viewport + ': Sing Song and local AI captions from other workspaces, Ctrl+K access, additional tools, original input/file/text retention', ok: true, additionalTools });
    await run(`(() => { for (const input of Object.values(window.__classicToolFixture.nodes)) input.value = ''; delete window.__classicToolFixture; })()`);
    await navigate('Presentator');
  }

  async function verifyPreviewToolNavigation(viewport) {
    await run(`(() => {
      document.getElementById('lessonInput').value = 'A safe, silent preview for navigation testing.';
      for (const input of document.querySelectorAll('[id="introClipEnabled"]')) input.checked = false;
      state.introPlayback.enabled = false;
    })()`);
    await clickSelector('#showScreenBtn');
    await pause(250);
    assert.ok(await run(`!document.getElementById('stagePanel').classList.contains('hidden')`), 'Idle preview is open before tool navigation');
    await searchForTool('Sing Song');
    await verifyOpenPreparationTool('singSongSection', 'Sing Song', 'singSongInput');

    await navigate('Presentator');
    await clickSelector('#showScreenBtn');
    await pause(250);
    // Only a guard-state fixture, never real playback. The action must leave
    // this state intact instead of calling Stop, Edit, or resetting the stage.
    await run(`state.speaking = true`);
    await searchForTool('AI Captioning (Local)');
    assert.ok(await run(`state.speaking && document.getElementById('inputPanel').classList.contains('hidden') && !document.getElementById('stagePanel').classList.contains('hidden')`), 'Busy preview refuses tool navigation without stopping playback or exposing hidden preparation');
    await run(`state.speaking = false`);
    await searchForTool('AI Captioning (Local)');
    await verifyOpenPreparationTool('aiCaptionSection', 'AI Captioning (Local)', 'captionVideoInput');
    report.interactions.push({ name: viewport + ': idle preview returns to the selected tool; busy preview refuses without stopping state', ok: true });
    await navigate('Presentator');
  }

  async function verifyDrawer() {
    assert.ok(await run(`document.querySelector('.studio-sidebar').hidden`), 'Mobile navigation starts closed');
    await clickVisibleButton('Open navigation');
    assert.ok(await run(`document.querySelector('.studio-menu-toggle').getAttribute('aria-expanded') === 'true' && document.querySelector('.studio-sidebar').contains(document.activeElement)`), 'Opening mobile navigation moves focus into the drawer');
    await capture('mobile-06-navigation', 'Your workspaces');
    await run(`document.querySelector('.studio-sidebar').querySelector('button').focus()`);
    await pressKey('Tab', ['shift']);
    assert.ok(await run(`(() => { const list=[...document.querySelectorAll('.studio-sidebar button:not(:disabled), .studio-sidebar a[href]')].filter(el=>el.getClientRects().length); return document.activeElement === list.at(-1); })()`), 'Shift+Tab wraps to last drawer control');
    await pressKey('Tab');
    assert.ok(await run(`document.activeElement === document.querySelector('.studio-sidebar button')`), 'Tab wraps to first drawer control');
    await pressKey('Escape');
    assert.ok(await run(`document.querySelector('.studio-sidebar').hidden && document.activeElement?.classList.contains('studio-menu-toggle')`), 'Escape closes drawer and restores menu focus');
    const focusStyle = await run(`({ hasDocumentFocus: document.hasFocus(), matchesFocusVisible: document.activeElement.matches(':focus-visible'), outlineStyle: getComputedStyle(document.activeElement).outlineStyle, outlineWidth: getComputedStyle(document.activeElement).outlineWidth, boxShadow: getComputedStyle(document.activeElement).boxShadow })`);
    report.interactions.push({ name: 'Mobile drawer keyboard focus diagnostic', focusStyle });
    if (focusStyle.matchesFocusVisible) assert.notEqual(focusStyle.outlineStyle, 'none', 'Keyboard focus is visibly indicated');
    else report.limitations.push('The hidden window does not have native document focus, so Chromium does not match :focus-visible. Focus restoration and Tab trapping are verified; the native focus-ring appearance remains unverified.');
    report.interactions.push({ name: 'Mobile drawer opening, focus trap, and Escape restoration', ok: true, focusStyle });
  }

  async function verifyPreparation(viewport) {
    await clickSelector('.classic-source-links [data-workflow-target="lessonContentSection"]');
    assert.ok(await run(`document.getElementById('lessonContentSection').open`), 'Written lesson shortcut opens its controls');
    await clickSelector('.classic-source-links [data-workflow-target="pdfSection"]');
    assert.ok(await run(`document.getElementById('pdfSection').open`), 'PDF shortcut opens its controls');
    await run(`(() => {
      // A test fixture in this disposable profile only. No user document,
      // narration, export, or model process is involved.
      document.getElementById('lessonInput').value = 'A little kindness makes a brighter day.';
      for (const input of document.querySelectorAll('[id="introClipEnabled"]')) input.checked = false;
      state.introPlayback.enabled = false;
    })()`);
    await clickSelector('#showScreenBtn');
    // Let a previous shortcut's smooth scroll finish, then inspect the preview
    // from its actual beginning instead of capturing the middle of the stage.
    await pause(500);
    await run(`(() => { document.querySelector('[data-workspace="presentator"]').scrollTo({ top: 0, left: 0, behavior: 'instant' }); document.getElementById('stagePanel').scrollTo({ top: 0, left: 0, behavior: 'instant' }); })()`);
    await capture(viewport + '-07-preview', 'Make sure it feels right.', 'presentator');
    assert.ok(await run(`!state.speaking && !state.exporting && !state.generatingNarration`), 'Preview does not start narration or export');
    await clickSelector('#editBtn');
    assert.ok(await run(`!document.getElementById('inputPanel').classList.contains('hidden') && document.getElementById('stagePanel').classList.contains('hidden')`), 'Edit returns to preparation');
    await run(`document.querySelector('[data-workspace="presentator"]').scrollTop = 0`);
    report.interactions.push({ name: viewport + ': PDF/lesson shortcuts, text-only preview, return to preparation', ok: true });
  }

  async function verifyAdditionalTools(viewport) {
    const compact = await run(`document.querySelector('.studio-sidebar').hidden`);
    if (compact) await clickVisibleButton('Open navigation');
    await clickSelector('.tdub-nav-button');
    await capture(viewport + '-08-translator', 'Video and Audio Translator');
    assert.ok(await run(`document.body.classList.contains('tdub-open')`), 'Translator opens from the retained navigation');
    assert.equal(await run(`document.querySelector('.studio-breadcrumb strong').innerText.trim()`), 'Translate Audio', 'Breadcrumb names the visible translator');
    assert.deepEqual(await run(`[...document.querySelectorAll('.studio-sidebar [aria-current="page"]')].map(el => el.innerText.trim())`), ['Translate Audio'], 'Only the visible translator is marked current');
    await clickSelector('.tdub-close');
    assert.ok(await run(`!document.body.classList.contains('tdub-open')`), 'Translator close restores the workspace');
    assert.equal(await run(`document.querySelector('.studio-breadcrumb strong').innerText.trim()`), 'Presentator', 'Closing the translator restores the workspace breadcrumb');
    if (await run(`document.querySelector('.studio-sidebar').hidden`)) await clickVisibleButton('Open navigation');
    await clickSelector('.studio-tool-links button:first-child');
    await capture(viewport + '-09-caption', 'Upload video file');
    await clickVisibleButton('✕');
    assert.ok(await run(`document.querySelector('.classic-studio').dataset.caption === 'false'`), 'Existing Caption Burner closes back to the workspace');
    report.interactions.push({ name: viewport + ': retained Translate Audio and protected Caption Burner open/close', ok: true });
  }

  async function verifyExporterTools(viewport) {
    const overlap = await run(`(() => {
      const exportButton=document.querySelector('.mx-mode-simple .mx-professional-export');
      const exportRect=exportButton.getBoundingClientRect();
      return [...document.querySelectorAll('.mx-simple-project-actions button')].filter(el=>el.getClientRects().length).map(el=> {
        const r=el.getBoundingClientRect(); return { label: el.innerText.trim(), intersectionWidth: Math.max(0, Math.min(r.right,exportRect.right)-Math.max(r.left,exportRect.left)), intersectionHeight: Math.max(0,Math.min(r.bottom,exportRect.bottom)-Math.max(r.top,exportRect.top)) };
      }).filter(item=>item.intersectionWidth>1 && item.intersectionHeight>1);
    })()`);
    assert.deepEqual(overlap, [], 'Exporter project actions do not overlap the export button');
    await clickSelector('.mx-simple-project-actions button[title="Show every editing control"]');
    assert.ok(await run(`!!document.querySelector('.mx-page.mx-mode-advanced')`), 'More tools exposes advanced controls');
    await capture(viewport + '-10-exporter-tools', 'My Exporter', 'exporter');
    await clickSelector('.mx-quick-project-actions button[title="Switch simple or advanced tools"]');
    assert.ok(await run(`!!document.querySelector('.mx-page.mx-mode-simple')`), 'Simple view can be restored');
    report.interactions.push({ name: viewport + ': Exporter action separation and reversible More tools switch', ok: true });
  }

  const requiredIds = ['inputPanel', 'stagePanel', 'lessonInput', 'showScreenBtn', 'playBtn', 'editBtn', 'stopStageBtn', 'pdfInput', 'pdfPresentBtn'];
  const idCounts = await run(`Object.fromEntries(${JSON.stringify(requiredIds)}.map(id => [id, document.querySelectorAll('[id="' + id + '"]').length]))`);
  report.interactions.push({ name: 'Legacy control IDs remain unique', idCounts });
  for (const [id, count] of Object.entries(idCounts)) assert.equal(count, 1, 'Required legacy control: ' + id);
  assert.ok(await run(`!!document.querySelector('.classic-studio')`), 'Classic shell loaded');
  const navigationLabels = await run(`[...document.querySelectorAll('.studio-navigation-list .studio-nav-item')].map(el => el.innerText.trim())`);
  assert.deepEqual(navigationLabels, ['Presentator', 'Quote Studio', 'My Exporter', 'Video Resizer'], 'All core workspaces have understandable text labels');
  assert.ok(await run(`!!document.querySelector('.studio-sidebar .tdub-nav-button')`), 'Existing Translate Audio control remains connected to sidebar');

  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
    window.setContentSize(viewport.width, viewport.height);
    await pause(150);
    await navigate('Presentator');
    await capture(viewport.name + '-01-presentator', 'Presentator', 'presentator');
    await navigate('Quote Studio');
    await capture(viewport.name + '-02-quotes', 'Quote', 'quotes');
    await navigate('My Exporter');
    await capture(viewport.name + '-03-exporter', 'Make your video', 'exporter');
    await verifyExporterTools(viewport.name);
    await navigate('Video Resizer');
    await capture(viewport.name + '-04-resizer', 'Fit your video to Shorts', 'resizer');
    await navigate('Presentator');
    await verifySearch(viewport.name);
    if (viewport.name === 'mobile') await verifyDrawer();
    await verifyPreparation(viewport.name);
    await verifyAdditionalTools(viewport.name);
    await verifyRestoredModuleAccess(viewport.name);
    await verifyPreviewToolNavigation(viewport.name);
  }

  if (report.errors.length) throw new Error('Uncaught renderer errors: ' + JSON.stringify(report.errors));
  if (report.missingAssets.length) throw new Error('Missing local assets: ' + [...new Set(report.missingAssets)].join(', '));
  assert.equal(new Set(report.screens.map(screen => screen.sha256)).size, report.screens.length, 'Each captured screen has distinct painted content');
  assert.equal(new Set(report.screens.filter(screen => screen.navTypography).map(screen => screen.navTypography.family)).size, 1, 'Navigation font family stays consistent across workspaces');
  finish();
}).catch(finish);
