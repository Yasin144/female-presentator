'use strict';

// Execute the actual production notification/narration helpers in a VM. No
// Electron launch, message delivery, network, lesson file or media export runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const ast = parser.parse(source, { sourceType: 'script' });
const functions = new Map();
traverse(ast, { FunctionDeclaration({ node }) { functions.set(node.id.name, node); } });
const code = name => {
  assert.ok(functions.has(name), `Production function exists: ${name}`);
  const node = functions.get(name);
  return source.slice(node.start, node.end);
};
const helperNames = ['createWhatsAppBrowserJob', 'finishWhatsAppBrowserJob', 'getWhatsAppOutputName', 'downloadWithWhatsAppJob'];

function fixture(overrides = {}) {
  const reports = [];
  const steps = [];
  const state = { preferredNarrationVoice: 'anjali', pdf: { requestId: 7 }, generatingNarration: false };
  const context = vm.createContext({
    window: { electronAPI: { reportWhatsAppJob: event => { reports.push(event); return Promise.resolve({ ok: true }); } } },
    state, console: { error() {}, warn() {} }, Blob, DOMException,
    getPdfPresentationText: () => 'Private teaching content is not notification data.',
    normalizeNarrationVoiceId: voice => voice,
    requireNarrationVoiceId: voice => voice,
    hasMatchingPdfNarration: () => false,
    hasFreshGeneratedAnjaliNarration: () => false,
    getNarrationVoiceLabel: () => 'Anjali',
    getNarrationVoiceOption: () => ({ fileNamePrefix: 'anjali' }),
    getLongNarrationRequestTimeoutMs: () => 100,
    getEffectiveLessonText: () => 'Private teaching content is not notification data.',
    commitLatestLessonText: () => 'Private teaching content is not notification data.',
    getLessonTextIssue: () => null,
    ensureLessonTextIsReady: () => true,
    requestPdfNarrationBlob: async () => { steps.push('generated'); return new Blob(['wav']); },
    requestNarrationBlob: async () => { steps.push('generated'); return new Blob(['wav']); },
    setPdfNarrationFromBlob: async () => { steps.push('loaded'); },
    setNarrationFromBlob: async () => { steps.push('loaded'); },
    assertPdfNarrationRequestActive: options => {
      if (options.isCurrent && !options.isCurrent()) throw new DOMException('Preparation cancelled.', 'AbortError');
    },
    triggerFileDownload: async () => ({ status: 'saved' }),
    convertAudioBlobToMp3: async () => new Blob(['mp3']),
    clearNarrationWarmupTimer() {}, updateSpeechToolsUi() {}, startNarrationLiveProgress() {},
    updatePreferredVoiceUi() {}, setNarrationGenStatus() {}, setStatus() {}, updateTaskProgressUi() {},
    finishNarrationLiveProgress() {}, resetTaskProgressUi() {}, updateNarrationLiveProgress() {},
    audioPreview: null,
    ...overrides,
  });
  vm.runInContext(helperNames.map(code).join('\n'), context);
  const load = name => vm.runInContext(code(name), context);
  return { context, reports, steps, state, load };
}

test('every real job receives a unique bounded identifier and reports only once', () => {
  const f = fixture();
  const jobs = Array.from({ length: 30 }, () => f.context.createWhatsAppBrowserJob('PDF video export'));
  assert.equal(new Set(jobs.map(job => job.id)).size, jobs.length);
  assert.ok(jobs.every(job => job.id.length < 100));
  f.context.finishWhatsAppBrowserJob(jobs[0], 'working', 'Not terminal');
  assert.equal(f.reports.length, 0);
  f.context.finishWhatsAppBrowserJob(jobs[0], 'completed', 'Saved: output.mp4');
  f.context.finishWhatsAppBrowserJob(jobs[0], 'failed', new Error('Late duplicate'));
  assert.equal(f.reports.length, 1);
  assert.deepEqual(Object.keys(f.reports[0]).sort(), ['details', 'id', 'processName', 'status']);
  assert.equal(f.reports[0].status, 'completed');
});

test('failure reports contain the actual bounded error message, not a stack or source content', () => {
  const f = fixture();
  const error = new Error('Encoder stopped: disk is full.\n' + 'detail '.repeat(200));
  f.context.finishWhatsAppBrowserJob(f.context.createWhatsAppBrowserJob('PDF video export'), 'failed', error);
  assert.match(f.reports[0].details, /^Encoder stopped: disk is full\. detail/);
  assert.equal(f.reports[0].details.length, 600);
  assert.doesNotMatch(f.reports[0].details, /Error:|at Object|Private teaching content/);
});

test('missing bridge, synchronous exceptions and rejected notification promises cannot fail a job', async () => {
  for (const api of [undefined, {}, { reportWhatsAppJob() { throw new Error('offline'); } }, { reportWhatsAppJob: () => Promise.reject(new Error('offline')) }]) {
    const f = fixture({ window: { electronAPI: api } });
    assert.doesNotThrow(() => f.context.finishWhatsAppBrowserJob(f.context.createWhatsAppBrowserJob('Lesson narration'), 'completed', 'Prepared'));
  }
  await new Promise(resolve => setImmediate(resolve));
});

test('cancelled or stale jobs do not emit a completed or failed notification', () => {
  const f = fixture();
  for (const name of ['AbortError', 'CanceledError']) {
    const error = new Error('Cancelled'); error.name = name;
    f.context.finishWhatsAppBrowserJob(f.context.createWhatsAppBrowserJob('Narration'), 'failed', error);
  }
  for (const status of ['completed', 'failed']) {
    f.context.finishWhatsAppBrowserJob(f.context.createWhatsAppBrowserJob('Export', { isCurrent: () => false }), status, 'Stopped');
  }
  assert.equal(f.reports.length, 0);
});

test('saved and browser-ready download messages include a basename only and do not claim an unverified browser save', async () => {
  for (const status of ['saved', 'download-started']) {
    const f = fixture({ triggerFileDownload: async () => ({ status }) });
    await f.context.downloadWithWhatsAppJob(new Blob(['file']), 'D:\\private-folder\\movie.mp4', 'Lesson video export');
    assert.equal(f.reports.length, 1);
    assert.equal(f.reports[0].details, status === 'saved' ? 'Saved: movie.mp4' : 'Ready for download: movie.mp4');
  }
});

test('cancelled and unspecified downloads emit nothing; failed writes preserve the actual reason', async () => {
  for (const result of [{ status: 'cancelled' }, undefined]) {
    const f = fixture({ triggerFileDownload: async () => result });
    await f.context.downloadWithWhatsAppJob(new Blob(['file']), 'movie.mp4', 'Lesson video export');
    assert.equal(f.reports.length, 0);
  }
  const f = fixture({ triggerFileDownload: async () => ({ status: 'failed', error: 'Permission denied' }) });
  await f.context.downloadWithWhatsAppJob(new Blob(['file']), 'movie.mp4', 'Lesson video export');
  assert.equal(f.reports[0].status, 'failed');
  assert.equal(f.reports[0].details, 'Permission denied');
});

test('download exceptions are rethrown unchanged after a single terminal event', async () => {
  const original = new Error('Could not prepare download');
  const f = fixture({ triggerFileDownload: async () => { throw original; } });
  await assert.rejects(f.context.downloadWithWhatsAppJob(new Blob(['file']), 'movie.mp4', 'Lesson video export'), error => error === original);
  assert.equal(f.reports.length, 1);
});

test('an empty output is rejected before any save dialog and cannot be reported completed', async () => {
  let downloads = 0;
  const f = fixture({ triggerFileDownload: async () => { downloads++; return { status: 'saved' }; } });
  await assert.rejects(f.context.downloadWithWhatsAppJob(new Blob(), 'movie.mp4', 'Lesson video export'), /empty or unavailable/);
  assert.equal(downloads, 0);
  assert.equal(f.reports.length, 1);
  assert.equal(f.reports[0].status, 'failed');
});

for (const name of ['ensurePdfNarrationReadyForPresentation', 'ensureNarrationReadyForSlide']) {
  test(`${name}: reports once only after the entire narration has generated and loaded`, async () => {
    const f = fixture(); f.load(name);
    await f.context[name]();
    assert.deepEqual(f.steps, ['generated', 'loaded']);
    assert.equal(f.reports.length, 1);
    assert.equal(f.reports[0].status, 'completed');
    assert.doesNotMatch(JSON.stringify(f.reports), /Private teaching content/);
    if (name.includes('Pdf')) assert.equal(f.state.pdf.preparingNarration, 0);
  });

  test(`${name}: cache hits are not new jobs, and terminal errors are rethrown unchanged`, async () => {
    const cached = fixture({ hasMatchingPdfNarration: () => true, hasFreshGeneratedAnjaliNarration: () => true }); cached.load(name);
    await cached.context[name]();
    assert.equal(cached.reports.length, 0);
    assert.equal(cached.steps.length, 0);
    const original = new Error('Local voice model could not load');
    const f = fixture({ requestPdfNarrationBlob: async () => { throw original; }, requestNarrationBlob: async () => { throw original; } }); f.load(name);
    await assert.rejects(f.context[name](), error => error === original);
    assert.equal(f.reports.length, 1);
    assert.equal(f.reports[0].details, original.message);
    if (name.includes('Pdf')) assert.equal(f.state.pdf.preparingNarration, 0);
  });
}

test('PDF replacement and cancelled lesson playback suppress obsolete generation results', async () => {
  const pdf = fixture(); pdf.load('ensurePdfNarrationReadyForPresentation');
  pdf.context.requestPdfNarrationBlob = async () => { pdf.state.pdf.requestId++; return new Blob(['wav']); };
  await assert.rejects(pdf.context.ensurePdfNarrationReadyForPresentation(), error => error.name === 'AbortError');
  assert.equal(pdf.reports.length, 0);
  assert.equal(pdf.state.pdf.preparingNarration, 0);
  const lesson = fixture(); lesson.load('ensureNarrationReadyForSlide');
  await lesson.context.ensureNarrationReadyForSlide({ notificationIsCurrent: () => false });
  assert.equal(lesson.reports.length, 0);
  assert.match(code('playSlide'), /notificationIsCurrent:\s*\(\) => !signal\.aborted/);
});

test('normal audio publication stopping the old signal is not mistaken for user cancellation', async () => {
  let stopped = false;
  const f = fixture({ setNarrationFromBlob: async () => { stopped = true; } });
  f.load('ensureNarrationReadyForSlide');
  await f.context.ensureNarrationReadyForSlide({ notificationIsCurrent: () => !stopped });
  assert.equal(f.reports.length, 1);
  assert.equal(f.reports[0].status, 'completed');
});

for (const name of ['generateNarrationDownload', 'downloadNarrationMp3Only', 'loadGeneratedNarrationIntoApp']) {
  test(`${name}: one event for whole generation, no event on empty input, actual error on failure`, async () => {
    const f = fixture(); f.load(name); await f.context[name]('anjali');
    assert.equal(f.reports.length, 1); assert.equal(f.reports[0].status, 'completed');
    const empty = fixture({ getLessonTextIssue: () => ({ message: 'Enter text first' }) }); empty.load(name);
    await empty.context[name]('anjali'); assert.equal(empty.reports.length, 0); assert.equal(empty.steps.length, 0);
    const failed = fixture({ requestNarrationBlob: async () => { throw new Error('Voice process stopped unexpectedly'); } }); failed.load(name);
    await failed.context[name]('anjali');
    assert.equal(failed.reports.length, 1); assert.equal(failed.reports[0].status, 'failed');
    assert.equal(failed.reports[0].details, 'Voice process stopped unexpectedly');
  });
}

test('cancelled manual narration save dialogs never announce download completion', async () => {
  for (const name of ['generateNarrationDownload', 'downloadNarrationMp3Only']) {
    const f = fixture({ triggerFileDownload: async () => ({ status: 'cancelled' }) }); f.load(name);
    await f.context[name]('anjali');
    assert.equal(f.reports.length, 0);
  }
});

test('the real native download helper returns saved/cancelled/failed results without changing protected callers', async () => {
  for (const outcome of ['cancelled', 'saved', 'failed']) {
    const f = fixture({ btoa: value => Buffer.from(value, 'binary').toString('base64') }); f.load('triggerFileDownload');
    let writes = 0;
    f.context.window.electronAPI = {
      isElectron: true,
      showSaveDialog: async () => outcome === 'cancelled' ? { canceled: true } : { filePath: 'C:\\output.wav' },
      writeFile: async () => { writes++; return outcome === 'failed' ? { ok: false, error: 'Disk full' } : { ok: true }; },
      showItemInFolder() {},
    };
    const result = await f.context.triggerFileDownload(new Blob(['wav']), 'output.wav');
    assert.equal(result.status, outcome);
    assert.equal(writes, outcome === 'cancelled' ? 0 : 1);
    assert.equal(f.reports.length, 0, 'The shared helper itself sends no notifications');
  }
});

test('video exports report in their outer terminal catch and after final result validation only', () => {
  for (const name of ['exportPdfModeVideo', 'exportVideo']) {
    const fn = functions.get(name);
    const outerTry = fn.body.body.find(node => node.type === 'TryStatement');
    assert.ok(outerTry);
    assert.match(source.slice(outerTry.handler.start, outerTry.handler.end), /finishWhatsAppBrowserJob\(whatsAppJob, "failed", error\)/);
    assert.doesNotMatch(source.slice(outerTry.finalizer.start, outerTry.finalizer.end), /finishWhatsAppBrowserJob/);
    const body = code(name);
    assert.ok(body.indexOf('The final') < body.indexOf('finishWhatsAppBrowserJob(whatsAppJob, "completed"'));
    assert.match(body, /isCurrent:\s*\(\) => state\.exportingVideo/);
    assert.match(body, /error\?\.name === "AbortError"[\s\S]*?export cancelled\.[\s\S]*?return;/);
  }
  assert.match(code('exportVideo'), /const whatsAppJob = cacheOnly \? null : createWhatsAppBrowserJob/);
  assert.ok(code('exportVideo').indexOf('await exportPdfModeVideo') < code('exportVideo').indexOf('createWhatsAppBrowserJob'));
  assert.match(code('beginExportFromUi'), /await downloadWithWhatsAppJob\(state\.preparedLessonExport\.blob/);
});

test('no notification calls are added to clips, retry internals, title previews or native/protected module processors', () => {
  const internal = ['requestPdfNarrationBlob', 'getPdfNarrationClip', 'requestNarrationBlob', 'requestNarrationBlobSingle',
    'generateNarrationChunkWithFallback', 'createTitleNarrationForVoice', 'ensureAnjaliNarrationReadyForExport',
    'ensureAnjaliPdfNarrationReadyForExport', 'scheduleNarrationWarmup', 'convertBlobToSc3Audio', 'processVideoQueue'];
  for (const name of internal) assert.doesNotMatch(code(name), /createWhatsAppBrowserJob|finishWhatsAppBrowserJob|downloadWithWhatsAppJob/, name);
  for (const [name] of functions) {
    if (/SingSong|Sc3Video|Caption/.test(name)) assert.doesNotMatch(code(name), /createWhatsAppBrowserJob|finishWhatsAppBrowserJob|downloadWithWhatsAppJob/, name);
  }
});

function singSongFixture(options = {}) {
  const f = fixture();
  f.state.singSong = { file: { name: 'source.wav' }, videoFile: { name: 'source.mp4' } };
  f.state.videoExportServerUrl = 'http://example.invalid';
  const nativeCalls = [];
  Object.assign(f.context, {
    setSingSongStatus() {}, setSingSongProgress() {}, clearSingSongResult() {}, notifySongCreationComplete() {},
    ensureVideoExportServer: async () => true,
    ensureSc3SingingModelServer: async () => true,
    extractMediaAudioToWavBlob: async () => new Blob(['audio']),
    convertBlobToSc3Audio: async () => ({ blob: new Blob(['voice']), fileName: 'converted.mp3' }),
    buildMuxBinaryRequestBlob: () => new Blob(['mux request']),
    fetchVideoExportEndpoint: async () => {
      if (options.failed) return { ok: false, json: async () => ({ error: 'FFmpeg could not write the converted video' }) };
      return { ok: true, blob: async () => options.empty ? new Blob() : new Blob(['final video']) };
    },
    URL: { createObjectURL: () => 'blob:offline-test' },
    saveSc3OutputToDownloads: async () => options.prepared ? '' : 'D:\\private\\converted.mp4',
  });
  for (const name of ['singSongProcessBtn', 'singSongSc3ReplaceBtn', 'singSongModelBtn', 'singSongDownloadBtn',
    'singSongDownloadReplacedBtn', 'sc3VideoReplaceBtn', 'sc3VideoDownloadBtn', 'sc3VideoResultPreview']) f.context[name] = null;
  Object.assign(f.context.window, { setInterval: () => 1, clearInterval() {}, setTimeout() {} });
  const nativeJob = method => async () => {
    nativeCalls.push(method);
    return options.failed ? { ok: false, error: 'Native voice operation failed' }
      : { ok: true, fileName: 'converted.mp4', outputPath: 'D:\\private\\converted.mp4' };
  };
  Object.assign(f.context.window.electronAPI, {
    getPathForFile: () => 'D:\\private\\source.mp4',
    sc3NarrateAudio: nativeJob('audio'), sc3ReplaceVideoAudio: nativeJob('video'),
  });
  for (const name of ['processSingSongSafe', 'replaceSingSongVocalWithSc3', 'replaceSingSongWithSc3SingingModel',
    'replaceVideoAudioWithSc3', '_replaceVideoAudioViaIpc', '_replaceVideoAudioRendererFallback']) f.load(name);
  return { ...f, nativeCalls };
}

test('the direct HTTP Sing Song fallback reports one terminal success without exposing file paths', async () => {
  for (const prepared of [false, true]) {
    const f = singSongFixture({ prepared });
    await f.context._replaceVideoAudioRendererFallback(f.state.singSong.videoFile);
    assert.equal(f.reports.length, 1);
    assert.equal(f.reports[0].status, 'completed');
    assert.equal(f.reports[0].processName, 'Sing Song video voice replacement');
    assert.match(f.reports[0].details, prepared ? /^Prepared: source\.mp4$/ : /^Saved: converted\.mp4$/);
    assert.doesNotMatch(JSON.stringify(f.reports), /private|example\.invalid/);
    assert.equal(f.state.singSong.processing, false);
  }
});

test('direct HTTP Sing Song failure reports the actual terminal cause and never an empty-file success', async () => {
  for (const options of [{ failed: true }, { empty: true }]) {
    const f = singSongFixture(options);
    await f.context._replaceVideoAudioRendererFallback(f.state.singSong.videoFile);
    assert.equal(f.reports.length, 1);
    assert.equal(f.reports[0].status, 'failed');
    assert.equal(f.reports[0].details, options.failed ? 'FFmpeg could not write the converted video' : 'FFmpeg returned an empty sc3 video.');
    assert.equal(f.state.singSong.processing, false);
  }
});

test('native Sing Song audio/video wrappers do not duplicate main-process job notifications', async () => {
  for (const name of ['processSingSongSafe', 'replaceSingSongVocalWithSc3']) {
    for (const failed of [false, true]) {
      const f = singSongFixture({ failed });
      if (name === 'replaceSingSongVocalWithSc3') f.state.singSong.file = null;
      await f.context[name]();
      assert.equal(f.nativeCalls.length, 1);
      assert.equal(f.reports.length, 0);
    }
  }
  const empty = singSongFixture();
  empty.state.singSong.file = empty.state.singSong.videoFile = null;
  await empty.context.processSingSongSafe(); await empty.context.replaceSingSongVocalWithSc3();
  assert.equal(empty.nativeCalls.length, 0);
  assert.equal(empty.reports.length, 0);
});

function transcriptionFixture(options = {}) {
  const f = fixture();
  f.state.transcribeSelectedFile = options.noFile ? null : { name: 'source.wav' };
  f.state.transcribeServerUrl = 'http://example.invalid';
  Object.assign(f.context, {
    setTranscribeStatus() {}, setTranscribeProgress() {}, setSpeechToolsStatus() {}, handleLessonInputChange() {},
    ensureTranscribeServer: async () => !options.unavailable,
    decodeAudioFileToWav: async () => new Blob(['audio']),
    arrayBufferToBase64: () => 'private-encoded-data',
    fetch: async () => options.failed
      ? { ok: false, json: async () => ({ error: 'Speech model could not decode this audio' }) }
      : { ok: true, json: async () => ({ text: options.empty ? '' : 'PRIVATE SPOKEN LESSON' }) },
    lessonInput: { value: '' }, transcribeAudioInput: { value: 'source.wav' },
  });
  f.context.window.setTimeout = () => {};
  f.load('handleTranscribeAudioUpload');
  return f;
}

test('direct Audio to Text reports only after the full transcript reaches the editor, never its contents', async () => {
  const f = transcriptionFixture();
  await f.context.handleTranscribeAudioUpload();
  assert.equal(f.context.lessonInput.value, 'PRIVATE SPOKEN LESSON');
  assert.equal(f.reports.length, 1);
  assert.equal(f.reports[0].status, 'completed');
  assert.equal(f.reports[0].details, 'Transcription added to the lesson editor.');
  assert.doesNotMatch(JSON.stringify(f.reports), /PRIVATE SPOKEN|private-encoded|example\.invalid/);
  assert.equal(f.state.transcribing, false);
});

test('Audio to Text no-ops are quiet and failures include the actual final cause', async () => {
  const empty = transcriptionFixture({ noFile: true });
  await empty.context.handleTranscribeAudioUpload(); assert.equal(empty.reports.length, 0);
  for (const [options, message] of [
    [{ unavailable: true }, 'The local transcription server is not running.'],
    [{ failed: true }, 'Speech model could not decode this audio'],
    [{ empty: true }, 'No clear speech was recognized from the uploaded audio.'],
  ]) {
    const f = transcriptionFixture(options); await f.context.handleTranscribeAudioUpload();
    assert.equal(f.reports.length, 1); assert.equal(f.reports[0].status, 'failed');
    assert.equal(f.reports[0].details, message); assert.equal(f.state.transcribing, false);
  }
});
