'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const source = fs.readFileSync(path.join(__dirname, '..', 'caption-script.js'), 'utf8');
const functions = new Map();
traverse(parser.parse(source), { FunctionDeclaration(p) {
  functions.set(p.node.id.name, source.slice(p.node.start, p.node.end));
} });
const fn = name => { assert.ok(functions.has(name), name); return functions.get(name); };
const plain = value => JSON.parse(JSON.stringify(value));

function timingHarness() {
  const context = { CAPTION_WORD_LIMIT: 8, SHORT_CAPTION_GAP_SECONDS: .75 };
  vm.createContext(context);
  vm.runInContext(['normalizeNurseryCaptionText', 'buildSpeechBoundedCaptionChunks', 'buildCaptionChunksFromTranscription'].map(fn).join('\n'), context);
  return context;
}

test('export preserves the blank pause between caption groups', () => {
  const context = { sourceVideo: { duration: 10 }, syncSlider: { value: '0' },
    generatedCaptions: [{ text: 'First', timestamp: [1, 2] }, { text: 'Second', timestamp: [2.3, 3] }],
    stripIgnoredIntroCaption: text => text };
  vm.createContext(context);
  vm.runInContext([fn('getCaptionSyncOffsetSeconds'), fn('getValidatedCaptionBurnList')].join('\n'), context);
  const cues = plain(context.getValidatedCaptionBurnList());
  assert.equal(cues[0].end, 2);
  assert.equal(cues[1].start, 2.3);
});

test('saved spelling corrections preserve cue bounds, punctuation and merged word timing', () => {
  const context = vm.createContext({});
  vm.runInContext(fn('applyCaptionSpellingCorrections'), context);
  const original = [{ text: 'Rhea likes Info Kids.', timestamp: [1, 3], words: [
    { text: 'Rhea', timestamp: [1, 1.3] }, { text: 'likes', timestamp: [1.4, 1.7] },
    { text: 'Info', timestamp: [2, 2.4] }, { text: 'Kids.', timestamp: [2.5, 3] },
  ] }];
  const result = plain(context.applyCaptionSpellingCorrections(original, 'Rhea = Ria\nInfo Kids = InfoKids'));
  assert.equal(result[0].text, 'Ria likes InfoKids.');
  assert.deepEqual(result[0].timestamp, [1, 3]);
  assert.deepEqual(result[0].words.map(word => word.timestamp), [[1, 1.3], [1.4, 1.7], [2, 3]]);
  assert.equal(original[0].text, 'Rhea likes Info Kids.');
  assert.deepEqual(plain(context.applyCaptionSpellingCorrections(original, '')), original);
  const paused = [{ text: 'Info Kids', timestamp: [1, 3], words: [
    { text: 'Info', timestamp: [1, 1.4] }, { text: 'Kids', timestamp: [2, 3] },
  ] }];
  assert.deepEqual(plain(context.applyCaptionSpellingCorrections(paused, 'Info Kids = InfoKids')), paused,
    'Spelling must not merge words across a phrase pause');
});

test('preview hides a saved group during a phrase pause without hiding short interword gaps', () => {
  const context = vm.createContext({});
  vm.runInContext(fn('captionHasSpeechAtTime'), context);
  const cue = { words: [
    { timestamp: [1, 1.2] }, { timestamp: [1.3, 1.5] }, { timestamp: [2, 2.4] },
  ] };
  for (const time of [1.1, 1.25, 1.4, 2.1]) assert.equal(context.captionHasSpeechAtTime(cue, time), true);
  for (const time of [.9, 1.6, 1.9, 2.4]) assert.equal(context.captionHasSpeechAtTime(cue, time), false);
});

test('spelling corrections keep untimed and multiline captions visible without fabricating word timing', () => {
  const context = vm.createContext({});
  vm.runInContext(fn('applyCaptionSpellingCorrections'), context);
  const cues = [{ text: '(Rhea) helped.\nInfo Kids.', timestamp: [1, 4], words: [] },
    { text: 'Keep this\nmanual caption', timestamp: [4, 6] }];
  const corrected = plain(context.applyCaptionSpellingCorrections(cues, 'Rhea = Ria\nInfo Kids = InfoKids'));
  assert.equal(corrected[0].text, '(Ria) helped.\nInfoKids.');
  assert.deepEqual(corrected[0].words, []);
  assert.deepEqual(corrected[0].timestamp, [1, 4]);
  assert.deepEqual(corrected[1], cues[1]);
  assert.deepEqual(plain(context.applyCaptionSpellingCorrections(cues, '')), cues);
  const malformed = [{ text: 'Rhea spoke', timestamp: [0, 2], words: [{ text: 'Rhea' }, { text: 'spoke' }] }];
  assert.equal(context.applyCaptionSpellingCorrections(malformed, 'Rhea = Ria')[0].text, 'Ria spoke');
});

test('both engine word lists leave short phrase pauses blank while retaining grouped words', () => {
  const words = [
    { word: 'The', start: 1, end: 1.2 }, { word: 'bird', start: 1.2, end: 1.5 },
    { word: 'sings', start: 1.9, end: 2.2 }, { word: 'sweetly.', start: 2.2, end: 2.6 },
    { word: 'Examples', start: 3, end: 3.4 },
  ];
  const cues = plain(timingHarness().buildSpeechBoundedCaptionChunks(words));
  assert.deepEqual(cues.map(cue => cue.text), ['The bird', 'sings sweetly.', 'Examples']);
  assert.equal(cues[0].timestamp[1], 1.5);
  assert.equal(cues[1].timestamp[0], 1.9);
  assert.deepEqual(cues.flatMap(cue => cue.words).map(word => word.timestamp), words.map(word => [word.start, word.end]));
});

test('Local segment phrases keep Time and What with their following sentences', () => {
  const texts = ['Info', 'Kids', 'Time', 'to', 'warm', 'up', 'Students', 'A', 'bird', 'in', 'a', 'cage', 'What', 'color', 'is', 'the', 'bird'];
  const words = texts.map((word, index) => ({ word, start: index * .4, end: index * .4 + .3 }));
  const segments = ['Info Kids', 'Time to warm up.', 'Students A bird in a cage.', 'What color is the bird?'].map(text => ({ text }));
  const result = timingHarness().buildCaptionChunksFromTranscription({ words, segments }, 10);
  assert.deepEqual(plain(result.map(cue => cue.text)), ['Info Kids', 'Time to warm up', 'Students A bird in a cage', 'What color is the bird']);
  assert.deepEqual(plain(result.flatMap(cue => cue.words).map(word => word.timestamp)), words.map(word => [word.start, word.end]));
});

test('actual backwards Fox timing cannot replace Tiger or be silently sorted', () => {
  const words = [
    { word: 'Tiger.', start: 38.60, end: 38.94 },
    { word: 'Fox.', start: 38.48, end: 40.46 },
  ];
  const original = plain(words);
  assert.throws(() => timingHarness().buildSpeechBoundedCaptionChunks(words), error =>
    error.captionTimingFailure === true && /timestamps conflict at word 2/.test(error.message));
  assert.deepEqual(words, original, 'Validation must not reorder or edit the recognized transcript');
});

test('a forward start that overlaps a previous word is rejected instead of covering it', () => {
  assert.throws(() => timingHarness().buildSpeechBoundedCaptionChunks([
    { word: 'Tiger', start: 38.60, end: 38.94 },
    { word: 'Fox', start: 38.80, end: 40.46 },
  ]), error => error.captionTimingFailure === true);
});

test('nonnumeric, missing, negative, collapsed and nonfinite word times cannot become captions', () => {
  const h = timingHarness();
  for (const [start, end] of [[null, 1], ['0', 1], [false, 1], [undefined, 1], [-1, 1], [1, 1], [2, 1], [NaN, 1], [0, Infinity]]) {
    assert.throws(() => h.buildSpeechBoundedCaptionChunks([{ word: 'spoken', start, end }]),
      error => error.captionTimingFailure === true, `${start}/${end}`);
  }
});

test('repaired words retain recognition order and exact Tiger/Fox speech bounds', () => {
  const words = [
    { word: 'Tiger.', start: 38.60, end: 38.94 },
    { word: 'Fox.', start: 40.48, end: 40.96 },
  ];
  assert.deepEqual(plain(timingHarness().buildSpeechBoundedCaptionChunks(words)), [
    { text: 'Tiger.', timestamp: [38.60, 38.94], words: [{ text: 'Tiger.', timestamp: [38.60, 38.94] }] },
    { text: 'Fox.', timestamp: [40.48, 40.96], words: [{ text: 'Fox.', timestamp: [40.48, 40.96] }] },
  ]);
});

test('very short valid words keep their exact end rather than extending across the next cue', () => {
  const result = timingHarness().buildSpeechBoundedCaptionChunks([
    { text: 'A.', timestamp: [1, 1.01] }, { text: 'B.', timestamp: [1.02, 1.03] },
  ]);
  assert.deepEqual(plain(result.map(cue => cue.timestamp)), [[1, 1.01], [1.02, 1.03]]);
  assert.deepEqual(plain(result.map(cue => cue.words[0].timestamp)), [[1, 1.01], [1.02, 1.03]]);
});

test('invalid ASR word timing never silently switches to supplied broad segments', () => {
  assert.throws(() => timingHarness().buildCaptionChunksFromTranscription({
    words: [{ word: 'Tiger', start: 38.6, end: 38.94 }, { word: 'Fox', start: 38.48, end: 40.46 }],
    segments: [{ text: 'Tiger Fox', start: 30, end: 45 }], text: 'Tiger Fox',
  }, 60), error => error.captionTimingFailure === true);
  const single = fn('transcribeActiveCaptionVideo');
  assert.match(single, /generatedCaptions = buildSpeechBoundedCaptionChunks\(words2\)/,
    'Transcription of separately picked narration must use the same timestamp guard');
  for (const variable of ['groqFirstErr', 'groqErr', 'svrErr']) {
    assert.match(single, new RegExp(`if \\(${variable}\\.captionTranslationFailure \\|\\| ${variable}\\.captionTimingFailure`),
      `${variable} must retain the timing error instead of starting another engine`);
  }
});

function timingDiagnostic() {
  return vm.runInNewContext('(' + fn('explainCaptionTimingFailure') + ')');
}

test('unsupported backend diagnostic retains the timing cause and requests reopen without a source path or key', async () => {
  const requests = [];
  const error = new Error('Speech timestamps conflict at word 20. Generate captions again; the previous captions are preserved.'); error.captionTimingFailure = true;
  const explained = await timingDiagnostic()(error, { engine: 'groq', contentMode: 'speech', apiKey: 'private-test-key' }, {
    async transcribeVideo(request) { requests.push(request); return { ok: false, error: 'No video path provided.' }; },
  });
  assert.deepEqual(plain(requests), [{ engine: 'groq', contentMode: 'speech', capabilityProbe: true }]);
  assert.equal(explained.cause, error);
  assert.equal(explained.captionTimingFailure, true);
  assert.equal(explained.captionBackendRestartSuggested, true);
  assert.match(explained.message, /^Speech timestamps conflict at word 20\./);
  assert.match(explained.message, /Close and reopen the app to activate the Groq timing fix/);
  assert.match(explained.message, /Your previous captions are preserved\./);
  assert.doesNotMatch(explained.message, /Generate captions again/);
});

test('a supported diagnostic retains the original strict timing failure without a misleading reopen requirement', async () => {
  const error = new Error('Speech timestamps conflict.'); error.captionTimingFailure = true;
  const result = await timingDiagnostic()(error, { engine: 'groq', contentMode: 'speech' }, {
    async transcribeVideo(request) { assert.equal(request.capabilityProbe, true); return { ok: true, groqSpeechTimingRepairVersion: 1 }; },
  });
  assert.equal(result, error);
  assert.equal(result.captionBackendRestartSuggested, undefined);
});

test('valid results, ordinary errors, song and other engines never request a diagnostic probe', async () => {
  let requests = 0;
  const api = { async transcribeVideo() { requests++; throw new Error('No probe expected'); } };
  const timingError = new Error('Speech timestamps conflict.'); timingError.captionTimingFailure = true;
  for (const [error, options] of [
    [undefined, { engine: 'groq', contentMode: 'speech' }],
    [new Error('Groq provider failed'), { engine: 'groq', contentMode: 'speech' }],
    [timingError, { engine: 'groq', contentMode: 'song' }],
    [timingError, { engine: 'local', contentMode: 'speech' }],
    [timingError, { engine: 'gemini', contentMode: 'song' }],
  ]) assert.equal(await timingDiagnostic()(error, options, api), error);
  assert.equal(requests, 0);
});

test('a rejected or malformed diagnostic can never replace the original timing cause with its own failure', async () => {
  const error = new Error('Speech timestamps conflict at word 20.'); error.captionTimingFailure = true;
  for (const response of [undefined, { ok: false, groqSpeechTimingRepairVersion: 1 }, { ok: true, groqSpeechTimingRepairVersion: 0 },
    { ok: true, groqSpeechTimingRepairVersion: '1' }, { ok: true, groqSpeechTimingRepairVersion: Infinity }]) {
    const result = await timingDiagnostic()(error, { engine: 'groq', contentMode: 'speech' }, {
      async transcribeVideo() { if (!response) throw new Error('IPC diagnostic unavailable'); return response; },
    });
    assert.equal(result.cause, error);
    assert.match(result.message, /^Speech timestamps conflict at word 20\./);
    assert.doesNotMatch(result.message, /IPC diagnostic unavailable/);
    assert.equal(result.captionTimingFailure, true);
  }
});

function uploadHarness(busy = false) {
  const loads = [];
  const originalQueue = [{ file: { name: 'old.mp4' }, captions: [{ text: 'Previous edit', timestamp: [2, 3] }] }];
  const context = {
    captionLocalBusy: () => busy,
    captionVideoQueue: originalQueue, captionQueueIndex: 0,
    syncSlider: { value: '-2500', min: '-15000', max: '15000' }, syncValue: { textContent: 'Old offset' },
    sizeSlider: { value: '50' }, sizeValue: null, gapSlider: null, gapValue: null,
    widthSlider: null, widthValue: null, strokeSlider: null, strokeValue: null, heightSlider: null, heightValue: null,
    fontSelect: { value: 'Nunito, sans-serif' }, boldCheck: { checked: true },
    document: { getElementById: () => null },
    statusText: { innerHTML: '' }, actionBtn: { disabled: false, classList: { remove() {} } },
    loadQueuedCaptionVideo: index => loads.push(index), scrollCaptionStudioToWorkSection() {},
  };
  vm.createContext(context);
  vm.runInContext(['sliderPercent', 'updateCaptionStyleValueLabels', 'acceptCaptionVideoFiles'].map(fn).join('\n'), context);
  return { context, loads, originalQueue };
}

test('a fresh valid upload resets a stale negative sync offset and its numeric label only', () => {
  const h = uploadHarness();
  h.context.acceptCaptionVideoFiles([{ name: 'new.mp4', type: 'video/mp4' }]);
  assert.equal(h.context.syncSlider.value, '0');
  assert.equal(h.context.syncValue.textContent, '50% · 0.0s');
  assert.deepEqual(h.loads, [0]);
  assert.equal(h.context.captionVideoQueue[0].file.name, 'new.mp4');
  assert.equal(h.context.sizeSlider.value, '50');
  assert.equal(h.context.fontSelect.value, 'Nunito, sans-serif');
  assert.equal(h.context.boldCheck.checked, true);
  for (const name of ['loadQueuedCaptionVideo', 'transcribeActiveCaptionVideo', 'transcribeCaptionQueueFrom']) {
    assert.doesNotMatch(fn(name), /syncSlider\.value\s*=/, `${name} must preserve a current-video offset`);
  }
});

test('a rejected or busy upload preserves the current video and its intentional sync offset', () => {
  for (const busy of [false, true]) {
    const h = uploadHarness(busy);
    h.context.acceptCaptionVideoFiles([{ name: busy ? 'new.mp4' : 'notes.txt', type: busy ? 'video/mp4' : 'text/plain' }]);
    assert.equal(h.context.syncSlider.value, '-2500');
    assert.equal(h.context.syncValue.textContent, 'Old offset');
    assert.equal(h.context.captionVideoQueue, h.originalQueue);
    assert.deepEqual(h.loads, []);
  }
});
