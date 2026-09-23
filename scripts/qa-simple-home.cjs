'use strict';

// Disposable, hidden renderer QA. Production main/preload, user files, backend
// jobs, sockets and external navigation are never used by this harness.
const { app, BrowserWindow, protocol, session, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'tmp', 'simple-home-qa');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
for (const flag of ['disable-background-networking', 'disable-component-update', 'disable-sync', 'disable-gpu']) app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const report = {
  startedAt: new Date().toISOString(), profile,
  isolation: 'Fresh hidden Electron profile, test-only bridge, all HTTP(S) mocked; no live backend or user work touched.',
  limitations: ['Mocked services do not verify live narration, export, or external integrations.', 'External fonts are blocked; screenshots use local font fallbacks.'],
  screens: [], interactions: [], errors: [], console: [], missingAssets: [], mockedNetwork: [], blockedBridge: [], whatsAppBridge: [],
};
let window;
let lastPaint = null;
let finished = false;
const timeout = setTimeout(() => finish(new Error('Isolated Home UI QA timed out')), 180000);
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
  return new Response(JSON.stringify({ ok: false, error: 'External request disabled for isolated Home UI QA' }), { status: 503, headers });
}

app.whenReady().then(async () => {
  const isolatedSession = session.fromPartition('qa-simple-home-' + path.basename(profile));
  await isolatedSession.protocol.handle('http', mockNetwork);
  await isolatedSession.protocol.handle('https', mockNetwork);
  isolatedSession.webRequest.onBeforeRequest({ urls: ['ws://*/*', 'wss://*/*', 'file://*/*'] }, (_details, callback) => callback({ cancel: true }));
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  await isolatedSession.protocol.handle('app', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'voice' || request.method !== 'GET') return new Response('Blocked in QA', { status: 403 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    // Never read the user's real mobile link or authentication token.
    if (relative === 'api/mobile-link' || /(^|\/)mobile-link\.json$/.test(relative)) return new Response(JSON.stringify({ wifiUrl: 'http://127.0.0.1:8433', mobileUrl: '', status: 'simple-home-qa' }), { headers: { 'Content-Type': 'application/json' } });
    const file = path.resolve(root, relative);
    const ext = path.extname(file).toLowerCase();
    if (!file.startsWith(root + path.sep) || /(^|[/\\])\./.test(relative) || !mime[ext]) return new Response('Blocked asset', { status: 403 });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      report.missingAssets.push(relative);
      return new Response('Not Found', { status: 404 });
    }
    return new Response(fs.readFileSync(file), { headers: { 'Content-Type': mime[ext], 'Cache-Control': 'no-store' } });
  });

  // Read method names only; production preload is never evaluated.
  const apiMethods = [...fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8').matchAll(/^  ([A-Za-z][A-Za-z0-9]+):/gm)].map(match => match[1]);
  ipcMain.on('qa-smoke-report', (_event, item) => {
    if (item.kind === 'blocked-bridge') report.blockedBridge.push(item.detail);
    else if (item.kind === 'qa-whatsapp') report.whatsAppBridge.push(item.detail);
    else report.errors.push(item);
  });
  function createWindow(mobileRemote = false, extraArguments = []) {
    window = new BrowserWindow({ width: 1440, height: 1000, useContentSize: true, show: false, webPreferences: { session: isolatedSession, preload: path.join(__dirname, 'qa-app-smoke-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false, additionalArguments: ['--qa-api-methods=' + Buffer.from(JSON.stringify(apiMethods)).toString('base64'), ...(mobileRemote ? ['--qa-mobile-remote'] : []), ...extraArguments] } });
    window.webContents.setFrameRate(30);
    window.webContents.on('paint', (_event, _rect, image) => { lastPaint = image.toPNG(); });
    window.webContents.setAudioMuted(true);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('app://voice/')) event.preventDefault(); });
    window.webContents.on('console-message', details => report.console.push({ level: details.level, message: details.message, sourceId: details.sourceId, lineNumber: details.lineNumber }));
    window.webContents.on('render-process-gone', (_event, details) => finish(new Error('QA renderer ended: ' + details.reason)));
  }
  createWindow();
  await window.loadURL('app://voice/renderer-dist/index.html');
  const run = source => window.webContents.executeJavaScript(source);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const bootstrapCheck = `(async () => {
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
  })()`;
  await run(bootstrapCheck);

  // A node may have a box yet be in a closed disclosure or hidden ancestor.
  // Keep visibility checks independent of the new CSS implementation.
  const installVisibilityCheck = `void (window.__qaVisible = element => {
    if (!element || !element.getClientRects().length) return false;
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (ancestor.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
      if (ancestor.tagName === 'DETAILS' && !ancestor.open && !ancestor.querySelector(':scope > summary')?.contains(element)) return false;
    }
    return true;
  })`;
  await run(installVisibilityCheck);

  async function capture(name, expected) {
    await run(`(async () => {
      const deadline = Date.now() + 8000;
      while (!document.body.innerText.toLowerCase().includes(${JSON.stringify(expected.toLowerCase())})) {
        if (Date.now() > deadline) throw new Error('Expected visible screen: ' + ${JSON.stringify(expected)});
        await new Promise(r => setTimeout(r, 50));
      }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    })()`);
    const state = await run(`(() => {
      const visible = window.__qaVisible;
      const root = document.querySelector('.simple-studio');
      return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
        rootData: root ? {...root.dataset} : null, text: document.body.innerText.slice(0, 22000),
        headings: [...document.querySelectorAll('h1,h2,h3')].filter(visible).map(el => el.innerText),
        visibleWorkspaces: [...document.querySelectorAll('[data-workspace]')].filter(visible).map(el => el.dataset.workspace),
        visiblePreparationSections: [...document.querySelectorAll('#inputPanel > details[id]')].filter(visible).map(el => el.id),
        controls: [...document.querySelectorAll('button,input,select,textarea,summary')].filter(visible).map(el => ({ tag: el.tagName, id: el.id, text: el.innerText?.trim().slice(0, 100), label: el.getAttribute('aria-label') })),
        failedImages: [...document.images].filter(el => visible(el) && el.src && el.complete && el.naturalWidth === 0).map(el => el.src),
        overflowCandidates: [...document.querySelectorAll('.simple-studio *')].filter(visible).filter(el => { const r=el.getBoundingClientRect(); return r.width > innerWidth + 2 && getComputedStyle(el).position !== 'absolute'; }).slice(0, 20).map(el => ({ tag: el.tagName, id: el.id, class: el.className, width: el.getBoundingClientRect().width })) };
    })()`);
    let png;
    if (process.argv.includes('--qa-whatsapp-session')) {
      lastPaint = null;
      window.webContents.invalidate();
      for (let attempt = 0; !lastPaint && attempt < 30; attempt++) await pause(100);
      assert.ok(lastPaint, 'Offscreen renderer produced a screenshot');
      png = lastPaint;
    } else {
      await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      await pause(200);
      png = (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG();
    }
    const screenshot = path.join(output, name + '.png');
    fs.writeFileSync(screenshot, png);
    const sha256 = crypto.createHash('sha256').update(png).digest('hex');
    report.screens.push({ name, screenshot, sha256, ...state });
    assert.ok(!/module crashed|Caption Burner stopped|The video screen hit an error/.test(state.text), name + ': no error boundary');
    assert.ok(state.documentWidth <= state.viewport.width + 1 && state.bodyWidth <= state.viewport.width + 1, name + ': body has horizontal overflow: ' + JSON.stringify({ viewport: state.viewport.width, documentWidth: state.documentWidth, bodyWidth: state.bodyWidth }));
    assert.deepEqual(state.failedImages, [], name + ': images load');
    return { ...state, sha256 };
  }

  async function click(selector) {
    await run(`(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(window.__qaVisible);
      if (!element) throw new Error('Missing visible control: ' + ${JSON.stringify(selector)});
      element.click();
    })()`);
    await pause(250);
  }
  async function pressKey(keyCode, modifiers = []) {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    // Native button activation uses Enter's character event, not only keyDown.
    if (keyCode === 'Enter') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await pause(180);
  }
  async function fillField(id, value) {
    await run(`(() => {
      const input = document.getElementById(${JSON.stringify(id)});
      if (!window.__qaVisible(input)) throw new Error('Missing visible input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await pause(50);
  }
  async function goHome() {
    if (!(await run(`window.__qaVisible(document.querySelector('.studio-home'))`))) await click('.studio-back-home');
    assert.ok(await run(`window.__qaVisible(document.querySelector('.studio-home'))`), 'Back to Home returns to the single Home screen');
    assert.deepEqual(await run(`[...document.querySelectorAll('[data-workspace]')].filter(window.__qaVisible).map(el=>el.dataset.workspace).filter(id=>id!=='home')`), [], 'Home hides working module screens');
    assert.ok(await run(`!document.querySelector('.studio-sidebar') || !window.__qaVisible(document.querySelector('.studio-sidebar'))`), 'Home has no competing sidebar');
  }
  async function openTool(id, keyboard = false) {
    await goHome();
    if (keyboard) {
      await run(`document.querySelector('[data-home-tool="${id}"]').focus()`);
      assert.equal(await run(`document.activeElement.dataset.homeTool`), id, 'Home card receives focus');
      await pressKey('Enter');
    } else await click('[data-home-tool="' + id + '"]');
    await pause(250);
    assert.ok(!(await run(`window.__qaVisible(document.querySelector('.studio-home'))`)), id + ': Home yields to the selected tool');
    assert.ok(await run(`[...document.querySelectorAll('.studio-back-home')].some(window.__qaVisible)`), id + ': obvious Back to Home action is visible');
  }

  const sectionTools = [
    { id: 'pdf', section: 'pdfSection', control: 'pdfInput', text: 'Choose your PDF' },
    { id: 'lesson', section: 'lessonContentSection', control: 'lessonInput', text: 'lesson' },
    { id: 'singing', section: 'singSongSection', control: 'singSongInput', text: 'Song MP3' },
    { id: 'local-captions', section: 'aiCaptionSection', control: 'captionVideoInput', text: 'Source Video' },
    { id: 'transcription', section: 'audioToTextSection', control: 'transcribeAudioInput', text: 'audio' },
  ];
  const helperTools = [
    { id: 'narration', section: 'narrationSection', text: 'Narration' },
    { id: 'speech', section: 'speechToolsSection', text: 'Text & Speech' },
    { id: 'media', section: 'mediaSection', text: 'Images & Video' },
    { id: 'templates', section: 'templateWorkflowSection', text: 'Templates' },
    { id: 'services', section: 'serverControlsSection', text: 'Local Service Status' },
  ];
  async function verifySectionTool(tool) {
    const result = await run(`(() => {
      const visible = window.__qaVisible;
      const chosen = document.getElementById(${JSON.stringify(tool.section)});
      const control = ${JSON.stringify(tool.control || '')} ? document.getElementById(${JSON.stringify(tool.control || '')}) : chosen?.querySelector(':scope > summary');
      return { chosenVisible: visible(chosen), open: chosen?.open, controlVisible: visible(control),
        siblingTools: ${JSON.stringify(sectionTools.filter(item => item.id !== tool.id).map(item => item.section))}.filter(id => visible(document.getElementById(id))),
        visibleWorkspaces: [...document.querySelectorAll('[data-workspace]')].filter(visible).map(el => el.dataset.workspace) };
    })()`);
    assert.ok(result.chosenVisible && result.open && result.controlVisible, tool.id + ': original selected controls are visible: ' + JSON.stringify(result));
    assert.deepEqual(result.siblingTools, [], tool.id + ': no unrelated PDF, song, caption, transcription or lesson module leaks onto this screen');
    assert.equal(result.visibleWorkspaces.length, 1, tool.id + ': exactly one workspace is visible');
    const leadingAction = tool.id === 'pdf' || tool.id === 'lesson' ? 'showScreenBtn' : tool.id === 'local-captions' ? 'aiCapSttBtn' : '';
    if (leadingAction) {
      const placement = await run(`(() => {
        const action = document.getElementById(${JSON.stringify(leadingAction)});
        const rect = action.getBoundingClientRect();
        const topbar = document.querySelector('.studio-topbar').getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, headerBottom: topbar.bottom, viewportHeight: innerHeight };
      })()`);
      assert.ok(placement.top >= placement.headerBottom - 1 && placement.bottom <= placement.viewportHeight, tool.id + ': leading action is fully visible below the fixed header: ' + JSON.stringify(placement));
    }
  }

  async function installNavigationFixtures() {
    await run(`(() => {
      // In-memory navigation fixtures, assigned without change events. No
      // importer, decoder, narration, transcription or export is triggered.
      window.__homeFixture = { nodes: {}, files: {}, text: 'Preserve this safe navigation lesson.' };
      for (const [id, name, type] of [['singSongInput','qa-song.mp3','audio/mpeg'], ['captionVideoInput','qa-caption.mp4','video/mp4'], ['pdfInput','qa-document.pdf','application/pdf']]) {
        const input = document.getElementById(id);
        const transfer = new DataTransfer();
        transfer.items.add(new File(['navigation-only fixture'], name, { type }));
        input.files = transfer.files;
        window.__homeFixture.nodes[id] = input;
        window.__homeFixture.files[id] = input.files[0];
      }
      const lesson = document.getElementById('lessonInput');
      window.__homeFixture.lesson = lesson;
      lesson.value = window.__homeFixture.text;
    })()`);
  }
  async function verifyNavigationFixtures() {
    const result = await run(`({ files: Object.entries(window.__homeFixture.nodes).map(([id, node]) => ({ id, sameNode: document.getElementById(id)===node, sameFile: document.getElementById(id).files[0]===window.__homeFixture.files[id] })), lessonSameNode: document.getElementById('lessonInput')===window.__homeFixture.lesson, lessonTextRetained: document.getElementById('lessonInput').value===window.__homeFixture.text, idle: !state.speaking && !state.exportingVideo && !state.generatingNarration })`);
    assert.ok(result.files.every(item => item.sameNode && item.sameFile), 'Navigation preserves original file inputs and selected File objects: ' + JSON.stringify(result));
    assert.ok(result.lessonSameNode && result.lessonTextRetained, 'Navigation preserves lesson textarea identity and text');
    assert.ok(result.idle, 'Opening tools does not start presentation work');
    report.interactions.push({ name: 'Original file inputs, selected files and lesson text survive Home navigation', ok: true, ...result });
  }

  async function verifyAppPreferences() {
    await goHome();
    assert.equal(await run(`document.querySelector('.simple-studio').dataset.appTheme`), 'dark', 'Fresh profile defaults to dark mode');
    const status = await run(`(() => {
      const setting = document.getElementById('studio-whatsapp-status');
      const toggle = document.getElementById('studio-theme-toggle');
      return { visible: window.__qaVisible(setting), status: setting?.querySelector('[role="status"]')?.textContent,
        disabled: setting?.disabled, whatsAppRole: setting?.getAttribute('role'), reviewVisible: window.__qaVisible(document.getElementById('studio-whatsapp-drafts-toggle')),
        switchRole: toggle?.getAttribute('role'), checked: toggle?.getAttribute('aria-checked') };
    })()`);
    assert.deepEqual(status, { visible: true, status: 'Off', disabled: false, whatsAppRole: 'switch', reviewVisible: true, switchRole: 'switch', checked: 'true' }, 'WhatsApp drafts default Off and can be enabled locally; both preferences are accessible switches');
    await installNavigationFixtures();
    await run(`(() => {
      const canvas = document.getElementById('previewCanvas');
      const themeToggle = document.getElementById('themeToggle');
      const themeSelect = document.getElementById('themeSelect');
      window.__appThemeFixture = { canvas, pixels: canvas.toDataURL(), themeToggle, checked: themeToggle.checked,
        themeSelect, selection: themeSelect.value, lessonTheme: state.theme };
    })()`);
    const verifyThemeSafety = async () => {
      const result = await run(`(() => {
        const fixture = window.__appThemeFixture;
        return { canvasSameNode: fixture.canvas === document.getElementById('previewCanvas'),
          samePixels: fixture.canvas.toDataURL() === fixture.pixels,
          sameThemeToggle: document.getElementById('themeToggle') === fixture.themeToggle && fixture.themeToggle.checked === fixture.checked,
          sameThemeSelection: document.getElementById('themeSelect') === fixture.themeSelect && fixture.themeSelect.value === fixture.selection,
          lessonThemeUnchanged: state.theme === fixture.lessonTheme,
          sameFiles: Object.entries(window.__homeFixture.nodes).every(([id, node]) => document.getElementById(id) === node && node.files[0] === window.__homeFixture.files[id]),
          sameLesson: document.getElementById('lessonInput') === window.__homeFixture.lesson && window.__homeFixture.lesson.value === window.__homeFixture.text };
      })()`);
      assert.ok(result.canvasSameNode && result.samePixels && result.sameThemeToggle && result.sameThemeSelection && result.lessonThemeUnchanged, 'App theme leaves presentation controls and canvas pixels unchanged: ' + JSON.stringify(result));
      assert.ok(result.sameFiles && result.sameLesson, 'Theme changes preserve selected files and lesson input identity');
      return result;
    };
    const dark = await capture('preferences-dark-desktop-home', 'Dark mode');
    await run(`document.getElementById('studio-theme-toggle').focus()`);
    await pressKey('Enter');
    assert.equal(await run(`document.querySelector('.simple-studio').dataset.appTheme`), 'light', 'Native keyboard activation selects light mode');
    assert.equal(await run(`document.getElementById('studio-theme-toggle').getAttribute('aria-checked')`), 'false', 'Theme switch exposes light selection');
    await verifyThemeSafety();
    const light = await capture('preferences-light-desktop-home', 'Dark mode');
    assert.notEqual(light.sha256, dark.sha256, 'Light and dark Home themes paint differently');
    await verifyWhatsAppDrafts(verifyThemeSafety);

    // A reload is safe only in this disposable profile; it proves local theme
    // persistence and is never used against the live production window.
    const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    window.reload();
    await reloaded;
    await run(bootstrapCheck);
    await run(installVisibilityCheck);
    assert.equal(await run(`document.querySelector('.simple-studio').dataset.appTheme`), 'light', 'Light app theme survives a renderer reload');
    await click('#studio-theme-toggle');
    assert.equal(await run(`document.querySelector('.simple-studio').dataset.appTheme`), 'dark', 'Theme switch restores dark mode');
    await installNavigationFixtures();
    report.interactions.push({ name: 'App preferences: default dark, keyboard light toggle, reload persistence, manual WhatsApp drafts switch, canvas and selected-input isolation', ok: true, status });
  }

  async function verifyWhatsAppDrafts(verifyThemeSafety) {
    const switchState = () => run(`(() => { const button = document.getElementById('studio-whatsapp-status'); return { disabled: button.disabled, checked: button.getAttribute('aria-checked') }; })()`);
    const assertNoCredentialControls = async () => {
      assert.equal(await run(`document.querySelectorAll('#studio-whatsapp-token, #studio-whatsapp-business-id, #studio-whatsapp-phone-id, #studio-whatsapp-save, #studio-whatsapp-validate, .studio-preferences input[type="password"]').length`), 0, 'Manual drafts contain no Meta account, token, template or validation controls');
    };
    await assertNoCredentialControls();
    assert.deepEqual(await switchState(), { disabled: false, checked: 'false' }, 'Local draft recording starts Off without account setup');
    assert.equal(await run(`window.__qaWhatsApp.snapshot().calls.filter(method => method === 'openWhatsAppDraft').length`), 0, 'Loading the app opens no external application');
    await click('#studio-whatsapp-drafts-toggle');
    await capture('preferences-whatsapp-empty-light-desktop', 'Review WhatsApp drafts');
    await click('#studio-whatsapp-drafts-toggle');
    await run(`document.getElementById('studio-whatsapp-status').focus()`);
    await pressKey('Enter');
    assert.deepEqual(await switchState(), { disabled: false, checked: 'true' }, 'Native keyboard activation enables local drafts');
    await run(`(async () => {
      await window.electronAPI.reportWhatsAppJob({ id: 'qa-complete', status: 'completed', processName: 'PDF video export', details: 'Saved: nursery-counting.mp4' });
      await window.electronAPI.reportWhatsAppJob({ id: 'qa-fail', status: 'failed', processName: 'Lesson narration preparation', details: 'The local voice model could not load. Restart the voice service and try again.' });
      await window.electronAPI.reportWhatsAppJob({ id: 'qa-complete', status: 'completed', processName: 'PDF video export', details: 'Duplicate must not create another draft.' });
    })()`);
    let snapshot = await run(`window.__qaWhatsApp.snapshot()`);
    assert.equal(snapshot.pending, 2, 'Exactly one draft is prepared per unique terminal job');
    assert.deepEqual(snapshot.drafts.map(draft => draft.status).sort(), ['completed', 'failed']);
    assert.equal(snapshot.calls.filter(method => method === 'openWhatsAppDraft').length, 0, 'Enabling and completing/failing jobs never open WhatsApp automatically');
    await click('#studio-whatsapp-drafts-toggle');
    assert.equal(await run(`document.querySelectorAll('[data-whatsapp-draft]').length`), 2, 'Review shows both completed and failed drafts');
    assert.ok(await run(`document.getElementById('studio-whatsapp-drafts').textContent.includes('nursery-counting.mp4') && document.getElementById('studio-whatsapp-drafts').textContent.includes('voice model could not load')`), 'Review displays the complete useful outcome and actual failure reason');
    await assertNoCredentialControls();
    const light = await capture('preferences-whatsapp-drafts-light-desktop', 'nursery-counting.mp4');
    await click('#studio-theme-toggle');
    await verifyThemeSafety();
    const dark = await capture('preferences-whatsapp-drafts-dark-desktop', 'voice model could not load');
    assert.notEqual(light.sha256, dark.sha256, 'Draft review follows the app light/dark preference');
    await click('[data-whatsapp-draft="qa-complete"] [data-draft-open="app"]');
    snapshot = await run(`window.__qaWhatsApp.snapshot()`);
    assert.equal(snapshot.lastAttempt.status, 'opened');
    assert.equal(snapshot.drafts.find(draft => draft.id === 'qa-complete').openedAt.length > 0, true, 'Explicit app opening marks only opened, never sent');
    assert.equal(snapshot.pending, 2, 'Opening a draft does not silently remove it');
    await run(`window.__qaWhatsApp.failNextOpen()`);
    await click('[data-whatsapp-draft="qa-fail"] [data-draft-open="web"]');
    assert.ok(await run(`[...document.querySelectorAll('.studio-preferences [role="alert"]')].some(element => window.__qaVisible(element) && element.textContent.includes('Mock WhatsApp app could not open'))`), 'A failed explicit opening shows actionable feedback');
    await capture('preferences-whatsapp-open-failure', 'Mock WhatsApp app could not open');
    await click('[data-whatsapp-draft="qa-fail"] [data-draft-open="web"]');
    snapshot = await run(`window.__qaWhatsApp.snapshot()`);
    assert.equal(snapshot.lastAttempt.status, 'opened');
    assert.equal(snapshot.lastAttempt.target, 'web');
    assert.equal(snapshot.calls.filter(method => method === 'openWhatsAppDraft').length, 3, 'Only the three explicitly clicked open actions reached the mock opener');
    assert.ok(await run(`document.getElementById('studio-whatsapp-drafts').textContent.includes('Send')`), 'Review explains that the user must press Send in WhatsApp');
    await click('#studio-whatsapp-status');
    assert.deepEqual(await switchState(), { disabled: false, checked: 'false' }, 'Off is reflected immediately');
    snapshot = await run(`window.__qaWhatsApp.snapshot()`);
    assert.equal(snapshot.pending, 2, 'Switching Off keeps existing drafts available for review');
    assert.equal(await run(`window.electronAPI.reportWhatsAppJob({ id: 'qa-off', status: 'completed', processName: 'Off fixture' }).then(result => result.skipped)`), 'disabled', 'Off creates no new draft');
    assert.equal(await run(`window.__qaWhatsApp.snapshot().pending`), 2);
    window.setContentSize(390, 844);
    await pause(250);
    await run(`document.querySelector('[data-whatsapp-draft="qa-complete"]').scrollIntoView({ block: 'start' })`);
    await capture('preferences-whatsapp-completed-dark-mobile', 'nursery-counting.mp4');
    await run(`document.querySelector('[data-whatsapp-draft="qa-fail"]').scrollIntoView({ block: 'start' })`);
    await capture('preferences-whatsapp-failed-dark-mobile', 'voice model could not load');
    await click('#studio-theme-toggle');
    await run(`document.querySelector('[data-whatsapp-draft="qa-fail"]').scrollIntoView({ block: 'start' })`);
    await capture('preferences-whatsapp-failed-light-mobile', 'voice model could not load');
    await click('[data-draft-dismiss="qa-complete"]');
    snapshot = await run(`window.__qaWhatsApp.snapshot()`);
    assert.equal(snapshot.pending, 1);
    assert.equal(snapshot.drafts[0].id, 'qa-fail', 'Dismiss removes only the selected draft while Off');
    assert.equal(await run(`document.querySelector('[data-whatsapp-draft="qa-complete"]')`), null, 'Dismissed draft disappears from review');
    await verifyThemeSafety();
    await click('#studio-whatsapp-drafts-toggle');
    window.setContentSize(1440, 1000);
    await pause(200);
    await verifyThemeSafety();
    assert.equal(await run(`document.querySelector('.simple-studio').dataset.appTheme`), 'light', 'Preferences QA leaves light theme selected for reload persistence check');
    report.interactions.push({ name: 'Manual WhatsApp drafts: explicit keyboard On, deduplicated completed/failed previews, no automatic opening, app/web open only on click, opened-not-sent, visible opening failure, Off keeps existing drafts/stops new, selective dismissal, desktop/mobile light/dark isolation', ok: true });
  }

  async function verifyNarrowPreferences() {
    const placement = await run(`(() => {
      const header = document.querySelector('.studio-topbar').getBoundingClientRect();
      return ['studio-whatsapp-status', 'studio-theme-toggle'].map(id => {
        const element = document.getElementById(id);
        const rect = element.getBoundingClientRect();
        return { id, visible: window.__qaVisible(element), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          width: rect.width, height: rect.height, headerBottom: header.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
      });
    })()`);
    for (const setting of placement) {
      assert.ok(setting.visible && setting.left >= 0 && setting.right <= setting.viewportWidth && setting.top >= setting.headerBottom && setting.bottom <= setting.viewportHeight && setting.height >= 44,
        'Mobile preferences are labeled, touch-sized, and visible above the fold: ' + JSON.stringify(setting));
    }
    report.interactions.push({ name: 'Mobile Home keeps WhatsApp status and dark mode visible above the fold', ok: true, placement });
  }

  async function verifyPreviewSafety(viewport) {
    await openTool('lesson');
    await run(`(() => {
      document.getElementById('lessonInput').value = 'A safe, silent preview for Home navigation testing.';
      for (const input of document.querySelectorAll('[id="introClipEnabled"]')) input.checked = false;
      state.introPlayback.enabled = false;
    })()`);
    await click('#showScreenBtn');
    await pause(300);
    assert.ok(await run(`window.__qaVisible(document.getElementById('stagePanel'))`), 'Silent lesson preview opens');
    assert.ok(await run(`!state.speaking && !state.exportingVideo && !state.generatingNarration`), 'Silent preview starts no narration or export');
    await capture(viewport + '-12-preview', 'Preview');
    // Guard-state fixture only, not real media or processing. Home must refuse
    // this navigation without clicking Stop/Edit or mutating active state.
    await run(`state.speaking = true`);
    await click('.studio-back-home');
    assert.ok(await run(`state.speaking && window.__qaVisible(document.getElementById('stagePanel')) && !window.__qaVisible(document.querySelector('.studio-home'))`), 'Busy preview refuses Home navigation without stopping playback');
    await run(`state.speaking = false`);
    await goHome();
    await openTool('singing');
    await verifySectionTool(sectionTools.find(tool => tool.id === 'singing'));
    assert.ok(await run(`!window.__qaVisible(document.getElementById('stagePanel'))`), 'Idle preview is hidden when another preparation tool opens');
    await goHome();
    report.interactions.push({ name: viewport + ': silent preview, busy Home refusal, idle Home return and different tool selection', ok: true });
  }

  async function verifyMobileHistory() {
    // A second disposable window enables the remote-only history behavior in
    // the stub bridge. Its services, permissions and network remain isolated.
    const previousWindow = window;
    createWindow(true);
    previousWindow.destroy();
    window.setContentSize(390, 844);
    await window.loadURL('app://voice/renderer-dist/index.html');
    await run(bootstrapCheck);
    await run(installVisibilityCheck);
    assert.equal(await run(`window.electronAPI.isMobileRemote`), true, 'QA-only bridge enables real remote navigation behavior');
    await verifyRemoteWhatsApp();
    await installNavigationFixtures();
    await openTool('singing');
    await goHome();
    await openTool('local-captions');
    const moveHistory = async (direction, expected) => {
      await run(`history.${direction}()`);
      await pause(400);
      if (expected === 'home') assert.ok(await run(`window.__qaVisible(document.querySelector('.studio-home'))`), direction + ': browser history restores Home');
      else await verifySectionTool(sectionTools.find(tool => tool.id === expected));
    };
    await moveHistory('back', 'home');
    await moveHistory('back', 'singing');
    await moveHistory('forward', 'home');
    await moveHistory('forward', 'local-captions');
    await verifyNavigationFixtures();
    await capture('mobile-history-local-captions', 'Source Video');

    await goHome();
    await openTool('captions');
    await moveHistory('back', 'home');
    await run(`history.forward()`);
    await pause(400);
    assert.ok(await run(`document.querySelector('.simple-studio').dataset.caption === 'true' && !window.__qaVisible(document.querySelector('.studio-home'))`), 'Forward restores Caption Burner without showing Home');
    await capture('mobile-history-caption-burner', 'Upload video file');

    await goHome();
    await openTool('translator');
    await moveHistory('back', 'home');
    assert.ok(await run(`!document.body.classList.contains('tdub-open')`), 'Browser Back closes the retained translator');
    await run(`history.forward()`);
    await pause(400);
    assert.ok(await run(`document.body.classList.contains('tdub-open') && !window.__qaVisible(document.querySelector('.studio-home'))`), 'Forward restores the translator without showing Home');
    await capture('mobile-history-translator', 'Video and Audio Translator');

    await goHome();
    await openTool('lesson');
    await run(`(() => {
      document.getElementById('lessonInput').value = 'A safe remote history preview.';
      for (const input of document.querySelectorAll('[id="introClipEnabled"]')) input.checked = false;
      state.introPlayback.enabled = false;
    })()`);
    await click('#showScreenBtn');
    await run(`state.speaking = true`);
    await run(`history.back()`);
    await pause(400);
    assert.ok(await run(`state.speaking && window.__qaVisible(document.getElementById('stagePanel')) && !window.__qaVisible(document.querySelector('.studio-home'))`), 'Mobile browser Back refuses busy preview without stopping it');
    await run(`state.speaking = false`);
    await goHome();
    report.interactions.push({ name: 'Remote browser Back/Forward restores exact section, Home, Caption Burner and translator; selected files remain; busy preview is not interrupted', ok: true });
  }

  async function verifyRemoteWhatsApp() {
    await goHome();
    await click('#studio-whatsapp-status');
    assert.equal(await run(`document.getElementById('studio-whatsapp-status').getAttribute('aria-checked')`), 'true', 'Remote can enable local draft preparation without account credentials');
    await run(`(async () => {
      await window.electronAPI.reportWhatsAppJob({ id: 'qa-remote-complete', status: 'completed', processName: 'PDF video export', details: 'Saved: remote-lesson.mp4' });
      await window.electronAPI.reportWhatsAppJob({ id: 'qa-remote-failed', status: 'failed', processName: 'Voice preparation', details: 'The voice service is unavailable.' });
    })()`);
    await click('#studio-whatsapp-drafts-toggle');
    assert.equal(await run(`document.querySelectorAll('#studio-whatsapp-drafts [data-draft-open], .studio-preferences input[type="password"], #studio-whatsapp-token, #studio-whatsapp-business-id, #studio-whatsapp-phone-id').length`), 0, 'Remote review contains no credentials or desktop external-opening buttons');
    assert.ok(await run(`/desktop/i.test(document.getElementById('studio-whatsapp-drafts').textContent)`), 'Remote draft review explains desktop-only WhatsApp opening');
    await capture('preferences-whatsapp-remote-drafts-no-desktop-open', 'remote-lesson.mp4');
    await click('#studio-whatsapp-status');
    assert.equal(await run(`document.getElementById('studio-whatsapp-status').getAttribute('aria-checked')`), 'false', 'Remote can turn draft preparation off');
    assert.equal(await run(`window.__qaWhatsApp.snapshot().pending`), 2, 'Remote Off retains existing reviewable drafts');
    await click('[data-draft-dismiss="qa-remote-complete"]');
    assert.equal(await run(`window.__qaWhatsApp.snapshot().pending`), 1, 'Remote dismissal removes only the selected local draft');
    const calls = await run(`window.__qaWhatsApp.snapshot().calls`);
    assert.deepEqual(calls.filter(method => method === 'openWhatsAppDraft' || method === 'saveWhatsAppConfig' || method === 'validateWhatsAppConfig'), [], 'Remote UI never invokes a desktop opener or credential configuration');
    await click('#studio-whatsapp-drafts-toggle');
    report.interactions.push({ name: 'Remote WhatsApp drafts: no credentials or desktop open buttons, On/Off retains old drafts, selective dismissal, zero external opener calls', ok: true });
  }

  async function verifyOldWhatsAppBackendGuard() {
    // An old running backend must not turn its retired automatic sender on.
    const previousWindow = window;
    createWindow(false, ['--qa-whatsapp-old-mode']);
    previousWindow.destroy();
    await window.loadURL('app://voice/renderer-dist/index.html');
    await run(bootstrapCheck);
    await run(installVisibilityCheck);
    assert.equal(await run(`document.getElementById('studio-whatsapp-status').disabled`), true, 'An older non-draft backend cannot be enabled by the new UI');
    await run(`document.getElementById('studio-whatsapp-status').click()`);
    assert.ok(await run(`[...document.querySelectorAll('.studio-preferences [role="alert"]')].some(element => window.__qaVisible(element) && element.textContent.trim())`), 'An older backend displays an actionable reload/availability warning');
    assert.equal(await run(`document.querySelectorAll('[data-draft-open], #studio-whatsapp-token, #studio-whatsapp-business-id').length`), 0);
    const calls = await run(`window.__qaWhatsApp.snapshot().calls`);
    assert.deepEqual(calls.filter(method => method !== 'getWhatsAppAutoSend'), [], 'Old mode only receives safe status reads, never enable/open/report calls');
    await capture('preferences-whatsapp-old-backend-guard', 'WhatsApp drafts');
    report.interactions.push({ name: 'Older backend guard: disabled draft switch, visible actionable warning, no retired sender or opening invocation', ok: true });
  }

  if (process.argv.includes('--qa-whatsapp-session')) {
    await goHome();
    await pause(500);
    const toggle = '.studio-whatsapp-auto button[role="switch"]';
    assert.equal(await run(`document.querySelector('.studio-whatsapp-options').open`), false, 'Extra display starts collapsed');
    assert.ok(await run(`document.querySelector('.studio-whatsapp-auto').getBoundingClientRect().height < 160`), 'WhatsApp panel remains compact');
    assert.equal(await run(`document.querySelector('.studio-header-icons').innerText.trim()`), '', 'Only icons visible, no labels or status text');
    assert.ok(await run(`!!document.querySelector('.simple-topbar-actions .studio-header-icons')`), 'Icons are in top-right header actions');
    await capture('whatsapp-auto-compact', 'Pattan Workspace');
    await click(toggle);
    assert.equal(await run(`document.querySelector('.studio-whatsapp-options').open`), true, 'First click opens consent instead of sending');
    assert.equal(await run(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-checked')`), 'false', 'Consent still gates automatic sending');
    await click('.studio-whatsapp-risk input');
    await click(toggle);
    await capture('whatsapp-auto-qr-dark', 'Scan the QR code in Chrome');
    await click('.studio-whatsapp-auto .studio-whatsapp-draft-actions button');
    await click('.studio-whatsapp-auto button[aria-expanded]');
    await capture('whatsapp-auto-connected-dark', 'Voice engine timed out.');
    assert.equal(await run(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-checked')`), 'true');
    assert.deepEqual(await run(`[...document.querySelectorAll('.studio-header-icons .studio-icon-toggle')].map(el => getComputedStyle(el).backgroundColor)`), ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], 'Both icons keep the normal background even when enabled');
    await click('#studio-theme-toggle');
    await pause(400);
    assert.equal(await run(`getComputedStyle(document.getElementById('studio-theme-toggle')).backgroundColor`), 'rgba(0, 0, 0, 0)', 'Off moon blends into the header');
    await capture('whatsapp-auto-connected-light', 'Delivered');
    window.setContentSize(390, 844);
    await pause(500);
    await capture('whatsapp-auto-mobile', 'Delivered');
    await click(toggle);
    assert.equal(await run(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-checked')`), 'false');
    await pause(400);
    assert.equal(await run(`getComputedStyle(document.querySelector(${JSON.stringify(toggle)})).backgroundColor`), 'rgba(0, 0, 0, 0)', 'Off WhatsApp blends into the header');
    await run(`window.dispatchEvent(new CustomEvent('pattan-warning', { detail: { message: 'Test warning: token=secret123' } }))`);
    await pause(100);
    assert.ok(await run(`document.querySelector('.app-warning-panel').innerText.includes('[credential removed]')`), 'Warning details redact secrets');
    assert.equal(await run(`document.querySelector('.app-warning-panel').innerText.includes('secret123')`), false);
    await capture('app-warning-mobile', 'Something needs attention');
    await click('.app-warning-panel button');
    assert.equal(await run(`!!document.querySelector('.app-warning-panel')`), false, 'Warnings dismiss without restarting');
    assert.equal(report.errors.length, 0, 'No renderer errors');
    report.interactions.push({ name: 'Automatic WhatsApp consent, QR, connection, history, dark/light, narrow layout and Off', ok: true });
    finish(); return;
  }
  const requiredIds = ['inputPanel', 'stagePanel', 'lessonInput', 'showScreenBtn', 'playBtn', 'editBtn', 'pdfInput', 'singSongInput', 'captionVideoInput', 'transcribeAudioInput'];
  const idCounts = await run(`Object.fromEntries(${JSON.stringify(requiredIds)}.map(id => [id, document.querySelectorAll('[id="' + id + '"]').length]))`);
  for (const [id, count] of Object.entries(idCounts)) assert.equal(count, 1, 'Required original control remains unique: ' + id);
  assert.ok(await run(`!!document.querySelector('.simple-studio')`), 'Simple Home shell is built and loaded');
  const homeCards = await run(`[...document.querySelectorAll('[data-home-tool]')].map(el => ({ id: el.dataset.homeTool, tag: el.tagName, text: el.innerText.trim() }))`);
  for (const id of ['pdf', 'lesson', 'singing', 'local-captions', 'captions', 'quotes', 'exporter', 'resizer', 'translator', 'transcription']) {
    assert.equal(homeCards.filter(card => card.id === id).length, 1, 'A single discoverable Home card exists for ' + id);
    assert.equal(homeCards.find(card => card.id === id).tag, 'BUTTON', 'Home card uses native keyboard-operable button: ' + id);
  }
  report.interactions.push({ name: 'All primary tools have one native Home card and retained engine IDs are unique', ok: true, homeCards, idCounts });
  await verifyAppPreferences();
  await installNavigationFixtures();

  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
    window.setContentSize(viewport.width, viewport.height);
    await pause(200);
    await goHome();
    if (viewport.name === 'mobile') await verifyNarrowPreferences();
    await capture(viewport.name + '-01-home', 'Sing Song');
    for (let index = 0; index < sectionTools.length; index++) {
      const tool = sectionTools[index];
      await openTool(tool.id, index === 0);
      await verifySectionTool(tool);
      await capture(viewport.name + '-0' + (index + 2) + '-' + tool.id, tool.text);
      if (tool.id === 'local-captions') {
        await fillField('captionSizeSlider', '110');
        assert.equal(await run(`getComputedStyle(document.getElementById('captionSizePreviewText')).fontSize`), '110px', 'Local size sample updates immediately');
        await run(`document.getElementById('captionSizePreviewText').scrollIntoView({block:'center'})`);
        await capture(viewport.name + '-local-caption-size-preview', 'Caption size preview');
        await fillField('captionSizeSlider', '50');
      }
    }
    for (const [index, tool] of [{ id: 'quotes', text: 'Quote' }, { id: 'exporter', text: 'My Exporter' }, { id: 'resizer', text: 'Fit your video' }].entries()) {
      await openTool(tool.id);
      const screen = await capture(viewport.name + '-0' + (index + 7) + '-' + tool.id, tool.text);
      assert.deepEqual(screen.visibleWorkspaces, [tool.id], tool.id + ': only the selected video workspace is visible');
      assert.deepEqual(screen.visiblePreparationSections, [], tool.id + ': preparation controls stay off the video tool screen');
    }
    await openTool('translator');
    await capture(viewport.name + '-10-translator', 'Video and Audio Translator');
    assert.ok(await run(`document.body.classList.contains('tdub-open')`), 'Original translator opens through Home');
    assert.ok(await run(`!window.__qaVisible(document.getElementById('inputPanel'))`), 'Translator hides lesson preparation');
    await goHome();
    assert.ok(await run(`!document.body.classList.contains('tdub-open')`), 'Back to Home closes the translator');
    await openTool('captions');
    await capture(viewport.name + '-11-caption-burner', 'Upload video file');
    await run(`(() => {
      const sample = document.querySelector('[data-caption-size-preview]');
      const input = sample.previousElementSibling.querySelector('input[type="range"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '110');
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await pause(100);
    assert.equal(await run(`getComputedStyle(document.querySelector('[data-caption-size-preview] span')).fontSize`), '110px', 'Caption Burner size sample updates immediately');
    await run(`document.querySelector('[data-caption-size-preview]').scrollIntoView({block:'center'})`);
    await capture(viewport.name + '-burner-caption-size-preview', 'Caption size preview');
    assert.ok(await run(`!window.__qaVisible(document.getElementById('inputPanel'))`), 'Caption Burner hides lesson preparation');
    await goHome();
    await verifyNavigationFixtures();
    await verifyPreviewSafety(viewport.name);
    for (const [index, tool] of helperTools.entries()) {
      await openTool(tool.id);
      await verifySectionTool(tool);
      await capture(viewport.name + '-' + (index + 13) + '-' + tool.id, tool.text);
      await goHome();
      assert.equal(await run(`document.activeElement?.dataset.homeTool`), tool.id, 'Back to Home restores focus to the selected helper');
    }
    // Restore text fixture after the isolated preview for the next viewport.
    await run(`document.getElementById('lessonInput').value = window.__homeFixture.text`);
    report.interactions.push({ name: viewport.name + ': all primary Home cards and five helper links, Enter activation, focused module isolation, Back to Home and focus restoration', ok: true });
  }
  await verifyMobileHistory();
  await verifyOldWhatsAppBackendGuard();

  if (report.errors.length) throw new Error('Uncaught renderer errors: ' + JSON.stringify(report.errors));
  if (report.missingAssets.length) throw new Error('Missing local assets: ' + [...new Set(report.missingAssets)].join(', '));
  assert.deepEqual(report.blockedBridge.filter(method => /WhatsApp/i.test(method)), [], 'Every intended WhatsApp interaction uses the isolated stateful mock; no production or unsupported sender bridge is reached');
  assert.equal(report.whatsAppBridge.some(item => item.method === 'saveWhatsAppConfig' || item.method === 'validateWhatsAppConfig'), false, 'Manual draft QA never invokes retired Meta configuration');
  assert.deepEqual(report.whatsAppBridge.filter(item => item.method === 'openWhatsAppDraft').map(item => item.target), ['app', 'web', 'web'], 'Only explicit desktop review clicks reach the mocked app/web opener');
  assert.equal(report.whatsAppBridge.filter(item => item.method === 'dismissWhatsAppDraft').length, 2, 'QA dismisses selected desktop and remote drafts');
  assert.equal(report.whatsAppBridge.some(item => item.method === 'setWhatsAppAutoSend' && item.enabled), true, 'QA exercised explicit On');
  assert.equal(report.whatsAppBridge.some(item => item.method === 'setWhatsAppAutoSend' && !item.enabled), true, 'QA exercised explicit Off');
  // Back/Forward intentionally restores earlier screens, so their repeat
  // captures may be pixel-identical. The primary navigation captures must
  // still be distinct to detect stale compositor frames.
  const primaryScreens = report.screens.filter(screen => !screen.name.startsWith('mobile-history-') && !screen.name.startsWith('preferences-'));
  assert.equal(new Set(primaryScreens.map(screen => screen.sha256)).size, primaryScreens.length, 'Each captured screen has distinct painted content');
  finish();
}).catch(finish);
