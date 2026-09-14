const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const fn = name => {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\r?\\n\\}`, 'm'));
  assert.ok(match, name);
  return match[0];
};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function audio() {
  const element = new EventTarget();
  return Object.assign(element, { dataset: { runtimeAudio: 'true' }, classList: { add() {} }, readyState: 0,
    plays: 0, pauses: 0, removed: false, load() {}, setAttribute() {}, removeAttribute() {},
    async play() { this.plays++; }, pause() { this.pauses++; }, remove() { this.removed = true; }
  });
}
function harness(extra = {}, names = []) {
  const state = { music: { enabled: true, url: 'music', volume: 0.1 }, narration: { url: 'voice', source: 'Uploaded' },
    preparedLessonExport: {}, stageVideo: {}, speaking: false, activeAudio: null, activeMusic: null };
  const calls = [], timers = [];
  const sandbox = { state, calls, AbortController, DOMException, console: { error() {} },
    window: { setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {} },
    STRICT_BACKGROUND_MUSIC_VOLUME: 0.1, STRICT_VOICE_VOLUME: 1, STRICT_SCENE_END_BUFFER_MS: 200,
    STAGE_VIDEO_START_DELAY_MS: 0, clamp: (n, a, b) => Math.max(a, Math.min(b, n)),
    teardownAudioGraph() {}, resetTaskProgressUi() {}, syncLessonPlaybackProgressUi() {}, drawScene() {},
    updateStageViewUi() {}, updateStagePageUi() {}, setStatus: text => calls.push(text),
    applyNaturalVoicePlayback() {}, getLessonPlaybackRate: () => 1,
    connectAudioGraph: async () => null, startBackgroundMusicPlayback: async () => null,
    startNarrationLoop: element => calls.push(['loop', element]),
    ...extra };
  const context = vm.createContext(sandbox);
  vm.runInContext(['getPlaybackSignal', 'disposeRuntimeAudio', 'stopActiveAudio', ...names].map(fn).join('\n'), context);
  context.stopPlayback = () => { context.stopActiveAudio(); state.speaking = false; };
  context.finishPlayback = message => { calls.push(['finish', message]); context.stopPlayback(); };
  return { context, state, calls, timers };
}

test('Stop aborts pending audio load and releases its hidden element and listeners', async () => {
  const element = audio();
  const { context } = harness({ document: { createElement: () => element, body: { appendChild() {} } } }, ['createLoadedAudio']);
  const loading = context.createLoadedAudio('voice', { signal: context.getPlaybackSignal() });
  context.stopActiveAudio();
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(element.removed, true);
  element.dispatchEvent(new Event('loadedmetadata'));
  element.dispatchEvent(new Event('error'));
});

test('successful audio loading detaches error cleanup; stalled loading times out', async () => {
  let element = audio();
  const { context, timers } = harness({ document: { createElement: () => element, body: { appendChild() {} } } }, ['createLoadedAudio']);
  const loading = context.createLoadedAudio('voice');
  element.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(await loading, element);
  element.dispatchEvent(new Event('error'));
  assert.equal(element.removed, false);
  element = audio();
  const stalled = context.createLoadedAudio('bad');
  timers.at(-1)();
  await assert.rejects(stalled, /timed out/);
  assert.equal(element.removed, true);
});

test('late background audio cannot start or replace music after Stop', async () => {
  const loaded = deferred(), element = audio();
  const { context, state } = harness({ createLoadedAudio: () => loaded.promise }, ['startBackgroundMusicPlayback']);
  const starting = context.startBackgroundMusicPlayback();
  context.stopActiveAudio();
  loaded.resolve(element);
  assert.equal(await starting, null);
  assert.equal(element.plays, 0);
  assert.equal(element.removed, true);
  assert.equal(state.activeMusic, null);
});

test('changing selected music while loading discards the old track', async () => {
  const loaded = deferred(), element = audio();
  const { context, state } = harness({ createLoadedAudio: () => loaded.promise }, ['startBackgroundMusicPlayback']);
  const starting = context.startBackgroundMusicPlayback();
  state.music.url = 'new-music';
  loaded.resolve(element);
  assert.equal(await starting, null);
  assert.equal(element.plays, 0);
});

for (const blockedAt of ['audio', 'graph', 'music', 'play']) {
  test(`Stop during narration ${blockedAt} preparation cannot restart playback`, async () => {
    const pending = deferred(), element = audio();
    const { context, state, calls } = harness({
      createLoadedAudio: () => blockedAt === 'audio' ? pending.promise : Promise.resolve(element),
      connectAudioGraph: () => blockedAt === 'graph' ? pending.promise : Promise.resolve(null),
      startBackgroundMusicPlayback: () => blockedAt === 'music' ? pending.promise : Promise.resolve(null),
      playAudioWithRecovery: () => blockedAt === 'play' ? pending.promise : Promise.resolve(true)
    }, ['playNarrationAudio']);
    const starting = context.playNarrationAudio();
    await tick();
    context.stopPlayback();
    pending.resolve(blockedAt === 'audio' ? element : true);
    await starting;
    assert.equal(state.speaking, false);
    assert.equal(state.activeAudio, null);
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'loop'), false);
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'finish'), false);
  });
}

test('old narration end/error callbacks cannot stop a newer session', async () => {
  let element = audio();
  const old = element;
  const { context, state, calls, timers } = harness({ createLoadedAudio: async () => element,
    playAudioWithRecovery: async () => true }, ['playNarrationAudio']);
  await context.playNarrationAudio();
  old.dispatchEvent(new Event('ended'));
  element = audio();
  await context.playNarrationAudio();
  timers.forEach(callback => callback());
  old.dispatchEvent(new Event('error'));
  assert.equal(state.activeAudio, element);
  assert.equal(state.speaking, true);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'finish'), false);
});

for (const name of ['playAudioWithRecovery', 'playVideoWithAutoplayRecovery']) {
  test(`${name} does not retry autoplay after cancellation`, async () => {
    const pending = deferred(), element = audio();
    element.play = () => { element.plays++; return pending.promise; };
    const { context } = harness({}, [name]);
    let current = true;
    const starting = context[name](element, { isCurrent: () => current });
    current = false;
    pending.reject(new Error('stopped'));
    assert.equal(await starting, false);
    assert.equal(element.plays, 1);
  });
}

test('cancelled audio context resume cannot tear down a newer graph', async () => {
  const resume = deferred();
  const { context, state } = harness({ ensureAudioContext: () => resume.promise }, ['connectAudioGraph']);
  const signal = context.getPlaybackSignal();
  const connecting = context.connectAudioGraph(audio(), false, 1, { signal });
  context.stopActiveAudio();
  const newer = {};
  state.audioGraph = newer;
  resume.resolve({});
  await connecting;
  assert.equal(state.audioGraph, newer);
});

for (const phase of ['generation', 'intro', 'title']) {
  test(`lesson stopped during ${phase} never advances into narration`, async () => {
    const pending = deferred();
    let started = 0;
    const noop = () => {};
    const { context, state } = harness({
      clearPlayLoadingOverlay: noop, armStartingTitleBadge: noop, commitLatestLessonText: () => 'Lesson',
      introClipEnabled: { checked: false }, isPdfPresentationMode: () => false,
      shouldPreferPdfScreenFromInput: () => false, ensureLessonTextIsReady: () => true,
      stopDictation: noop, stopInputPreview: noop, stagePanel: { classList: { contains: () => false } },
      hasFreshGeneratedAnjaliNarration: () => phase !== 'generation', ENABLE_PREPARED_LESSON_EXPORT: false,
      playIntroClipIfEnabled: () => phase === 'intro' ? pending.promise : Promise.resolve(),
      playTitleIntroBeforeLesson: () => phase === 'title' ? pending.promise : Promise.resolve(),
      normalizeNarrationVoiceId: value => value, playNarrationAudio: () => { started++; },
      setPlayLoadingStep: noop, updatePlayLoadingProgress: noop, startNarrationLiveProgress: noop,
      getNarrationVoiceLabel: () => 'Selected voice', updateTaskProgressUi: noop,
      getLongNarrationRequestTimeoutMs: () => 1000, ensureNarrationReadyForSlide: () => pending.promise
    }, ['playSlide']);
    state.introPlayback = {};
    state.introPoster = {};
    const playing = context.playSlide();
    await tick();
    context.stopPlayback();
    pending.resolve();
    await playing;
    assert.equal(started, 0);
  });
}

test('Stop settles the title wait without waiting for an ended event', async () => {
  const element = audio();
  const { context, state } = harness({
    createTitleNarrationForVoice: async () => ({ blob: {}, text: 'Title' }),
    URL: { createObjectURL: () => 'blob:title', revokeObjectURL() {} }, delay: async () => {},
    createLoadedAudio: async () => element, markSceneDirty() {}, EXPORT_TITLE_PREROLL_MS: 0,
    TITLE_TO_CONTEXT_GAP_MS: 0, playAudioWithRecovery: async () => true
  }, ['playTitleIntroBeforeLesson']);
  const playing = context.playTitleIntroBeforeLesson('voice');
  await tick();
  assert.equal(state.activeAudio, element);
  context.stopPlayback();
  await playing;
  assert.equal(state.activeAudio, null);
  assert.equal(element.removed, true);
});

test('PDF Context draws its backdrop with state mouth position, including an empty selection', () => {
  const backdrop = [];
  const noop = () => {};
  const { context, state } = harness({ canvas: { width: 1280, height: 720 },
    ctx: { clearRect: noop, save: noop, restore: noop, fillText: noop },
    drawTeachingStageBackdrop: value => backdrop.push(value), drawSceneVfx: noop,
    syncPdfContextStageImages: noop, getPdfContextPages: () => [], updateStageTimelineUi: noop,
    requestCanvasExportFrame: noop
  }, ['drawPdfContextScene']);
  state.mouthOpen = 0.23;
  state.previewPageIndex = 0;
  context.drawPdfContextScene();
  assert.deepEqual(backdrop, [0.23]);
});

test('workspace Reset calls the existing playback cancellation helpers before reload', () => {
  const block = source.slice(source.indexOf('const resetInputsBtn ='), source.indexOf('\n}', source.indexOf('const resetInputsBtn =')) + 2);
  let click;
  const calls = [];
  vm.runInNewContext(block, {
    document: { getElementById: () => ({ addEventListener: (_, callback) => { click = callback; } }) },
    window: { confirm: () => true, localStorage: { clear: () => calls.push('clear') }, location: { reload: () => calls.push('reload') } },
    state: {}, stopPlayback: () => calls.push('stop'), stopInputPreview: () => calls.push('preview')
  });
  click();
  assert.deepEqual(calls, ['stop', 'preview', 'clear', 'reload']);
});

test('missing optional voice sample is not fetched on startup or offered as usable narration', async () => {
  const player = {}, button = {}, noop = () => {};
  const { context } = harness({ anjaliSampleAudio: player, useAnjaliSampleBtn: button,
    ANJALI_SAMPLE_AUDIO_FILE: '', mathsAutoTranslateToggle: null,
    resolveProjectAssetUrl: () => { throw new Error('Missing sample must not be requested'); },
    setMathsTranslateLoading: noop, updateMathsTranslationPreview: noop,
    setMathsTranslatorStatus: noop, setMathsHelperStatus: noop
  }, ['initializeMathsTeacherAssets', 'useBundledAnjaliSampleAsNarration']);
  context.state.mathsTranslator = {};
  context.initializeMathsTeacherAssets();
  await context.useBundledAnjaliSampleAsNarration();
  assert.equal(player.hidden, true);
  assert.equal(button.disabled, true);
  assert.equal(player.src, undefined);
});

test('Info Kids logo references the existing PNG instead of corrupted embedded bytes', () => {
  assert.match(source, /infoKidsLogoImg\.src = resolveProjectAssetUrl\("assets\/info-kids-logo-transparent\.png"\)/);
  const bytes = fs.readFileSync(path.join(__dirname, '..', 'assets', 'info-kids-logo-transparent.png'));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});
