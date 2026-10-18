'use strict';
// Isolated headless UI QA: the real InputPanel, React editor and legacy caption
// controller, with a small local video and mocked transcription/cancellation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const puppeteer = require('puppeteer');

const root = path.resolve(__dirname, '..');
let fixture;
let fixtureDirectory;
const passed = [];
let server;
let browser;
const screenshots = [];
const assFiles = [];
// Public IDs are the bridge between the React UI and the legacy caption
// controller. Organization changes must preserve these existing controls.
const expectedCaptionIds = [
  'captionVideoInput', 'captionQueuePanel', 'captionQueueStatus', 'captionQueueRunBtn', 'captionQueueExportAllBtn',
  'captionQueuePrevBtn', 'captionQueueNextBtn', 'captionQueueList', 'captionActionBtn', 'captionCancelBtn',
  'captionEraseBtn', 'captionPreviewBtn', 'captionExportBtn', 'captionViralShortBtn', 'captionResetBtn',
  'captionTranslateCheck', 'captionEmojiCheck', 'captionKaraokeCheck', 'captionBrollCheck', 'captionSfxCheck',
  'captionProgressBarCheck', 'captionBgMusicCheck', 'bgMusicInput', 'bgMusicAudio', 'captionWatermarkCheck',
  'captionWatermarkInput', 'captionContentMode', 'captionEngine', 'captionLocalModeDisclosure', 'captionGroqKeyField',
  'captionGroqApiKey', 'captionRegenerateBtn', 'captionVocalFocus', 'captionVocabularyHints', 'captionStyleSelect',
  'captionGroqRecoveryField', 'captionGroqLocalRecovery',
  'captionLanguage', 'captionLanguageDisclosure', 'captionTranslateSelectedBtn', 'captionEraserQuality',
  'captionFilterSelect', 'captionFontSelect', 'captionSizeValue', 'captionSizeSlider', 'captionSizePreviewText',
  'captionSizePreviewBtn', 'captionPositionPreset', 'captionPositionXValue', 'captionPositionX', 'captionPositionYValue',
  'captionPositionY', 'captionGapValue', 'captionGapSlider', 'captionWidthValue', 'captionWidthSlider', 'captionSyncNum',
  'captionSyncSlider', 'captionStrokeValue', 'captionStrokeSlider', 'captionHeightValue', 'captionHeightSlider',
  'captionBoldCheck', 'captionColorPicker', 'captionProgress', 'captionStatusText', 'captionProgressBarValue',
  'captionExportActions', 'captionVideoContainer', 'captionRenderCanvas', 'captionVideoControls', 'captionPlayPauseBtn',
  'captionSeekSlider', 'captionTimeDisplay', 'captionSourceVideo', 'captionEditorPanel', 'captionList',
  'aiCapSttBtn', 'aiCapTtsBtn', 'aiCapVoiceStatus',
];

async function main() {
  const browserPath = [puppeteer.executablePath(),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(candidate => fs.existsSync(candidate));
  if (!browserPath) { console.log(JSON.stringify({ skipped: true, reason: 'No installed Chromium browser is available.' })); return; }
  const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true });
  if (ffmpegCheck.error || ffmpegCheck.status !== 0) { console.log(JSON.stringify({ skipped: true, reason: 'FFmpeg is unavailable on PATH.' })); return; }
  fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-local-qa-'));
  fixture = path.join(fixtureDirectory, 'caption-advanced-qa.mp4');
  const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'color=c=0x123456:s=320x180:r=15', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
    '-t', '50', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart', '-y', fixture], { encoding: 'utf8', windowsHide: true });
  if (generated.error || generated.status !== 0) throw new Error(`Could not generate the synthetic QA video: ${generated.error?.message || generated.stderr}`);
  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const entryId = '\0caption-local-qa-entry';
  const inputPath = path.join(root, 'src/components/InputPanel.jsx').replace(/\\/g, '/');
  const appCssPath = path.join(root, 'src/index.css').replace(/\\/g, '/');
  const bundle = await build({
    configFile: false, root, logLevel: 'error',
    plugins: [react(), {
      name: 'caption-local-qa-entry',
      resolveId(id) { if (id === 'caption-local-qa-entry') return entryId; },
      load(id) {
        if (id === entryId) return `import React from 'react'; import {createRoot} from 'react-dom/client'; import ${JSON.stringify(appCssPath)}; import InputPanel from ${JSON.stringify(inputPath)}; createRoot(document.getElementById('root')).render(React.createElement(InputPanel));`;
      },
    }],
    build: { write: false, minify: false, cssCodeSplit: false, rolldownOptions: {
      input: 'caption-local-qa-entry', output: { format: 'iife', name: 'CaptionLocalQA' },
    } },
  });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle).output;
  const js = output.find(item => item.type === 'chunk').code;
  const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\nbody{padding:16px}#inputPanel{max-width:1100px;margin:auto}#inputPanel>:not(#aiCaptionSection){display:none}</style></head><body><div id="root"></div><script src="/qa-entry.js"></script></body></html>`;
  server = http.createServer((request, response) => {
    const route = new URL(request.url, 'http://127.0.0.1').pathname;
    let content;
    let type;
    if (route === '/') { content = html; type = 'text/html'; }
    else if (route === '/qa-entry.js') { content = js; type = 'application/javascript'; }
    else if (route === '/caption-script.js') {
      // Expose the real ASS builder only inside this isolated QA page. Calling
      // it inspects export text sizing without starting an export or notifying.
      content = fs.readFileSync(path.join(root, 'caption-script.js'), 'utf8').replace(
        'window.captionLocalWorkbenchAPI = localWorkbenchBridge;',
        'window.captionLocalWorkbenchAPI = localWorkbenchBridge; window.__qaBuildPreviewAss = () => buildPreviewMatchedAss([]); window.__qaRenderAt = time => renderCaptionFrame(renderCanvas.getContext("2d"), renderCanvas.width, renderCanvas.height, time);');
      type = 'application/javascript';
    }
    else if (/^\/caption-fonts\/Nunito-(Regular|Black)\.ttf$/.test(route)) {
      const fontPath = path.join(root, 'public', route.slice(1));
      if (fs.existsSync(fontPath)) { content = fs.readFileSync(fontPath); type = 'font/ttf'; }
    }
    if (content === undefined) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': type }); response.end(content);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (url.startsWith(origin + '/') || url.startsWith('blob:') || url.startsWith('data:')) request.continue();
    else request.abort();
  });
  await page.evaluateOnNewDocument(fixturePath => {
    window.__qaNotifications = 0;
    window.__qaASRCalls = 0;
    window.__qaExportCalls = 0;
    window.__qaTranscriptionRequests = [];
    window.__qaEraseRequests = [];
    window.__qaTranslationRequests = [];
    window.__qaCapabilityRequests = [];
    window.__qaTranslationMode = 'success';
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, options = {}) => {
      if (!String(input).includes('8434/api/translate/batch')) return originalFetch(input, options);
      const request = JSON.parse(options.body); window.__qaTranslationRequests.push(request);
      const results = window.__qaTranslationMode === 'verified-labels'
        ? request.texts.map(text => ({ 'Tiger.': 'పులి.', 'Fox.': 'నక్క.' }[text]))
        : request.texts.map((_text, index) => ({ en: ['English caption one', 'English caption two'],
          te: ['నమస్కారం పిల్లలారా', 'ఇది మొదటి పాఠం'], hi: ['नमस्ते बच्चों', 'यह पहला पाठ है'] }[request.target][index % 2]));
      const result = () => new Response(JSON.stringify({ target: request.target, results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (window.__qaTranslationMode === 'deferred') return new Promise((resolve, reject) => {
        window.__qaResolveTranslation = () => resolve(result());
        options.signal?.addEventListener('abort', () => reject(options.signal.reason || new DOMException('Cancelled', 'AbortError')), { once: true });
      });
      if (window.__qaTranslationMode === 'error') return new Response(JSON.stringify({ error: 'QA translation provider unavailable' }), { status: 502 });
      if (window.__qaTranslationMode === 'partial') return new Response(JSON.stringify({ target: request.target, results: [] }), { status: 200 });
      return result();
    };
    window.electronAPI = {
      getPathForFile: () => fixturePath,
      onTranscribeProgress() {},
      transcribeVideo: options => {
        if (options.capabilityProbe) { window.__qaCapabilityRequests.push(options); return Promise.resolve({ ok: true, groqSpeechTimingRepairVersion: 1 }); }
        window.__qaASRCalls += 1;
        window.__qaTranscriptionRequests.push(options);
        return new Promise(resolve => { window.__qaResolveTranscription = resolve; });
      },
      cancelTranscribeVideo: async () => {
        window.__qaResolveTranscription?.({ ok: false, cancelled: true });
        return { ok: true };
      },
      eraseCaptions: options => {
        window.__qaEraseRequests.push(options);
        return new Promise(resolve => { window.__qaResolveErase = resolve; });
      },
      burnCaptions: async () => {
        window.__qaExportCalls += 1;
        throw new Error('Exports are not part of isolated caption UI QA');
      },
      showNotification() { window.__qaNotifications += 1; },
      reportWhatsAppJob() { window.__qaNotifications += 1; },
    };
    if (window.speechSynthesis) window.speechSynthesis.speak = () => {};
  }, fixture);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#captionVideoInput');
  await page.addScriptTag({ url: origin + '/caption-script.js' });
  await page.waitForFunction(() => !!window.captionLocalWorkbenchAPI);
  await page.waitForSelector('.lcp-source-card');

  const organization = await page.evaluate(expectedIds => {
    const section = document.getElementById('aiCaptionSection');
    const counts = new Map();
    section.querySelectorAll('[id]').forEach(element => counts.set(element.id, (counts.get(element.id) || 0) + 1));
    const primary = ['captionVideoInput', 'captionContentMode', 'captionEngine', 'captionLanguage', 'captionActionBtn', 'captionEraseBtn'].map(id => {
      const element = document.getElementById(id), rect = element.getBoundingClientRect();
      return { id, visible: element.checkVisibility(), inSource: !!element.closest('.lcp-source-card'), top: rect.top, bottom: rect.bottom };
    });
    const secondary = [...section.querySelectorAll('.lcp-disclosure')].map(element => ({ open: element.open, label: element.querySelector('summary')?.textContent.trim() }));
    return {
      missing: expectedIds.filter(id => counts.get(id) !== 1),
      duplicates: [...counts].filter(([, count]) => count > 1).map(([id]) => id), primary, secondary,
    };
  }, expectedCaptionIds);
  assert.deepEqual(organization.missing, [], 'Every existing caption control must remain mounted exactly once.');
  assert.deepEqual(organization.duplicates, [], 'The organized caption module must not duplicate controller IDs.');
  assert.ok(organization.primary.every(control => control.visible && control.inSource && control.top >= 0 && control.bottom <= 1000),
    `Source, engine and Generate must be visible on entry: ${JSON.stringify(organization.primary)}`);
  assert.ok(organization.secondary.length >= 4 && organization.secondary.every(section => !section.open && section.label),
    'Secondary tools must have labeled, initially collapsed disclosures.');
  assert.equal(await page.$eval('#lcp-queue-heading', element => element.checkVisibility()), true, 'The Video queue entry must stay visible before selecting a video.');
  assert.equal(await page.$eval('#lcp-queue-heading', element => element.closest('.lcp-source-card') !== null), true, 'The queue belongs in Source & recognition.');
  assert.equal(await page.$eval('#captionQueueList', element => element.parentElement.id), 'captionQueuePanel', 'Queue progress must retain its insertion target.');
  passed.push('Source, engine and Generate appear on entry; all legacy IDs remain unique and secondary tools start collapsed');
  assert.equal(await page.$eval('#captionEraseBtn', element => element.checkVisibility() && element.disabled
    && !!element.closest('.lcp-source-card') && !element.closest('.lcp-disclosure')), true,
  'Caption Eraser must appear in Source outside collapsed options and wait for a video.');
  passed.push('Caption Eraser stays visible beside generation on entry and is disabled until a video is selected');
  assert.equal(await page.$eval('#captionLanguage', element => element.value), 'en');
  assert.equal(await page.$eval('#captionEraserQuality', element => element.value), 'ai');
  assert.equal(await page.$eval('#captionTranslateCheck', element => element.checkVisibility()), false);
  passed.push('Caption language is visible with English default and eraser quality defaults to AI repair');

  const assertNoCaptionOverflow = async label => {
    const overflow = await page.evaluate(() => {
      const section = document.getElementById('aiCaptionSection');
      const controls = [...section.querySelectorAll('input,button,select,textarea')].filter(element => element.checkVisibility());
      const summary = section.querySelector(':scope > summary'), title = summary.querySelector('.section-title');
      const summaryRect = summary.getBoundingClientRect(), titleRect = title.getBoundingClientRect();
      const marker = getComputedStyle(summary, '::after');
      return {
        width: innerWidth, documentWidth: document.documentElement.scrollWidth,
        moduleWidth: section.clientWidth, moduleScrollWidth: section.scrollWidth,
        titleRight: titleRect.right, markerLeft: summaryRect.right - parseFloat(marker.right) - parseFloat(marker.width),
        controls: controls.flatMap(element => {
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > innerWidth + 1 ? [{ id: element.id || element.getAttribute('aria-label'), left: rect.left, right: rect.right }] : [];
        }),
        squeezedEditors: innerWidth < 600 ? [...section.querySelectorAll('#captionList .chunk-editor')].filter(element => element.checkVisibility()).flatMap(element => {
          const width = element.getBoundingClientRect().width, rowWidth = element.parentElement.getBoundingClientRect().width;
          return width < rowWidth * .5 ? [{ width, rowWidth }] : [];
        }) : [],
      };
    });
    assert.ok(overflow.documentWidth <= overflow.width + 1 && overflow.moduleScrollWidth <= overflow.moduleWidth + 1 && !overflow.controls.length
      && (!Number.isFinite(overflow.markerLeft) || overflow.titleRight <= overflow.markerLeft + 1),
      `${label} must keep controls inside the viewport without horizontal overflow: ${JSON.stringify(overflow)}`);
    assert.deepEqual(overflow.squeezedEditors, [], `${label} must give caption text at least half the cue-row width for readable editing.`);
  };
  const screenshotDirectory = path.join(root, 'generated-media', `caption-organization-qa-${Date.now()}`);
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  const captureOrganization = async stage => {
    for (const [name, width, height] of [['desktop', 1280, 1000], ['mobile', 390, 950]]) {
      await page.setViewport({ width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await assertNoCaptionOverflow(`${stage} ${name}`);
      const screenshotPath = path.join(screenshotDirectory, `${stage}-${name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }); screenshots.push(screenshotPath);
    }
    await page.setViewport({ width: 320, height: 900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await assertNoCaptionOverflow(`${stage} narrow mobile`);
    await page.setViewport({ width: 1280, height: 1000 });
  };
  await captureOrganization('initial');
  passed.push('Desktop, mobile and narrow mobile entry layouts keep caption controls inside the viewport');
  const videoInput = await page.$('#captionVideoInput');
  await page.$eval('#captionSyncSlider', element => {
    element.value = '-2500'; element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.match(await page.$eval('#captionSyncNum', element => element.textContent), /-2\.5s/);
  await videoInput.uploadFile(fixture);
  assert.equal(await page.$eval('#captionSyncSlider', element => element.value), '0');
  assert.match(await page.$eval('#captionSyncNum', element => element.textContent), /0\.0s/);
  passed.push('Fresh video upload resets a stale negative sync offset and its numeric display');
  await page.waitForFunction(() => {
    const state = window.captionLocalWorkbenchAPI?.getState();
    return state?.hasVideo && state.duration > 4;
  });
  await page.waitForSelector('.local-caption-workbench .cw-panel');
  assert.equal(await page.$eval('.cw-badge', element => element.textContent), 'No captions yet');
  assert.equal(await page.$eval('#captionEngine', element => element.value), 'local', 'Local stays the default engine.');
  assert.equal(await page.$eval('#captionGroqKeyField', element => element.classList.contains('hidden')), true);
  assert.equal(await page.$eval('#captionRegenerateBtn', element => element.classList.contains('hidden')), true, 'Regeneration appears after captions exist.');
  assert.equal(await page.$eval('#captionEraseBtn', element => element.checkVisibility() && !element.disabled
    && !!element.closest('.lcp-source-card') && !element.closest('.lcp-disclosure')), true,
  'Loading a video must enable the visible Source eraser.');
  passed.push('Advanced tools available before transcription');

  await page.evaluate(() => {
    document.querySelectorAll('#aiCaptionSection .lcp-disclosure').forEach(element => { element.open = true; });
  });
  for (const selector of ['#captionVocabularyHints', '#captionVocalFocus', '#captionLanguage', '#captionPositionPreset',
    '#captionSyncSlider', '#captionBrollCheck', '#captionBgMusicCheck', '#captionSizePreviewText', '#captionSizePreviewBtn']) {
    assert.equal(await page.$eval(selector, element => element.checkVisibility()), true, `${selector} must be reachable when its secondary section opens.`);
  }
  await page.setViewport({ width: 320, height: 900 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await assertNoCaptionOverflow('Expanded secondary tools on narrow mobile');
  await page.setViewport({ width: 1280, height: 1000 });
  passed.push('Opening secondary sections reveals recognition, timing, effects and size tools without narrow-screen overflow');

  await page.evaluate(() => {
    document.querySelector('.cw-panel').open = true;
    document.querySelectorAll('.cw-section').forEach(element => { element.open = true; });
  });
  const clickText = async text => {
    const found = await page.evaluate(label => {
      const button = [...document.querySelectorAll('.local-caption-workbench button')].find(element => element.textContent.trim() === label);
      if (!button) return 'missing';
      if (button.disabled) return 'disabled';
      button.click(); return 'clicked';
    }, text);
    assert.equal(found, 'clicked', `${text} must be clickable`);
  };
  const state = () => page.evaluate(() => window.captionLocalWorkbenchAPI.getState());
  const setText = async (selector, text) => {
    await page.$eval(selector, (element, value) => {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
  };

  // Import through the real file input, preserving Unicode and multiple lines.
  const srt = '1\n00:00:00,500 --> 00:00:02,000\nJingle bells\nజింగిల్\n\n2\n00:00:02,000 --> 00:00:04,500\nJingle bells again\n';
  await page.$eval('[aria-label="Import subtitle file"]', (input, text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'qa-lyrics.srt', { type: 'text/plain' }));
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, srt);
  await page.waitForFunction(() => [...document.querySelectorAll('.local-caption-workbench button')].some(button => button.textContent === 'Apply import'));
  await clickText('Apply import');
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().captions.length === 2);
  const imported = await state();
  assert.equal(imported.captions[0].text, 'Jingle bells\nజింగిల్');
  assert.equal(imported.timingSource, 'estimated');
  assert.equal(await page.$eval('#captionList .chunk-editor', element => element.value), 'Jingle bells\nజింగిల్');
  assert.equal(await page.$eval('#captionEditorPanel', element => element.checkVisibility()), true, 'Imported captions must reveal the cue editor.');
  assert.equal(await page.$eval('#captionList .chunk-editor', element => element.checkVisibility()), true, 'Imported caption text must be visibly editable.');
  assert.equal(await page.$eval('#captionActionBtn', element => element.checkVisibility()), false, 'A captioned single video must show Regenerate without a duplicate Generate action.');
  assert.equal(await page.$eval('#captionRegenerateBtn', element => element.checkVisibility()), true, 'Regenerate must stay reachable after importing captions.');
  assert.equal(await page.$eval('#captionQueuePanel', element => element.checkVisibility()), true, 'A single file must keep its queue and export controls visible.');
  assert.ok(await page.$eval('#captionQueueList', element => element.textContent.includes('transcribed')));
  passed.push('SRT import updates the legacy editor and queue, preserving multiline Unicode');
  const beforeErasing = await state();
  const originalSourceUrl = await page.$eval('#captionSourceVideo', element => element.src);
  const notificationsBeforeErasing = await page.evaluate(() => window.__qaNotifications);
  await page.click('#captionEraseBtn');
  await page.waitForFunction(() => window.__qaEraseRequests.length === 1 && window.captionLocalWorkbenchAPI.getState().disabled);
  assert.equal(await page.$eval('#captionEraseBtn', element => element.disabled && element.checkVisibility()), true,
    'The reachable eraser must lock while its mocked job is running.');
  assert.equal(await page.evaluate(() => window.__qaEraseRequests[0].filePath), fixture, 'The click must target the selected synthetic source.');
  assert.match(await page.evaluate(() => window.__qaEraseRequests[0].jobId), /^caption-erase-/);
  assert.equal(await page.evaluate(() => window.__qaEraseRequests[0].quality), 'ai');
  assert.equal(await page.$eval('#captionEraserQuality', element => element.disabled), true);
  await page.evaluate(() => window.__qaResolveErase({ ok: true, changed: false, noCaptionsDetected: true }));
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled);
  const afterErasing = await state();
  assert.deepEqual(afterErasing.captions, beforeErasing.captions, 'No detections must preserve every edited cue.');
  assert.equal(afterErasing.itemId, beforeErasing.itemId);
  assert.equal(afterErasing.timingSource, beforeErasing.timingSource);
  assert.deepEqual(afterErasing.warnings, beforeErasing.warnings);
  assert.equal(await page.$eval('#captionSourceVideo', element => element.src), originalSourceUrl);
  assert.equal(await page.$eval('#captionEraseBtn', element => element.disabled || !element.checkVisibility()), false);
  assert.equal(await page.evaluate(() => window.__qaASRCalls), 0, 'A no-detections eraser job must not start transcription.');
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 0, 'A no-detections eraser job must not export a replacement video.');
  assert.equal(await page.evaluate(() => window.__qaNotifications), notificationsBeforeErasing);
  assert.match(await page.$eval('#captionStatusText', element => element.textContent), /No previous captions detected/);
  passed.push('The Source eraser button reaches its mocked IPC and preserves source, captions and metadata when no captions are detected');
  await page.select('#captionEraserQuality', 'quick');
  await page.click('#captionEraseBtn');
  await page.waitForFunction(() => window.__qaEraseRequests.length === 2 && window.captionLocalWorkbenchAPI.getState().disabled);
  assert.equal(await page.evaluate(() => window.__qaEraseRequests[1].quality), 'quick');
  await page.evaluate(() => window.__qaResolveErase({ ok: true, changed: false, noCaptionsDetected: true }));
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled);
  assert.deepEqual((await state()).captions, beforeErasing.captions);
  await page.select('#captionEraserQuality', 'ai');
  passed.push('AI and Quick eraser quality reach IPC independently and lock while erasing');
  await page.waitForFunction(() => document.getElementById('captionSourceVideo').readyState >= 2);
  await page.evaluate(() => {
    const api = window.captionLocalWorkbenchAPI;
    api.seek(api.getState().itemId, 1);
  });
  await page.waitForFunction(() => !document.getElementById('captionSourceVideo').seeking);
  await page.$eval('#captionSizeSlider', element => element.dispatchEvent(new Event('input', { bubbles: true })));
  await page.evaluate(() => {
    document.querySelectorAll('#aiCaptionSection .lcp-disclosure,.local-caption-workbench .cw-panel').forEach(element => { element.open = false; });
  });
  await captureOrganization('captions');
  await page.evaluate(() => {
    document.querySelectorAll('#aiCaptionSection .lcp-disclosure,.local-caption-workbench .cw-panel').forEach(element => { element.open = true; });
  });
  passed.push('Imported-caption review and appearance layouts remain within desktop and mobile bounds');

  // Notice-only events must not erase history or timing metadata.
  await page.evaluate(() => {
    window.captionLocalWorkbenchAPI.notice('QA notice');
    window.captionLocalWorkbenchAPI.publish();
  });
  await clickText('Undo');
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().captions.length === 0);
  assert.equal((await state()).timingSource, undefined);
  await clickText('Redo');
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().captions.length === 2);
  assert.equal((await state()).timingSource, 'estimated');
  assert.deepEqual((await state()).warnings, imported.warnings);
  passed.push('Undo/redo restore captions and timing metadata after a notice event');

  const stale = await page.evaluate(() => {
    const api = window.captionLocalWorkbenchAPI;
    try { api.applyCaptions('previous-video', api.getState().captions); return ''; }
    catch (error) { return error.message; }
  });
  assert.match(stale, /selected video changed/);
  await setText('[aria-label="Shift all captions seconds"]', '0.1');
  await page.evaluate(() => {
    window.__qaOriginalApply = window.captionLocalWorkbenchAPI.applyCaptions;
    window.captionLocalWorkbenchAPI.applyCaptions = () => { throw new Error('QA rejected stale caption edit'); };
  });
  await clickText('Apply shift');
  await page.waitForFunction(() => document.querySelector('.cw-notice')?.textContent.includes('QA rejected stale caption edit'));
  assert.deepEqual((await state()).captions, imported.captions);
  await page.evaluate(() => { window.captionLocalWorkbenchAPI.applyCaptions = window.__qaOriginalApply; });
  await clickText('Undo');
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().captions.length === 0);
  await clickText('Redo');
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().captions.length === 2);
  passed.push('Stale-target rejection leaves captions and undo/redo history intact');

  const lyrics = 'Jingle bells jingle bells\nJingle bells jingle bells';
  await setText('[aria-label="Exact song lyrics"]', lyrics);
  await clickText('Preview lyric fit');
  await page.waitForSelector('[aria-label="Lyric timing review warnings"]');
  assert.ok(await page.$eval('[aria-label="Lyric timing review warnings"]', element => /Repeated lyrics|estimated|estimates/.test(element.textContent)));
  assert.deepEqual((await state()).captions, imported.captions, 'Preview must not alter captions');
  await clickText('Apply exact lyrics');
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().captions.reduce((count, cue) => count + (cue.words?.length || 0), 0) === 8);
  const fitted = await state();
  assert.equal(fitted.captions.map(cue => cue.text).join(' '), lyrics.replace(/\n/g, ' '));
  assert.equal(fitted.timingSource, 'estimated');
  for (const cue of fitted.captions) {
    let previousEnd = cue.start;
    for (const word of cue.words) {
      assert.ok(word.start >= previousEnd && word.end > word.start && word.end <= cue.end);
      previousEnd = word.end;
    }
  }
  passed.push('Exact lyrics preserve repeated chorus and apply valid, disclosed estimated word timing');

  await page.select('[aria-label="Local caption review speed"]', '0.5');
  await page.waitForFunction(() => document.getElementById('captionSourceVideo').playbackRate === .5);
  assert.equal((await state()).previewSpeed, .5);
  await page.$eval('#captionSyncSlider', slider => { slider.value = '200'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
  await clickText('Go to caption');
  await page.waitForFunction(() => document.getElementById('captionSourceVideo').currentTime > .65);
  const seek = await page.evaluate(() => ({ currentTime: document.getElementById('captionSourceVideo').currentTime, start: window.captionLocalWorkbenchAPI.getState().captions[0].start }));
  assert.ok(Math.abs(seek.currentTime - seek.start - .2) < .05);
  await clickText('Loop current caption');
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().looping);
  await page.evaluate(() => {
    const video = document.getElementById('captionSourceVideo');
    video.currentTime = window.captionLocalWorkbenchAPI.getState().captions[0].end + .2;
    video.dispatchEvent(new Event('timeupdate'));
  });
  await page.waitForFunction(() => document.getElementById('captionSourceVideo').currentTime < window.captionLocalWorkbenchAPI.getState().captions[0].start + .4);
  await clickText('Stop caption loop');
  assert.equal((await state()).looping, false);
  passed.push('Review speed, cue looping and seeking honor the sync offset');

  // Measure actual Canvas text and the actual ASS builder, without decoding a
  // costly 4K clip. The real metadata/reload path reads these video dimensions.
  await page.evaluate(() => {
    window.__qaTextDraws = [];
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (this.canvas.id === 'captionRenderCanvas' && /Font|check/.test(String(text))) {
        const transform = this.getTransform();
        const fontPixels = Number(this.font.match(/([\d.]+)px/)?.[1]);
        window.__qaTextDraws.push({ text, fontPixels, effectivePixels: fontPixels * Math.hypot(transform.c, transform.d) });
      }
      return originalFillText.call(this, text, ...args);
    };
    document.getElementById('captionSyncSlider').value = '0';
    document.getElementById('captionSizeSlider').value = '50';
  });
  for (const dimensions of [{ width: 3840, height: 2160 }, { width: 2160, height: 3840 }]) {
    const reload = await page.evaluate(size => {
      const video = document.getElementById('captionSourceVideo');
      Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => size.width });
      Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => size.height });
      const reloadButton = document.querySelector('#captionQueueList button');
      reloadButton.click();
      return { disabled: reloadButton.disabled, busy: window.captionLocalWorkbenchAPI.getState().disabled };
    }, dimensions);
    assert.equal(reload.disabled, false, `Queue reload must unlock after cancellation (busy=${reload.busy})`);
    await page.waitForFunction(size => {
      const video = document.getElementById('captionSourceVideo');
      const canvas = document.getElementById('captionRenderCanvas');
      return video.readyState >= 2 && canvas.width === size.width / 2 && canvas.height === size.height / 2;
    }, {}, dimensions);
    const measurement = await page.evaluate(() => {
      const api = window.captionLocalWorkbenchAPI;
      const current = api.getState();
      api.applyCaptions(current.itemId, [{ start: .5, end: 4.5, text: 'Font check', words: [
        { text: 'Font', start: .5, end: 1.2 }, { text: 'check', start: 1.2, end: 4.5 },
      ] }], { timingSource: 'word', warnings: [] });
      window.__qaTextDraws = [];
      api.seek(current.itemId, .8);
      return { draws: window.__qaTextDraws, slider: document.getElementById('captionSizeSlider').value, ass: window.__qaBuildPreviewAss() };
    });
    assert.equal(measurement.slider, '50', '4K video loading must preserve the selected size');
    assert.ok(measurement.draws.length, 'The real preview must render the known caption');
    for (const draw of measurement.draws) {
      assert.equal(draw.fontPixels, 100, '4K source text must scale to 100px');
      assert.equal(draw.effectivePixels, 50, 'Capped preview must retain the original 50px appearance');
    }
    assert.ok(measurement.ass.includes(`PlayResX: ${dimensions.width}`));
    assert.ok(measurement.ass.includes(`PlayResY: ${dimensions.height}`));
    const assSize = Number(measurement.ass.match(/^Style: Preview,[^,]+,([\d.]+)/m)?.[1]);
    assert.ok(Math.abs(assSize - 137.7) < .001, 'ASS must carry 100px source size with Nunito metric correction');
  }
  assert.equal(await page.evaluate(() => window.__qaNotifications), 0);
  passed.push('4K landscape and portrait preserve 50px preview appearance, 100px source captions and the selected slider in Canvas/ASS');
  // Real transcription busy guards, with a deferred mock instead of a native worker.
  await page.select('#captionContentMode', 'song');
  await page.evaluate(() => {
    const action = document.getElementById('captionActionBtn');
    action.classList.remove('hidden'); action.click();
  });
  await page.waitForFunction(() => window.__qaASRCalls === 1 && window.captionLocalWorkbenchAPI.getState().disabled);
  assert.equal(await page.$eval('#captionEngine', element => element.disabled), true, 'The engine must lock while captioning.');
  assert.equal(await page.$eval('#captionRegenerateBtn', element => element.disabled), true);
  assert.equal(await page.$eval('#captionEraseBtn', element => element.disabled && element.checkVisibility()), true, 'Transcription must disable the visible eraser.');
  assert.deepEqual(await page.evaluate(() => window.__qaTranscriptionRequests[0].engine), 'local');
  assert.ok(await page.$eval('[aria-label="Import subtitle file"]', element => element.disabled));
  assert.ok(await page.$eval('[aria-label="Local caption review speed"]', element => element.disabled));
  assert.ok(await page.$eval('#captionList', element => [...element.querySelectorAll('input,button,textarea')].every(control => control.disabled)));
  const rejection = await page.evaluate(() => {
    const api = window.captionLocalWorkbenchAPI;
    const snapshot = api.getState();
    try { api.applyCaptions(snapshot.itemId, snapshot.captions); return ''; }
    catch (error) { return error.message; }
  });
  assert.match(rejection, /Wait for caption/);
  await page.evaluate(() => document.getElementById('captionCancelBtn').click());
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled);
  assert.equal(await page.$eval('#captionEraseBtn', element => element.disabled), false, 'Cancelling transcription must re-enable the eraser.');
  assert.equal(await page.$eval('#captionQueueList button', element => element.disabled), false, 'Queue reload must unlock after cancellation');
  const priorVideoUrl = await page.$eval('#captionSourceVideo', element => element.src);
  await page.$eval('#captionQueueList button', element => element.click());
  await page.waitForFunction(previous => {
    const video = document.getElementById('captionSourceVideo');
    return video.src !== previous && video.readyState >= 2;
  }, {}, priorVideoUrl);
  assert.equal((await state()).captions[0].text, 'Font check', 'Reload must retain the edited queue captions');
  assert.equal(await page.evaluate(() => window.__qaNotifications), 0);
  passed.push('Busy controls reject edits; cancellation unlocks queue reload, retains edits and sends no notifications');

  // A memory/voice guard must stop every local fallback, otherwise the renderer
  // would launch another Whisper after the native engine protected SC3.
  await page.select('#captionContentMode', 'speech');
  const beforeResourceRefusal = await state();
  await page.evaluate(() => {
    window.__qaLocalFallbackCalls = 0;
    const originalFetch = window.fetch;
    window.fetch = function(input, ...args) {
      if (String(input).includes('8428')) window.__qaLocalFallbackCalls += 1;
      return originalFetch.call(this, input, ...args);
    };
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) { window.__qaLocalFallbackCalls += 1; super(...args); }
    };
    window.electronAPI.transcribeVideo = async () => {
      window.__qaASRCalls += 1;
      return { ok: false, code: 'CAPTION_RESOURCE_BUSY', error: 'Not enough free memory for Local captions. Free at least 3 GB of RAM, or select the Groq engine.' };
    };
    document.getElementById('captionActionBtn').click();
  });
  await page.waitForFunction(() => window.__qaASRCalls === 2 && !window.captionLocalWorkbenchAPI.getState().disabled);
  assert.match(await page.$eval('#captionStatusText', element => element.textContent), /Not enough free memory for Local captions/);
  assert.equal(await page.evaluate(() => window.__qaLocalFallbackCalls), 0, 'The resource guard must not launch HTTP or browser Whisper');
  assert.equal(await page.$eval('#captionSizeSlider', element => element.disabled), false);
  assert.deepEqual((await state()).captions, beforeResourceRefusal.captions);
  assert.equal(await page.evaluate(() => window.__qaNotifications), 0);
  passed.push('Caption memory refusal stops native, HTTP and browser fallback generation and unlocks editing');

  await page.evaluate(() => {
    window.electronAPI.transcribeVideo = async () => {
      window.__qaASRCalls += 1;
      return { ok: false, code: 'CAPTION_TRANSCRIPTION_BUSY', error: 'A caption transcription is already running. Wait for it to finish.' };
    };
    document.getElementById('captionActionBtn').click();
  });
  await page.waitForFunction(() => window.__qaASRCalls === 3 && !window.captionLocalWorkbenchAPI.getState().disabled);
  assert.match(await page.$eval('#captionStatusText', element => element.textContent), /already running/);
  assert.equal(await page.evaluate(() => window.__qaLocalFallbackCalls), 0);
  assert.deepEqual((await state()).captions, beforeResourceRefusal.captions);
  assert.equal((await state()).timingSource, beforeResourceRefusal.timingSource);
  assert.deepEqual((await state()).warnings, beforeResourceRefusal.warnings);
  assert.equal(await page.evaluate(() => window.__qaNotifications), 0);
  passed.push('Native transcription-busy refusal preserves captions and metadata without a fallback job');

  // Exercise the selectable cloud engine through real Generate/Regenerate
  // controls. The Electron boundary remains a mock, so no audio is uploaded.
  await page.select('#captionEngine', 'gemini');
  assert.equal(await page.$eval('#captionContentMode', element => element.value), 'song');
  assert.match(await page.$eval('#captionLocalModeDisclosure', element => element.textContent), /Google/);
  await page.select('#captionContentMode', 'speech');
  assert.equal(await page.$eval('#captionEngine', element => element.value), 'local');
  await page.select('#captionEngine', 'groq');
  assert.match(await page.$eval('#captionLocalModeDisclosure', element => element.textContent), /Groq/);
  assert.equal(await page.$eval('#captionGroqKeyField', element => element.classList.contains('hidden')), false);
  assert.deepEqual(await page.$eval('#captionGroqApiKey', element => ({ type: element.type, maxLength: element.maxLength, autocomplete: element.autocomplete, value: element.value })),
    { type: 'password', maxLength: 256, autocomplete: 'off', value: '' });
  passed.push('Engine selection discloses cloud audio processing; Gemini selects songs and Speech restores Local');

  await page.$eval('#captionResetBtn', element => element.click());
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().hasVideo);
  assert.equal(await page.$eval('#lcp-queue-heading', element => element.checkVisibility()), true, 'Clearing videos must retain the visible queue entry.');
  assert.equal(await page.$eval('#captionQueuePanel', element => element.checkVisibility()), false, 'An empty queue must hide inactive processing controls.');
  await videoInput.uploadFile(fixture);
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().hasVideo && document.getElementById('captionSourceVideo').readyState >= 2);
  await page.evaluate(() => {
    window.__qaGroqRequests = [];
    window.__qaGroqMode = 'success';
    window.__qaGroqCapabilityVersion = 1;
    window.__qaGroqResultText = 'Groq first result';
    window.__qaLegacyGroqCalls = 0;
    window.__qaExportCalls = 0;
    window.electronAPI.transcribeVideoGroq = async () => { window.__qaLegacyGroqCalls += 1; throw new Error('Unexpected legacy cloud route'); };
    window.electronAPI.burnCaptions = async () => { window.__qaExportCalls += 1; throw new Error('Exports are not part of this QA'); };
    window.electronAPI.transcribeVideo = async options => {
      if (options.capabilityProbe) {
        window.__qaCapabilityRequests.push(options);
        return window.__qaGroqCapabilityVersion ? { ok: true, groqSpeechTimingRepairVersion: window.__qaGroqCapabilityVersion }
          : { ok: false, error: 'No video path provided.' };
      }
      window.__qaASRCalls += 1;
      window.__qaGroqRequests.push(options);
      if (window.__qaGroqMode === 'deferred') return new Promise(resolve => { window.__qaResolveTranscription = resolve; });
      if (window.__qaGroqMode === 'error') return { ok: false, error: 'Groq API key is missing. Add it in AI Tools.' };
      if (window.__qaGroqMode === 'backwards') return { ok: true, text: 'Tiger. Fox.',
        words: [{ word: 'Tiger.', start: 38.6, end: 38.94 }, { word: 'Fox.', start: 38.48, end: 40.46 }],
        segments: [{ text: 'Tiger. Fox.', start: 38.48, end: 40.46 }], language: 'en', timingSource: 'word' };
      // Exact word boundaries from the real short-audio verification result.
      if (window.__qaGroqMode === 'repaired') return { ok: true, text: 'Tiger. Fox.',
        words: [{ word: 'Tiger.', start: 38.64, end: 39.06 }, { word: 'Fox.', start: 42.18, end: 43.24 }],
        segments: [{ text: 'Tiger.', start: 38.64, end: 39.06 }, { text: 'Fox.', start: 42.18, end: 43.24 }],
        language: 'en', timingSource: 'word', warnings: ['Groq caption timing was verified against short audio.'] };
      const text = window.__qaGroqResultText;
      const words = text.split(' ').map((word, index) => ({ word, start: 0.5 + index * 0.4, end: 0.85 + index * 0.4 }));
      return { ok: true, text, words, segments: [{ start: 0.5, end: 1.7, text }], language: 'en', timingSource: 'word' };
    };
    document.getElementById('captionActionBtn').click();
  });
  await page.waitForFunction(() => window.__qaGroqRequests.length === 1 && !window.captionLocalWorkbenchAPI.getState().disabled
    && window.captionLocalWorkbenchAPI.getState().captions.some(caption => caption.text.includes('Groq first result')));
  const firstRequest = await page.evaluate(() => window.__qaGroqRequests[0]);
  assert.equal(firstRequest.engine, 'groq');
  assert.equal(firstRequest.contentMode, 'speech');
  assert.equal(Object.hasOwn(firstRequest, 'apiKey'), false, 'A blank key must use the configured backend key.');
  assert.match(await page.$eval('#captionList', element => element.textContent + [...element.querySelectorAll('textarea')].map(input => input.value).join(' ')), /Groq first result/);
  assert.equal(await page.$eval('#captionRegenerateBtn', element => element.disabled || element.classList.contains('hidden')), false);
  assert.equal(await page.evaluate(() => window.__qaLegacyGroqCalls), 0);
  assert.equal(await page.evaluate(() => window.__qaLocalFallbackCalls), 0);
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 0);
  assert.equal(await page.evaluate(() => window.__qaCapabilityRequests.length), 0, 'Healthy repaired results must not require a backend probe or restart.');
  passed.push('Generate uses explicit Groq speech routing and updates the editor without local fallback or export');

  // Exercise actual playback after Generate, then a browser playback rejection.
  assert.equal(await page.$eval('#captionPreviewBtn', button => button.disabled), false);
  assert.equal(await page.$eval('#captionPlayPauseBtn', button => button.disabled), false);
  await page.click('#captionPreviewBtn');
  await page.waitForFunction(() => {
    const video = document.getElementById('captionSourceVideo');
    return !video.paused && video.currentTime > 0.2;
  });
  await page.waitForFunction(() => /5-second preview complete/.test(document.getElementById('captionStatusText').textContent));
  await page.evaluate(() => {
    const video = document.getElementById('captionSourceVideo');
    video.__qaOriginalPlay = video.play;
    video.play = () => Promise.reject(new DOMException('Playback blocked for QA', 'NotAllowedError'));
  });
  await page.click('#captionPreviewBtn');
  await page.waitForFunction(() => /Preview failed: Playback blocked for QA/.test(document.getElementById('captionStatusText').textContent));
  assert.equal(await page.$eval('#captionPreviewBtn', button => button.disabled), false);
  await page.evaluate(() => {
    const video = document.getElementById('captionSourceVideo');
    video.play = video.__qaOriginalPlay;
    delete video.__qaOriginalPlay;
  });
  passed.push('Preview plays after Generate and reports rejected playback without claiming success or leaving its button locked');

  await page.select('#captionContentMode', 'song');
  await setText('#captionGroqApiKey', 'gsk_qa_fake_session_key');
  await page.evaluate(() => {
    window.__qaGroqResultText = 'Jingle bells again';
    document.getElementById('captionRegenerateBtn').click();
  });
  await page.waitForFunction(() => window.__qaGroqRequests.length === 2 && !window.captionLocalWorkbenchAPI.getState().disabled
    && window.captionLocalWorkbenchAPI.getState().captions.some(caption => caption.text.includes('Jingle bells again')));
  assert.equal(await page.evaluate(() => window.__qaGroqRequests[1].engine), 'groq');
  assert.equal(await page.evaluate(() => window.__qaGroqRequests[1].contentMode), 'song');
  assert.equal(await page.evaluate(() => window.__qaGroqRequests[1].apiKey), 'gsk_qa_fake_session_key');
  assert.equal((await state()).timingSource, 'word');
  assert.equal(await page.evaluate(() => window.__qaLocalFallbackCalls), 0);
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 0);
  passed.push('Regenerate applies selected Groq to song captions with timed words and waits for review');

  const retainedCaptions = (await state()).captions;
  // Speech has local fallback paths that must remain blocked for explicit Groq.
  await page.select('#captionContentMode', 'speech');
  await page.evaluate(() => { window.__qaGroqMode = 'error'; document.getElementById('captionRegenerateBtn').click(); });
  await page.waitForFunction(() => window.__qaGroqRequests.length === 3 && !window.captionLocalWorkbenchAPI.getState().disabled);
  assert.match(await page.$eval('#captionStatusText', element => element.textContent), /Groq API key is missing/);
  assert.deepEqual((await state()).captions, retainedCaptions, 'Failed regeneration must preserve existing edits.');
  assert.equal(await page.evaluate(() => window.__qaLocalFallbackCalls), 0, 'Groq failures must not run local HTTP or browser ASR.');
  assert.equal(await page.evaluate(() => window.__qaLegacyGroqCalls), 0);
  passed.push('Groq errors remain visible, preserve existing captions and never launch a different engine');

  await page.evaluate(() => { window.__qaGroqMode = 'deferred'; document.getElementById('captionRegenerateBtn').click(); });
  await page.waitForFunction(() => window.__qaGroqRequests.length === 4 && window.captionLocalWorkbenchAPI.getState().disabled);
  for (const selector of ['#captionEngine', '#captionContentMode', '#captionRegenerateBtn', '#captionGroqApiKey', '#captionSizeSlider', '#captionEraseBtn']) {
    assert.equal(await page.$eval(selector, element => element.disabled), true, `${selector} must lock during Groq captioning.`);
  }
  await page.$eval('#captionCancelBtn', element => element.click());
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled);
  assert.deepEqual((await state()).captions, retainedCaptions, 'Cancelled regeneration must preserve existing edits.');
  assert.equal(await page.$eval('#captionEngine', element => element.disabled), false);
  assert.equal(await page.$eval('#captionRegenerateBtn', element => element.disabled), false);
  assert.equal(await page.$eval('#captionEraseBtn', element => element.disabled || !element.checkVisibility()), false);
  assert.equal(await page.$eval('#captionSizeSlider', element => element.value), '50');
  assert.equal(await page.evaluate(() => window.__qaLocalFallbackCalls), 0);
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 0);
  passed.push('Groq regeneration locks controls; cancellation preserves captions, unlocks editing and keeps font size');

  for (const [index, text] of ['I', 'Hi'].entries()) {
    await page.evaluate(value => {
      window.__qaGroqMode = 'success'; window.__qaGroqResultText = value;
      document.getElementById('captionRegenerateBtn').click();
    }, text);
    await page.waitForFunction((count, expected) => window.__qaGroqRequests.length === count && !window.captionLocalWorkbenchAPI.getState().disabled
      && window.captionLocalWorkbenchAPI.getState().captions.some(caption => caption.text === expected), {}, 5 + index, text);
    const short = (await state()).captions.find(caption => caption.text === text);
    assert.equal(short.words[0].text, text);
    assert.equal(short.words[0].start, 0.5);
    assert.equal(short.words[0].end, 0.85);
  }
  assert.equal(await page.evaluate(() => window.__qaLocalFallbackCalls), 0);
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 0);
  passed.push('Groq preserves valid one-letter and two-letter timed captions');

  const beforeMalformedTiming = await state();
  const translationsBeforeMalformedTiming = await page.evaluate(() => window.__qaTranslationRequests.length);
  await page.select('#captionLanguage', 'te');
  await page.evaluate(() => { window.__qaGroqMode = 'backwards'; document.getElementById('captionRegenerateBtn').click(); });
  await page.waitForFunction(() => window.__qaGroqRequests.length === 7 && !window.captionLocalWorkbenchAPI.getState().disabled);
  assert.deepEqual((await state()).captions, beforeMalformedTiming.captions, 'Backwards ASR timing must preserve the previous cues.');
  assert.equal((await state()).timingSource, beforeMalformedTiming.timingSource);
  assert.deepEqual((await state()).warnings, beforeMalformedTiming.warnings);
  assert.match(await page.$eval('#captionStatusText', element => element.textContent), /Speech timestamps conflict/);
  assert.doesNotMatch(await page.$eval('#captionStatusText', element => element.textContent), /Close and reopen/);
  assert.deepEqual(await page.evaluate(() => window.__qaCapabilityRequests), [{ engine: 'groq', contentMode: 'speech', capabilityProbe: true }]);
  assert.equal(await page.evaluate(() => window.__qaTranslationRequests.length), translationsBeforeMalformedTiming,
    'Malformed source timing must stop before target-language translation.');
  assert.equal(await page.evaluate(() => window.__qaLocalFallbackCalls), 0);
  assert.equal(await page.evaluate(() => window.__qaLegacyGroqCalls), 0);
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 0);
  passed.push('Backwards Fox/Tiger timing cannot replace captions, trigger translation, start a fallback or export');

  await page.evaluate(() => {
    window.__qaGroqCapabilityVersion = 0;
    document.getElementById('captionRegenerateBtn').click();
  });
  await page.waitForFunction(() => window.__qaGroqRequests.length === 8 && !window.captionLocalWorkbenchAPI.getState().disabled);
  assert.deepEqual((await state()).captions, beforeMalformedTiming.captions);
  assert.equal((await state()).timingSource, beforeMalformedTiming.timingSource);
  assert.match(await page.$eval('#captionStatusText', element => element.textContent), /Speech timestamps conflict.*Close and reopen the app to activate the Groq timing fix/);
  assert.doesNotMatch(await page.$eval('#captionStatusText', element => element.textContent), /Generate captions again/);
  assert.equal(await page.evaluate(() => window.__qaCapabilityRequests.length), 2);
  assert.equal(await page.evaluate(() => window.__qaTranslationRequests.length), translationsBeforeMalformedTiming);
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 0);
  passed.push('A rejected Groq timeline on an unconfirmed backend retains edits and shows reopen guidance without a paid retry');

  await page.evaluate(() => {
    window.__qaGroqMode = 'repaired'; window.__qaTranslationMode = 'verified-labels';
    document.getElementById('captionRegenerateBtn').click();
  });
  await page.waitForFunction(() => window.__qaGroqRequests.length === 9 && !window.captionLocalWorkbenchAPI.getState().disabled
    && window.captionLocalWorkbenchAPI.getState().captions.some(cue => cue.text === 'పులి.'));
  const repairedLabels = await state();
  assert.deepEqual(repairedLabels.captions.map(cue => [cue.text, cue.start, cue.end]),
    [['పులి.', 38.64, 39.06], ['నక్క.', 42.18, 43.24]]);
  assert.equal(repairedLabels.timingSource, 'estimated');
  assert.ok(repairedLabels.captions.every(cue => !cue.words?.length));
  assert.equal(await page.evaluate(() => window.__qaCapabilityRequests.length), 2,
    'A healthy repaired backend without the optional diagnostic route must continue without another probe or reopen.');
  const repairedRendering = await page.evaluate(() => {
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    let draws = [];
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (this.canvas.id === 'captionRenderCanvas') draws.push(String(text));
      return fillText.call(this, text, ...args);
    };
    const at = time => { draws = []; window.__qaRenderAt(time); return draws; };
    try { return { before: at(38.5), tiger: at(38.8), gap: at(40), fox: at(42.5), after: at(43.3), ass: window.__qaBuildPreviewAss() }; }
    finally { CanvasRenderingContext2D.prototype.fillText = fillText; }
  });
  assert.deepEqual(repairedRendering.before, []);
  assert.deepEqual(repairedRendering.tiger, ['పులి.']);
  assert.deepEqual(repairedRendering.gap, []);
  assert.deepEqual(repairedRendering.fox, ['నక్క.']);
  assert.deepEqual(repairedRendering.after, []);
  const assTimes = value => value.split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0);
  const repairedDialogues = repairedRendering.ass.split('\n').filter(line => line.startsWith('Dialogue:'));
  assert.equal(repairedDialogues.length, 2);
  for (const [index, cue] of repairedLabels.captions.entries()) {
    const fields = repairedDialogues[index].split(',');
    assert.ok(Math.abs(assTimes(fields[1]) - cue.start) < .011);
    assert.ok(Math.abs(assTimes(fields[2]) - cue.end) < .011);
  }
  assert.match(repairedRendering.ass, /Style: Preview,Nirmala UI,/);
  const repairedAssPath = path.join(screenshotDirectory, 'verified-tiger-fox-telugu.ass');
  fs.writeFileSync(repairedAssPath, repairedRendering.ass, 'utf8'); assFiles.push(repairedAssPath);
  await page.evaluate(() => { window.__qaTranslationMode = 'success'; });
  await page.select('#captionLanguage', 'en');
  passed.push('Verified Tiger/Fox Telugu cues preserve real speech bounds, remain blank before/between narration and match native ASS');

  // A Telugu filename and detected Telugu must not override an explicit Local
  // choice. Rename the existing synthetic File in memory, without user audio.
  await page.select('#captionEngine', 'local');
  assert.equal(await page.$eval('#captionGroqKeyField', element => element.classList.contains('hidden')), true);
  await page.select('#captionContentMode', 'speech');
  await page.evaluate(() => {
    const input = document.getElementById('captionVideoInput');
    const renamed = new File([input.files[0]], 'Lesson Telugu.mp4', { type: 'video/mp4' });
    document.getElementById('captionResetBtn').click();
    const transfer = new DataTransfer(); transfer.items.add(renamed);
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().hasVideo && document.getElementById('captionSourceVideo').readyState >= 2);
  await page.evaluate(() => {
    window.__qaLocalIndicRequests = [];
    window.electronAPI.transcribeVideo = async options => {
      window.__qaLocalIndicRequests.push(options);
      return { ok: true, text: 'జింగిల్ గంటలు', language: 'te', timingSource: 'word',
        words: [{ word: 'జింగిల్', start: 0.5, end: 1 }, { word: 'గంటలు', start: 1.1, end: 1.7 }],
        segments: [{ start: 0.5, end: 1.7, text: 'జింగిల్ గంటలు' }] };
    };
    document.getElementById('captionActionBtn').click();
  });
  await page.waitForFunction(() => window.__qaLocalIndicRequests.length === 1 && !window.captionLocalWorkbenchAPI.getState().disabled
    && window.captionLocalWorkbenchAPI.getState().captions.some(caption => caption.text.includes('English caption one')));
  assert.equal(await page.evaluate(() => window.__qaLocalIndicRequests[0].engine), 'local');
  assert.equal(await page.evaluate(() => Object.hasOwn(window.__qaLocalIndicRequests[0], 'apiKey')), false, 'A Groq session key must not be sent to Local.');
  assert.equal(await page.evaluate(() => window.__qaLegacyGroqCalls), 0, 'An Indic filename or detected language must not trigger automatic Groq.');
  assert.equal(await page.evaluate(() => window.__qaLocalFallbackCalls), 0);
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 0);
  assert.equal(await page.$eval('#captionSizeSlider', element => element.value), '50');
  assert.equal(await page.evaluate(() => window.__qaLocalIndicRequests[0].languageHint), 'auto');
  assert.equal((await state()).timingSource, 'estimated');
  assert.deepEqual((await state()).captions.map(cue => [cue.start, cue.end]), [[0.5, 1.7]]);
  passed.push('Explicit Local auto-detects Telugu speech and translates to English default with unchanged cue timing and caption size');

  // Exercise the shared translation stage through real controls. Mock only the
  // local HTTP boundary, never a caption mutation or the preview/ASS builder.
  await page.evaluate(() => {
    window.__qaScriptDraws = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (this.canvas.id === 'captionRenderCanvas') window.__qaScriptDraws.push({ text: String(text), font: this.font });
      return fillText.call(this, text, ...args);
    };
  });
  const languageBounds = (await state()).captions.map(cue => [cue.start, cue.end]);
  for (const [target, expectedText, expectedFont] of [['te', 'నమస్కారం', 'Nirmala UI'], ['hi', 'नमस्ते', 'Nirmala UI'], ['en', 'English', 'Nunito Black']]) {
    await page.select('#captionLanguage', target);
    const beforeRequests = await page.evaluate(() => window.__qaTranslationRequests.length);
    await page.click('#captionTranslateSelectedBtn');
    await page.waitForFunction((count, expected) => window.__qaTranslationRequests.length > count && !window.captionLocalWorkbenchAPI.getState().disabled
      && window.captionLocalWorkbenchAPI.getState().captions.some(cue => cue.text.includes(expected)), {}, beforeRequests, expectedText);
    const translated = await state();
    assert.deepEqual(translated.captions.map(cue => [cue.start, cue.end]), languageBounds);
    assert.equal(translated.timingSource, 'estimated');
    assert.ok(translated.captions.every(cue => !cue.words?.length), 'Translations must not retain source-language word timestamps.');
    assert.match(translated.warnings.join(' '), /estimated timing/);
    const rendering = await page.evaluate(() => {
      const api = window.captionLocalWorkbenchAPI;
      window.__qaScriptDraws = []; api.seek(api.getState().itemId, .8);
      return { draws: window.__qaScriptDraws, ass: window.__qaBuildPreviewAss() };
    });
    assert.match(rendering.ass, new RegExp(`Style: Preview,${expectedFont},`));
    const assPath = path.join(screenshotDirectory, `caption-language-${target}.ass`);
    fs.writeFileSync(assPath, rendering.ass, 'utf8'); assFiles.push(assPath);
    assert.ok(rendering.draws.some(draw => draw.font.includes(target === 'en' ? 'Pattan Caption Nunito' : 'Nirmala UI')));
    assert.equal(await page.$eval('#captionSizeSlider', element => element.value), '50');
    assert.equal(await page.$eval('#captionFontSelect', element => element.value), 'Nunito, sans-serif');
    assert.equal(await page.$eval('#captionBoldCheck', element => element.checked), true);
    await page.screenshot({ path: path.join(screenshotDirectory, `caption-language-${target}.png`), fullPage: true });
    screenshots.push(path.join(screenshotDirectory, `caption-language-${target}.png`));
  }
  passed.push('Visible English/Telugu/Hindi translation preserves cue timing, clears stale word timing and uses matching preview/export fonts without changing Nunito/bold50 controls');

  await page.evaluate(() => {
    window.__qaLanguageASRRequests = [];
    window.electronAPI.transcribeVideo = async options => {
      window.__qaLanguageASRRequests.push(options);
      const isHindi = document.getElementById('captionLanguage').value === 'en';
      const tokens = isHindi ? ['नमस्ते', 'बच्चों'] : ['Hello', 'children'];
      const text = tokens.join(' ');
      return { ok: true, text, language: isHindi ? 'hi' : 'en', timingSource: 'word',
        words: tokens.map((word, index) => ({ word, start: index ? 1.1 : .5, end: index ? 1.7 : 1 })),
        segments: [{ start: .5, end: 1.7, text }] };
    };
  });
  for (const [index, [engine, target, expectedText]] of [['local', 'en', 'English'], ['groq', 'te', 'నమస్కారం'], ['gemini', 'hi', 'नमस्ते']].entries()) {
    await page.select('#captionEngine', engine);
    await page.select('#captionLanguage', target);
    await page.click('#captionRegenerateBtn');
    await page.waitForFunction((count, expected) => window.__qaLanguageASRRequests.length === count && !window.captionLocalWorkbenchAPI.getState().disabled
      && window.captionLocalWorkbenchAPI.getState().captions.some(cue => cue.text.includes(expected)), {}, index + 1, expectedText);
    const request = await page.evaluate(index => window.__qaLanguageASRRequests[index], index);
    assert.equal(request.engine, engine);
    assert.equal(request.languageHint, 'auto', 'Output language must never force source speech recognition.');
    assert.deepEqual((await state()).captions.map(cue => [cue.start, cue.end]), languageBounds);
    assert.equal((await state()).timingSource, 'estimated');
  }
  passed.push('Local, Groq and Gemini generation all honor output language while auto-detecting source speech and retaining exact cue bounds');

  await page.$eval('#captionSyncSlider', slider => { slider.value = '200'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
  const shiftedAss = await page.evaluate(() => window.__qaBuildPreviewAss());
  const dialogueTimes = shiftedAss.split('\n').filter(line => line.startsWith('Dialogue:')).map(line => line.split(',').slice(1, 3));
  const assSeconds = value => value.split(':').map(Number).reduce((seconds, part) => seconds * 60 + part, 0);
  assert.ok(Math.abs(Math.min(...dialogueTimes.map(([start]) => assSeconds(start))) - .7) < .011);
  assert.ok(Math.abs(Math.max(...dialogueTimes.map(([, end]) => assSeconds(end))) - 1.9) < .011);
  assert.deepEqual((await state()).captions.map(cue => [cue.start, cue.end]), languageBounds);
  await page.$eval('#captionSyncSlider', slider => { slider.value = '0'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
  passed.push('Translated captions retain stored cue times and apply the selected sync offset consistently to native ASS export');

  const beforeTranslationFailure = await state();
  for (const mode of ['error', 'partial']) {
    await page.select('#captionLanguage', 'te');
    await page.evaluate(mode => { window.__qaTranslationMode = mode; document.getElementById('captionTranslateSelectedBtn').click(); }, mode);
    await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled && /preserved/.test(document.getElementById('captionStatusText').textContent));
    assert.deepEqual((await state()).captions, beforeTranslationFailure.captions);
    assert.equal((await state()).timingSource, beforeTranslationFailure.timingSource);
  }
  await page.evaluate(() => { window.__qaTranslationMode = 'deferred'; document.getElementById('captionTranslateSelectedBtn').click(); });
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().disabled && document.getElementById('captionCancelBtn').textContent === 'Stop Translation');
  for (const selector of ['#captionLanguage', '#captionEraserQuality', '#captionTranslateSelectedBtn', '#captionSizeSlider']) {
    assert.equal(await page.$eval(selector, element => element.disabled), true);
  }
  await page.click('#captionCancelBtn');
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled);
  assert.deepEqual((await state()).captions, beforeTranslationFailure.captions);
  assert.equal((await state()).timingSource, beforeTranslationFailure.timingSource);
  assert.match(await page.$eval('#captionStatusText', element => element.textContent), /cancelled.*preserved/);
  await page.evaluate(() => { window.__qaTranslationMode = 'success'; });
  await page.select('#captionLanguage', 'en');
  passed.push('Translation provider errors, partial results and real Cancel preserve captions/provenance, unlock controls and do not apply late responses');

  await page.select('#captionEngine', 'groq');
  await page.select('#captionContentMode', 'song');
  await page.evaluate(() => {
    const input = document.getElementById('captionVideoInput');
    const current = input.files[0];
    document.getElementById('captionResetBtn').click();
    const transfer = new DataTransfer();
    for (const name of ['Queue one.mp4', 'Queue two.mp4']) transfer.items.add(new File([current], name, { type: 'video/mp4' }));
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll('#captionQueueList > div').length === 2
    && document.getElementById('captionSourceVideo').readyState >= 2);
  assert.equal(await page.$eval('#captionQueuePanel', element => element.checkVisibility()), true, 'Selecting multiple videos must reveal the queue.');
  assert.equal(await page.$eval('#captionQueueRunBtn', element => element.checkVisibility()), true, 'The two-video Start Queue action must be visible.');
  const notificationsBeforeQueue = await page.evaluate(() => window.__qaNotifications);
  await page.evaluate(() => {
    window.__qaQueueGroqRequests = [];
    window.__qaQueueCancellations = 0;
    window.electronAPI.transcribeVideo = async options => {
      window.__qaQueueGroqRequests.push(options);
      return new Promise(resolve => { window.__qaResolveQueuedTranscription = resolve; });
    };
    window.electronAPI.cancelTranscribeVideo = async options => {
      window.__qaQueueCancellations += 1;
      window.__qaQueueCancelOptions = options;
      window.__qaResolveQueuedTranscription?.({ ok: false, cancelled: true });
      return { ok: true, cancelled: true };
    };
    document.getElementById('captionQueueRunBtn').click();
  });
  await page.waitForFunction(() => window.__qaQueueGroqRequests.length === 1 && window.captionLocalWorkbenchAPI.getState().disabled);
  assert.equal(await page.$eval('#captionCancelBtn', element => element.disabled || element.classList.contains('hidden')), false, 'The pending queue transcription must expose Stop.');
  assert.equal(await page.$eval('#captionEngine', element => element.disabled), true);
  assert.equal(await page.$eval('#captionGroqApiKey', element => element.disabled), true);
  assert.equal(await page.$eval('#captionEraseBtn', element => element.disabled && element.checkVisibility()), true, 'The running queue must disable the visible eraser.');
  await page.$eval('#captionCancelBtn', element => element.click());
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled);
  assert.equal(await page.evaluate(() => window.__qaQueueCancellations), 1);
  assert.equal(await page.evaluate(() => window.__qaQueueCancelOptions.engine), 'groq');
  assert.equal(await page.evaluate(() => window.__qaQueueGroqRequests.length), 1, 'Cancelling must not start a paid request for the next queued video.');
  const queueRows = await page.$$eval('#captionQueueList > div > button:first-child', elements => elements.map(element => ({ disabled: element.disabled, text: element.textContent })));
  assert.equal(queueRows.length, 2);
  assert.ok(queueRows.every(row => !row.disabled && / - ready$/.test(row.text)), 'Both queue videos must unlock and remain ready after cancellation.');
  assert.equal(await page.evaluate(() => window.__qaLocalFallbackCalls), 0);
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 0);
  assert.equal(await page.evaluate(() => window.__qaNotifications), notificationsBeforeQueue);
  assert.equal(await page.$eval('#captionSizeSlider', element => element.value), '50');
  passed.push('Two-video Groq queue cancels its pending request, stops before the next request and unlocks without exporting');
  assert.equal(await page.$eval('#captionEraseBtn', element => element.disabled || !element.checkVisibility()), false, 'Cancelling the queue must restore the eraser.');

  await page.select('#captionLanguage', 'te');
  await page.evaluate(() => {
    window.__qaQueueTranslationASRRequests = [];
    window.__qaTranslationMode = 'deferred';
    window.electronAPI.transcribeVideo = async options => {
      window.__qaQueueTranslationASRRequests.push(options);
      return { ok: true, text: 'Hello children', language: 'en', timingSource: 'word',
        words: [{ word: 'Hello', start: .5, end: 1 }, { word: 'children', start: 1.1, end: 1.7 }],
        segments: [{ start: .5, end: 1.7, text: 'Hello children' }] };
    };
    document.getElementById('captionQueueRunBtn').click();
  });
  await page.waitForFunction(() => window.__qaQueueTranslationASRRequests.length === 1 && window.captionLocalWorkbenchAPI.getState().disabled
    && document.getElementById('captionCancelBtn').textContent === 'Stop Translation');
  await page.click('#captionCancelBtn');
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled);
  assert.equal(await page.evaluate(() => window.__qaQueueTranslationASRRequests.length), 1);
  assert.equal(await page.evaluate(() => window.__qaQueueCancellations), 1, 'Translation Cancel must not cancel a finished or unrelated ASR job.');
  assert.equal((await state()).captions.length, 0);
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 0);
  assert.ok((await page.$$eval('#captionQueueList > div > button:first-child', elements => elements.map(element => element.textContent)))
    .every(text => / - ready$/.test(text)));
  passed.push('Cancelling queue translation aborts applying text, stops before the next video and avoids a backend cancel for completed ASR');

  await page.select('#captionLanguage', 'hi');
  await page.evaluate(() => { window.__qaTranslationMode = 'success'; document.getElementById('captionQueueRunBtn').click(); });
  await page.waitForFunction(() => window.__qaQueueTranslationASRRequests.length === 3 && !window.captionLocalWorkbenchAPI.getState().disabled
    && document.getElementById('captionQueueStatus').textContent.includes('Captions 2/2'));
  const successfulQueueRequests = await page.evaluate(() => window.__qaQueueTranslationASRRequests.slice(1));
  assert.ok(successfulQueueRequests.every(request => request.engine === 'groq' && request.languageHint === 'auto'));
  for (let index = 0; index < 2; index++) {
    await page.$$eval('#captionQueueList > div > button:first-child', (buttons, index) => buttons[index].click(), index);
    await page.waitForFunction(() => document.getElementById('captionSourceVideo').readyState >= 2 && !window.captionLocalWorkbenchAPI.getState().disabled);
    const selected = await state();
    assert.equal(selected.captions[0].text, 'नमस्ते बच्चों');
    assert.deepEqual(selected.captions.map(cue => [cue.start, cue.end]), [[.5, 1.7]]);
    assert.equal(selected.timingSource, 'estimated');
    assert.ok(selected.captions.every(cue => !cue.words?.length));
  }
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 0, 'Song queue must remain at review after translation.');
  assert.equal(await page.$eval('#captionSizeSlider', element => element.value), '50');
  passed.push('A complete two-video queue applies Hindi output to every video while preserving cue bounds, estimated timing and the review-before-export song flow');
  await page.$eval('#captionResetBtn', element => element.click());
  await videoInput.uploadFile(fixture);
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().hasVideo && document.getElementById('captionSourceVideo').readyState >= 2);
  await page.select('#captionContentMode', 'speech');
  await page.select('#captionLanguage', 'te');
  const translationsBeforeFailedQueue = await page.evaluate(() => window.__qaTranslationRequests.length);
  await page.evaluate(() => {
    window.__qaFailedQueueASR = []; window.__qaFailedQueueProbes = [];
    window.electronAPI.transcribeVideo = async request => {
      if (request.capabilityProbe) { window.__qaFailedQueueProbes.push(request); return { ok: false, error: 'No video path provided.' }; }
      window.__qaFailedQueueASR.push(request);
      return { ok: true, language: 'en', text: 'Tiger. Fox.', timingSource: 'word',
        words: [{ word: 'Tiger.', start: 38.6, end: 38.94 }, { word: 'Fox.', start: 38.48, end: 40.46 }] };
    };
    document.getElementById('captionQueueRunBtn').click();
  });
  await page.waitForFunction(() => window.__qaFailedQueueASR.length === 1 && !window.captionLocalWorkbenchAPI.getState().disabled
    && document.getElementById('captionStatusText').textContent.includes('Close and reopen'));
  assert.equal(await page.evaluate(() => window.__qaFailedQueueASR.length), 1, 'A timing failure must not repeat paid ASR.');
  assert.deepEqual(await page.evaluate(() => window.__qaFailedQueueProbes), [{ engine: 'groq', contentMode: 'speech', capabilityProbe: true }]);
  assert.match(await page.$eval('#captionStatusText', element => element.textContent), /Exported 0\/1.*Speech timestamps conflict.*Close and reopen/);
  assert.match(await page.$eval('#captionStatusText', element => element.textContent), /No export started\./);
  assert.match(await page.$eval('#captionQueueList', element => element.textContent), /Speech timestamps conflict.*Close and reopen/);
  assert.equal(await page.evaluate(() => window.__qaTranslationRequests.length), translationsBeforeFailedQueue);
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 0);
  assert.equal((await state()).hasVideo, true);
  assert.equal(await page.$$eval('#captionQueueList > div', rows => rows.length), 1, 'The failed video must remain in its queue.');
  passed.push('A failed queue retains its video and shows the full timing/reopen reason after completion without retry, translation or export');
  await page.$eval('#captionResetBtn', element => element.click());
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().hasVideo);
  assert.equal(await page.$eval('#captionEraseBtn', element => element.checkVisibility() && element.disabled
    && !!element.closest('.lcp-source-card') && !element.closest('.lcp-disclosure')), true,
  'Clearing a video must retain the visible Source eraser and disable it until the next upload.');
  assert.equal(await page.$eval('#lcp-queue-heading', element => element.checkVisibility()), true);
  passed.push('Eraser stays visible while busy, re-enables after transcription/queue cancellation and remains available after clearing the video');

  await videoInput.uploadFile(fixture);
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().hasVideo && document.getElementById('captionSourceVideo').readyState >= 2);
  await page.select('#captionEngine', 'local');
  await page.select('#captionLanguage', 'en');
  await page.evaluate(() => {
    const api = window.captionLocalWorkbenchAPI;
    api.applyCaptions(api.getState().itemId, [{ start: .5, end: 1.7, text: 'Reviewed caption', words: [] }]);
    window.__qaNativeFailures = 0;
    window.electronAPI.transcribeVideo = async () => {
      window.__qaNativeFailures++;
      return { ok: false, code: 'CAPTION_TIMING_UNCERTAIN', error: 'Opening audio timing needs review.' };
    };
  });
  const retained = (await state()).captions;
  const fallbackBefore = await page.evaluate(() => window.__qaLocalFallbackCalls);
  await page.$eval('#captionActionBtn', element => element.click());
  await page.waitForFunction(() => window.__qaNativeFailures === 1 && !window.captionLocalWorkbenchAPI.getState().disabled);
  assert.deepEqual((await state()).captions, retained);
  assert.equal(await page.evaluate(() => window.__qaLocalFallbackCalls), fallbackBefore);
  assert.match(await page.$eval('#captionStatusText', element => element.textContent), /Opening audio timing needs review/);
  assert.equal(await page.$eval('#captionSingleLiveStatus', element => element.checkVisibility()), false,
    'A failed single transcription must hide its obsolete Active now spinner.');
  assert.equal(await page.$eval('#captionProgressBarValue', element => element.style.width), '0%');
  passed.push('Native timing failures retain reviewed captions and never launch a hidden weaker transcription engine');

  await page.evaluate(() => {
    window.__qaIncompleteNarration = 0;
    window.electronAPI.transcribeVideo = async () => {
      window.__qaIncompleteNarration++;
      return { ok: true, language: 'en', text: 'Hello. A short example sentence.',
        words: [{ word: 'Hello.', start: .5, end: 1 }],
        segments: [{ text: 'Hello.', start: .5, end: 1 }, { text: 'A short example sentence.', start: 2, end: 3 }] };
    };
  });
  await page.$eval('#captionActionBtn', element => element.click());
  await page.waitForFunction(() => window.__qaIncompleteNarration === 1 && !window.captionLocalWorkbenchAPI.getState().disabled);
  assert.deepEqual((await state()).captions, retained);
  assert.equal(await page.evaluate(() => window.__qaLocalFallbackCalls), fallbackBefore);
  assert.match(await page.$eval('#captionStatusText', element => element.textContent), /missing sentences/);
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 0);
  passed.push('Partial narration word timing preserves reviewed captions and cannot silently remove an example sentence');

  await page.$eval('#captionResetBtn', element => element.click());
  await videoInput.uploadFile(fixture);
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().hasVideo && document.getElementById('captionSourceVideo').readyState >= 2);
  await page.$eval('#captionQueueRunBtn', element => element.click());
  await page.waitForFunction(() => window.__qaIncompleteNarration === 2 && !window.captionLocalWorkbenchAPI.getState().disabled
    && document.getElementById('captionStatusText').textContent.includes('missing sentences'));
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 0);
  assert.equal((await state()).captions.length, 0);
  assert.match(await page.$eval('#captionQueueList', element => element.textContent), /missing sentences/);
  passed.push('A queue cannot export only the timed fragment of an incomplete narration transcript');

  await page.$eval('#captionResetBtn', element => element.click());
  await videoInput.uploadFile(fixture);
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().hasVideo && document.getElementById('captionSourceVideo').readyState >= 2);
  await page.select('#captionContentMode', 'speech');
  const translationsBeforeImportedDraft = await page.evaluate(() => window.__qaTranslationRequests.length);
  await page.evaluate(() => {
    const api = window.captionLocalWorkbenchAPI;
    api.applyCaptions(api.getState().itemId, [{ start: .5, end: 1.7, text: 'Reviewed caption', words: [
      { text: 'Reviewed', start: .5, end: 1 }, { text: 'caption', start: 1, end: 1.7 },
    ] }], { sourceLanguage: 'English', outputLanguage: 'en', timingSource: 'word', warnings: [] });
    window.__qaUnexpectedASR = 0;
    window.electronAPI.transcribeVideo = async () => { window.__qaUnexpectedASR++; throw new Error('Saved draft must not rerun ASR'); };
    window.__qaTranslationMode = 'error';
    window.electronAPI.burnCaptions = async request => {
      window.__qaExportCalls++; window.__qaLastBurnCaptions = request.captions;
      return { ok: true, fileName: 'qa-captioned.mp4' };
    };
    document.getElementById('captionQueueRunBtn').click();
  });
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled
    && document.getElementById('captionQueueStatus').textContent.includes('Exported 1/1'));
  assert.equal(await page.evaluate(() => window.__qaUnexpectedASR), 0);
  assert.equal(await page.evaluate(() => window.__qaTranslationRequests.length), translationsBeforeImportedDraft,
    'A declared English draft must not depend on the unavailable translation service.');
  assert.equal((await state()).sourceLanguage, 'en');
  assert.equal((await state()).outputLanguage, 'en');
  assert.equal(await page.$eval('#captionSingleLiveStatus', element => element.checkVisibility()), false);
  assert.match(await page.$eval('#captionStatusText', element => element.textContent), /Queue complete.*1\/1/);
  passed.push('A declared English Local draft exports through the real queue without new ASR, translation requests or a stale single progress spinner');

  await page.$eval('#captionResetBtn', element => element.click());
  await videoInput.uploadFile(fixture);
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().hasVideo && document.getElementById('captionSourceVideo').readyState >= 2);
  await page.evaluate(() => {
    const api = window.captionLocalWorkbenchAPI;
    api.applyCaptions(api.getState().itemId, [{ start: .5, end: 1.7, text: 'नमस्ते बच्चों', words: [] }],
      { sourceLanguage: 'hi', outputLanguage: 'hi', timingSource: 'estimated', warnings: ['Review wording'] });
    document.getElementById('captionQueueRunBtn').click();
  });
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled
    && document.getElementById('captionStatusText').textContent.includes('Failed 1'));
  assert.equal((await state()).captions[0].text, 'नमस्ते बच्चों');
  assert.equal((await state()).outputLanguage, 'hi');
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 1);
  assert.match(await page.$eval('#captionQueueList', element => element.textContent), /failed.*translation provider unavailable.*no export started/i);
  assert.doesNotMatch(await page.$eval('#captionStatusText', element => element.textContent), /Queue complete/);
  passed.push('A saved draft translation failure retains captions and language, reports Failed 1 and cannot silently claim export completion');
  await page.evaluate(() => { window.__qaTranslationMode = 'success'; document.getElementById('captionQueueRunBtn').click(); });
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled
    && document.getElementById('captionQueueStatus').textContent.includes('Exported 1/1'));
  assert.equal(await page.evaluate(() => window.__qaUnexpectedASR), 0);
  assert.equal(await page.evaluate(() => window.__qaExportCalls), 2);
  assert.equal((await state()).outputLanguage, 'en');
  passed.push('Retrying a retained draft after translation recovers exports it without discarding the draft or rerunning speech recognition');

  await page.$eval('#captionResetBtn', element => element.click());
  await videoInput.uploadFile(...Array(8).fill(fixture));
  await page.waitForFunction(() => document.querySelectorAll('#captionQueueList > div').length === 8
    && document.getElementById('captionSourceVideo').readyState >= 2);
  await page.select('#captionEngine', 'groq');
  await page.select('#captionContentMode', 'speech');
  await page.select('#captionLanguage', 'en');
  assert.equal(await page.$eval('#captionGroqLocalRecovery', element => element.checked), false);
  assert.equal(await page.$eval('#captionGroqRecoveryField', element => element.checkVisibility()), true);
  await page.evaluate(() => {
    window.__qaRecoveryRequests = [];
    window.__qaRecoveryExports = [];
    window.__qaRecoveryValid = { ok: true, engine: 'groq', language: 'en', text: 'Reviewed caption.',
      words: [{ word: 'Reviewed', start: .5, end: 1 }, { word: 'caption.', start: 1, end: 1.7 }],
      timingSource: 'word', warnings: [] };
    window.electronAPI.transcribeVideo = async options => {
      window.__qaRecoveryRequests.push(options);
      if (window.__qaRecoveryRequests.length === 3) return { ok: false, engine: 'groq', code: 'CAPTION_GROQ_RATE_LIMIT',
        providerHttpStatus: 429, retryAfterMs: 3600000, retryAt: Date.now() + 3600000, error: 'Groq quota reached.' };
      return { ...window.__qaRecoveryValid, engine: options.engine };
    };
    window.electronAPI.burnCaptions = async options => {
      window.__qaRecoveryExports.push(options);
      return { ok: true, fileName: `qa-recovery-${window.__qaRecoveryExports.length}.mp4` };
    };
    document.getElementById('captionQueueRunBtn').click();
  });
  await page.waitForFunction(() => window.__qaRecoveryRequests.length === 3 && !window.captionLocalWorkbenchAPI.getState().disabled
    && document.getElementById('captionStatusText').textContent.includes('Queue paused'));
  const pausedQueue = await page.$eval('#captionQueueList', element => element.textContent);
  assert.equal((pausedQueue.match(/ - exported/g) || []).length, 2);
  assert.equal((pausedQueue.match(/ - waiting/g) || []).length, 1);
  assert.equal((pausedQueue.match(/ - ready/g) || []).length, 5);
  assert.equal(await page.evaluate(() => window.__qaRecoveryExports.length), 2);
  assert.match(await page.$eval('#captionStatusText', element => element.textContent), /Queue paused\. Exported 2\/8.*Wait.*Local.*preserved/);
  assert.equal(await page.$eval('#captionQueueLiveStatus', element => element.checkVisibility()), false);
  assert.equal(await page.$eval('#captionSingleLiveStatus', element => element.checkVisibility()), false);
  assert.equal(await page.$eval('#captionQueueRunBtn', element => element.disabled), true);
  await page.$eval('#captionQueueRunBtn', element => element.dispatchEvent(new Event('click')));
  assert.equal(await page.evaluate(() => window.__qaRecoveryRequests.length), 3, 'Even a programmatic retry must honor the cooldown.');
  passed.push('Terminal Groq quota pauses an eight-video queue after two exports, preserves five unattempted videos and prevents all early retries without a stale spinner');

  await page.$eval('#captionGroqLocalRecovery', element => { element.checked = true; element.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await page.$eval('#captionQueueRunBtn', element => element.disabled), false);
  await page.$eval('#captionQueueRunBtn', element => element.click());
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled
    && document.getElementById('captionQueueStatus').textContent.includes('Exported 8/8'));
  assert.equal(await page.evaluate(() => window.__qaRecoveryRequests.length), 9);
  assert.deepEqual(await page.evaluate(() => window.__qaRecoveryRequests.slice(3).map(request => request.engine)), Array(6).fill('local'));
  assert.equal(await page.evaluate(() => window.__qaRecoveryExports.length), 8, 'Successful Groq exports must not be repeated.');
  assert.equal((await page.$eval('#captionQueueList', element => element.textContent)).match(/Local recovery from Groq/g).length, 6);
  await page.$eval('#captionQueueList > div:first-child > button', element => element.click());
  assert.equal((await state()).engine, 'groq', 'The two existing successful Groq results keep their true provenance.');
  passed.push('Opting into Local recovery finishes all six remaining videos during Groq cooldown, labels every recovered row and preserves the two successful Groq exports');

  await page.$eval('#captionResetBtn', element => element.click());
  await videoInput.uploadFile(fixture);
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().hasVideo && document.getElementById('captionSourceVideo').readyState >= 2);
  await page.evaluate(() => {
    window.__qaSingleRecoveryRequests = [];
    window.electronAPI.transcribeVideo = async options => {
      window.__qaSingleRecoveryRequests.push(options);
      return options.engine === 'groq' ? { ok: false, code: 'CAPTION_GROQ_TIMING_UNCERTAIN', error: 'Word boundaries uncertain.' }
        : { ...window.__qaRecoveryValid, engine: 'local' };
    };
    document.getElementById('captionActionBtn').click();
  });
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled && window.captionLocalWorkbenchAPI.getState().captions.length > 0);
  assert.equal((await state()).engine, 'local');
  assert.equal((await state()).recoveredFromEngine, 'groq');
  assert.match((await state()).warnings.join(' '), /Local recovery.*Groq.*Review/);
  assert.match(await page.$eval('#captionStatusText', element => element.textContent), /Local recovery from Groq/);
  const beforeRecoveryCancel = await state();
  await page.evaluate(() => {
    window.electronAPI.transcribeVideo = options => {
      window.__qaSingleRecoveryRequests.push(options);
      return new Promise(resolve => { window.__qaResolveTranscription = resolve; });
    };
    window.electronAPI.cancelTranscribeVideo = async options => {
      window.__qaRecoveryCancelEngine = options.engine;
      window.__qaResolveTranscription?.({ ok: false, cancelled: true });
      return { ok: true, cancelled: true };
    };
    document.getElementById('captionRegenerateBtn').click();
  });
  await page.waitForFunction(() => window.captionLocalWorkbenchAPI.getState().disabled && document.getElementById('captionSingleLiveStatus').textContent.includes('Local recovery'))
    .catch(async error => {
      console.error(await page.evaluate(() => ({ disabled: window.captionLocalWorkbenchAPI.getState().disabled,
        requests: window.__qaSingleRecoveryRequests, engine: document.getElementById('captionEngine').value,
        recovery: document.getElementById('captionGroqLocalRecovery').checked,
        regenerateDisabled: document.getElementById('captionRegenerateBtn').disabled,
        status: document.getElementById('captionStatusText').textContent,
        phase: document.getElementById('captionSingleLiveStatus').textContent })));
      throw error;
    });
  await page.$eval('#captionCancelBtn', element => element.click());
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled);
  assert.deepEqual((await state()).captions, beforeRecoveryCancel.captions);
  assert.equal((await state()).engine, 'local');
  assert.equal((await state()).recoveredFromEngine, 'groq');
  assert.equal(await page.evaluate(() => window.__qaRecoveryCancelEngine), 'local');
  assert.equal(await page.$eval('#captionSingleLiveStatus', element => element.checkVisibility()), false);
  passed.push('Single-video generation uses the same explicit Local recovery with visible provenance; cancelling regeneration preserves captions and removes the recovery spinner');

  const retainedBeforeMalformedRecovery = await state();
  const exportedBeforeMalformedRecovery = await page.evaluate(() => window.__qaRecoveryExports.length);
  await page.evaluate(() => {
    window.__qaMalformedRecoveryRequests = [];
    window.electronAPI.transcribeVideo = async options => {
      window.__qaMalformedRecoveryRequests.push(options);
      const duration = document.getElementById('captionSourceVideo').duration;
      return { ok: true, engine: 'local', language: 'en', text: 'Hello.',
        words: [{ word: 'Hello.', start: duration - 1, end: duration + 1 }], timingSource: 'word' };
    };
    document.getElementById('captionRegenerateBtn').click();
  });
  await page.waitForFunction(() => window.__qaMalformedRecoveryRequests.length > 0 && !window.captionLocalWorkbenchAPI.getState().disabled
    && document.getElementById('captionStatusText').textContent.includes('within the video'));
  assert.equal(await page.evaluate(() => window.__qaMalformedRecoveryRequests.length), 1, 'A Local validation failure must not run another engine or a Groq restart probe.');
  assert.equal(await page.evaluate(() => window.__qaMalformedRecoveryRequests[0].engine), 'local');
  assert.deepEqual((await state()).captions, retainedBeforeMalformedRecovery.captions);
  assert.deepEqual((await state()).warnings, retainedBeforeMalformedRecovery.warnings);
  assert.equal((await state()).engine, 'local');
  assert.equal(await page.evaluate(() => window.__qaRecoveryExports.length), exportedBeforeMalformedRecovery);
  assert.equal(await page.$eval('#captionSingleLiveStatus', element => element.checkVisibility()), false);
  assert.doesNotMatch(await page.$eval('#captionStatusText', element => element.textContent), /Close and reopen/);
  passed.push('Out-of-video Local recovery timestamps cannot replace reviewed captions, trigger export or show an unrelated Groq restart suggestion');

  const provenanceProof = await page.evaluate(() => {
    const api = window.captionLocalWorkbenchAPI;
    const current = api.getState();
    api.applyCaptions(current.itemId, current.captions, { engine: 'groq', sourceLanguage: 'en', outputLanguage: 'en',
      timingSource: 'word', warnings: ['Verified saved Groq draft'] });
    const imported = api.getState();
    api.applyCaptions(imported.itemId, imported.captions);
    const manuallyEdited = api.getState();
    let rejected = false;
    try { api.applyCaptions(imported.itemId, imported.captions, { engine: 'groq', recoveredFromEngine: 'groq' }); }
    catch (_) { rejected = true; }
    return { imported: { engine: imported.engine, recovery: imported.recoveredFromEngine, warnings: imported.warnings },
      manuallyEdited: { engine: manuallyEdited.engine, recovery: manuallyEdited.recoveredFromEngine },
      rejected, unchanged: JSON.stringify(api.getState()) === JSON.stringify(manuallyEdited),
      requests: window.__qaMalformedRecoveryRequests.length };
  });
  assert.equal(provenanceProof.imported.engine, 'groq');
  assert.equal(provenanceProof.imported.recovery, undefined);
  assert.deepEqual(provenanceProof.imported.warnings, ['Verified saved Groq draft']);
  assert.equal(provenanceProof.manuallyEdited.engine, 'groq');
  assert.equal(provenanceProof.manuallyEdited.recovery, undefined);
  assert.equal(provenanceProof.rejected, true);
  assert.equal(provenanceProof.unchanged, true);
  assert.equal(provenanceProof.requests, 1, 'Importing verified caption drafts must not call ASR.');
  assert.doesNotMatch(await page.$eval('#captionQueueList', element => element.textContent), /Local recovery from Groq/);
  passed.push('Verified saved Groq captions retain explicit Groq provenance in getState and manual edits, clear old Local recovery labels and reject inconsistent metadata without ASR');

  // A fresh isolated page avoids inheriting the intentional terminal-quota
  // cooldown exercised above. No desktop app or provider requests are involved.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#captionVideoInput');
  await page.addScriptTag({ url: origin + '/caption-script.js' });
  await page.waitForFunction(() => !!window.captionLocalWorkbenchAPI);
  await (await page.$('#captionVideoInput')).uploadFile(...Array(8).fill(fixture));
  await page.waitForFunction(() => document.querySelectorAll('#captionQueueList > div').length === 8
    && document.getElementById('captionSourceVideo').readyState >= 2);
  await page.select('#captionEngine', 'groq');
  await page.select('#captionContentMode', 'speech');
  await page.select('#captionLanguage', 'en');
  await page.$eval('#captionGroqLocalRecovery', element => { element.checked = false; element.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.evaluate(() => {
    window.__qaOptionalRequests = [];
    window.__qaOptionalExports = [];
    window.electronAPI.transcribeVideo = async options => {
      window.__qaOptionalRequests.push(options);
      return { ok: true, engine: options.engine, language: 'en', text: 'Usable Groq caption.',
        words: [{ word: 'Usable', start: .5, end: .8 }, { word: 'Groq', start: .8, end: 1.2 }, { word: 'caption.', start: 1.2, end: 1.7 }],
        timingSource: 'word', warnings: window.__qaOptionalRequests.length === 2
          ? ['Optional recognition check was limited. Review words and synchronization.'] : [],
        ...(window.__qaOptionalRequests.length === 2 ? { rateLimit: {
          code: 'CAPTION_GROQ_RATE_LIMIT', engine: 'groq', providerHttpStatus: 429,
          retryAfterMs: 3600000, retryAt: Date.now() + 3600000, retryAfterEstimated: false,
        } } : {}) };
    };
    window.electronAPI.burnCaptions = async options => {
      window.__qaOptionalExports.push(options);
      return { ok: true, fileName: `qa-optional-quota-${window.__qaOptionalExports.length}.mp4` };
    };
    document.getElementById('captionQueueRunBtn').click();
  });
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled
    && document.getElementById('captionStatusText').textContent.includes('Queue paused'));
  assert.equal(await page.evaluate(() => window.__qaOptionalRequests.length), 2, 'The next clip must not make a Groq request after optional-check quota.');
  assert.equal(await page.evaluate(() => window.__qaOptionalExports.length), 2, 'The current usable Groq result must export before pausing later clips.');
  const optionalPausedQueue = await page.$eval('#captionQueueList', element => element.textContent);
  assert.equal((optionalPausedQueue.match(/ - exported/g) || []).length, 2);
  assert.equal((optionalPausedQueue.match(/ - waiting/g) || []).length, 1);
  assert.equal((optionalPausedQueue.match(/ - ready/g) || []).length, 5);
  assert.doesNotMatch(optionalPausedQueue, /Local recovery from Groq/);
  assert.equal(await page.$eval('#captionQueueRunBtn', element => element.disabled), true);
  await page.$eval('#captionQueueList > div:nth-child(2) > button', element => element.click());
  assert.equal((await state()).engine, 'groq');
  assert.equal((await state()).recoveredFromEngine, undefined);
  assert.equal((await state()).timingSource, 'word');
  assert.match((await state()).warnings.join(' '), /Optional recognition check was limited.*Review/);
  await page.$eval('#captionQueueRunBtn', element => element.dispatchEvent(new Event('click')));
  assert.equal(await page.evaluate(() => window.__qaOptionalRequests.length), 2);
  passed.push('A successful Groq result with optional-check quota exports as Groq, retains the review warning, then pauses remaining clips without another provider request');

  await page.$eval('#captionGroqLocalRecovery', element => { element.checked = true; element.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#captionQueueRunBtn', element => element.click());
  await page.waitForFunction(() => !window.captionLocalWorkbenchAPI.getState().disabled
    && document.getElementById('captionQueueStatus').textContent.includes('Exported 8/8'));
  assert.deepEqual(await page.evaluate(() => window.__qaOptionalRequests.map(request => request.engine)), ['groq', 'groq', ...Array(6).fill('local')]);
  assert.equal(await page.evaluate(() => window.__qaOptionalExports.length), 8);
  assert.equal((await page.$eval('#captionQueueList', element => element.textContent)).match(/Local recovery from Groq/g).length, 6);
  await page.$eval('#captionQueueList > div:nth-child(2) > button', element => element.click());
  assert.equal((await state()).engine, 'groq');
  assert.match((await state()).warnings.join(' '), /Optional recognition check was limited/);
  passed.push('After optional-check quota, explicit Local recovery applies only to later clips and never redoes or relabels the two completed Groq exports');

  assert.deepEqual(errors, [], 'No page-level JavaScript errors');
  console.log(JSON.stringify({ passed: passed.length, checks: passed, screenshots, assFiles }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; })
  .finally(async () => {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (fixtureDirectory) {
      const absolute = path.resolve(fixtureDirectory);
      const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
      if (!absolute.startsWith(temporaryRoot) || !path.basename(absolute).startsWith('caption-local-qa-')) {
        throw new Error('Refusing to remove a QA fixture directory outside the temporary workspace.');
      }
      fs.rmSync(absolute, { recursive: true, force: true });
    }
  });
