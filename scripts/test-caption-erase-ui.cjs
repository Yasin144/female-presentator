'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'caption-script.js'), 'utf8');
const functions = new Map();
let eraseCallback;
traverse(parser.parse(source), {
  FunctionDeclaration(p) { functions.set(p.node.id.name, source.slice(p.node.start, p.node.end)); },
  CallExpression(p) {
    if (p.node.callee.type === 'MemberExpression' && p.node.callee.object.name === 'eraseBtn' && p.node.callee.property.name === 'addEventListener') {
      const callback = p.node.arguments[1];
      eraseCallback = source.slice(callback.start, callback.end);
    }
  },
});
assert.ok(eraseCallback);
function element() {
  const classes = new Set();
  return { disabled: false, textContent: '', innerHTML: 'Edited captions', style: {},
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle(c, on) { if (on) classes.add(c); else classes.delete(c); } },
    querySelectorAll: () => [], addEventListener() {}, appendChild() {}, };
}
function harness(result, options = {}) {
  const original = { file: { name: 'original.mp4', type: 'video/mp4', path: 'D:\\original.mp4' },
    status: 'transcribed', captions: [{ text: 'Edited caption', timestamp: [0, 2] }],
    outputPath: 'D:\\captioned.mp4', outputFileName: 'captioned.mp4', progress: 100 };
  const elements = new Map();
  const controls = ['videoInput', 'actionBtn', 'resetBtn', 'previewBtn', 'exportBtn', 'eraseBtn', 'queueRunBtn', 'queueExportAllBtn', 'queuePrevBtn', 'queueNextBtn', 'viralShortBtn'];
  const calls = { notifications: [], unsubscribe: 0, requests: [], renders: 0, progress: [], localStates: [] };
  const api = { isMobileRemote: options.mobile || false,
    eraseCaptions: async args => { calls.requests.push(args); return typeof result === 'function' ? result(args) : result; },
    onCaptionEraseProgress: cb => { calls.onProgress = cb; return () => { calls.unsubscribe++; }; },
  };
  const context = { console: { warn() {}, error() {} },
    document: { getElementById(id) { return elements.get(id) || null; }, createElement: () => element(), querySelectorAll: () => [] },
    window: { electronAPI: api, updateTaskProgressUi: (...args) => calls.progress.push(args) },
    captionVideoQueue: [original], captionQueueIndex: 0, activeFile: original.file,
    generatedCaptions: original.captions.slice(), isErasingCaptions: false, isExtractingText: false,
    isRecording: false, captionQueueRunning: false, captionQueueExporting: false,
    captionTranslationBusy: false, captionPreviewSpeed: 1, captionPreviewLoop: null,
    videoUrl: 'file:///D:/original.mp4', autoBurnRequested: true, audioDataArray: [1, 2], hasDrawnFirstFrame: true,
    clearPreviewFrameHandle() {},
    sourceVideo: { src: 'file:///D:/original.mp4', pause() {}, removeAttribute() {}, load() {}, addEventListener() {} },
    renderCanvas: { width: 640, height: 360, getContext: () => ({ clearRect() {} }) },
    renderCaptionQueue() { calls.renders++; },
    setQueueItemState(index, patch) { context.captionVideoQueue[index] = { ...context.captionVideoQueue[index], ...patch }; },
    setCaptionProgressBar(pct) { calls.progress.push(pct); }, renderSingleCaptionProgress() {}, hideSingleCaptionProgress() {},
    setCaptionExportActionsVisible(visible) { calls.exportActionsVisible = visible; },
    renderCaptionExportActions() {},
    // Publishing is an external UI boundary. Keep the actual production busy
    // predicate and source identity/loop helpers below; observe publication only.
    publishCaptionLocalState() {
      calls.localStates.push({ disabled: context.captionLocalBusy(), source: context.activeFile?.path,
        captions: context.generatedCaptions.map(caption => ({ ...caption })) });
    },
    notifyCaptionStudio(title, body) { calls.notifications.push([title, body]); }, speakCaptionStudio() {},
    statusText: element(), videoContainer: element(), editorPanel: element(), captionList: element(), progressBlock: element(),
    karaokeCheck: { checked: true }, seekSlider: { value: 3 },
    URL: { revokeObjectURL() {}, createObjectURL() { throw new Error('Native clean source must not use a placeholder blob URL'); } },
    alert(message) { throw new Error(message); },
  };
  controls.forEach(name => { context[name] = element(); });
  context.queuePrevBtn.disabled = true;
  elements.set('captionSizePreviewBtn', element());
  const production = ['captionFilePathToUrl', 'getCaptionSourcePath', 'loadQueuedCaptionVideo', 'populateEditor',
    'removeIgnoredIntroCaptions', 'stripIgnoredIntroCaption', 'captionLocalBusy', 'ensureCaptionLocalItemId',
    'clearCaptionPreviewLoop'].map(name => {
      assert.ok(functions.has(name), name);
      return functions.get(name);
    }).join('\n');
  vm.createContext(context);
  const run = vm.runInContext(production + '\n(' + eraseCallback + ')', context);
  return { context, original, calls, controls, elements, run };
}
test('successful erase loads the clean source for preview, transcription and export and clears old captions', async () => {
  const h = harness({ ok: true, changed: true, outputPath: 'D:\\clean.mp4', fileName: 'detected-clean.mp4' });
  await h.run();
  assert.equal(h.context.activeFile.path, 'D:\\clean.mp4');
  assert.equal(h.context.sourceVideo.src, 'file:///D:/clean.mp4');
  assert.equal(h.context.captionVideoQueue[0].file.name, 'detected-clean.mp4');
  assert.equal(h.context.captionVideoQueue[0].status, 'ready');
  assert.equal(h.context.captionVideoQueue[0].captions.length, 0);
  assert.equal(h.context.generatedCaptions.length, 0);
  assert.equal(h.context.audioDataArray, null);
  assert.equal(h.context.editorPanel.style.display, 'none');
  assert.equal(h.context.captionVideoQueue[0].outputPath, undefined);
  assert.equal(h.calls.exportActionsVisible, false);
  assert.match(h.context.statusText.textContent, /Clean video loaded: detected-clean.mp4/);
  assert.equal(h.calls.unsubscribe, 1);
  assert.equal(h.context.isErasingCaptions, false);
  assert.equal(h.context.queuePrevBtn.disabled, true);
  assert.equal(h.context.actionBtn.disabled, false);
  assert.ok(h.calls.localStates.some(state => state.disabled), 'Workbench locks while erasing');
  assert.equal(h.calls.localStates.at(-1).disabled, false);
  assert.equal(h.calls.localStates.at(-1).source, 'D:\\clean.mp4');
});
test('no detections preserve the current source, captions and previously exported result', async () => {
  const h = harness({ ok: true, changed: false, noCaptionsDetected: true });
  await h.run();
  assert.equal(h.context.captionVideoQueue[0], h.original);
  assert.equal(h.context.activeFile, h.original.file);
  assert.equal(h.context.generatedCaptions[0].text, 'Edited caption');
  assert.equal(h.context.captionVideoQueue[0].outputPath, 'D:\\captioned.mp4');
  assert.match(h.context.statusText.textContent, /No previous captions detected/);
  assert.equal(h.calls.notifications.length, 0);
  assert.equal(h.calls.unsubscribe, 1);
});
test('failure and missing output cannot report success or discard edited captions', async () => {
  for (const result of [{ ok: false, error: 'OCR failed' }, { ok: true, changed: true }]) {
    const h = harness(result);
    await h.run();
    assert.equal(h.context.captionVideoQueue[0], h.original);
    assert.equal(h.context.activeFile, h.original.file);
    assert.equal(h.context.generatedCaptions[0].text, 'Edited caption');
    assert.match(h.context.statusText.textContent, /Erasing failed/);
    assert.equal(h.calls.notifications.length, 0);
    assert.equal(h.calls.unsubscribe, 1);
  }
});
test('actual progress is filtered by job/source and conflicting actions stay locked while the job runs', async () => {
  let resolveJob;
  const h = harness(() => new Promise(resolve => { resolveJob = resolve; }));
  const pending = h.run();
  assert.equal(h.context.isErasingCaptions, true);
  for (const name of h.controls) assert.equal(h.context[name].disabled, true, name);
  const jobId = h.calls.requests[0].jobId;
  h.calls.onProgress({ jobId: 'different-job', pct: 80, message: 'Wrong job' });
  assert.doesNotMatch(h.context.statusText.textContent, /Wrong job/);
  h.calls.onProgress({ jobId, filePath: 'D:\\different.mp4', pct: 80, message: 'Wrong file' });
  assert.doesNotMatch(h.context.statusText.textContent, /Wrong file/);
  h.calls.onProgress({ jobId, filePath: h.original.file.path, pct: 37, phase: 'detecting', message: 'Analyzed 37 frames' });
  assert.equal(h.context.statusText.textContent, 'Analyzed 37 frames');
  assert.equal(h.context.captionVideoQueue[0].progress, 37);
  await h.run();
  assert.equal(h.calls.requests.length, 1, 'Repeated erase click must not launch a second job');
  resolveJob({ ok: true, changed: false, noCaptionsDetected: true });
  await pending;
  assert.equal(h.calls.unsubscribe, 1);
  assert.equal(h.context.actionBtn.disabled, false);
});
test('mobile preview uses the clean download URL while retaining the Windows source path', async () => {
  const h = harness({ ok: true, changed: true, outputPath: 'D:\\clean.mp4', outputFileName: 'clean.mp4', mobileDownloadUrl: '/api/download/clean.mp4' }, { mobile: true });
  await h.run();
  assert.equal(h.context.sourceVideo.src, '/api/download/clean.mp4');
  assert.equal(h.context.activeFile.path, 'D:\\clean.mp4');
});

test('reserved characters in a clean filename survive both adoption and queue reselection', async () => {
  const outputPath = 'D:\\Lessons #1\\clean 100%? తెలుగు.mp4';
  const expected = 'file:///D:/Lessons%20%231/clean%20100%25%3F%20%E0%B0%A4%E0%B1%86%E0%B0%B2%E0%B1%81%E0%B0%97%E0%B1%81.mp4';
  const h = harness({ ok: true, changed: true, outputPath });
  await h.run();
  assert.equal(h.context.sourceVideo.src, expected);
  assert.equal(h.context.activeFile.path, outputPath);
  vm.runInContext('loadQueuedCaptionVideo(0)', h.context);
  assert.equal(h.context.sourceVideo.src, expected);
  const url = new URL(h.context.sourceVideo.src);
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.equal(decodeURIComponent(url.pathname), '/D:/Lessons #1/clean 100%? తెలుగు.mp4');
});

function tsFunction(file, name, context) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  let extracted;
  traverse(parser.parse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'] }), {
    FunctionDeclaration(p) { if (p.node.id.name === name) extracted = text.slice(p.node.start, p.node.end); },
  });
  assert.ok(extracted, name);
  return vm.runInNewContext(stripTypeScriptTypes(extracted) + '\n' + name, context);
}

test('React and legacy file preview URLs preserve drive, UNC, percent, query and fragment characters', () => {
  const legacy = vm.runInNewContext(functions.get('captionFilePathToUrl') + '\ncaptionFilePathToUrl');
  const react = tsFunction('src/caption/CaptionBurner.tsx', 'captionFilePathToUrl', {});
  const cases = [
    ['D:\\Lessons #1\\clean 100%?.mp4', 'file:///D:/Lessons%20%231/clean%20100%25%3F.mp4'],
    ['D:\\percent%23literal.mp4', 'file:///D:/percent%2523literal.mp4'],
    ['\\\\server\\Shared Lessons\\clean #100%?.mp4', 'file://server/Shared%20Lessons/clean%20%23100%25%3F.mp4'],
    ['/lessons/clean #100%?.mp4', 'file:///lessons/clean%20%23100%25%3F.mp4'],
  ];
  for (const [filePath, expected] of cases) {
    assert.equal(legacy(filePath), expected);
    assert.equal(react(filePath), expected);
    assert.equal(new URL(expected).hash, '');
    assert.equal(new URL(expected).search, '');
  }
});
test('transcription and native WAV extraction read the clean source rather than the original File', async () => {
  const calls = [];
  const originalFile = { name: 'original.mp4', size: 200 };
  const context = { window: { electronAPI: {
    isElectron: false, isMobileRemote: true,
    getPathForFile() { throw new Error('Old upload path must not be requested'); },
    uploadMobileFile() { throw new Error('Original upload must not replace the cleaned source'); },
    async transcribeVideo(args) { calls.push(args.videoPath); return { ok: true, words: [{ word: 'clean', start: 0, end: 1 }] }; },
    async extractAudio(args) { calls.push(args.videoPath); return { ok: true, wavPath: 'D:\\clean-audio.wav', size: 123 }; },
  } }, throwIfAborted() {}, getLanguageCode: () => 'en', processLocalWhisperResult: () => ({ captions: [{ text: 'Clean captions' }], detectedLang: 'English' }) };
  const transcribe = tsFunction('src/caption/transcribe.ts', 'transcribeWithLocalWhisper', context);
  const extract = tsFunction('src/caption/transcribe.ts', 'extractAudioAsWav', context);
  const transcription = await transcribe(originalFile, 'English', 8, () => {}, undefined, 'speech', 'D:\\clean.mp4');
  assert.equal(transcription.captions[0].text, 'Clean captions');
  const audio = await extract(originalFile, 'D:\\clean.mp4');
  assert.equal(audio.wavPath, 'D:\\clean-audio.wav');
  assert.deepEqual(calls, ['D:\\clean.mp4', 'D:\\clean.mp4']);
});
test('native burn reads the clean source and never falls back to exporting the old captioned upload', async () => {
  const calls = [];
  let fail = false;
  const context = { window: { electronAPI: {
    getPathForFile() { throw new Error('Old upload path must not be requested'); },
    async burnCaptions(args) { calls.push(args.videoPath); return fail ? { ok: false, error: 'Clean source export failed' } : { ok: true, outputPath: 'D:\\new-captions.mp4', fileName: 'new-captions.mp4' }; },
  } }, throwIfAborted() {}, buildAss: () => 'ASS captions', setInterval: () => 1, clearInterval() {},
    getFFmpeg() { throw new Error('Must not fall back to original File'); }, console: { warn() {} } };
  const burn = tsFunction('src/caption/burn.ts', 'burnCaptions', context);
  const originalFile = { name: 'original.mp4' };
  const meta = { width: 1920, height: 1080, sourcePath: 'D:\\clean.mp4' };
  const result = await burn(originalFile, [{ text: 'New captions' }], { fontSize: 50 }, () => {}, undefined, meta);
  assert.equal(result.outputPath, 'D:\\new-captions.mp4');
  fail = true;
  await assert.rejects(burn(originalFile, [], {}, () => {}, undefined, meta), /Clean source export failed/);
  assert.deepEqual(calls, ['D:\\clean.mp4', 'D:\\clean.mp4']);
});

test('React eraser adopts the clean source and resets captions without a fake empty output blob', async () => {
  const text = fs.readFileSync(path.join(root, 'src/caption/CaptionBurner.tsx'), 'utf8');
  let callback;
  traverse(parser.parse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'] }), {
    VariableDeclarator(p) { if (p.node.id.name === 'handleEraseCaptions') { const node = p.node.init.arguments[0]; callback = text.slice(node.start, node.end); } },
  });
  assert.ok(callback);
  const item = { id: 'test', video: { file: { name: 'original.mp4' }, name: 'original.mp4' }, captions: [{ text: 'Old caption' }], status: 'transcribed' };
  const cleanPath = 'D:\\clean #100%.mp4';
  const calls = { patches: [], unsubscribe: 0 };
  const api = { getPathForFile: () => 'D:\\original.mp4',
    onCaptionEraseProgress: () => () => calls.unsubscribe++,
    eraseCaptions: async () => ({ ok: true, changed: true, outputPath: cleanPath, fileName: 'clean #100%.mp4' }), };
  const context = { activeItem: item, eraseJobRef: { current: null }, processing: false, batchOn: false,
    electronApi: () => api, uid: () => 'job', vidRef: { current: { pause() {} } },
    upd(id, patch) { calls.patches.push(patch); }, setError() {}, setErasing(value) { calls.erasing = value; },
    setVideoUrl(value) { calls.videoUrl = value; }, setBurnedVideoUrl(value) { calls.burnedVideoUrl = value; },
    setCurTime(value) { calls.curTime = value; }, setIsPlaying() {}, setEditingCapIndex(value) { calls.editingIndex = value; }, setEditingCapText() {}, notify() {},
    URL: { createObjectURL() { throw new Error('Do not create empty placeholder outputs'); } },
    captionFilePathToUrl: tsFunction('src/caption/CaptionBurner.tsx', 'captionFilePathToUrl', {}), };
  const run = vm.runInNewContext(stripTypeScriptTypes('const extracted = ' + callback + ';\nextracted'), context);
  await run();
  const adopted = calls.patches.at(-1);
  assert.equal(adopted.video.sourcePath, cleanPath);
  assert.equal(adopted.video.file, item.video.file);
  assert.equal(adopted.captions, undefined);
  assert.equal(adopted.outputUrl, undefined);
  assert.equal(adopted.status, 'idle');
  assert.equal(calls.videoUrl, 'file:///D:/clean%20%23100%25.mp4');
  assert.equal(calls.burnedVideoUrl, null);
  assert.equal(calls.editingIndex, null);
  assert.equal(calls.curTime, 0);
  assert.equal(calls.unsubscribe, 1);
  assert.equal(calls.erasing, false);
});
