const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
function functionSource(name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\r?\\n\\}`, 'm'));
  assert.ok(match, `Production function ${name} must exist`);
  return match[0];
}

function exportFixture(options = {}) {
  const statuses = [], muxCalls = [], renderCalls = [], notifications = [];
  const state = { preferredNarrationVoice: 'test-voice', presentationMode: 'pdf',
    music: { enabled: false }, pdf: { playbackRate: options.rate || 1, totalDurationMs: 20000, narration: { fileName: 'test.wav', durationMs: 20000 } } };
  const track = { kind: 'video', stop() {} };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const bindings = {
    Blob, state, ctx: { clearRect() {} }, previewCanvas: { width: 1280, height: 720 },
    window: { electronAPI: { reportWhatsAppJob: event => { notifications.push(event); return Promise.resolve({ ok: true }); } } },
    console: { error: error => statuses.push(error.message) },
    getPdfSelectedPageCount: () => options.noPages ? 0 : 1, canExportVideo: () => !options.unsupported,
    getPdfExportFileName: () => 'offline.pdf.mp4', getEffectiveExportQuality: () => 'hd',
    getExportCompletionTailMs: () => 150, getPdfExportCaptureRate: () => 24,
    getEffectiveExportRenderSpeedMultiplier: () => 2, getPdfRenderMode: () => 'context',
    getPdfPlaybackRate: () => state.pdf.playbackRate, getPdfCountingDisplayMode: () => 'reveal',
    getNarrationVoiceLabel: () => 'Test voice', getPdfPresentationText: () => options.silent ? '' : 'Three dogs.',
    createExportCanvasSurface: () => ({}), getAcceleratedExportCaptureRate: () => 48,
    createExportCanvasStream: () => stream, getPdfExportBitrate: () => 1000000,
    createSilentWavBlob: () => new Blob(['silent'], { type: 'audio/wav' }),
    ensureAnjaliPdfNarrationReadyForExport: async () => {
      state.pdf.totalDurationMs = state.pdf.narration.durationMs = options.preparedDuration || 20000;
      return new Blob(['narration'], { type: 'audio/wav' });
    },
    createExportMediaRecorder: () => ({ mimeType: 'video/webm', start() {} }),
    stopExportMediaRecorder: async recorder => {
      recorder.ondataavailable({ data: new Blob(['frames'], { type: 'video/webm' }) });
      recorder.onstop();
    },
    renderPdfTimelineForExport: async (mode, settings) => {
      renderCalls.push({ mode, settings });
      if (options.changedRate) state.pdf.playbackRate = options.changedRate;
      if (options.stopped) state.exportingVideo = false;
    },
    encodePdfExactTimelineForExport: async settings => ({ blob: new Blob(['exact'], { type: 'video/ivf' }), durationMs: settings.durationMs / settings.playbackRate }),
    muxVideoAndAudio: async (video, audio, settings) => {
      muxCalls.push(settings);
      if (options.muxError) throw options.muxError;
      return options.emptyResult ? {} : { savedPath: 'offline-only.mp4' };
    },
    requestVideoSaveHandle: async () => { const error = new Error('Save cancelled.'); error.name = 'AbortError'; throw error; },
    setStatus: status => statuses.push(status), clamp: (value, low, high) => Math.min(high, Math.max(low, value))
  };
  for (const name of ['downloadBtn', 'downloadPdfContextBtn', 'playBtn', 'stopStageBtn', 'recordBtn', 'stopRecordBtn', 'clearAudioBtn', 'audioInput']) bindings[name] = {};
  for (const name of ['preventBackgroundThrottling', 'allowBackgroundThrottling', 'stopDictation', 'stopInputPreview', 'stopPlayback', 'syncExportVoiceSelection', 'updateTaskProgressUi', 'updateStageModeUi', 'setPdfRenderMode', 'useCanvasSurface', 'rebuildPdfPresentationSchedule', 'ensureVideoExportServer', 'syncPdfPreviewPageFromTime', 'drawScene', 'requestExportVideoFrame', 'freezeAvatarForExport', 'setExportCaptureRate', 'cancelVisualLoop', 'waitForNextPaint', 'stopActiveAudio', 'markSceneDirty', 'clearExportCaptureRate', 'restoreAvatarAfterExport', 'setRecordingUi', 'updateNarrationUi', 'updateSpeechToolsUi', 'updatePlaybackProgressUi', 'resetTaskProgressUi']) bindings[name] = () => {};
  const context = vm.createContext(bindings);
  vm.runInContext(['createWhatsAppBrowserJob', 'finishWhatsAppBrowserJob', 'getWhatsAppOutputName', 'downloadWithWhatsAppJob', 'exportPdfModeVideo'].map(functionSource).join('\n'), context);
  return { state, context, statuses, muxCalls, renderCalls, notifications };
}

test('PDF Context export target duration follows the selected narration speed', async () => {
  for (const rate of [0.5, 1, 1.25, 2, 2.5]) {
    const f = exportFixture({ rate });
    await f.context.exportPdfModeVideo('context');
    assert.equal(f.muxCalls.length, 1, f.statuses.join('\n'));
    assert.equal(f.muxCalls[0].targetDurationMs, 20000 / rate + 150);
    assert.equal(f.muxCalls[0].audioSpeed, rate);
    assert.equal(f.muxCalls[0].videoSpeed, 2);
    assert.equal(f.state.exportingVideo, false);
  }
});

test('new voice duration and silent PDFs use the same scaled context target', async () => {
  for (const settings of [{ rate: 2.5, preparedDuration: 30000 }, { rate: 0.5, silent: true }]) {
    const f = exportFixture(settings);
    await f.context.exportPdfModeVideo('context');
    assert.equal(f.muxCalls.length, 1, f.statuses.join('\n'));
    assert.equal(f.muxCalls[0].targetDurationMs, (settings.preparedDuration || 20000) / settings.rate + 150);
  }
});

test('context rendering and muxing retain one captured speed despite later UI changes', async () => {
  const f = exportFixture({ rate: 2.5, changedRate: 0.5 });
  await f.context.exportPdfModeVideo('context');
  assert.equal(f.muxCalls.length, 1, f.statuses.join('\n'));
  assert.equal(f.renderCalls[0].settings.playbackRate, 2.5);
  assert.equal(f.muxCalls[0].audioSpeed, 2.5);
  assert.equal(f.muxCalls[0].targetDurationMs, 8150);
});

test('exact PDF duration still comes from its deterministic encoded timeline without context tail padding', async () => {
  const f = exportFixture({ rate: 2.5 });
  await f.context.exportPdfModeVideo('exact');
  assert.equal(f.muxCalls.length, 1, f.statuses.join('\n'));
  assert.equal(f.muxCalls[0].targetDurationMs, 8000);
  assert.equal(f.muxCalls[0].audioSpeed, 2.5);
  assert.equal(f.muxCalls[0].pdfExactTimeline, true);
});

test('the real PDF export reports one completion only after a saved result, using the output basename', async () => {
  const f = exportFixture();
  await f.context.exportPdfModeVideo('context');
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].status, 'completed');
  assert.equal(f.notifications[0].details, 'Saved: offline-only.mp4');
  const selected = exportFixture();
  await selected.context.exportPdfModeVideo('exact', { videoSaveHandle: { electronFilePath: 'D:\\private\\chosen.mp4' } });
  assert.equal(selected.notifications.length, 1);
  assert.equal(selected.notifications[0].details, 'Saved: chosen.mp4');
});

test('the real PDF export reports actual mux/write failure but never reports empty results completed', async () => {
  for (const options of [{ muxError: new Error('Encoder stopped: disk is full') }, { emptyResult: true }]) {
    const f = exportFixture(options);
    await f.context.exportPdfModeVideo('context');
    assert.equal(f.notifications.length, 1);
    assert.equal(f.notifications[0].status, 'failed');
    assert.equal(f.notifications[0].details, options.muxError?.message || 'The final PDF video file was not written to Downloads.');
    assert.equal(f.state.exportingVideo, false);
  }
});

test('the real PDF export sends no terminal notifications for no-op, save cancellation or Stop Export', async () => {
  for (const options of [{ noPages: true }, { unsupported: true }, { stopped: true }, { saveCancelled: true }]) {
    const f = exportFixture(options);
    await f.context.exportPdfModeVideo('context', options.saveCancelled ? { saveHandleRequested: true } : {});
    assert.equal(f.notifications.length, 0, JSON.stringify(options));
    if (!options.stopped) assert.equal(f.muxCalls.length, 0);
  }
});

test('the real context frame loop uses the captured playback rate rather than mutable UI state', async () => {
  const frames = [], waits = [];
  let now = 0;
  const state = { pdf: { totalDurationMs: 1000 }, exportCapture: {} };
  const bindings = { state, performance: { now: () => now },
    getPdfRenderMode: () => 'context', getPdfPlaybackRate: () => 0.5,
    getExportRenderSpeedMultiplier: () => 1, getAcceleratedExportCaptureRate: () => 10,
    getPdfExportCaptureRate: () => 10, getPdfPresentationPages: () => [{}], getPdfSelectionIndexForTime: () => 0,
    getPdfContextVisibleText: () => ({ mouthActive: false }), clamp: (value, low, high) => Math.min(high, Math.max(low, value)),
    drawScene: () => frames.push(state.pdf.currentTimeMs),
    setTimeout: (callback, ms) => { waits.push(ms); now += ms; callback(); }
  };
  for (const name of ['syncPdfPreviewPageFromTime', 'updatePlaybackProgressUi', 'updateTaskProgressUi', 'requestExportVideoFrame', 'waitForNextPaint']) bindings[name] = () => {};
  const context = vm.createContext(bindings);
  vm.runInContext(functionSource('renderPdfTimelineForExport'), context);
  await context.renderPdfTimelineForExport('context', { playbackRate: 2.5, renderSpeedMultiplier: 1 });
  assert.deepEqual(frames, [0, 0, 250, 500, 750, 1000]);
  assert.equal(waits.length, 4);
});
