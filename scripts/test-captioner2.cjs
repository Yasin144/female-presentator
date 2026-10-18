'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const stripTypeScriptTypes = require('node:module').stripTypeScriptTypes || (code => require('sucrase').transform(code, { transforms: ['typescript'] }).code);

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('caption-script.js and caption-script-v2.js coexist in the same global scope without SyntaxError or collision', () => {
  const script1 = read('caption-script.js');
  const script2 = read('caption-script-v2.js');
  const context = {
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    },
    document: {
      readyState: 'complete',
      getElementById: () => null,
      addEventListener: () => {},
      querySelectorAll: () => [],
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  };
  context.globalThis = context;
  context.self = context.window;
  vm.createContext(context);
  assert.doesNotThrow(() => {
    vm.runInContext(script1, context, { filename: 'caption-script.js' });
    vm.runInContext(script2, context, { filename: 'caption-script-v2.js' });
  });
  assert.equal(typeof context.window.bootCaptionStudioV2, 'function');
});

test('Captioner2.jsx and caption-script-v2.js use isolated cap2_ IDs and wire voice shortcuts', () => {
  const jsx = read('src/components/Captioner2/Captioner2.jsx');
  const script2 = read('caption-script-v2.js');
  const workbench2 = read('src/caption/LocalCaptionWorkbench2.tsx');

  for (const id of [
    'cap2_aiCaptionSection',
    'cap2_captionVideoInput',
    'cap2_captionContentMode',
    'cap2_captionEngine',
    'cap2_captionLanguage',
    'cap2_captionTranslateSelectedBtn',
    'cap2_captionAutoRecover',
    'cap2_captionGroqApiKey',
    'cap2_captionActionBtn',
    'cap2_captionEraseBtn',
    'cap2_captionCancelBtn',
    'cap2_captionRegenerateBtn',
    'cap2_captionResetBtn',
    'cap2_captionEraserQuality',
    'cap2_captionQueuePanel',
    'cap2_captionQueueList',
    'cap2_captionVocalFocus',
    'cap2_captionVocabularyHints',
    'cap2_captionSpellingCorrections',
    'cap2_aiCapSttBtn',
    'cap2_aiCapTtsBtn',
    'cap2_aiCapVoiceStatus',
    'cap2_captionRenderCanvas',
    'cap2_captionSourceVideo',
    'cap2_captionExportBtn',
    'cap2_captionPreviewBtn',
  ]) {
    assert.ok(jsx.includes(`id="${id}"`), `Missing ${id} in Captioner2.jsx`);
    assert.ok(script2.includes(id), `Missing ${id} handler in caption-script-v2.js`);
  }

  assert.ok(script2.includes('cap2_manualCaptionBox'));
  assert.ok(script2.includes('cap2_manualCaptionText'));
  assert.ok(script2.includes('captioner2WorkbenchAPI'));
  assert.ok(script2.includes('captioner2-local-state'));
  assert.ok(workbench2.includes('captioner2WorkbenchAPI'));
  assert.ok(workbench2.includes('captioner2-local-state'));
});

test('CaptionBurner.tsx and CaptionBurner2.tsx stay in parity with CaptionWorkbench, Eraser, Song mode and smart engine default', () => {
  const cb1 = read('src/caption/CaptionBurner.tsx').replace(/\r\n/g, '\n');
  const cb2 = read('src/caption/CaptionBurner2.tsx').replace(/\r\n/g, '\n');
  assert.equal(cb1.replace('function CaptionBurner(', 'function CaptionBurner2('), cb2);
  assert.match(cb1, /CaptionWorkbench/);
  assert.match(cb1, /handleEraseCaptions/);
  assert.match(cb1, /retranscribeItem/);
  assert.match(cb1, /getGroqApiKey\?\.\(\) \|\| ''\)\.trim\(\) \? 'groq' : 'local'/);
});

test('transcribeWithHuggingFace falls back to Local Whisper when Groq API key is empty', async () => {
  const source = read('src/caption/transcribe.ts')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export /gm, '');
  let localCalled = false;
  const context = {
    LANG_CODE: { English: 'en', Telugu: 'te', Hindi: 'hi' },
    CODE_TO_NAME: { en: 'English', te: 'Telugu', hi: 'Hindi' },
    DOMException,
    console,
    window: {
      electronAPI: {
        getGroqApiKey: () => '',
        getPathForFile: () => 'C:\\test\\lesson.mp4',
        transcribeVideo: async opts => {
          localCalled = true;
          return {
            ok: true,
            language: 'en',
            contentMode: opts.contentMode || 'speech',
            timingSource: 'word',
            text: 'Welcome to class.',
            words: [
              { word: 'Welcome', start: 0.2, end: 0.6 },
              { word: 'to', start: 0.65, end: 0.8 },
              { word: 'class.', start: 0.85, end: 1.4 },
            ],
          };
        },
      },
    },
  };
  const transcribeWithHuggingFace = vm.runInNewContext(
    stripTypeScriptTypes(source) + '\ntranscribeWithHuggingFace',
    context
  );
  const res = await transcribeWithHuggingFace(
    { name: 'lesson.mp4', size: 1024 },
    'English',
    '',
    8,
    () => {},
    'groq'
  );
  assert.equal(localCalled, true);
  assert.equal(res.captions.length, 1);
  assert.equal(res.captions[0].text, 'Welcome to class.');
});

test('fixSpellingsWithGroq maintains strictly monotonic word timestamps when token count changes', async () => {
  const source = read('src/caption/transcribe.ts')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export /gm, '');
  const context = {
    LANG_CODE: { English: 'en' },
    CODE_TO_NAME: { en: 'English' },
    DOMException,
    console,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              captions: [{ id: 0, text: 'Ria likes InfoKids very much today' }],
            }),
          },
        }],
      }),
    }),
  };
  const fixSpellingsWithGroq = vm.runInNewContext(
    stripTypeScriptTypes(source) + '\nfixSpellingsWithGroq',
    context
  );
  const input = [{
    start: 1,
    end: 3,
    text: 'Rhea likes Info Kids',
    words: [
      { text: 'Rhea', start: 1.0, end: 1.4 },
      { text: 'likes', start: 1.4, end: 1.9 },
      { text: 'Info', start: 1.9, end: 2.4 },
      { text: 'Kids', start: 2.4, end: 3.0 },
    ],
  }];
  const updated = await fixSpellingsWithGroq(input, 'English', 'gsk_test_key', () => {});
  assert.equal(updated[0].words.length, 6);
  let prevEnd = 1.0;
  for (const w of updated[0].words) {
    assert.ok(w.start >= prevEnd - 1e-9, `Word ${w.text} start ${w.start} < prevEnd ${prevEnd}`);
    assert.ok(w.end > w.start, `Word ${w.text} end ${w.end} <= start ${w.start}`);
    prevEnd = w.end;
  }
});

test('main.cjs falls back to Local Whisper when Groq engine is selected without an API key', () => {
  const mainSrc = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  assert.match(mainSrc, /function resolveConfiguredGroqApiKey\(/);
  assert.match(mainSrc, /Groq API key is missing — falling back automatically to Local Whisper/);
  assert.match(mainSrc, /effectiveEngine = 'local'/);
});

test('Captioner 2 repairs overlapping or zero-length word timestamps in caption-script-v2.js and passes captionerVersion: 2', () => {
  const script2 = read('caption-script-v2.js');
  const context = {
    CAPTION_WORD_LIMIT: 4,
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    },
    document: {
      readyState: 'complete',
      getElementById: (id) => {
        if (id === 'cap2_captionEngine') return { value: 'groq' };
        if (id === 'cap2_captionContentMode') return { value: 'speech' };
        return null;
      },
      addEventListener: () => {},
      querySelectorAll: () => [],
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  };
  context.globalThis = context;
  context.self = context.window;
  vm.createContext(context);
  vm.runInContext(
    script2.replace(
      'function getCaptionTranscriptionOptions()',
      'window.__testGetCaptionTranscriptionOptions = getCaptionTranscriptionOptions; window.__testBuildSpeechBoundedCaptionChunks = buildSpeechBoundedCaptionChunks; function getCaptionTranscriptionOptions()'
    ),
    context,
    { filename: 'caption-script-v2.js' }
  );

  const opts = context.window.__testGetCaptionTranscriptionOptions();
  assert.equal(opts.captionerVersion, 2);
  assert.equal(opts.engine, 'groq');

  const chunks = context.window.__testBuildSpeechBoundedCaptionChunks([
    { word: 'Hello', start: 36.98, end: 37.80 },
    { word: 'everyone', start: 37.60, end: 37.60 }, // overlapping + zero-length
    { word: 'welcome', start: 37.90, end: 38.40 },
  ], 4);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].words.length, 3);
  let prevEnd = 0;
  for (const w of chunks[0].words) {
    assert.ok(w.timestamp[0] >= prevEnd - 1e-6);
    assert.ok(w.timestamp[1] > w.timestamp[0]);
    prevEnd = w.timestamp[1];
  }
});

test('main.cjs with captionerVersion: 2 repairs uncertain Groq short audio window timing instead of throwing', () => {
  const mainSrc = read('main.cjs');
  assert.match(mainSrc, /const isCaptionerV2 = captionerVersion === 2;/);
  assert.match(mainSrc, /const repairGroqWordTimelineV2 =/);
  assert.match(mainSrc, /const repairGroqSegmentsV2 =/);
  assert.match(mainSrc, /repairedTimelineV2 = true;/);
});

test('Captioner 2 queue treats busy transcription lock as retryable and auto-recovers stale locks', () => {
  const script2 = read('caption-script-v2.js');
  const mainSrc = read('main.cjs');
  assert.match(script2, /async function invokeCaptioner2TranscribeVideo\(/);
  assert.match(script2, /if \(\/another caption transcription is running\/i\.test\(message\)\) return true;/);
  assert.match(script2, /\\b\(\?:cancelled\|canceled\|aborted by user\)\\b/);
  assert.match(mainSrc, /opts\?\.captionerVersion === 2/);
  assert.match(mainSrc, /waitForRelease === true/);
});

test('Captioner 2 checks and corrects , and . punctuation according to grammar', () => {
  const script2 = read('caption-script-v2.js');
  const context = {
    CAPTION_WORD_LIMIT: 8,
    window: { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} },
    document: { readyState: 'complete', getElementById: () => null, addEventListener: () => {}, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    CustomEvent: class CustomEvent {},
  };
  context.globalThis = context;
  context.self = context.window;
  vm.createContext(context);
  vm.runInContext(
    script2.replace(
      'function applyCaptionGrammarPunctuation(',
      'window.__testApplyCaptionGrammarPunctuation = applyCaptionGrammarPunctuation; window.__testBuildSpeechBoundedCaptionChunks = buildSpeechBoundedCaptionChunks; function applyCaptionGrammarPunctuation('
    ),
    context,
    { filename: 'caption-script-v2.js' }
  );

  // 1. Repairs false mid-phrase , and . on function words, converts . before 'And' to ', and', and ends with '.'
  const cues1 = context.window.__testBuildSpeechBoundedCaptionChunks([
    { word: 'the,', start: 0.0, end: 0.2 },
    { word: 'children.', start: 0.25, end: 0.6 },
    { word: 'are', start: 0.65, end: 0.85 },
    { word: 'going', start: 0.9, end: 1.2 },
    { word: 'to.', start: 1.25, end: 1.4 },
    { word: 'school.', start: 1.45, end: 1.8 },
    { word: 'And', start: 1.95, end: 2.15 },
    { word: 'they', start: 2.2, end: 2.4 },
    { word: 'are', start: 2.45, end: 2.65 },
    { word: 'happy,', start: 2.7, end: 3.1 },
  ], 12);
  assert.equal(cues1.map(c => c.text).join(' '), 'The children are going to school, and they are happy.');

  // 2. Inserts ',' after introductory/dependent clauses and '?' or '.' at sentence ends
  const cues2 = context.window.__testApplyCaptionGrammarPunctuation([
    {
      text: 'first when you finish your homework you can play',
      timestamp: [0, 3.0],
      words: [
        { text: 'first', timestamp: [0.0, 0.3] },
        { text: 'when', timestamp: [0.35, 0.55] },
        { text: 'you', timestamp: [0.6, 0.75] },
        { text: 'finish', timestamp: [0.8, 1.1] },
        { text: 'your', timestamp: [1.15, 1.35] },
        { text: 'homework', timestamp: [1.4, 1.8] },
        { text: 'you', timestamp: [2.05, 2.25] },
        { text: 'can', timestamp: [2.3, 2.5] },
        { text: 'play,', timestamp: [2.55, 3.0] },
      ],
    },
  ]);
  assert.equal(cues2[0].text, 'First, when you finish your homework, you can play.');
});

test('Captioner 2 supports drag-and-drop queue creation, duplicate skipping, and live queue extension while processing', () => {
  const jsx = read('src/components/Captioner2/Captioner2.jsx');
  const script2 = read('caption-script-v2.js');
  assert.ok(jsx.includes('id="cap2_captionDropZone"'));
  assert.ok(script2.includes('cap2_captionDropZone'));
  assert.match(script2, /function getCaptionVideoFileKey\(/);
  assert.match(script2, /const syncNewlyAddedQueueItems = \(\) =>/);
  assert.match(script2, /acceptCaptionVideoFiles\(droppedFiles, \{ append: true, autoStart: true \}\)/);
});

test('burn-captions uses ultrafast x264 preset and sparse-PTS in-memory emoji loop for fast export', () => {
  const mainSrc = read('main.cjs');
  const emojiSrc = read('caption-emoji-export.cjs');
  assert.match(mainSrc, /ipcMain\.handle\('burn-captions'[\s\S]*?'-preset',\s*'ultrafast'/);
  assert.match(emojiSrc, /loop=-1:size=1:start=0,setpts=/);
  assert.match(emojiSrc, /flags=fast_bilinear/);
  assert.doesNotMatch(emojiSrc, /,format=rgba\[caption-base\]/);
});
