'use strict';
// The real editor in an isolated headless Chromium page. Media is synthesized
// locally; every native API and translation response is a fake. Nothing calls
// the running desktop app, external providers, or user export directories.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const puppeteer = require('puppeteer');
const root = path.resolve(__dirname, '..');
const projectKey = 'pattan-my-exporter-project-v1';
let browser, directory;
const passed = [], failed = [], screenshots = [], additionalScreenshots = [], playbackTraces = [];
const focusedOrganization = process.argv.includes('--organization-only');
const focusedScreenshots = process.argv.includes('--screenshots-only');
const organizationChecks = /organization|mounts|undo|continuous playback|buffering video|export payload|export without captions|export cancellation|cancellation during preflight|speech provider failure|Groq Telugu|caption cancellation|cancelling during metadata|responsive editor|library thumbnails|runtime errors/i;

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Synthetic QA media failed: ${result.error?.message || result.stderr}`);
}
async function check(name, operation) {
  if (focusedOrganization && !organizationChecks.test(name)) return;
  if (focusedScreenshots && !/mounts|responsive editor|library thumbnails|runtime errors/i.test(name)) return;
  try { await operation(); passed.push(name); }
  catch (error) { failed.push({ name, error: error.message }); }
}
async function clickText(page, text, options = {}) {
  const result = await page.evaluate((label, opts) => {
    const candidates = [...document.querySelectorAll(opts.scope ? `${opts.scope} button,${opts.scope} summary` : 'button,summary')]
      .filter(button => opts.contains ? button.textContent.includes(label) : button.textContent.trim() === label);
    const button = candidates.find(element => element.offsetWidth && element.offsetHeight && !element.matches(':disabled'));
    if (!button) return false;
    button.click(); return true;
  }, text, options);
  assert.ok(result, `Enabled visible button unavailable: ${text}`);
}
async function setLabel(page, prefix, value, kind = 'input') {
  const changed = await page.evaluate((text, next, tag) => {
    const label = [...document.querySelectorAll('label')].find(element => {
      const input = element.querySelector(tag);
      return element.textContent.trim().startsWith(text) && input?.offsetWidth && input.offsetHeight;
    });
    const input = label?.querySelector(tag);
    if (!input || input.matches(':disabled')) return false;
    const setter = Object.getOwnPropertyDescriptor(tag === 'select' ? HTMLSelectElement.prototype : tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(next));
    input.dispatchEvent(new Event(tag === 'select' ? 'change' : 'input', { bubbles: true }));
    if (tag !== 'select') input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, prefix, value, kind);
  assert.ok(changed, `Editable control unavailable: ${prefix}`);
}
async function saved(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), projectKey); }
async function settle(page) { await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500))); }
async function reset(page) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.mx-page'); await settle(page); }
async function shortcut(page, key) { await page.keyboard.down('Control'); await page.keyboard.press(key); await page.keyboard.up('Control'); }
async function setControl(page, selector, value) {
  assert.ok(await page.evaluate((query, next) => {
    const element = [...document.querySelectorAll(query)].find(input => input.offsetWidth && input.offsetHeight);
    if (!element || element.matches(':disabled')) return false;
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, String(next));
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return true;
  }, selector, value), `Editable control unavailable: ${selector}`);
}
async function seekAt(page, seconds, total = 8) {
  const point = await page.evaluate(({ time, duration }) => {
    const lane = document.querySelector('.mx-video-lane').getBoundingClientRect();
    const ruler = document.querySelector('.mx-scrubber').getBoundingClientRect();
    return { x: lane.left + lane.width * time / duration, y: ruler.top + ruler.height / 2 };
  }, { time: seconds, duration: total });
  await page.mouse.click(point.x, point.y);
}
async function inspector(page) { await clickText(page, 'Clip settings', { scope: '.mx-editor-navigation' }); }
async function showInspector(page, tab = 'Clip') {
  const open = await page.$eval('.mx-workspace', element => element.classList.contains('mx-side-panel-inspector'));
  if (!open) await inspector(page);
  await clickText(page, tab, { scope: '.mx-inspector-tabs' });
}
async function hideInspector(page) {
  const open = await page.$eval('.mx-workspace', element => element.classList.contains('mx-side-panel-inspector'));
  if (open) await page.click('.mx-inspector .mx-side-panel-close');
}
async function addProjectTab(page) {
  const visiblePlus = await page.evaluate(() => [...document.querySelectorAll('.mx-project-tabs button')]
    .some(button => button.textContent.trim() === '+ Project' && button.offsetWidth && button.offsetHeight));
  if (visiblePlus) await clickText(page, '+ Project', { scope: '.mx-project-tabs' });
  else {
    await clickText(page, 'More tools', { scope: '.mx-filmora-toolstrip', contains: true });
    await clickText(page, 'New project tab', { scope: '.mx-filmora-toolstrip .mx-editor-menu' });
  }
}
async function revealControl(page, selector) {
  assert.ok(await page.evaluate(query => {
    const control = document.querySelector(query); if (!control) return false;
    const details = []; let parent = control.parentElement;
    while (parent) { if (parent.tagName === 'DETAILS' && !parent.open) details.unshift(parent); parent = parent.parentElement; }
    for (const disclosure of details) disclosure.querySelector(':scope > summary')?.click();
    return true;
  }, selector), `Control unavailable to reveal: ${selector}`);
}
async function thumbnailPaintReady(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('.mx-asset-thumbnail video,.mx-asset-thumbnail img')]
    .every(media => media.tagName === 'VIDEO'
      ? media.readyState >= 2 && media.currentTime > 0 && !media.seeking
      : media.complete && media.naturalWidth > 0));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function assertLastTimelineMenuAction(page) {
  const menu = await page.$('.mx-filmora-toolstrip .mx-editor-menu-items');
  const menuBox = await menu.boundingBox();
  await page.mouse.move(menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height / 2);
  await page.mouse.wheel({ deltaY: 600 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const lastAction = await page.evaluate(() => {
    const button = [...document.querySelectorAll('.mx-filmora-toolstrip .mx-editor-menu button')].find(button => button.textContent.trim() === 'New project tab');
    const rect = button.getBoundingClientRect(); const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { rect: rect.toJSON(), timeline: document.querySelector('.mx-timeline').getBoundingClientRect().toJSON(),
      hit: button === hit || button.contains(hit) };
  });
  assert.ok(lastAction.hit && lastAction.rect.top >= lastAction.timeline.top - 2 && lastAction.rect.bottom <= lastAction.timeline.bottom + 2,
    JSON.stringify(lastAction));
}

async function main() {
  const browserPath = [puppeteer.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(candidate => fs.existsSync(candidate));
  if (!browserPath) throw new Error('No installed Chromium browser is available for exporter verification.');
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'my-exporter-browser-qa-'));
  const video = path.join(directory, 'editor-video.mp4'), image = path.join(directory, 'editor-image.png');
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-y', video]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x123456:s=320x180', '-frames:v', '1', '-threads', '1', '-y', image]);
  const voiceVideo = path.join(directory, 'voice-source.mp4'), voiceOutput = path.join(directory, 'voice-replaced.mp4');
  if (process.argv.includes('--voice-only')) {
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x385d73:s=160x90:r=5', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=16000',
      '-t', '60', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', voiceVideo]);
    fs.copyFileSync(voiceVideo, voiceOutput);
  }
  const autoAllPaths = {
    one: path.join(directory, 'Scene1.mp4'), two: path.join(directory, 'Lesson9Scene2.png'),
    three: path.join(directory, 'Lesson20Scene3.mp4'), ten: path.join(directory, 'Lesson1Scene10.mp4'), audio: video,
  };
  if (process.argv.includes('--auto-all-only')) {
    for (const target of [autoAllPaths.one, autoAllPaths.three, autoAllPaths.ten]) fs.copyFileSync(video, target);
    fs.copyFileSync(image, autoAllPaths.two);
  }
  const { normalizeProject } = await import('../src/components/MyExporter/editor-model.mjs');
  const baseScene = { kind: 'video', path: video, width: 320, height: 180, sourceDuration: 8, speed: 1, hasAudio: true, volume: 1, fit: 'contain' };
  const seed = normalizeProject({ format: 'pattan-my-exporter-project', version: 3, projectName: 'Isolated QA', selectedId: 'video-a',
    scenes: [{ ...baseScene, id: 'video-a', libraryId: 'asset-video', name: 'Z First video', trimStart: 1, duration: 4 },
      { id: 'image-b', libraryId: 'asset-image', kind: 'image', path: image, name: 'A Second image', duration: 1, trimStart: 0, sourceDuration: 1, width: 320, height: 180 },
      { ...baseScene, id: 'video-c', libraryId: 'asset-other', name: 'B Third video', trimStart: 3, duration: 3 }],
    mediaLibrary: [{ ...baseScene, id: 'asset-video', name: 'Z First video', duration: 8, trimStart: 0 },
      { id: 'asset-image', kind: 'image', path: image, name: 'A Second image', duration: 1, width: 320, height: 180 },
      { ...baseScene, id: 'asset-unused', name: 'Unused source', duration: 8, trimStart: 0 }],
    captions: [{ id: 'cue-a', start: .5, end: 2, text: 'Tiger.', words: [{ text: 'Tiger.', start: .5, end: 2 }] },
      { id: 'cue-c', start: 5.2, end: 6, text: 'Fox.', words: [{ text: 'Fox.', start: 5.2, end: 6 }] }],
    textOverlays: [{ id: 'title', text: 'Original title', start: 0, end: 4, x: 50, y: 20, fontSize: 48, opacity: 1, color: '#ffffff', fontFamily: 'Arial' }],
    audioTracks: [{ id: 'linked-sound', name: 'Linked sound', path: video, start: 0, trimStart: 1, duration: 4, sourceDuration: 8, speed: 1,
      originSceneId: 'video-a', detachedFromSceneId: 'video-a', detachedOffset: 0, timelineOffsetWithinScene: 0, volume: .3 }],
    watermark: { name: 'QA logo', path: image, preview: '' }, watermarkEnabled: false, captionLanguage: 'en', settings: { captionFontSize: 42 } });

  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const entryId = '\0my-exporter-qa-entry';
  const componentPath = path.join(root, 'src/components/MyExporter/MyExporter.jsx').replace(/\\/g, '/');
  const appStylePath = path.join(root, 'src/index.css').replace(/\\/g, '/');
  const bundle = await build({ configFile: false, root, logLevel: 'error', plugins: [react(), {
    name: 'my-exporter-qa-entry', resolveId(id) { if (id === 'my-exporter-qa-entry') return entryId; },
    load(id) { if (id === entryId) return `import React from 'react'; import {createRoot} from 'react-dom/client'; import ${JSON.stringify(appStylePath)}; import MyExporter from ${JSON.stringify(componentPath)}; createRoot(document.getElementById('root')).render(React.createElement(MyExporter));`; },
  }], build: { write: false, minify: false, cssCodeSplit: false, rolldownOptions: { input: 'my-exporter-qa-entry', output: { format: 'iife', name: 'MyExporterQA' } } } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle).output;
  const js = output.find(item => item.type === 'chunk').code;
  const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n');
  fs.writeFileSync(path.join(directory, 'editor.js'), js);
  fs.writeFileSync(path.join(directory, 'editor.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;min-width:0;margin:0}body{background:#12151b}${css}</style></head><body><div id="root"></div><script src="editor.js"></script></body></html>`);
  browser = await puppeteer.launch({ executablePath: browserPath, headless: true,
    args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.setRequestInterception(true);
  page.on('request', request => /^(file:|blob:|data:)/i.test(request.url()) ? request.continue() : request.abort());
  await page.evaluateOnNewDocument((state, key, paths) => {
    localStorage.removeItem('pattan-my-exporter-workspaces-v1');
    localStorage.setItem(key, sessionStorage.getItem('my-exporter-qa-project-override') ?? JSON.stringify(state));
    window.__qaCalls = { probe: [], transcribe: [], preflight: [], export: [], voice: [], translation: [], cancel: [], save: [], write: [], notification: [], unexpected: [] };
    window.__qaASRMode = 'success'; window.__qaExportMode = 'success'; window.__qaProbeMode = 'success'; window.__qaPreflightMode = 'success';
    window.__qaVoiceMode = 'success'; window.__qaTranslationMode = 'success';
    window.__qaCaptionCache = new Map();
    const calls = window.__qaCalls;
    const captionResponse = options => ({ ok: true, detectedLang: 'en', sourceLanguage: 'en', language: 'en', duration: 8, timingSource: 'word',
      text: 'Tiger.', words: [{ word: 'Tiger.', start: 1.5, end: 2.5 }], segments: [{ start: 1.5, end: 2.5, text: 'Tiger.' }],
      captions: [{ start: 1.5, end: 2.5, text: options.targetLanguage === 'te' ? 'పులి.' : 'Tiger.',
        words: options.targetLanguage === 'te' ? undefined : [{ text: 'Tiger.', start: 1.5, end: 2.5 }] }] });
    const transcribe = async options => {
      calls.transcribe.push(JSON.parse(JSON.stringify(options)));
      if (window.__qaASRMode === 'error') return { ok: false, error: 'QA speech provider failed; old captions must stay.' };
      if (window.__qaASRMode === 'deferred') return new Promise(resolve => { window.__qaResolveASR = resolve; });
      if (window.__qaASRResponse) return structuredClone(window.__qaASRResponse);
      return captionResponse(options);
    };
    const methods = {
      getPathForFile: file => /\.png$/i.test(file?.name || '') ? paths.image : paths.video,
      myExporterProbe: async options => {
        calls.probe.push(options);
        const result = { ok: true, duration: 8, width: 320, height: 180, hasAudio: true, frameRate: 15, fileSize: 1000, modifiedAt: 1 };
        if (window.__qaProbeMode === 'deferred') return new Promise(resolve => { window.__qaResolveProbe = () => resolve(result); });
        return result;
      },
      myExporterPickMedia: async () => ({ ok: true, filePaths: [paths.video, paths.image] }),
      myExporterPickAudio: async () => ({ ok: true, filePaths: [paths.video] }),
      myExporterWaveform: async () => ({ ok: true, peaks: Array.from({ length: 60 }, (_, i) => .1 + (i % 8) / 12), duration: 8, trimStart: 0, sourceDuration: 8, hasAudio: true, fileSize: 1000, modifiedAt: 1 }),
      myExporterCaptionCacheLoad: async cacheKey => ({ ok: true, found: window.__qaCaptionCache.has(cacheKey), data: window.__qaCaptionCache.get(cacheKey) }),
      myExporterCaptionCacheSave: async (cacheKey, data) => { window.__qaCaptionCache.set(cacheKey, data); return { ok: true }; },
      transcribeVideo: transcribe, myExporterTranscribe: transcribe, myExporterGenerateCaptions: transcribe,
      exportSyncedTranslatedVideo: async payload => {
        calls.voice.push(structuredClone(payload));
        if (window.__qaVoiceMode === 'error') return { ok: false, error: 'QA synchronized voice export failed.' };
        if (window.__qaVoiceMode === 'deferred') return new Promise(resolve => { window.__qaResolveVoice = resolve; });
        return { ok: true, outputPath: paths.voiceOutput, duration: 60 };
      },
      cancelTranscribeVideo: async () => { window.__qaResolveASR?.({ ok: false, cancelled: true }); return { ok: true }; },
      showSaveDialog: async options => { calls.save.push(options); return { canceled: false, filePath: paths.output }; },
      writeFile: async (...args) => { calls.write.push(args); return { ok: true }; },
      myExporterPreflight: async payload => {
        calls.preflight.push(JSON.parse(JSON.stringify(payload)));
        const result = { ok: true, errors: [], warnings: [], exportCapabilitiesVersion: 2, audioRangeFadeEnvelope: true };
        if (window.__qaPreflightMode === 'deferred') return new Promise(resolve => { window.__qaResolvePreflight = () => resolve(result); });
        return result;
      },
      myExporterExport: async payload => {
        calls.export.push(JSON.parse(JSON.stringify(payload)));
        if (window.__qaExportMode === 'deferred') return new Promise(resolve => { window.__qaResolveExport = resolve; });
        return { ok: true, outputPath: paths.output, fileName: 'qa-output.mp4', width: 1920, height: 1080, duration: 8, jobId: payload.jobId, exportCapabilitiesVersion: 2 };
      },
      myExporterCancel: async options => { calls.cancel.push(options); window.__qaResolveExport?.({ ok: false, cancelled: true, error: 'QA export cancelled', jobId: options?.jobId }); return { ok: true }; },
      onMyExporterProgress: callback => { window.__qaProgress = callback; }, offMyExporterProgress: () => {}, onTranscribeProgress: () => {},
      showNotification: (...args) => calls.notification.push(args), reportWhatsAppJob: options => calls.notification.push(options),
      openFile: async () => ({ ok: true }), showItemInFolder: async () => ({ ok: true }),
    };
    window.electronAPI = new Proxy(methods, { get(object, property) {
      if (property in object) return object[property];
      if (typeof property !== 'string') return undefined;
      return async (...args) => { calls.unexpected.push({ method: property, args }); return { ok: false, error: `Unmocked QA API: ${property}` }; };
    } });
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, options = {}) => {
      if (!String(input).includes('/api/translate')) return originalFetch(input, options);
      const request = JSON.parse(options.body || '{}');
      calls.translation.push({ endpoint: String(input), request: structuredClone(request) });
      if (window.__qaTranslationMode === 'error') return new Response(JSON.stringify({ error: 'QA translation failed.' }), { status: 502 });
      if (window.__qaTranslationMode === 'partial') return new Response(JSON.stringify({ results: [], target: request.target }), { status: 200 });
      const translate = text => request.target === 'te' ? (String(text).includes('Fox') ? 'నక్క.' : 'పులి.') : request.target === 'hi' ? 'बाघ।' : String(text);
      return new Response(JSON.stringify({ results: (request.texts || [request.text]).map(translate), translated: translate(request.text || '') }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    if (window.speechSynthesis) window.speechSynthesis.speak = () => {};
  }, seed, projectKey, { video, image, voiceOutput, output: path.join(directory, 'qa-output.mp4') });
  await page.goto(pathToFileURL(path.join(directory, 'editor.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.mx-page'); await settle(page);

  if (process.argv.includes('--help-only')) {
    await runHelpChecks(page, seed, errors);
    if (!failed.length) {
      const destination = path.join(root, 'generated-media', 'my-exporter-ui-qa'); fs.mkdirSync(destination, { recursive: true });
      for (let i = 0; i < screenshots.length; i++) {
        const copy = path.join(destination, path.basename(screenshots[i])); fs.copyFileSync(screenshots[i], copy); screenshots[i] = copy;
      }
    }
    console.log(JSON.stringify({ passed: passed.length, checks: passed, failed, screenshots, fixtureDirectory: directory }, null, 2));
    if (failed.length) process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--audio-range-only')) {
    await runAudioRangeChecks(page, seed, errors);
    if (!failed.length && screenshots.length) {
      const destination = path.join(root, 'generated-media', 'my-exporter-ui-qa'); fs.mkdirSync(destination, { recursive: true });
      fs.copyFileSync(screenshots[0], path.join(destination, 'audio-range-1280.png'));
    }
    console.log(JSON.stringify({ passed: passed.length, checks: passed, failed, screenshots, fixtureDirectory: directory }, null, 2));
    if (failed.length) process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--auto-all-only')) {
    await runAutoAllChecks(page, seed, autoAllPaths, errors);
    if (!failed.length && screenshots.length) {
      const destination = path.join(root, 'generated-media', 'my-exporter-ui-qa'); fs.mkdirSync(destination, { recursive: true });
      fs.copyFileSync(screenshots[0], path.join(destination, 'add-auto-all-1280.png'));
    }
    console.log(JSON.stringify({ passed: passed.length, checks: passed, failed, screenshots, fixtureDirectory: directory }, null, 2));
    if (failed.length) process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--voice-only')) {
    await runVoiceChecks(page, seed, { video: voiceVideo, output: voiceOutput }, errors);
    console.log(JSON.stringify({ passed: passed.length, checks: passed, failed, fixtureDirectory: directory }, null, 2));
    if (failed.length) process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--autosave-only')) {
    await check('single-project autosave quota failure remains visible in the footer', async () => {
      assert.equal(await page.$('.mx-project-tabs'), null);
      const originalRaw = await page.evaluate(key => localStorage.getItem(key), projectKey);
      await page.evaluate(key => {
        window.__qaOriginalStorageSetItem = Storage.prototype.setItem;
        window.__qaQuotaWrites = 0;
        Storage.prototype.setItem = function(storageKey, value) {
          if (this === localStorage && storageKey === key) {
            window.__qaQuotaWrites++;
            throw new DOMException('QA storage quota exceeded', 'QuotaExceededError');
          }
          return window.__qaOriginalStorageSetItem.call(this, storageKey, value);
        };
      }, projectKey);
      try {
        await setControl(page, '[aria-label="Project name"]', 'Unsaved quota edit');
        await page.waitForFunction(() => {
          const footer = document.querySelector('.mx-operation-status');
          return footer?.offsetWidth && footer.offsetHeight && footer.textContent.includes('Autosave storage is full');
        }, { timeout: 5000 });
        assert.equal(await page.$('.mx-project-tabs'), null, 'The failure must be visible with the single-project tab strip hidden.');
        const result = await page.evaluate(key => ({ raw: localStorage.getItem(key), attempts: window.__qaQuotaWrites,
          name: document.querySelector('[aria-label="Project name"]').value,
          warning: document.querySelector('.mx-operation-status').textContent,
          nativeCalls: window.__qaCalls.write.length + window.__qaCalls.export.length + window.__qaCalls.transcribe.length,
          unexpected: window.__qaCalls.unexpected }), projectKey);
        assert.ok(result.attempts > 0);
        assert.equal(result.raw, originalRaw, 'Failed autosave must preserve the previously stored project.');
        assert.equal(result.name, 'Unsaved quota edit', 'The editable project must retain its unsaved change.');
        assert.ok(result.warning.includes('save a project file'));
        assert.equal(result.nativeCalls, 0);
        assert.deepEqual(result.unexpected, []);
        assert.deepEqual(errors, []);
      } finally {
        await page.evaluate(() => {
          Storage.prototype.setItem = window.__qaOriginalStorageSetItem;
          delete window.__qaOriginalStorageSetItem;
        });
        await reset(page);
      }
      assert.equal((await saved(page)).projectName, seed.projectName);
    });
    console.log(JSON.stringify({ passed: passed.length, checks: passed, failed, fixtureDirectory: directory }, null, 2));
    if (failed.length) process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--workspace-only')) {
    await runWorkspaceCheck(page, seed);
    await runUndoCheck(page);
    console.log(JSON.stringify({ passed: passed.length, checks: passed, failed, fixtureDirectory: directory }, null, 2));
    if (failed.length) process.exitCode = 1;
    return;
  }
  if (process.argv.includes('--transport-only')) {
    for (let run = 0; run < 5; run++) await runTransportCheck(page, ` (${run + 1}/5)`);
    console.log(JSON.stringify({ passed: passed.length, checks: passed, failed, fixtureDirectory: directory,
      transportTrace: path.join(directory, 'transport-trace.json') }, null, 2));
    if (failed.length) process.exitCode = 1;
    return;
  }

  await runOrganizationChecks(page);
  await reset(page);

  await check('editor mounts without runtime errors', () => assert.deepEqual(errors, []));
  await check('original scene order and source trims survive metadata loading', async () => {
    const p = await saved(page); assert.deepEqual(p.scenes.map(s => s.id), seed.scenes.map(s => s.id));
    assert.deepEqual(p.scenes.map(s => [s.trimStart, s.duration]), seed.scenes.map(s => [s.trimStart, s.duration]));
  });
  await check('source preview does not insert media or change program sequence', async () => {
    await page.click('[aria-label="Preview Unused source"]');
    await page.waitForSelector('.mx-source-monitor');
    assert.equal((await saved(page)).scenes.length, 3);
    assert.ok(await page.$('.mx-source-monitor video'));
  });
  await check('source in/out insert creates a new trimmed clip', async () => {
    await setLabel(page, 'In', 2); await setLabel(page, 'Out', 4);
    await clickText(page, 'Insert to timeline'); await settle(page);
    const p = await saved(page); assert.equal(p.scenes.length, 4);
    assert.ok(p.scenes.some(s => s.trimStart === 2 && s.duration === 2));
  });

  // Editing assertions added here use the rendered controls and persistent
  // project state, never replacement implementations or component internals.
  await runEditingChecks(page, seed, errors);
  await reset(page);
  await page.click('[aria-label="Preview Unused source"]');
  await page.waitForSelector('.mx-source-monitor'); await settle(page); await thumbnailPaintReady(page);
  const mediaDiagnostics = await page.evaluate(() => [...document.querySelectorAll('.mx-asset-card')].map(card => ({
    name: card.querySelector('strong')?.textContent,
    video: [...card.querySelectorAll('video')].map(video => ({ src: video.src, currentSrc: video.currentSrc, readyState: video.readyState,
      width: video.videoWidth, currentTime: video.currentTime, error: video.error?.code || null, rect: video.getBoundingClientRect().toJSON() })),
    image: [...card.querySelectorAll('img')].map(image => ({ src: image.src, complete: image.complete, width: image.naturalWidth,
      rect: image.getBoundingClientRect().toJSON() })),
    thumbnailRect: card.querySelector('.mx-asset-thumbnail')?.getBoundingClientRect().toJSON(),
    styles: [...card.querySelectorAll('video,img,.mx-asset-kind-symbol')].map(element => {
      const style = getComputedStyle(element);
      return { tag: element.tagName, className: element.className, display: style.display, opacity: style.opacity,
        visibility: style.visibility, zIndex: style.zIndex, currentTime: element.currentTime ?? null };
    }),
    decodedPixels: [...card.querySelectorAll('video,img')].map(media => {
      try {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
        const context = canvas.getContext('2d'); context.drawImage(media, 0, 0, 8, 8);
        const pixels = [...context.getImageData(0, 0, 8, 8).data];
        return { tag: media.tagName, firstPixel: pixels.slice(0, 4), distinctChannels: new Set(pixels).size };
      } catch (error) { return { tag: media.tagName, error: error.message }; }
    }),
  })));
  await check('visible library thumbnails decode and seek a real video frame', async () => {
    const videos = mediaDiagnostics.flatMap(card => card.video);
    assert.ok(videos.length > 0);
    assert.ok(videos.every(video => video.readyState >= 2 && video.width > 0 && video.currentTime > 0 && !video.error), JSON.stringify(videos));
    assert.ok(mediaDiagnostics.flatMap(card => card.image).every(image => image.complete && image.width > 0));
  });
  for (const width of [1024, 1280, 1920]) await check(`responsive editor stays within ${width}px viewport`, async () => {
    await page.setViewport({ width, height: width === 1024 ? 768 : width === 1280 ? 900 : 1080 });
    // Start every capture from the same settled default view rather than
    // clicking a library card during the previous inspector close transition.
    await reset(page);
    await page.waitForSelector('[aria-label="Preview Unused source"]', { visible: true });
    await page.click('[aria-label="Preview Unused source"]');
    await settle(page); await thumbnailPaintReady(page);
    const bounds = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
      panels: [...document.querySelectorAll('.mx-page,.mx-player,.mx-timeline')].map(element => {
        const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width }; }) }));
    assert.ok(bounds.document <= bounds.viewport + 2, JSON.stringify(bounds));
    assert.ok(bounds.panels.every(panel => panel.left >= -2 && panel.right <= width + 2), JSON.stringify(bounds));
    assert.ok(await page.$('.mx-source-monitor video'));
    const screenshot = path.join(directory, `source-program-${width}.png`); await page.screenshot({ path: screenshot, fullPage: true });
    (width === 1024 ? additionalScreenshots : screenshots).push(screenshot);
    await showInspector(page, 'Clip'); await settle(page);
    const inspectorBounds = await page.evaluate(() => ({
      program: document.querySelector('.mx-viewer').getBoundingClientRect().toJSON(),
      inspector: document.querySelector('.mx-inspector').getBoundingClientRect().toJSON(),
      timeline: document.querySelector('.mx-timeline').getBoundingClientRect().toJSON(),
    }));
    assert.ok(inspectorBounds.program.right <= inspectorBounds.inspector.left + 2, JSON.stringify(inspectorBounds));
    assert.ok(inspectorBounds.timeline.right > inspectorBounds.inspector.left + 200, 'Inspector narrowed the lower timeline');
    const footerBounds = await page.evaluate(() => ({
      footer: document.querySelector('.mx-operation-status').getBoundingClientRect().toJSON(),
      workspace: document.querySelector('.mx-workspace').getBoundingClientRect().toJSON(), height: innerHeight,
    }));
    assert.ok(footerBounds.footer.height >= 24 && footerBounds.footer.height <= 40 && footerBounds.footer.bottom <= footerBounds.height + 2,
      JSON.stringify(footerBounds));
    assert.ok(footerBounds.workspace.bottom <= footerBounds.footer.top + 2, 'Status footer overlaps the workspace/timeline');
    const inspectorScreenshot = path.join(directory, `inspector-${width}.png`); await page.screenshot({ path: inspectorScreenshot, fullPage: true });
    (width === 1024 ? additionalScreenshots : screenshots).push(inspectorScreenshot);
    await showInspector(page, 'Captions'); await seekAt(page, .75); await settle(page);
    const captionScreenshot = path.join(directory, `captions-${width}.png`); await page.screenshot({ path: captionScreenshot, fullPage: true });
    (width === 1024 ? additionalScreenshots : screenshots).push(captionScreenshot);
    if (width === 1024) {
      await clickText(page, 'More tools', { scope: '.mx-filmora-toolstrip', contains: true });
      await assertLastTimelineMenuAction(page);
      const menuScreenshot = path.join(directory, `more-tools-${width}.png`); await page.screenshot({ path: menuScreenshot, fullPage: true }); additionalScreenshots.push(menuScreenshot);
      await clickText(page, 'More tools', { scope: '.mx-filmora-toolstrip', contains: true });
    }
    await hideInspector(page);
  });
  await check('no unhandled runtime errors or real provider/native requests', async () => {
    assert.deepEqual(errors, []);
    const calls = await page.evaluate(() => window.__qaCalls.unexpected);
    assert.deepEqual(calls, []);
  });
  if (!failed.length) {
    const reviewDirectory = path.join(root, 'generated-media', 'my-exporter-ui-qa');
    fs.mkdirSync(reviewDirectory, { recursive: true });
    for (let i = 0; i < screenshots.length; i++) {
      const destination = path.join(reviewDirectory, path.basename(screenshots[i]));
      fs.copyFileSync(screenshots[i], destination); screenshots[i] = destination;
    }
  }
  console.log(JSON.stringify({ passed: passed.length, checks: passed, failed, screenshots, additionalScreenshots, mediaDiagnostics, fixtureDirectory: directory }, null, 2));
  if (failed.length) process.exitCode = 1;
}

async function runEditingChecks(page, seed, errors) {
  // Root integrates the final controls while this harness is prepared. These
  // assertions intentionally fail when required editing behavior is absent.
  await check('selecting linked audio keeps a visible program video/image', async () => {
    await page.click('.mx-audio-clip'); await settle(page);
    const program = await page.evaluate(() => [...document.querySelectorAll('.mx-viewer video,.mx-viewer img,.mx-preview video,.mx-preview img')]
      .some(element => element.offsetWidth > 0 && element.offsetHeight > 0));
    assert.ok(program, 'Audio selection blanked the program monitor');
  });
  await check('imported audio retains source length, speed and fades in its own export lane', async () => {
    await reset(page); await clickText(page, 'Audio', { scope: '.mx-editor-navigation' });
    await clickText(page, '+ Import', { scope: '.mx-asset-browser' }); await settle(page);
    let p = await saved(page);
    assert.equal(p.audioTracks.length, 2); assert.ok(p.mediaLibrary.some(asset => asset.kind === 'audio'));
    const imported = p.audioTracks.find(track => track.id !== 'linked-sound');
    await page.evaluate(name => [...document.querySelectorAll('.mx-audio-row .mx-audio-clip')]
      .find(clip => clip.textContent.includes(name)).click(), imported.name);
    await showInspector(page, 'Clip');
    await setControl(page, '[aria-label="Audio speed"]', .5); await setControl(page, '[aria-label="Audio fade in"]', .4);
    await setControl(page, '[aria-label="Audio fade out"]', .6); await settle(page);
    p = await saved(page); const edited = p.audioTracks.find(track => track.id === imported.id);
    assert.equal(edited.speed, .5); assert.equal(edited.duration, 16); assert.equal(edited.sourceDuration, 8);
    assert.equal(edited.fadeIn, .4); assert.equal(edited.fadeOut, .6);
    assert.equal(await page.$$eval('.mx-audio-row', rows => rows.length), 2);
    await clickText(page, 'Export ▾', { scope: '.mx-editor-topbar' }); await clickText(page, 'Export with current captions');
    await page.waitForFunction(() => window.__qaCalls.export.length === 1);
    const exported = await page.evaluate(id => window.__qaCalls.export[0].audioTracks.find(track => track.id === id), imported.id);
    assert.equal(exported.speed, .5); assert.equal(exported.duration, 16); assert.equal(exported.fadeIn, .4); assert.equal(exported.fadeOut, .6);
  });
  await runTransportCheck(page);
  await check('buffering video holds program and added audio, then resumes the synchronized mix', async () => {
    await reset(page);
    await page.evaluate(() => {
      const video = document.querySelector('.mx-program-stage video');
      const getter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState').get;
      window.__qaHoldProgramReady = true;
      Object.defineProperty(video, 'readyState', { configurable: true,
        get() { return window.__qaHoldProgramReady ? 0 : getter.call(this); } });
    });
    try {
      await page.click('.mx-play-button');
      await page.waitForFunction(() => document.querySelector('.mx-master-mix-status').textContent.includes('Loading source'));
      await settle(page);
      const waiting = await page.evaluate(() => ({
        videoPaused: document.querySelector('.mx-program-stage video').paused,
        audio: [...document.querySelectorAll('.mx-center > .mx-hidden > audio')].map(audio => audio.paused),
      }));
      assert.equal(waiting.videoPaused, true); assert.ok(waiting.audio.length && waiting.audio.every(Boolean));
      await page.evaluate(() => { window.__qaHoldProgramReady = false; });
      await page.waitForFunction(() => {
        const video = document.querySelector('.mx-program-stage video');
        return !video.paused && !video.seeking && video.currentTime > 1.05
          && [...document.querySelectorAll('.mx-center > .mx-hidden > audio')].some(audio => !audio.paused);
      }, { timeout: 2500 });
      await page.click('.mx-play-button');
    } finally {
      await page.evaluate(() => { window.__qaHoldProgramReady = false; const video = document.querySelector('.mx-program-stage video'); if (video) delete video.readyState; });
    }
  });
  await check('source trim preserves retained speech/words, title and linked sound', async () => {
    await reset(page); await showInspector(page, 'Clip'); await setLabel(page, 'Start', 2); await settle(page);
    const p = await saved(page);
    assert.equal(p.scenes[0].trimStart, 2); assert.ok(p.captions.length > 0);
    assert.deepEqual(p.captions[0].words.map(w => [w.start, w.end]), [[0, 1]]);
    assert.equal(p.audioTracks[0].trimStart, 2); assert.equal(p.textOverlays.length, 1);
    assert.ok(p.captions.every(c => c.words?.every(w => w.start >= c.start && w.end <= c.end)));
  });
  await check('razor splits linked source audio and retains subtitle/title times', async () => {
    await reset(page); await seekAt(page, 2); await page.click('.mx-filmora-toolstrip [title^="Split at playhead"]'); await settle(page);
    const p = await saved(page); assert.equal(p.scenes.length, 4); assert.equal(p.audioTracks.length, 2);
    assert.deepEqual(p.captions, seed.captions); assert.deepEqual(p.textOverlays, seed.textOverlays);
    assert.ok(Math.abs(p.scenes[1].trimStart - 3) < .04); assert.equal(p.audioTracks[1].originSceneId, p.scenes[1].id);
    assert.equal(await page.$$eval('.mx-audio-row', rows => rows.length), 1);
    assert.equal(await page.$$eval('.mx-audio-row .mx-audio-clip', clips => clips.length), 2);
    assert.ok(await page.$('.mx-titles-row .mx-title-clip'));
  });
  await check('quarter-speed edit retains the full linked sound and word timing', async () => {
    await reset(page); await showInspector(page, 'Clip'); await revealControl(page, '[aria-label="Playback speed"]');
    await setControl(page, '[aria-label="Playback speed"]', .25); await settle(page);
    const p = await saved(page); assert.equal(p.scenes[0].speed, .25); assert.equal(p.audioTracks[0].duration, 16);
    assert.equal(p.audioTracks[0].speed, .25); assert.deepEqual(p.captions[0].words.map(w => [w.start, w.end]), [[2, 8]]);
  });
  await runUndoCheck(page);
  await runWorkspaceCheck(page, seed);
  await check('reordering clips retimes their words and linked audio to the matching scene', async () => {
    await reset(page);
    await page.evaluate(() => {
      const clips = [...document.querySelectorAll('.mx-video-lane button.mx-clip')];
      const from = clips.find(button => button.textContent.includes('Z First video'));
      window.__qaDrag = new DataTransfer();
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__qaDrag }));
    });
    await page.evaluate(() => {
      const clips = [...document.querySelectorAll('.mx-video-lane button.mx-clip')];
      const to = clips.find(button => button.textContent.includes('B Third video'));
      to.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: window.__qaDrag }));
      to.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: window.__qaDrag }));
    });
    await page.evaluate(() => {
      const from = [...document.querySelectorAll('.mx-video-lane button.mx-clip')].find(button => button.textContent.includes('Z First video'));
      from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__qaDrag }));
    });
    await settle(page); const p = await saved(page);
    assert.notDeepEqual(p.scenes.map(s => s.id), seed.scenes.map(s => s.id));
    const offset = p.scenes.slice(0, p.scenes.findIndex(s => s.id === 'video-a')).reduce((sum, s) => sum + s.duration / s.speed, 0);
    const tiger = p.captions.find(c => c.id === 'cue-a');
    assert.equal(tiger.start, offset + .5); assert.equal(tiger.words[0].start, offset + .5); assert.equal(p.audioTracks[0].start, offset);
  });
  await check('keyframe changes update both saved animation and rendered program transform', async () => {
    await reset(page); await showInspector(page, 'Clip'); await revealControl(page, '[title="Add transform keyframe at playhead"]');
    await clickText(page, '◇ Add keyframe');
    await setControl(page, '[aria-label="Scale"]', 1.5); await settle(page);
    const p = await saved(page); assert.equal(p.scenes[0].keyframes.length, 1); assert.equal(p.scenes[0].keyframes[0].scale, 1.5);
    const style = await page.$eval('.mx-program-stage video', video => video.style.transform);
    assert.ok(style.includes('1.5'), style);
  });
  await check('selecting a caption seeks the paused frame in the same video', async () => {
    await reset(page);
    await page.evaluate(() => [...document.querySelectorAll('.mx-caption-clip')].find(clip => clip.textContent === 'Tiger.').click());
    await settle(page);
    const time = await page.$eval('.mx-program-stage video', video => video.currentTime);
    assert.ok(Math.abs(time - 1.5) < .1, `Paused caption selection kept source frame at ${time}, expected1.5`);
  });
  await check('selecting a title seeks its paused source frame without blanking the program', async () => {
    await reset(page); await seekAt(page, 2); await page.click('.mx-title-clip'); await settle(page);
    const time = await page.$eval('.mx-program-stage video', video => video.currentTime);
    assert.ok(Math.abs(time - 1) < .1, `Paused title selection kept source frame at ${time}, expected1`);
  });
  await check('selecting the same video resets its source frame to the clip start', async () => {
    await reset(page); await seekAt(page, 2);
    await page.evaluate(() => [...document.querySelectorAll('.mx-video-lane button.mx-clip')].find(clip => clip.textContent.includes('Z First video')).click());
    await settle(page);
    const time = await page.$eval('.mx-program-stage video', video => video.currentTime);
    assert.ok(Math.abs(time - 1) < .1, `Same-video selection kept source frame at ${time}, expected1`);
  });
  await check('inspector fade transition remains exportable and preserves duration', async () => {
    await reset(page); await showInspector(page, 'Clip'); await revealControl(page, '[aria-label="Clip transition"]');
    await setControl(page, '[aria-label="Clip transition"]', 'fade-black'); await settle(page);
    const p = await saved(page);
    assert.ok(p.scenes[0].transitionDuration >= .1 && p.scenes[0].transitionDuration <= 1.5, `Invalid fade duration ${p.scenes[0].transitionDuration}`);
    assert.equal(p.scenes[0].duration, 4);
  });
  await check('export payload preserves per-scene framing, words/titles, and owned job ID', async () => {
    await reset(page); await showInspector(page, 'Clip'); await revealControl(page, '[aria-label="Clip framing"]');
    await setControl(page, '[aria-label="Clip framing"]', 'fill'); await settle(page);
    await clickText(page, 'Export ▾', { scope: '.mx-editor-topbar' }); await clickText(page, 'Export with current captions');
    await page.waitForFunction(() => window.__qaCalls.export.length === 1);
    const calls = await page.evaluate(() => window.__qaCalls);
    const payload = calls.export[0]; assert.equal(payload.scenes[0].fit, 'fill'); assert.equal(payload.scenes[1].fit, 'contain');
    assert.ok(payload.jobId); assert.equal(calls.preflight[0].jobId, payload.jobId); assert.deepEqual(payload.captions, seed.captions);
    assert.deepEqual(payload.textOverlays, seed.textOverlays); assert.equal(payload.burnCaptions, true);
  });
  await check('export without captions explicitly disables burn-in without deleting the edit', async () => {
    await reset(page); await clickText(page, 'Export ▾', { scope: '.mx-editor-topbar' }); await clickText(page, 'Export without captions');
    await page.waitForFunction(() => window.__qaCalls.export.length === 1); await settle(page);
    assert.equal(await page.evaluate(() => window.__qaCalls.export[0].burnCaptions), false); assert.deepEqual((await saved(page)).captions, seed.captions);
  });
  await check('owned export cancellation prevents success status and ignores unrelated progress', async () => {
    await reset(page); await showInspector(page, 'Export'); await page.evaluate(() => { window.__qaExportMode = 'deferred'; });
    await clickText(page, 'Export ▾', { scope: '.mx-editor-topbar' }); await clickText(page, 'Export with current captions');
    await page.waitForFunction(() => window.__qaCalls.export.length === 1);
    await page.evaluate(() => window.__qaProgress?.({ jobId: 'other-job', pct: 100, phase: 'WRONG JOB SUCCESS' }));
    assert.ok(!await page.evaluate(() => document.body.textContent.includes('WRONG JOB SUCCESS')));
    await hideInspector(page); await clickText(page, 'Cancel export', { scope: '.mx-operation-status' }); await settle(page);
    const calls = await page.evaluate(() => window.__qaCalls);
    assert.equal(calls.cancel[0].jobId, calls.export[0].jobId); assert.ok(!await page.$('.mx-result'));
    assert.ok(!calls.notification.some(args => Array.isArray(args) && args[0] === 'My Exporter complete'));
    assert.ok(await page.$eval('.mx-operation-status', footer => footer.offsetHeight > 0 && /cancel/i.test(footer.textContent)));
  });
  await check('cancellation during preflight prevents an export from starting', async () => {
    await reset(page); await showInspector(page, 'Export'); await page.evaluate(() => { window.__qaPreflightMode = 'deferred'; });
    await clickText(page, 'Export ▾', { scope: '.mx-editor-topbar' }); await clickText(page, 'Export with current captions');
    await page.waitForFunction(() => !!window.__qaResolvePreflight); await clickText(page, 'Cancel export', { scope: '.mx-operation-status' });
    await page.evaluate(() => window.__qaResolvePreflight()); await settle(page);
    assert.equal(await page.evaluate(() => window.__qaCalls.export.length), 0); assert.ok(!await page.$('.mx-result'));
  });
  await check('speech provider failure preserves every previous caption and edit', async () => {
    await reset(page); await showInspector(page, 'Captions'); await page.evaluate(() => { window.__qaASRMode = 'error'; });
    await clickText(page, 'Regenerate captions'); await page.waitForFunction(() => window.__qaCalls.transcribe.length > 0); await settle(page);
    assert.deepEqual((await saved(page)).captions, seed.captions); assert.deepEqual((await saved(page)).textOverlays, seed.textOverlays);
    assert.ok(await page.evaluate(() => document.body.textContent.includes('QA speech provider failed')));
    await hideInspector(page);
    assert.ok(await page.$eval('.mx-operation-status', footer => footer.offsetHeight > 0 && footer.textContent.includes('QA speech provider failed')));
  });
  await check('Groq Telugu captions preserve source speech boundaries with estimated translated words', async () => {
    await reset(page); await showInspector(page, 'Captions'); await setControl(page, '[aria-label="Caption engine"]', 'groq'); await setLabel(page, 'Caption language', 'te', 'select');
    await clickText(page, 'Regenerate captions'); await page.waitForFunction(() => document.body.textContent.includes('synchronized captions ready')); await settle(page);
    const p = await saved(page); const calls = await page.evaluate(() => window.__qaCalls.transcribe);
    assert.ok(calls.length > 0 && calls.every(call => call.engine === 'groq' && call.languageHint === 'auto' && call.contentMode === 'speech'));
    assert.equal(p.captions[0].text, 'పులి.'); assert.equal(p.captions[0].start, .5); assert.equal(p.captions[0].end, 1.5);
    assert.deepEqual(p.captions[0].words, []); assert.equal(p.captions[0].timingSource, 'estimated');
  });
  await check('caption cancellation keeps the existing draft and stops subsequent scene requests', async () => {
    await reset(page); await showInspector(page, 'Captions'); await page.evaluate(() => { window.__qaASRMode = 'deferred'; });
    await clickText(page, 'Regenerate captions'); await page.waitForFunction(() => window.__qaCalls.transcribe.length === 1);
    await clickText(page, 'Cancel captions', { scope: '.mx-operation-status' }); await settle(page);
    assert.equal(await page.evaluate(() => window.__qaCalls.transcribe.length), 1); assert.deepEqual((await saved(page)).captions, seed.captions);
    assert.ok(!await page.$('.mx-caption-loading'));
  });
  await check('cancelling during metadata prevents any new speech-provider request', async () => {
    await reset(page); await showInspector(page, 'Captions'); await page.evaluate(() => { window.__qaProbeMode = 'deferred'; });
    await clickText(page, 'Regenerate captions'); await page.waitForFunction(() => !!window.__qaResolveProbe);
    await clickText(page, 'Cancel captions', { scope: '.mx-operation-status' }); await page.evaluate(() => window.__qaResolveProbe()); await settle(page);
    assert.equal(await page.evaluate(() => window.__qaCalls.transcribe.length), 0); assert.deepEqual((await saved(page)).captions, seed.captions);
  });
  await check('invalid saved project stays intact until its exact recovery copy is saved', async () => {
    const raw = '{"version":3,"scenes":[{"id":"broken","duration":-1,"kind":"image","path":"bad"}],"note":"పులి"}';
    await page.evaluate(value => sessionStorage.setItem('my-exporter-qa-project-override', value), raw);
    try {
      await reset(page);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), projectKey), raw);
      assert.ok(await page.$eval('.mx-operation-status', footer => footer.offsetHeight > 0 && footer.textContent.includes('Save recovery copy')));
      await clickText(page, 'New', { scope: '.mx-editor-topbar' }); await addProjectTab(page); await settle(page);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), projectKey), raw, 'New project/workspace overwrote the invalid draft');
      await clickText(page, 'Save recovery copy', { scope: '.mx-operation-status' });
      await page.waitForFunction(() => window.__qaCalls.write.length === 1);
      const write = await page.evaluate(() => window.__qaCalls.write[0]);
      assert.equal(Buffer.from(write[1], 'base64').toString('utf8'), raw);
    } finally { await page.evaluate(() => sessionStorage.removeItem('my-exporter-qa-project-override')); }
  });
}

async function runHelpChecks(page, seed, errors) {
  const dialog = '[role="dialog"][aria-label="My Exporter help and demos"]';
  const search = `${dialog} [aria-label="Search My Exporter help"]`;
  const demo = `${dialog} [data-testid="exporter-help-demo"]`;
  const callKeys = ['transcribe', 'translation', 'voice', 'preflight', 'export', 'cancel', 'save', 'write', 'notification', 'unexpected'];
  const projectKeys = ['scenes', 'audioTracks', 'captions', 'textOverlays', 'music', 'settings', 'watermark', 'watermarkEnabled',
    'mediaLibrary', 'trackStates', 'projectName'];
  const content = async () => {
    const state = await saved(page); const values = {};
    for (const key of projectKeys) values[key] = state[key];
    // Waveforms arrive independently of the UI and do not represent edits.
    values.audioTracks = values.audioTracks?.map(track => {
      const copy = structuredClone(track);
      for (const key of ['waveform', 'waveformLoading', 'waveformError', 'waveformCacheKey', 'waveformFingerprint']) delete copy[key];
      return copy;
    });
    return values;
  };
  const calls = () => page.evaluate(keys => Object.fromEntries(keys.map(key => [key, window.__qaCalls[key].length])), callKeys);
  const active = id => page.waitForSelector(`${dialog} [data-help-active-topic="${id}"]`, { visible: true });
  const choose = async id => {
    const selector = `${dialog} button[data-help-topic="${id}"]`;
    await page.waitForSelector(selector, { visible: true });
    await page.$eval(selector, button => button.scrollIntoView({ block: 'nearest' }));
    await page.click(selector); await active(id);
  };
  const category = async id => {
    await page.click(`${dialog} button[data-help-category="${id}"]`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  };
  const open = async () => {
    if (await page.$(dialog)) return;
    await page.click('[aria-label="Help & Demos"]'); await page.waitForSelector(dialog, { visible: true });
  };
  const close = async () => {
    if (!await page.$(dialog)) return;
    await page.keyboard.press('Escape'); await page.waitForSelector(dialog, { hidden: true });
  };
  const start = async () => { await reset(page); return { content: await content(), calls: await calls() }; };
  const unchanged = async before => {
    await settle(page); assert.deepEqual(await content(), before.content, 'Using help changed the real editable project.');
    assert.deepEqual(await calls(), before.calls, 'Using help invoked a provider, saved a file, exported, or cancelled a job.');
  };
  try {
    await check('Help & Demos opens a searchable guide with every editor category', async () => {
      const before = await start(); await open();
      assert.ok(await page.evaluate(query => document.activeElement === document.querySelector(query), search), 'Opening the guide must focus its search field.');
      await category('all');
      const ui = await page.evaluate(({ query, input }) => ({
        categories: [...document.querySelectorAll(`${query} button[data-help-category]`)].map(button => button.dataset.helpCategory),
        topics: [...document.querySelectorAll(`${query} button[data-help-topic]`)].map(button => button.dataset.helpTopic),
        activeText: document.querySelector(`${query} [data-help-active-topic]`)?.textContent,
      }), { query: dialog, input: search });
      for (const id of ['project', 'media', 'timeline', 'clip', 'audio', 'text', 'captions', 'tools', 'export']) assert.ok(ui.categories.includes(id), `Missing help category: ${id}`);
      assert.equal(ui.topics.length, 90, 'All 90 editor features should have a guide.');
      assert.ok(ui.activeText?.length > 150, 'Each feature needs an explanation and instructions.');
      await unchanged(before); await close();
    });
    await check('help multiword search finds audio removal and gives useful empty results', async () => {
      const before = await start(); await open(); await setControl(page, search, 'remove selected audio');
      await page.waitForSelector(`${dialog} button[data-help-topic="audio-remove-range"]`, { visible: true }); await choose('audio-remove-range');
      const description = await page.$eval(`${dialog} [data-help-active-topic]`, panel => panel.textContent);
      assert.match(description, /gap/i, 'Audio removal guide must explain leaving a gap.');
      await setControl(page, search, 'zznonexistenthelpzz');
      await page.waitForFunction(query => !document.querySelector(`${query} button[data-help-topic]`), {}, dialog);
      assert.match(await page.$eval(dialog, panel => panel.textContent), /no.*(feature|result|match)|try.*search/i);
      await setControl(page, search, ''); await unchanged(before); await close();
    });
    await check('all 90 feature guides render complete instructions and replay their isolated demos', async () => {
      const before = await start();
      await page.keyboard.press('F1'); await page.waitForSelector(dialog, { visible: true });
      await category('all');
      const topicIds = await page.$$eval(`${dialog} button[data-help-topic]`, buttons => buttons.map(button => button.dataset.helpTopic));
      assert.equal(topicIds.length, 90);
      for (const id of topicIds) {
        await choose(id);
        const instructions = await page.$eval(`${dialog} [data-help-active-topic]`, article => ({
          title: article.querySelector('h3')?.textContent,
          steps: [...article.querySelectorAll('ol li')].map(step => step.textContent.trim()),
        }));
        assert.ok(instructions.title?.trim(), `${id} has no title.`);
        assert.ok(instructions.steps.length >= 2 && instructions.steps.every(Boolean), `${id} has incomplete steps.`);
        await page.waitForFunction(query => document.querySelector(query)?.dataset.demoStep === '0', {}, demo);
        for (const step of ['1', '2']) {
          await page.click(`${demo} [aria-label="Next demo step"]`);
          await page.waitForFunction(({ query, value }) => document.querySelector(query)?.dataset.demoStep === value, {}, { query: demo, value: step });
        }
        await page.click(`${demo} [aria-label="Replay demo"]`);
        await page.waitForFunction(query => document.querySelector(query)?.dataset.demoStep === '0', {}, demo);
      }
      await unchanged(before); await close();
    });
    await check('media, captions and export guides are reachable by category and explain the real workflow', async () => {
      const before = await start(); await open();
      for (const [group, topic, expected] of [['media', 'source-range', /in|out|source/i],
        ['captions', 'captions-engine', /groq|gemini|local/i], ['export', 'export-video', /export|folder|save/i]]) {
        await category(group); await choose(topic);
        assert.match(await page.$eval(`${dialog} [data-help-active-topic]`, panel => panel.textContent), expected);
        assert.equal(await page.$eval(demo, element => element.dataset.demoStep), '0', 'Changing feature should reset its demo.');
      }
      await clickText(page, 'Show controls', { scope: dialog }); await page.waitForSelector(dialog, { hidden: true });
      assert.equal(await page.$eval('.mx-inspector-tabs .active', button => button.textContent.trim()), 'Export', 'Show controls did not locate Export settings.');
      await unchanged(before); await close();
    });
    await check('the audio gap demo shows removal, replays, and keyboard shortcuts never edit the actual project', async () => {
      const before = await start(); await open(); await category('audio'); await choose('audio-remove-range');
      assert.equal(await page.$eval(demo, element => element.dataset.demoKind), 'audio-gap');
      await page.click(`${demo} [aria-label="Next demo step"]`);
      assert.equal(await page.$eval(demo, element => element.dataset.demoStep), '1');
      await page.click(`${demo} [aria-label="Next demo step"]`);
      assert.equal(await page.$eval(demo, element => element.dataset.demoStep), '2');
      assert.match(await page.$eval(demo, element => element.textContent), /silent gap/i);
      await page.click(`${demo} [aria-label="Replay demo"]`);
      assert.equal(await page.$eval(demo, element => element.dataset.demoStep), '0');
      await page.focus(`${demo} [aria-label="Next demo step"]`);
      await page.keyboard.press('Delete'); await page.keyboard.press('s'); await shortcut(page, 'z');
      await page.keyboard.press('Space');
      assert.ok(await page.$(dialog), 'Editor shortcuts dismissed the help guide.');
      assert.ok(await page.$eval('.mx-program-stage video', video => video.paused), 'Demo keyboard events started the real program playback.');
      await unchanged(before); await close();
    });
    await check('demo playback advances its sample, pauses, and respects reduced motion', async () => {
      const before = await start(); await open(); await category('audio'); await choose('audio-remove-range');
      assert.equal(await page.$eval(`${demo} [aria-label="Play demo"]`, button => button.getAttribute('aria-pressed')), 'false');
      await page.click(`${demo} [aria-label="Play demo"]`);
      await page.waitForFunction(query => document.querySelector(query)?.dataset.demoStep === '1', { timeout: 4000 }, demo);
      await page.click(`${demo} [aria-label="Pause demo"]`);
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2350)));
      assert.equal(await page.$eval(demo, element => element.dataset.demoStep), '1', 'Paused demo kept advancing.');
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.waitForFunction(query => !document.querySelector(`${query} [aria-label="Play demo"]`), {}, demo);
      await page.click(`${demo} [aria-label="Replay demo"]`); await page.click(`${demo} [aria-label="Next demo step"]`);
      assert.equal(await page.$eval(demo, element => element.dataset.demoStep), '1', 'Reduced motion must retain manual demo controls.');
      await unchanged(before); await close(); await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    });
    await check('inline Audio range help opens the correct feature and restores focus with Escape', async () => {
      const before = await start(); await page.click('.mx-audio-clip'); await settle(page);
      const trigger = '[aria-label="How to use Audio range"]'; await page.waitForSelector(trigger, { visible: true });
      await page.click(trigger); await active('audio-remove-range'); await close();
      assert.equal(await page.evaluate(query => document.activeElement === document.querySelector(query), trigger), true);
      // Selecting audio is an ordinary editor action; the guide itself must not edit it.
      await unchanged(before);
    });
    await check('Show controls locates project, timeline and the existing source preview without inserting media', async () => {
      const before = await start();
      for (const [group, topic, target] of [['project', 'project-save', '.mx-editor-topbar'], ['timeline', 'timeline-split', '.mx-filmora-toolstrip']]) {
        await open(); await category(group); await choose(topic); await clickText(page, 'Show controls', { scope: dialog });
        await page.waitForSelector(dialog, { hidden: true });
        await page.waitForFunction(query => document.querySelector(query)?.contains(document.activeElement), {}, target);
      }
      await page.click('[aria-label="Preview Unused source"]'); await page.waitForSelector('.mx-source-monitor', { visible: true });
      await page.click('[aria-label="How to use Source preview"]'); await active('source-range');
      await clickText(page, 'Show controls', { scope: dialog }); await page.waitForSelector(dialog, { hidden: true });
      await page.waitForFunction(() => document.querySelector('.mx-source-monitor')?.contains(document.activeElement));
      assert.ok(await page.$('.mx-source-monitor video'), 'Source help lost the existing preview.');
      await unchanged(before);
    });
    await check('inline Preview help and Show controls locate the correct playback, crop and project sections', async () => {
      const before = await start();
      await clickText(page, 'Preview options ▾', { scope: '.mx-player-tools' });
      await page.click('[aria-label="How to use Preview controls"]'); await active('timeline-playback'); await close();
      for (const [group, topic, section] of [['tools', 'tools-crop', 'Direct crop & part export'], ['project', 'project-reset', 'Project tools']]) {
        await page.evaluate(title => {
          const summary = [...document.querySelectorAll('.mx-inspector-page summary')].find(element => element.textContent === title);
          summary.closest('details').open = false;
        }, section);
        await open(); await category(group); await choose(topic); await clickText(page, 'Show controls', { scope: dialog });
        await page.waitForSelector(dialog, { hidden: true });
        await page.waitForFunction(title => {
          const summary = [...document.querySelectorAll('.mx-inspector-page[data-inspector-page="tools"] summary')].find(element => element.textContent === title);
          return summary?.closest('details').open && document.activeElement === summary;
        }, {}, section);
      }
      await unchanged(before);
    });
    await check('help traps keyboard focus and returns it to Help & Demos when closed', async () => {
      await start(); await open();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
        const focus = await page.evaluate(query => ({ inside: document.querySelector(query).contains(document.activeElement),
          tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'), text: document.activeElement?.textContent.slice(0, 100) }), dialog);
        assert.ok(focus.inside, `Reverse Tab ${i + 1} escaped help: ${JSON.stringify(focus)}`);
      }
      await close();
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Help & Demos');
    });
    for (const width of [1024, 1280]) await check(`help guide, search and demo fit a ${width}px viewport`, async () => {
      await start(); await page.setViewport({ width, height: width === 1024 ? 768 : 900 }); await open();
      await category('audio'); await choose('audio-remove-range');
      const overview = path.join(directory, `help-instructions-${width}.png`); await page.screenshot({ path: overview, fullPage: true }); screenshots.push(overview);
      await page.click(`${demo} [aria-label="Next demo step"]`); await page.click(`${demo} [aria-label="Next demo step"]`);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const bounds = await page.evaluate(({ query, demonstration, input }) => {
        const rect = element => { const box = element.getBoundingClientRect(); return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }; };
        const panel = document.querySelector(query), example = document.querySelector(demonstration);
        const focusedSearch = document.querySelector(input);
        return { viewport: { width: innerWidth, height: innerHeight }, panel: rect(panel), example: rect(example), search: rect(focusedSearch),
          horizontalOverflow: panel.scrollWidth - panel.clientWidth, bodyOverflow: document.documentElement.scrollWidth - innerWidth };
      }, { query: dialog, demonstration: demo, input: search });
      assert.ok(bounds.panel.left >= 0 && bounds.panel.right <= width + 1 && bounds.panel.top >= 0 && bounds.panel.bottom <= bounds.viewport.height + 1, JSON.stringify(bounds));
      assert.ok(bounds.horizontalOverflow <= 2 && bounds.bodyOverflow <= 2, JSON.stringify(bounds));
      assert.ok(bounds.example.width > 200 && bounds.search.width > 150, JSON.stringify(bounds));
      const capture = path.join(directory, `help-audio-gap-${width}.png`); await page.screenshot({ path: capture, fullPage: true }); screenshots.push(capture); await close();
    });
    await check('Help & Demos remains usable during caption generation without cancelling the active job', async () => {
      await page.setViewport({ width: 1280, height: 900 }); await start(); await showInspector(page, 'Captions');
      await page.evaluate(() => { window.__qaASRMode = 'deferred'; }); await clickText(page, 'Regenerate captions');
      await page.waitForFunction(() => window.__qaCalls.transcribe.length === 1); await settle(page);
      const before = { content: await content(), calls: await calls() };
      await open(); await category('export'); await choose('export-video');
      await page.click(`${demo} [aria-label="Next demo step"]`); await page.click(`${demo} [aria-label="Next demo step"]`);
      await unchanged(before); await close();
      assert.ok(await page.$eval('.mx-operation-status', footer => [...footer.querySelectorAll('button')].some(button => button.textContent.trim() === 'Cancel captions' && !button.disabled)), 'Help ended or cancelled the active caption job.');
      await clickText(page, 'Cancel captions', { scope: '.mx-operation-status' }); await settle(page);
      assert.deepEqual(await content(), before.content, 'Cancelling the mock job changed the project.');
    });
    await check('help tests complete without runtime errors or unexpected native requests', async () => {
      assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.__qaCalls.unexpected), []);
      assert.equal(await page.evaluate(() => window.__qaCalls.voice.length + window.__qaCalls.translation.length + window.__qaCalls.export.length + window.__qaCalls.write.length), 0);
    });
  } finally {
    await close(); await page.setViewport({ width: 1280, height: 900 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  }
}

async function runAudioRangeChecks(page, seed, errors) {
  const project = structuredClone(seed);
  project.audioTracks = [{ id: 'range-sound', kind: 'audio', name: 'Range sound', path: seed.scenes[0].path,
    start: 2, trimStart: 1, duration: 3, sourceDuration: 8, speed: 2, volume: .4, muted: false, fadeIn: .1, fadeOut: .2 },
  seed.audioTracks[0]];
  const clipSelector = '.mx-audio-clip[data-audio-id="range-sound"]';
  const controls = { start: '[aria-label="Audio range in"]', end: '[aria-label="Audio range out"]' };
  const near = (actual, expected, tolerance = .02) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
  const editableAudio = tracks => tracks.map(track => {
    const copy = structuredClone(track);
    for (const key of ['waveform', 'waveformLoading', 'waveformError', 'waveformCacheKey', 'waveformFingerprint']) delete copy[key];
    return copy;
  });
  const point = time => page.evaluate(({ selector, seconds }) => {
    const clip = document.querySelector(selector); const box = clip.getBoundingClientRect();
    return { x: box.left + (seconds - 2) / 3 * box.width, y: box.top + box.height / 2 };
  }, { selector: clipSelector, seconds: time });
  const values = () => page.evaluate(selectors => ({ start: Number(document.querySelector(selectors.start)?.value),
    end: Number(document.querySelector(selectors.end)?.value) }), controls);
  const setRange = async (start = 3.125, end = 4.375) => {
    await page.click(controls.end); await setControl(page, controls.end, end); await page.keyboard.press('Tab');
    await page.click(controls.start); await setControl(page, controls.start, start); await page.keyboard.press('Tab'); await settle(page);
    assert.deepEqual(await values(), { start, end });
  };
  const start = async ({ explicitInspector = true } = {}) => {
    await page.evaluate(value => sessionStorage.setItem('my-exporter-qa-project-override', JSON.stringify(value)), project);
    await reset(page); await page.$eval(clipSelector, clip => clip.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    const at = await point(3); await page.mouse.click(at.x, at.y);
    if (explicitInspector) await showInspector(page, 'Clip'); await settle(page);
    await page.waitForSelector(controls.start, { visible: true });
    return saved(page);
  };
  const drag = async (from, to) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up(); await settle(page);
  };
  const unchanged = async before => {
    const after = await saved(page);
    for (const key of ['scenes', 'audioTracks', 'captions', 'textOverlays', 'music', 'settings']) assert.deepEqual(after[key], before[key], `${key} changed while selecting an audio range.`);
  };
  const unchangedOtherContent = (after, before) => {
    for (const key of ['scenes', 'captions', 'textOverlays', 'music', 'settings']) assert.deepEqual(after[key], before[key], `${key} must remain unchanged by selected-audio removal.`);
    assert.deepEqual(after.audioTracks.find(track => track.id === 'linked-sound'), before.audioTracks.find(track => track.id === 'linked-sound'));
  };
  try {
    await check('selecting audio exposes millisecond range controls and preserves the program', async () => {
      const before = await start({ explicitInspector: false });
      const ui = await page.evaluate(selectors => ({
        inputs: Object.values(selectors).map(selector => { const input = document.querySelector(selector); return { type: input.type, step: input.step, visible: Boolean(input.offsetWidth && input.offsetHeight) }; }),
        program: Boolean(document.querySelector('.mx-program-stage video,.mx-program-stage img')),
      }), controls);
      assert.ok(ui.inputs.every(input => input.type === 'number' && Number(input.step) === .001 && input.visible)); assert.ok(ui.program);
      await unchanged(before);
    });
    for (const zoom of [1, 2]) {
      await check(`audio drag selection maps exact lane time at zoom ${zoom} without moving the clip`, async () => {
        const before = await start(); await setControl(page, '[aria-label="Timeline zoom"]', zoom); await settle(page);
        await clickText(page, 'Select Audio Range');
        await drag(await point(2.5), await point(3.5));
        const selected = await values(); near(selected.start, 2.5); near(selected.end, 3.5); await unchanged(before);
      });
    }
    await check('audio click-start/click-end selection retains clip placement', async () => {
      const before = await start(); await clickText(page, 'Select Audio Range');
      const first = await point(2.75), last = await point(4.25);
      await page.mouse.click(first.x, first.y); await page.mouse.click(last.x, last.y); await settle(page);
      const selected = await values(); near(selected.start, 2.75); near(selected.end, 4.25); await unchanged(before);
    });
    await check('numeric audio In and Out retain exact milliseconds without timeline edits', async () => {
      const before = await start(); await setRange(); await unchanged(before);
      const capture = path.join(directory, 'audio-range-1280.png'); await page.screenshot({ path: capture, fullPage: true }); screenshots.push(capture);
    });
    await check('audio range timestamps accept real keyboard decimal entry', async () => {
      const before = await start();
      for (const [selector, value] of [[controls.end, '4.375'], [controls.start, '3.125']]) {
        await page.click(selector); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
        await page.keyboard.type(value); await page.keyboard.press('Tab');
      }
      await settle(page); assert.deepEqual(await values(), { start: 3.125, end: 4.375 }); await unchanged(before);
    });
    await check('editing one audio range edge preserves the other fractional source boundary', async () => {
      const original = structuredClone(project.audioTracks[0]);
      try {
        project.audioTracks[0].start = 10 / 3;
        await start();
        await page.click(controls.end); await setControl(page, controls.end, 5.125); await page.keyboard.press('Tab');
        await clickText(page, 'Remove Selected Audio'); await settle(page);
        let pieces = (await saved(page)).audioTracks.filter(track => track.id !== 'linked-sound');
        assert.equal(pieces.length, 1); assert.equal(pieces[0].start, 5.125);
        assert.equal(pieces[0].trimStart, 1 + (5.125 - 10 / 3) * 2);
        near(pieces[0].start + pieces[0].duration, 10 / 3 + 3, 1e-12);
        project.audioTracks[0].duration = 3.0004;
        await start();
        await page.click(controls.start); await setControl(page, controls.start, 4.125); await page.keyboard.press('Tab');
        await clickText(page, 'Remove Selected Audio'); await settle(page);
        pieces = (await saved(page)).audioTracks.filter(track => track.id !== 'linked-sound');
        assert.equal(pieces.length, 1); assert.equal(pieces[0].start, 10 / 3); assert.equal(pieces[0].duration, 4.125 - 10 / 3);
      } finally { project.audioTracks[0] = original; }
    });
    await check('cancelled audio movement rolls back and allows later edits to undo', async () => {
      const before = await start(), from = await point(3), to = await point(3.5);
      await page.evaluate(() => window.addEventListener('pointerdown', event => { window.__qaAudioPointerId = event.pointerId; }, { once: true, capture: true }));
      await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 });
      await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.__qaAudioPointerId, bubbles: true })));
      await page.mouse.up(); await settle(page); await unchanged(before);
      await setControl(page, '[aria-label="Audio volume"]', .6); await settle(page);
      assert.equal((await saved(page)).audioTracks.find(track => track.id === 'range-sound').volume, .6);
      await shortcut(page, 'z'); await settle(page);
      assert.deepEqual(editableAudio((await saved(page)).audioTracks), editableAudio(before.audioTracks));
    });
    await check('audio range handles adjust only the selected bounds and clamp at clip edges', async () => {
      const before = await start(); await setRange();
      let handle = await page.$('[aria-label="Audio range start"]'), box = await handle.boundingBox();
      await drag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, await point(2.5));
      near((await values()).start, 2.5); near((await values()).end, 4.375);
      handle = await page.$('[aria-label="Audio range end"]'); box = await handle.boundingBox();
      await drag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, await point(4.75));
      near((await values()).end, 4.75); near((await values()).start, 2.5);
      handle = await page.$('[aria-label="Audio range start"]'); box = await handle.boundingBox();
      await drag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, await point(1.5));
      near((await values()).start, 2);
      handle = await page.$('[aria-label="Audio range end"]'); box = await handle.boundingBox();
      await drag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, await point(5.5));
      near((await values()).end, 5); await unchanged(before);
    });
    await check('Remove Selected Audio leaves the exact gap and preserves source timing and other tracks', async () => {
      const before = await start(); await setRange(); await clickText(page, 'Remove Selected Audio'); await settle(page);
      const after = await saved(page), pieces = after.audioTracks.filter(track => track.id !== 'linked-sound').sort((a, b) => a.start - b.start);
      assert.equal(pieces.length, 2); assert.equal(pieces[0].start, 2); assert.equal(pieces[0].duration, 1.125); assert.equal(pieces[0].trimStart, 1); assert.equal(pieces[0].speed, 2);
      assert.equal(pieces[1].start, 4.375); assert.equal(pieces[1].duration, .625); assert.equal(pieces[1].trimStart, 5.75); assert.equal(pieces[1].speed, 2);
      assert.equal(pieces[1].start - (pieces[0].start + pieces[0].duration), 1.25); assert.equal(pieces[1].start + pieces[1].duration, 5);
      assert.equal(await page.$$eval('.mx-audio-row', rows => rows.length), 2, 'Cut audio segments must stay on the same Audio row instead of jumping to a new row.');
      assert.equal(await page.$$eval('.mx-audio-row', rows => rows[0].querySelectorAll('.mx-audio-clip').length), 2);
      assert.equal(await page.$$eval('.mx-audio-silent-gap', gaps => gaps.length), 1);
      unchangedOtherContent(after, before);
      assert.ok(await page.$eval('.mx-operation-status', footer => /gap/i.test(footer.textContent) && !/moved left|no empty space|closes the empty/i.test(footer.textContent)));
      await shortcut(page, 'z'); await settle(page); assert.deepEqual(editableAudio((await saved(page)).audioTracks), editableAudio(before.audioTracks)); unchangedOtherContent(await saved(page), before);
      await shortcut(page, 'y'); await settle(page); assert.deepEqual(editableAudio((await saved(page)).audioTracks), editableAudio(after.audioTracks)); unchangedOtherContent(await saved(page), before);
    });
    await check('editing a cut audio fade replaces its inherited fade envelope', async () => {
      await start(); await setRange(); await clickText(page, 'Remove Selected Audio'); await settle(page);
      const before = await saved(page); assert.ok(before.audioTracks.find(track => track.id === 'range-sound').fadeEnvelope);
      await setControl(page, '[aria-label="Audio fade in"]', .3); await settle(page);
      const after = await saved(page), track = after.audioTracks.find(item => item.id === 'range-sound');
      assert.equal(track.fadeIn, .3); assert.equal(track.fadeEnvelope, undefined); assert.equal(track.start, 2); assert.equal(track.duration, 1.125); assert.equal(track.trimStart, 1); assert.equal(track.speed, 2);
      unchangedOtherContent(after, before);
      assert.deepEqual(editableAudio(after.audioTracks.filter(item => item.id !== 'range-sound')), editableAudio(before.audioTracks.filter(item => item.id !== 'range-sound')));
    });
    await check('slowing a cut audio clip retains source material and replaces inherited fades', async () => {
      await start(); await setRange(); await clickText(page, 'Remove Selected Audio'); await settle(page);
      const before = await saved(page); assert.ok(before.audioTracks.find(track => track.id === 'range-sound').fadeEnvelope);
      await setControl(page, '[aria-label="Audio speed"]', 1); await settle(page);
      const after = await saved(page), track = after.audioTracks.find(item => item.id === 'range-sound');
      assert.equal(track.speed, 1); assert.equal(track.duration, 2.25); assert.equal(track.start, 2); assert.equal(track.trimStart, 1); assert.equal(track.fadeEnvelope, undefined);
      unchangedOtherContent(after, before);
      assert.deepEqual(editableAudio(after.audioTracks.filter(item => item.id !== 'range-sound')), editableAudio(before.audioTracks.filter(item => item.id !== 'range-sound')));
    });
    await check('clip boundary trim clamps the selected audio range to retained material', async () => {
      const before = await start(); await setRange();
      const handle = await page.$(`${clipSelector} .mx-trim-handle.right`), box = await handle.boundingBox();
      const laneWidth = await page.$eval(clipSelector, clip => clip.closest('.mx-position-lane').getBoundingClientRect().width);
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await drag(from, { x: from.x - laneWidth / 8, y: from.y });
      const after = await saved(page), track = after.audioTracks.find(item => item.id === 'range-sound'), selected = await values();
      near(track.duration, 2, .05); assert.ok(selected.start >= track.start && selected.end <= track.start + track.duration + .000001 && selected.end > selected.start);
      assert.equal(track.trimStart, 1); assert.equal(track.speed, 2); unchangedOtherContent(after, before);
    });
    await check('locked audio prevents range changes, removal and preview', async () => {
      await start(); await setRange(); await page.$eval('.mx-audio-group-row .mx-track-label button:last-child', button => button.click()); await settle(page);
      const before = await saved(page), selected = await values();
      const disabled = await page.evaluate(selectors => ({ inputs: Object.values(selectors).every(selector => document.querySelector(selector).matches(':disabled')),
        actions: ['Remove Selected Audio', 'Preview Selected Audio'].every(text => [...document.querySelectorAll('button')].find(button => button.textContent.includes(text) && button.offsetWidth)?.matches(':disabled')) }), controls);
      assert.ok(disabled.inputs && disabled.actions, JSON.stringify(disabled));
      const handle = await page.$('[aria-label="Audio range start"]'), box = await handle.boundingBox();
      await drag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, await point(2.5));
      assert.deepEqual(await values(), selected); await unchanged(before);
    });
    await check('busy caption processing blocks selected-audio edits atomically', async () => {
      await start(); await setRange(); const selected = await values(); const before = await saved(page);
      await showInspector(page, 'Captions'); await page.evaluate(() => { window.__qaASRMode = 'deferred'; });
      await clickText(page, 'Regenerate captions'); await page.waitForFunction(() => window.__qaCalls.transcribe.length === 1); await showInspector(page, 'Clip');
      assert.ok(await page.$eval(controls.start, input => input.matches(':disabled')));
      await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('Remove Selected Audio') && button.offsetWidth)?.click());
      assert.deepEqual(await values(), selected); await unchanged(before);
      await clickText(page, 'Cancel captions', { scope: '.mx-operation-status' }); await settle(page); await unchanged(before);
    });
    await check('selected-audio preview honors source trim and speed and stops at the exact Out bound', async () => {
      const before = await start(); await setRange();
      const hiddenNativeControls = await page.$eval('.mx-cut-preview', audio => !audio.controls);
      assert.ok(hiddenNativeControls, 'Native seeking controls must not play outside the selected range.');
      await page.evaluate(() => {
        const audio = document.querySelector('.mx-cut-preview'); window.__qaAudioRangePreviewTrace = [];
        for (const event of ['play', 'pause']) audio.addEventListener(event, () => window.__qaAudioRangePreviewTrace.push({ event, time: audio.currentTime, rate: audio.playbackRate }));
      });
      await clickText(page, 'Preview Selected Audio', { contains: true });
      await page.waitForFunction(() => window.__qaAudioRangePreviewTrace.some(entry => entry.event === 'play'), { timeout: 3500 });
      await page.waitForFunction(() => { const audio = document.querySelector('.mx-cut-preview'); return audio.paused && audio.currentTime >= 5.73; }, { timeout: 3500 });
      const trace = await page.evaluate(() => ({ events: window.__qaAudioRangePreviewTrace, end: document.querySelector('.mx-cut-preview').currentTime }));
      const play = trace.events.find(entry => entry.event === 'play'); near(play.time, 3.25, .03); assert.equal(play.rate, 2); near(trace.end, 5.75, .08);
      await unchanged(before);
    });
    await check('a cancelled deferred play cannot pause a newer selected-audio preview', async () => {
      const before = await start(); await setRange();
      await page.evaluate(() => {
        const audio = document.querySelector('.mx-cut-preview'), nativePlay = audio.play.bind(audio);
        window.__qaRangePlayCount = 0;
        audio.play = () => {
          if (++window.__qaRangePlayCount === 1) return new Promise(resolve => { window.__qaResolveOldRangePlay = resolve; });
          return nativePlay();
        };
      });
      try {
        await clickText(page, 'Preview Selected Audio', { contains: true });
        await page.waitForFunction(() => typeof window.__qaResolveOldRangePlay === 'function');
        await clickText(page, 'Stop Selected Audio');
        await clickText(page, 'Preview Selected Audio', { contains: true });
        await page.waitForFunction(() => window.__qaRangePlayCount === 2 && !document.querySelector('.mx-cut-preview').paused);
        await page.evaluate(() => window.__qaResolveOldRangePlay());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.$eval('.mx-cut-preview', audio => audio.paused), false, 'Late resolution of an old play promise paused the new preview.');
        await clickText(page, 'Stop Selected Audio'); assert.equal(await page.$eval('.mx-cut-preview', audio => audio.paused), true);
        await unchanged(before);
      } finally {
        await page.evaluate(() => { const audio = document.querySelector('.mx-cut-preview'); if (audio) delete audio.play; window.__qaResolveOldRangePlay?.(); });
      }
    });
    await check('audio range checks have no runtime errors or unexpected native calls', async () => {
      assert.deepEqual(errors, []); const calls = await page.evaluate(() => window.__qaCalls);
      assert.deepEqual(calls.unexpected, []); assert.equal(calls.export.length + calls.voice.length + calls.translation.length + calls.notification.length, 0);
    });
  } finally {
    await page.evaluate(() => sessionStorage.removeItem('my-exporter-qa-project-override'));
    await reset(page);
  }
}

async function runAutoAllChecks(page, seed, paths, errors) {
  const project = structuredClone(seed);
  project.scenes = [{ ...project.scenes[0], id: 'placed-three', libraryId: 'asset-three', name: 'Lesson20Scene3', path: paths.three,
    trimStart: 2, duration: 4, speed: 2, sourceDuration: 8, fit: 'fill', brightness: .2,
    keyframes: [{ time: .5, scale: 1.2, positionX: 3, positionY: 0, opacity: 1 }] }];
  project.selectedId = 'placed-three';
  const media = (id, name, filePath) => ({ ...seed.mediaLibrary[0], id, name, path: filePath, trimStart: 0, duration: 8, sourceDuration: 8, speed: 1 });
  project.mediaLibrary = [media('asset-ten', 'Lesson1Scene10', paths.ten),
    { ...seed.mediaLibrary[1], id: 'asset-two', name: 'Lesson9Scene2', path: paths.two, sourceDuration: 1, duration: 1, speed: 1 },
    media('asset-one', 'Scene1', paths.one), media('asset-three', 'Lesson20Scene3', paths.three),
    { id: 'asset-audio', kind: 'audio', name: 'Narration Scene0', path: paths.audio, sourceDuration: 8, duration: 8, trimStart: 0, speed: 1, hasAudio: true }];
  project.captions = [{ ...seed.captions[0], end: 1.5, words: [{ text: 'Tiger.', start: .5, end: 1.5 }] }];
  project.textOverlays = [{ ...seed.textOverlays[0], end: 2 }];
  project.audioTracks = [{ ...seed.audioTracks[0], path: paths.three, duration: 2, trimStart: 2, speed: 2,
    originSceneId: 'placed-three', detachedFromSceneId: 'placed-three' }];
  project.music = { name: 'Independent music', path: paths.audio, duration: 8 };
  const start = async (options = {}) => {
    const source = structuredClone(project);
    if (options.locked) source.trackStates = { ...source.trackStates, [options.locked]: true };
    if (options.pending) source.mediaLibrary[0].probeError = 'Reading media details...';
    await page.evaluate(value => sessionStorage.setItem('my-exporter-qa-project-override', JSON.stringify(value)), source);
    await reset(page); await clickText(page, 'Media', { scope: '.mx-editor-navigation' }); await settle(page);
    return saved(page);
  };
  const autoButton = () => page.evaluateHandle(() => [...document.querySelectorAll('.mx-asset-browser button')]
    .find(button => button.textContent.trim() === 'Add Auto All'));
  const unchanged = async before => {
    await settle(page); const after = await saved(page);
    for (const key of ['scenes', 'audioTracks', 'captions', 'textOverlays', 'mediaLibrary', 'music', 'settings']) assert.deepEqual(after[key], before[key], `${key} changed during a blocked Add Auto All.`);
  };
  try {
    await check('Add Auto All is visible in Media and excludes the Audio library', async () => {
      await start(); const button = await autoButton();
      assert.ok(await button.evaluate(element => element && element.offsetWidth > 0 && element.offsetHeight > 0 && !element.matches(':disabled')));
      await button.dispose(); await clickText(page, 'Audio', { scope: '.mx-editor-navigation' });
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('.mx-asset-browser button')].some(button => button.textContent.trim() === 'Add Auto All')), false);
    });
    await check('Add Auto All orders scene numbers across filename prefixes and commits one complete Undo', async () => {
      const before = await start();
      await setControl(page, '[aria-label="Search media"]', 'Scene2'); await clickText(page, 'Images', { scope: '.mx-asset-type-filter' });
      assert.equal(await page.$$eval('.mx-asset-card', cards => cards.length), 1);
      await clickText(page, 'Add Auto All', { scope: '.mx-asset-browser' }); await settle(page);
      const after = await saved(page);
      assert.deepEqual(after.scenes.map(scene => scene.libraryId), ['asset-one', 'asset-two', 'asset-three', 'asset-ten']);
      assert.deepEqual(after.scenes.map(scene => scene.kind), ['video', 'image', 'video', 'video']);
      assert.equal(after.scenes.length, 4); assert.ok(!after.scenes.some(scene => scene.kind === 'audio'));
      assert.deepEqual(after.scenes.find(scene => scene.id === 'placed-three'), before.scenes[0], 'The existing trimmed, accelerated, animated clip must be reused intact.');
      assert.equal(after.captions[0].start, 9.5); assert.equal(after.captions[0].end, 10.5);
      assert.deepEqual(after.captions[0].words.map(word => [word.start, word.end]), [[9.5, 10.5]]);
      assert.equal(after.audioTracks[0].start, 9); assert.equal(after.audioTracks[0].duration, 2); assert.equal(after.audioTracks[0].trimStart, 2); assert.equal(after.audioTracks[0].speed, 2);
      assert.equal(after.textOverlays[0].start, 9); assert.equal(after.textOverlays[0].end, 11); assert.deepEqual(after.music, before.music);
      const button = await autoButton(); await button.evaluate(element => element.click()); await button.dispose(); await settle(page);
      const repeated = await saved(page);
      for (const key of ['scenes', 'audioTracks', 'captions', 'textOverlays']) assert.deepEqual(repeated[key], after[key], `A repeated Add Auto All changed ${key}.`);
      await shortcut(page, 'z'); await settle(page); const restored = await saved(page);
      for (const key of ['scenes', 'audioTracks', 'captions', 'textOverlays', 'mediaLibrary', 'music', 'settings', 'watermark', 'watermarkEnabled']) assert.deepEqual(restored[key], before[key], `One Undo did not restore ${key}.`);
      await shortcut(page, 'y'); await settle(page);
      assert.deepEqual((await saved(page)).scenes, after.scenes, 'Redo should restore the complete sorted placement.');
      await setControl(page, '[aria-label="Search media"]', ''); await clickText(page, 'All', { scope: '.mx-asset-type-filter' });
      await settle(page); await thumbnailPaintReady(page);
      const capture = path.join(directory, 'add-auto-all-1280.png'); await page.screenshot({ path: capture, fullPage: true }); screenshots.push(capture);
    });
    await check('Add Auto All cannot mutate a project while caption processing is pending', async () => {
      const before = await start(); await showInspector(page, 'Captions'); await page.evaluate(() => { window.__qaASRMode = 'deferred'; });
      await clickText(page, 'Regenerate captions'); await page.waitForFunction(() => window.__qaCalls.transcribe.length === 1);
      await clickText(page, 'Media', { scope: '.mx-editor-navigation' });
      const button = await autoButton(); assert.ok(await button.evaluate(element => element.matches(':disabled')));
      await button.evaluate(element => element.click()); await button.dispose(); await unchanged(before);
      assert.equal(await page.evaluate(() => window.__qaCalls.transcribe.length), 1);
      await clickText(page, 'Cancel captions', { scope: '.mx-operation-status' }); await unchanged(before);
    });
    for (const locked of ['videoLocked', 'audioLocked', 'captionsLocked']) {
      await check(`Add Auto All respects ${locked} without changing any timeline data`, async () => {
        const before = await start({ locked }); const button = await autoButton();
        assert.ok(await button.evaluate(element => element.matches(':disabled')));
        await button.evaluate(element => element.click()); await button.dispose(); await unchanged(before);
        assert.equal(await page.evaluate(() => window.__qaCalls.transcribe.length + window.__qaCalls.export.length), 0);
      });
    }
    await check('one pending media probe makes Add Auto All atomic across otherwise ready assets', async () => {
      const before = await start({ pending: true }); const button = await autoButton();
      await button.evaluate(element => element.click()); await button.dispose(); await unchanged(before);
      assert.equal((await saved(page)).scenes.length, 1);
      assert.equal(await page.evaluate(() => window.__qaCalls.transcribe.length + window.__qaCalls.export.length), 0);
      assert.ok(await page.$eval('.mx-operation-status', footer => footer.offsetHeight > 0 && /details|loading|finish|pending/i.test(footer.textContent)), 'Pending media must produce a visible actionable warning.');
    });
    await check('Add Auto All checks produce no runtime errors or unexpected native calls', async () => {
      assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.__qaCalls.unexpected), []);
      assert.equal(await page.evaluate(() => window.__qaCalls.notification.length + window.__qaCalls.voice.length + window.__qaCalls.translation.length), 0);
    });
  } finally {
    await page.evaluate(() => sessionStorage.removeItem('my-exporter-qa-project-override'));
    await reset(page);
  }
}

async function runVoiceChecks(page, seed, paths, errors) {
  const project = structuredClone(seed);
  project.scenes[0] = { ...project.scenes[0], path: paths.video, sourceDuration: 60, trimStart: 40, duration: 4, speed: 2 };
  project.mediaLibrary[0] = { ...project.mediaLibrary[0], path: paths.video, sourceDuration: 60, duration: 60 };
  project.audioTracks[0] = { ...project.audioTracks[0], path: paths.video, sourceDuration: 60, trimStart: 40, duration: 2, speed: 2 };
  project.audioTracks.push({ id: 'independent-sound', kind: 'audio', name: 'Independent sound', path: paths.video,
    start: 3, trimStart: 0, duration: 1, sourceDuration: 60, speed: 1, volume: .2 });
  const transcript = { ok: true, language: 'en', detectedLang: 'en', sourceLanguage: 'en', duration: 60, timingSource: 'word',
    text: 'Fox.', words: [{ word: 'Fox.', start: 42.18, end: 42.58 }],
    segments: [{ text: 'Fox.', start: 38.98, end: 43 }] };
  const startVoice = async (engine = 'groq', options = {}) => {
    const sourceProject = structuredClone(project);
    if (options.pending === 'scene') sourceProject.scenes[0].probeError = 'Reading media details...';
    if (options.pending === 'library') {
      sourceProject.scenes[0].probeError = '';
      sourceProject.mediaLibrary[0].probeError = 'Reading media details...';
    }
    await page.evaluate(value => sessionStorage.setItem('my-exporter-qa-project-override', JSON.stringify(value)), sourceProject);
    await reset(page); await showInspector(page, 'Captions'); await setControl(page, '[aria-label="Caption engine"]', engine);
    await showInspector(page, 'Tools'); await clickText(page, 'Translate narration', { scope: '.mx-inspector-page[data-inspector-page="tools"]' });
    await setLabel(page, 'Voice language', 'te', 'select');
    await setLabel(page, 'Narration voice', options.gender || 'female', 'select'); await settle(page);
    const before = await saved(page);
    await page.evaluate(({ result, modes }) => {
      window.__qaASRResponse = result;
      if (modes.asr) window.__qaASRMode = modes.asr;
      if (modes.translation) window.__qaTranslationMode = modes.translation;
      if (modes.voice) window.__qaVoiceMode = modes.voice;
    }, { result: options.transcript || transcript, modes: options });
    await clickText(page, 'Change Selected Video Voice to Telugu');
    if (!options.pending) await page.waitForFunction(() => window.__qaCalls.transcribe.length === 1);
    return before;
  };
  const voiceSettled = () => page.waitForFunction(() => {
    const button = document.querySelector('.mx-voice-change');
    return button && !button.disabled && !button.textContent.includes('Translating and synchronizing');
  }, { timeout: 5000 });
  const assertOriginal = async before => {
    await voiceSettled(); await settle(page);
    const after = await saved(page);
    assert.deepEqual(after.scenes, before.scenes);
    assert.deepEqual(after.audioTracks, before.audioTracks);
    assert.deepEqual(after.captions, before.captions);
    assert.deepEqual(after.textOverlays, before.textOverlays);
    assert.ok(await page.$eval('.mx-operation-status', footer => footer.offsetHeight > 0 && /failed|stopped|conflict/i.test(footer.textContent)));
  };
  try {
    for (const pending of ['scene', 'library']) {
      await check(`pending ${pending} media details block narration before all service requests`, async () => {
        const before = await startVoice('groq', { pending }); await settle(page);
        const after = await saved(page), calls = await page.evaluate(() => window.__qaCalls);
        assert.equal(calls.transcribe.length, 0); assert.equal(calls.translation.length, 0); assert.equal(calls.voice.length, 0);
        assert.deepEqual(after.scenes, before.scenes); assert.deepEqual(after.mediaLibrary, before.mediaLibrary);
        assert.deepEqual(after.audioTracks, before.audioTracks); assert.deepEqual(after.captions, before.captions);
        assert.deepEqual(after.textOverlays, before.textOverlays);
        assert.ok(await page.$eval('.mx-operation-status', footer => footer.offsetHeight > 0 && footer.textContent.includes('media details to finish loading')));
        if (pending === 'library') assert.equal(after.scenes[0].probeError, '', 'The linked-library guard must work even when the timeline scene has no probe error.');
      });
    }
    for (const { engine, gender } of [{ engine: 'local', gender: 'female' }, { engine: 'groq', gender: 'female' }, { engine: 'groq', gender: 'male' }]) {
      const name = gender === 'male' ? 'male Groq narration sends the selected voice and mode with verified timing'
        : `${engine} narration uses verified word timing, retaining source trim and speed`;
      await check(name, async () => {
        const before = await startVoice(engine, { gender }); await page.waitForFunction(() => window.__qaCalls.voice.length === 1); await voiceSettled(); await settle(page);
        const calls = await page.evaluate(() => window.__qaCalls);
        assert.equal(calls.transcribe.length, 1);
        assert.equal(calls.transcribe[0].engine, engine); assert.equal(calls.transcribe[0].contentMode, 'speech');
        assert.equal(calls.transcribe[0].languageHint, 'auto'); assert.equal(calls.transcribe[0].videoPath, paths.video);
        assert.equal(calls.translation.length, 1); assert.ok(calls.translation[0].endpoint.endsWith('/api/translate/batch'));
        assert.deepEqual(calls.translation[0].request.texts, ['Fox.']); assert.equal(calls.translation[0].request.target, 'te');
        const payload = calls.voice[0]; assert.equal(payload.videoPath, paths.video); assert.equal(payload.targetLanguage, 'te');
        assert.equal(payload.singleVoice, true); assert.equal(payload.voiceMode, gender);
        assert.equal(payload.voice, gender === 'male' ? 'te-IN-MohanNeural' : 'te-IN-ShrutiNeural');
        assert.equal(payload.segments.length, 1); assert.equal(payload.segments[0].start, 42.18); assert.equal(payload.segments[0].end, 42.58);
        assert.equal(payload.segments[0].translatedText, 'నక్క.');
        const after = await saved(page), replaced = after.scenes[0];
        assert.equal(replaced.path, paths.output); assert.equal(replaced.trimStart, 40); assert.equal(replaced.duration, 4); assert.equal(replaced.speed, 2);
        assert.deepEqual(after.scenes.slice(1), before.scenes.slice(1)); assert.deepEqual(after.textOverlays, before.textOverlays);
        assert.deepEqual(after.audioTracks, before.audioTracks.filter(track => track.id === 'independent-sound'));
        assert.deepEqual(after.captions, before.captions.filter(cue => cue.id === 'cue-c'), 'Only the replaced narration’s obsolete captions may be invalidated.');
        assert.deepEqual(after.captions[0].words, before.captions[1].words, 'Unrelated verified caption word timings must survive voice replacement.');
        await shortcut(page, 'z'); await settle(page);
        const restored = await saved(page);
        assert.deepEqual(restored.scenes, before.scenes); assert.deepEqual(restored.audioTracks, before.audioTracks);
        assert.deepEqual(restored.captions, before.captions); assert.deepEqual(restored.textOverlays, before.textOverlays);
      });
    }
    await check('narration ASR failure preserves the original video and captions', async () => {
      const before = await startVoice('groq', { asr: 'error' }); await assertOriginal(before);
      const calls = await page.evaluate(() => window.__qaCalls); assert.equal(calls.translation.length, 0); assert.equal(calls.voice.length, 0);
    });
    await check('conflicting narration words reject the broad segment without translation or export', async () => {
      const invalid = { ...transcript, words: [{ word: 'Tiger.', start: 42.3, end: 42.6 }, { word: 'Fox.', start: 42.18, end: 42.58 }] };
      const before = await startVoice('groq', { transcript: invalid }); await assertOriginal(before);
      const calls = await page.evaluate(() => window.__qaCalls); assert.equal(calls.translation.length, 0); assert.equal(calls.voice.length, 0);
      assert.ok(await page.$eval('.mx-operation-status', footer => footer.textContent.includes('word 2')));
    });
    await check('segment-only narration rejects uncertain timing before translation or native voice', async () => {
      const before = await startVoice('groq', { transcript: { ...transcript, words: [] } }); await assertOriginal(before);
      const calls = await page.evaluate(() => window.__qaCalls); assert.equal(calls.translation.length, 0); assert.equal(calls.voice.length, 0);
    });
    for (const mode of ['error', 'partial']) {
      await check(`${mode} narration translation preserves the original video and all captions`, async () => {
        const before = await startVoice('groq', { translation: mode }); await assertOriginal(before);
        const calls = await page.evaluate(() => window.__qaCalls); assert.equal(calls.translation.length, 1); assert.equal(calls.voice.length, 0);
      });
    }
    await check('native synchronized voice failure commits no project changes', async () => {
      const before = await startVoice('groq', { voice: 'error' }); await assertOriginal(before);
      assert.equal(await page.evaluate(() => window.__qaCalls.voice.length), 1);
    });
    await check('deferred narration locks project edits and ignores a second voice request', async () => {
      const before = await startVoice('groq', { asr: 'deferred', voice: 'deferred' });
      assert.deepEqual((await saved(page)).scenes, before.scenes); assert.equal(await page.evaluate(() => window.__qaCalls.voice.length), 0);
      const controls = await page.evaluate(() => ({
        name: document.querySelector('[aria-label="Project name"]').disabled,
        voice: document.querySelector('.mx-voice-change').matches(':disabled'),
        undo: document.querySelector('[title="Undo (Ctrl+Z)"]').disabled,
        language: [...document.querySelectorAll('label')].find(label => label.textContent.startsWith('Voice language'))?.querySelector('select').matches(':disabled'),
      }));
      assert.ok(Object.values(controls).every(Boolean), JSON.stringify(controls));
      await page.evaluate(() => {
        document.querySelector('.mx-voice-change').click();
        document.querySelector('.mx-filmora-toolstrip [title="Delete selected"]').click();
      });
      await shortcut(page, 'z'); await settle(page);
      assert.equal(await page.evaluate(() => window.__qaCalls.transcribe.length), 1);
      assert.deepEqual((await saved(page)).scenes, before.scenes); assert.deepEqual((await saved(page)).captions, before.captions);
      await page.evaluate(result => window.__qaResolveASR(result), transcript);
      await page.waitForFunction(() => typeof window.__qaResolveVoice === 'function');
      assert.deepEqual((await saved(page)).scenes, before.scenes); assert.deepEqual((await saved(page)).captions, before.captions);
      await page.evaluate(() => window.__qaResolveVoice({ ok: false, error: 'QA deferred native voice failure.' }));
      await assertOriginal(before);
      assert.equal(await page.evaluate(() => window.__qaCalls.transcribe.length), 1); assert.equal(await page.evaluate(() => window.__qaCalls.voice.length), 1);
    });
    await check('narration tests make no unexpected native calls or runtime errors', async () => {
      assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.__qaCalls.unexpected), []);
      assert.equal(await page.evaluate(() => window.__qaCalls.notification.length), 0);
    });
  } finally {
    await page.evaluate(() => sessionStorage.removeItem('my-exporter-qa-project-override'));
    await reset(page);
  }
}

async function runOrganizationChecks(page) {
  await check('organization keeps primary navigation clear and advanced Effects reachable', async () => {
    await reset(page);
    const primary = await page.$$eval('.mx-editor-navigation > button', buttons => buttons.map(button => button.getAttribute('aria-label') || button.textContent.trim()));
    assert.deepEqual(primary, ['Media', 'Audio', 'Titles', 'Captions', 'Help & Demos', 'Clip settings']);
    await page.focus('.mx-editor-navigation .mx-editor-menu > summary'); await page.keyboard.press('Space');
    assert.equal(await page.$eval('.mx-editor-navigation .mx-editor-menu', menu => menu.open), true, 'Space did not open Effects');
    assert.ok(await page.$eval('.mx-program-stage video', video => video.paused), 'Space on Effects also started playback');
    await clickText(page, 'Effects', { scope: '.mx-editor-navigation', contains: true });
    for (const effect of ['Transitions', 'Filters', 'Stickers', 'Templates']) {
      await clickText(page, 'Effects', { scope: '.mx-editor-navigation', contains: true });
      await clickText(page, effect, { scope: '.mx-editor-navigation .mx-editor-menu' });
      assert.ok(await page.$eval('.mx-asset-browser', browser => browser.offsetWidth > 0 && browser.offsetHeight > 0));
      assert.equal(await page.$eval('.mx-editor-navigation .mx-editor-menu', menu => menu.open), false, 'Effects menu did not close after routing');
    }
    await clickText(page, 'Captions', { scope: '.mx-editor-navigation' });
    assert.ok(await page.$eval('[aria-label="Caption engine"]', input => input.offsetWidth > 0 && input.offsetHeight > 0));
    assert.equal(await page.$('.mx-source-monitor'), null);
  });
  await check('organization inspector shows one category and retains every editing section', async () => {
    await reset(page);
    const expected = {
      Clip: '[aria-label="Clip trim start"]', Text: '.mx-text-controls,button', Captions: '[aria-label="Caption engine"]',
      Export: '[aria-label="Export resolution"]', Tools: 'summary',
    };
    for (const [tab, selector] of Object.entries(expected)) {
      await showInspector(page, tab);
      const visible = await page.$$eval('.mx-inspector-page', pages => [...new Set(pages.filter(p => p.offsetWidth && p.offsetHeight).map(p => p.dataset.inspectorPage))]);
      assert.deepEqual(visible, [tab.toLowerCase()], `Inspector category leaked other pages for ${tab}`);
      assert.ok(await page.$eval(`.mx-inspector-page[data-inspector-page="${tab.toLowerCase()}"]`, (pane, query) =>
        [...pane.querySelectorAll(query)].some(control => control.offsetWidth && control.offsetHeight), selector), `${tab} controls missing`);
    }
    const tools = await page.$$eval('.mx-inspector-page[data-inspector-page="tools"] summary', summaries => summaries.map(summary => summary.textContent.trim()));
    assert.ok(['Logo & watermark', 'Translate narration', 'Voice tools', 'Direct crop & part export'].every(name => tools.includes(name)), JSON.stringify(tools));
    await showInspector(page, 'Clip');
    assert.equal(await page.$eval('.mx-clip-animation', disclosure => disclosure.open), false, 'Animation clutter should begin collapsed');
    await revealControl(page, '[title="Add transform keyframe at playhead"]');
    assert.ok(await page.$eval('[aria-label="Scale"]', input => input.offsetWidth > 0 && input.offsetHeight > 0));
  });
  await check('organization keeps advanced timeline actions in More tools and matching caption/title tabs', async () => {
    await reset(page); await clickText(page, 'More tools', { scope: '.mx-filmora-toolstrip', contains: true });
    const advanced = await page.$$eval('.mx-filmora-toolstrip .mx-editor-menu button', buttons => buttons.filter(button => button.offsetWidth && button.offsetHeight).map(button => button.textContent.trim()));
    assert.ok(['Duplicate clip', 'Detach audio', 'AI Stutter Cutter', 'Voice, logo & crop tools'].every(name => advanced.includes(name)), JSON.stringify(advanced));
    await assertLastTimelineMenuAction(page);
    const menuScreenshot = path.join(directory, 'more-tools-1280.png'); await page.screenshot({ path: menuScreenshot, fullPage: true }); additionalScreenshots.push(menuScreenshot);
    await clickText(page, 'Voice, logo & crop tools', { scope: '.mx-filmora-toolstrip .mx-editor-menu' });
    assert.equal(await page.$eval('.mx-inspector-tabs .active', tab => tab.textContent.trim()), 'Tools');
    await page.evaluate(() => [...document.querySelectorAll('.mx-caption-clip')].find(clip => clip.textContent === 'Tiger.').click());
    await settle(page); assert.equal(await page.$eval('.mx-inspector-tabs .active', tab => tab.textContent.trim()), 'Captions');
    assert.ok(await page.$eval('.mx-caption-review', review => review.open));
    await page.click('.mx-title-clip'); await settle(page);
    assert.equal(await page.$eval('.mx-inspector-tabs .active', tab => tab.textContent.trim()), 'Text');
    assert.ok(await page.$eval('.mx-text-controls textarea', textarea => textarea.offsetWidth > 0 && textarea.offsetHeight > 0));
  });
}

async function runUndoCheck(page) {
  await check('undo restores settings and title edits, redo owns complete state', async () => {
    await reset(page); await showInspector(page, 'Captions');
    await setLabel(page, 'Text size', 64); await settle(page);
    assert.equal((await saved(page)).settings.captionFontSize, 64, 'Caption size edit did not commit');
    await shortcut(page, 'z'); await settle(page); assert.equal((await saved(page)).settings.captionFontSize, 42);
    await shortcut(page, 'y'); await settle(page); assert.equal((await saved(page)).settings.captionFontSize, 64, 'Redo did not restore caption size');
    await page.click('.mx-text-overlay'); await showInspector(page, 'Text'); await setLabel(page, 'Text', 'Edited title', 'textarea'); await settle(page);
    assert.equal((await saved(page)).textOverlays[0].text, 'Edited title');
    await shortcut(page, 'z'); await settle(page); assert.equal((await saved(page)).textOverlays[0].text, 'Original title');
    assert.equal((await saved(page)).settings.captionFontSize, 64, 'Undoing the title also reverted the prior caption size');
  });
}

async function runWorkspaceCheck(page, seed) {
  await check('project tabs isolate undo history while retaining edits and within-tab undo/redo', async () => {
    await reset(page); await showInspector(page, 'Captions'); await setLabel(page, 'Text size', 64); await settle(page);
    const undoDisabled = () => page.$eval('.mx-editor-project-actions [title="Undo (Ctrl+Z)"]', button => button.disabled);
    assert.equal(await undoDisabled(), false, 'Initial edit did not enable Undo');
    await addProjectTab(page); await settle(page);
    assert.equal((await saved(page)).scenes.length, 0); assert.equal(await undoDisabled(), true, 'New tab inherited Undo');
    await shortcut(page, 'z'); await settle(page); assert.equal((await saved(page)).scenes.length, 0, 'Undo brought old project into new tab');
    await clickText(page, 'Isolated QA', { scope: '.mx-project-tabs' }); await settle(page);
    let p = await saved(page);
    assert.deepEqual(p.scenes.map(scene => scene.id), seed.scenes.map(scene => scene.id));
    assert.deepEqual(p.captions, seed.captions); assert.deepEqual(p.textOverlays, seed.textOverlays);
    assert.equal(p.settings.captionFontSize, 64); assert.equal(await undoDisabled(), true, 'Switched tab retained unrelated history');
    await shortcut(page, 'z'); await settle(page); assert.equal((await saved(page)).settings.captionFontSize, 64);
    await showInspector(page, 'Captions'); await setLabel(page, 'Text size', 70); await settle(page); assert.equal(await undoDisabled(), false);
    await shortcut(page, 'z'); await settle(page); assert.equal((await saved(page)).settings.captionFontSize, 64);
    await shortcut(page, 'z'); await settle(page); assert.equal((await saved(page)).settings.captionFontSize, 64, 'Undo crossed the tab history boundary');
    await shortcut(page, 'y'); await settle(page); p = await saved(page);
    assert.equal(p.settings.captionFontSize, 70, 'Undo erased the within-tab redo branch');
    assert.deepEqual(p.captions, seed.captions); assert.deepEqual(p.textOverlays, seed.textOverlays);
  });
}

async function runTransportCheck(page, suffix = '') {
  await check(`continuous playback follows video → image → video in original order${suffix}`, async () => {
    await reset(page);
    await page.evaluate(() => {
      window.__qaPlaybackLog = [];
      window.__qaPlaybackTimer = setInterval(() => {
        const video = document.querySelector('.mx-program-stage video');
        window.__qaPlaybackLog.push({ time: Math.round(performance.now()), sourceTime: video?.currentTime,
          paused: video?.paused, ready: video?.readyState, seeking: video?.seeking,
          image: Boolean(document.querySelector('.mx-program-stage img[alt="Program scene"]')),
          clock: document.querySelector('.mx-player-tools > span')?.textContent,
          warning: document.querySelector('.mx-operation-status')?.textContent });
        if (window.__qaPlaybackLog.length > 100) window.__qaPlaybackLog.shift();
      }, 200);
    });
    try {
      await page.click('.mx-play-button');
      await page.waitForSelector('.mx-program-stage img[alt="Program scene"]', { timeout: 6500 });
      await page.waitForSelector('.mx-program-stage video', { timeout: 2500 });
      // The new media element exists before its initial metadata seek completes.
      // Require the correct presented frame, without accepting a stale clip.
      await page.waitForFunction(() => {
        const video = document.querySelector('.mx-program-stage video');
        return video && video.readyState >= 2 && !video.seeking && !video.paused && video.currentTime >= 3.1 && video.currentTime < 6;
      }, { timeout: 2500 });
      const time = await page.$eval('.mx-program-stage video', video => video.currentTime);
      assert.ok(time >= 3 && time < 6, `Third-scene source time ${time}`);
      await page.click('.mx-play-button');
    } catch (error) {
      throw new Error(`${error.message}; transition trace: ${JSON.stringify(await page.evaluate(() => window.__qaPlaybackLog))}`);
    } finally {
      await page.evaluate(() => clearInterval(window.__qaPlaybackTimer));
      playbackTraces.push({ run: suffix || 'full editor', frames: await page.evaluate(() => window.__qaPlaybackLog) });
      fs.writeFileSync(path.join(directory, 'transport-trace.json'), JSON.stringify(playbackTraces, null, 2));
    }
  });
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); });
