'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'caption-script-v2.js'), 'utf8').replace(/cap2_/g, '');
const functions = new Map();
traverse(parser.parse(source), { FunctionDeclaration(p) { functions.set(p.node.id.name, source.slice(p.node.start, p.node.end)); } });
const fn = name => { assert.ok(functions.has(name), name); return functions.get(name); };
const plain = value => JSON.parse(JSON.stringify(value));
const cues = () => [
  { text: 'Hello\nchildren', timestamp: [1.125, 3.75], colorOverride: '#aabbcc', words: [{ text: 'Hello', timestamp: [1.125, 2] }, { text: 'children', timestamp: [2, 3.75] }] },
  { text: 'Good morning', timestamp: [4, 6.5], words: [{ text: 'Good', timestamp: [4, 5] }, { text: 'morning', timestamp: [5, 6.5] }] },
];
const response = results => ({ ok: true, status: 200, json: async () => ({ results }) });
function pure(fetchImpl = async () => { throw new Error('Unexpected translation request'); }) {
  const context = { fetch: fetchImpl, JSON, Set, Error, AbortController, document: { getElementById: () => null }, fontSelect: { value: 'Nunito, sans-serif' } };
  vm.createContext(context);
  vm.runInContext(['normalizeCaptionOutputLanguage', 'getCaptionOutputLanguage', 'captionTextScriptLanguage', 'captionTranslationTimeoutMs', 'translateCaptionLanguageBatch', 'getCaptionFontFamily'].map(fn).join('\n'), context);
  return context;
}

test('visible output selector defaults to English independently of ASR engine options', () => {
  const panel = fs.readFileSync(path.join(root, 'src/components/LocalCaptionPanel.jsx'), 'utf8');
  assert.match(panel, /id="captionLanguage"[^>]*defaultValue="en"/);
  for (const code of ['en', 'te', 'hi']) assert.match(panel, new RegExp(`<option value="${code}">`));
  assert.match(panel, /Speech language is detected automatically/);
  const context = pure();
  const elements = { captionLanguage: { value: 'te' }, captionEngine: { value: 'groq' }, captionContentMode: { value: 'speech' } };
  context.document.getElementById = id => elements[id];
  vm.runInContext(fn('getCaptionTranscriptionOptions'), context);
  assert.equal(context.getCaptionOutputLanguage(), 'te');
  assert.equal(context.getCaptionTranscriptionOptions().engine, 'groq');
  assert.equal(context.getCaptionTranscriptionOptions().languageHint, undefined);
  assert.equal(context.getCaptionTranscriptionOptions().outputLanguage, undefined);
  assert.equal(context.normalizeCaptionOutputLanguage(undefined), 'en');
});

test('same-language captions retain real word timing without requesting translation', async () => {
  const context = pure();
  const original = cues();
  const output = await context.translateCaptionLanguageBatch(original, { target: 'en', sourceLanguage: 'en', timingSource: 'word', warnings: ['Existing warning'] });
  assert.deepEqual(plain(output.captions), original);
  assert.equal(output.timingSource, 'word');
  assert.equal(output.translated, false);
  output.captions[0].words[0].timestamp[0] = 99;
  assert.equal(original[0].words[0].timestamp[0], 1.125);
});

test('English output translates Hindi source while preserving exact cue timing and color', async () => {
  const requests = [];
  const context = pure(async (url, options) => { requests.push({ url, ...options }); return response(['Welcome\nchildren', 'Good morning']); });
  const original = cues();
  original[0].text = 'नमस्ते बच्चों';
  const frozen = plain(original);
  const output = await context.translateCaptionLanguageBatch(original, { target: 'en', sourceLanguage: 'hi', timingSource: 'word' });
  assert.deepEqual(JSON.parse(requests[0].body), { texts: original.map(cue => cue.text), target: 'en', source: 'hi' });
  assert.equal(requests[0].url, 'http://127.0.0.1:8434/api/translate/batch');
  assert.deepEqual(plain(output.captions.map(cue => cue.timestamp)), original.map(cue => cue.timestamp));
  assert.equal(output.captions[0].colorOverride, '#aabbcc');
  assert.equal(output.captions[0].text, 'Welcome\nchildren');
  assert.deepEqual(plain(original), frozen);
  assert.equal(output.timingSource, 'estimated');
  assert.ok(output.captions.every(cue => cue.words.length === 0));
  assert.match(output.warnings.join(' '), /original cue start and end.*estimated timing/);
});

test('a contradictory English language label cannot suppress Indic script translation', async () => {
  let calls = 0;
  const context = pure(async (_url, options) => { calls++; assert.equal(JSON.parse(options.body).source, 'auto'); return response(['Hello children', 'Good morning']); });
  const original = cues(); original[0].text = 'నమస్కారం పిల్లలారా';
  await context.translateCaptionLanguageBatch(original, { target: 'en', sourceLanguage: 'en' });
  assert.equal(calls, 1);
});

test('mixed English and Telugu captions use auto source rather than a target-language shortcut', async () => {
  const context = pure(async (_url, options) => {
    assert.equal(JSON.parse(options.body).source, 'auto');
    assert.equal(JSON.parse(options.body).target, 'te');
    return response(['నమస్కారం పిల్లలారా', 'శుభోదయం']);
  });
  const original = cues(); original[1].text = 'శుభోదయం';
  const output = await context.translateCaptionLanguageBatch(original, { target: 'te', sourceLanguage: 'en', timingSource: 'word' });
  assert.equal(output.captions[0].text, 'నమస్కారం పిల్లలారా');
  assert.deepEqual(plain(output.captions.map(cue => cue.timestamp)), original.map(cue => cue.timestamp));
  assert.deepEqual(original[0].words[0].timestamp, [1.125, 2]);
});

test('long videos receive a bounded timeout matching provider batch count and character limits', () => {
  const context = pure();
  const one = context.captionTranslationTimeoutMs([{ text: 'Hello' }]);
  assert.equal(one, 330000);
  assert.equal(context.captionTranslationTimeoutMs(Array.from({ length: 61 }, () => ({ text: 'Hello' }))), 630000);
  assert.equal(context.captionTranslationTimeoutMs([{ text: 'a'.repeat(1200) }, { text: 'b'.repeat(1200) }]), 630000);
  assert.equal(context.captionTranslationTimeoutMs(Array.from({ length: 5000 }, () => ({ text: 'a'.repeat(1000) }))), 3600000);
});

test('a response for a different target language cannot replace captions', async () => {
  const context = pure(async () => ({ ok: true, json: async () => ({ target: 'hi', results: ['एक', 'दो'] }) }));
  await assert.rejects(context.translateCaptionLanguageBatch(cues(), { target: 'te' }), /incomplete captions/);
});

test('partial, malformed and blank translations fail atomically', async () => {
  for (const results of [[], ['Only one'], ['One', 'Two', 'Extra'], ['One', ''], ['One', null], ['One', { text: 'Two' }]]) {
    const context = pure(async () => response(results));
    const original = cues(); const before = plain(original);
    await assert.rejects(context.translateCaptionLanguageBatch(original, { target: 'te' }), /incomplete captions/);
    assert.deepEqual(original, before);
  }
});

test('provider failure preserves every original cue and reports its error', async () => {
  const context = pure(async () => ({ ok: false, status: 502, json: async () => ({ error: 'All translation providers unavailable' }) }));
  const original = cues(); const before = plain(original);
  await assert.rejects(context.translateCaptionLanguageBatch(original, { target: 'hi' }), /providers unavailable/);
  assert.deepEqual(original, before);
});

test('cancellation before a request and after a late response never returns replacements', async () => {
  const early = new AbortController(); early.abort();
  await assert.rejects(pure().translateCaptionLanguageBatch(cues(), { target: 'te', signal: early.signal }), /cancelled/);
  const late = new AbortController();
  const context = pure(async (_url, options) => ({ ok: true, json: async () => { assert.equal(options.signal, late.signal); late.abort(); return { results: ['ఒకటి', 'రెండు'] }; } }));
  const original = cues(); const before = plain(original);
  await assert.rejects(context.translateCaptionLanguageBatch(original, { target: 'te', signal: late.signal }), /cancelled/);
  assert.deepEqual(original, before);
});

function manualHarness(fetchImpl) {
  const context = pure(fetchImpl);
  const original = cues();
  const elements = { captionLanguage: { value: 'te' } };
  const classes = new Set();
  const element = () => ({ disabled: false, textContent: '', classList: { add: name => classes.add(name), remove: name => classes.delete(name) } });
  Object.assign(context, {
    captionVideoQueue: [{ id: 'video-one', captions: plain(original), timingSource: 'word', sourceLanguage: 'en', warnings: [], outputPath: 'old-export.mp4' }],
    captionQueueIndex: 0, generatedCaptions: plain(original), captionTranslationController: null,
    captionTranslationBusy: false, captionTranscriptionCancelRequested: false,
    captionLocalBusy: () => context.captionTranslationBusy,
    createCaptionWhatsAppJob: () => () => {},
    ensureCaptionLocalItemId: item => item?.id || '',
    cancelBtn: element(), actionBtn: element(), statusText: element(),
    setTimeout: callback => { context.timeoutCallback = callback; return 1; }, clearTimeout: () => {},
    document: { getElementById: id => elements[id] },
    publishCaptionLocalState: () => { context.published.push({ busy: context.captionTranslationBusy, captions: plain(context.generatedCaptions) }); },
    published: [], populateEditor: () => {}, updateCaptionStyleValueLabels: () => {}, renderCaptionQueue: () => {},
    commitCaptionLocalEdits: metadata => {
      context.captionVideoQueue[0] = { ...context.captionVideoQueue[0], captions: plain(context.generatedCaptions), ...metadata, outputPath: undefined };
    },
  });
  vm.runInContext(['applyCaptionOutputMetadata', 'prepareCaptionOutput', 'translateCaptionsTo'].map(fn).join('\n'), context);
  return { context, original };
}

test('manual translation publishes old captions while busy and commits all cues together', async () => {
  let resolve;
  const h = manualHarness(() => new Promise(done => { resolve = done; }));
  const pending = h.context.translateCaptionsTo('te');
  assert.equal(h.context.captionTranslationBusy, true);
  assert.deepEqual(plain(h.context.generatedCaptions), h.original);
  assert.equal(h.context.cancelBtn.textContent, 'Stop Translation');
  resolve(response(['నమస్కారం పిల్లలారా', 'శుభోదయం'])); await pending;
  assert.equal(h.context.captionTranslationBusy, false);
  assert.equal(h.context.captionVideoQueue[0].outputLanguage, 'te');
  assert.equal(h.context.captionVideoQueue[0].timingSource, 'estimated');
  assert.equal(h.context.captionVideoQueue[0].outputPath, undefined);
  assert.deepEqual(plain(h.context.generatedCaptions.map(cue => cue.timestamp)), h.original.map(cue => cue.timestamp));
  assert.deepEqual(h.context.published[0].captions, h.original);
});

test('manual translation failure and cancellation retain captions and existing export', async () => {
  for (const cancel of [false, true]) {
    let resolve;
    const h = manualHarness(() => new Promise(done => { resolve = done; }));
    const pending = h.context.translateCaptionsTo('hi');
    if (cancel) { h.context.captionTranscriptionCancelRequested = true; h.context.captionTranslationController.abort(new Error('Caption translation cancelled.')); }
    resolve(response(cancel ? ['एक', 'दो'] : ['Incomplete'])); await pending;
    assert.deepEqual(plain(h.context.generatedCaptions), h.original);
    assert.equal(h.context.captionVideoQueue[0].outputPath, 'old-export.mp4');
    assert.equal(h.context.captionVideoQueue[0].timingSource, 'word');
    assert.equal(h.context.captionTranslationBusy, false);
    assert.match(h.context.statusText.textContent, /preserved/);
  }
});

test('a stale video identity rejects translation without writing replacements', async () => {
  let resolve;
  const h = manualHarness(() => new Promise(done => { resolve = done; }));
  const pending = h.context.translateCaptionsTo('te');
  h.context.captionVideoQueue[0].id = 'video-two';
  resolve(response(['ఒకటి', 'రెండు'])); await pending;
  assert.deepEqual(plain(h.context.generatedCaptions), h.original);
  assert.equal(h.context.captionVideoQueue[0].outputPath, 'old-export.mp4');
  assert.match(h.context.statusText.textContent, /cancelled/);
});

test('timeout releases translation busy state and preserves the previous captions', async () => {
  let resolve;
  const h = manualHarness(() => new Promise(done => { resolve = done; }));
  const pending = h.context.translateCaptionsTo('te');
  h.context.timeoutCallback(); resolve(response(['ఒకటి', 'రెండు'])); await pending;
  assert.equal(h.context.captionTranslationBusy, false);
  assert.deepEqual(plain(h.context.generatedCaptions), h.original);
  assert.match(h.context.statusText.textContent, /timed out/);
});

test('every native engine route awaits output preparation while ASR remains automatic', () => {
  const single = fn('transcribeActiveCaptionVideo');
  const queue = fn('transcribeCaptionQueueFrom');
  assert.match(single, /languageHint: 'auto'/);
  assert.match(queue, /languageHint: 'auto'/);
  assert.doesNotMatch(single + queue, /captionLanguage[^\n]*languageHint/);
  assert.match(single, /async function finaliseCaptions\(\)/);
  assert.match(single, /await prepareCaptionOutput\(stagedCaptions, outputLanguage/);
  assert.match(queue, /await prepareCaptionOutput\(directCaptions, outputLanguage/);
  assert.match(queue, /await prepareCaptionOutput\(current\.captions, outputLanguage/);
  assert.match(fn('captionLocalBusy'), /captionTranslationBusy/);
  assert.match(fn('syncCaptionWorkbenchBusy'), /'captionLanguage', 'captionTranslateSelectedBtn'/);
});

test('manual text changes and undo clear stale language tags while timing changes and explicit translation preserve them', () => {
  for (const variant of ['text', 'timing', 'translation']) {
    const previous = [{ text: 'नमस्ते बच्चों', timestamp: [.5, 1.7] }];
    const next = plain(previous);
    if (variant !== 'timing') next[0].text = 'Hello children';
    else next[0].timestamp = [.6, 1.8];
    const context = {
      captionVideoQueue: [{ captions: previous, outputLanguage: 'hi', captionLanguage: 'Hindi', sourceLanguage: 'hi', timingSource: 'estimated', warnings: [] }],
      captionQueueIndex: 0, generatedCaptions: next, clearCaptionPreviewLoop() {},
      captionLocalEditedQueueItem: (item, captions, metadata) => ({ ...item, captions: plain(captions), ...metadata }),
      setCaptionExportActionsVisible() {}, exportActions: { replaceChildren() {} }, exportBtn: null, previewBtn: null,
      sourceVideo: { src: '' }, renderCaptionQueue() {},
    };
    vm.createContext(context); vm.runInContext(fn('commitCaptionLocalEdits'), context);
    context.commitCaptionLocalEdits({ timingSource: 'estimated', warnings: [] }, false, variant === 'translation');
    const item = context.captionVideoQueue[0];
    if (variant === 'text') {
      assert.equal(item.outputLanguage, undefined); assert.equal(item.captionLanguage, undefined); assert.equal(item.sourceLanguage, '');
    } else {
      assert.equal(item.outputLanguage, 'hi'); assert.equal(item.captionLanguage, 'Hindi'); assert.equal(item.sourceLanguage, 'hi');
    }
  }
});

test('English retains Nunito while Telugu and Hindi choose a readable script font', () => {
  const context = pure();
  assert.equal(context.getCaptionFontFamily('Welcome children'), '"Pattan Caption Nunito", sans-serif');
  for (const text of ['తెలుగు ఉపశీర్షిక', 'हिन्दी कैप्शन']) assert.match(context.getCaptionFontFamily(text), /^"Nirmala UI"/);
  assert.equal(context.fontSelect.value, 'Nunito, sans-serif');
  assert.match(fn('renderCaptionFrame'), /getCaptionFontFamily\(generatedCaptions\.map/,
    'Mixed-script videos must use the same script-safe font as their native ASS export.');
});

test('native ASS uses the same Indic font without changing original size scaling', () => {
  for (const text of ['తెలుగు ఉపశీర్షిక', 'हिन्दी कैप्शन', 'Welcome children']) {
    const context = { CAPTION_WORD_LIMIT: 8, CAPTION_BOTTOM_OFFSET_PX: 80, SHORT_CAPTION_GAP_SECONDS: .75, CAPTION_PREVIEW_MAX_DIM: 1920, QUEUE_EXPORT_FONT_SIZE: 50,
      sourceVideo: { videoWidth: 3840, videoHeight: 2160, duration: 7 }, renderCanvas: {}, sizeSlider: { value: 50 }, styleSelect: { value: 'white-yellow' },
      colorPicker: { value: '#ffffff' }, strokeSlider: { value: 0 }, captionPosX: .5, captionPosY: .9, widthSlider: { value: 85 }, gapSlider: { value: 120 },
      fontSelect: { value: 'Nunito, sans-serif' }, boldCheck: { checked: true }, heightSlider: { value: 100 }, karaokeCheck: { checked: true }, emojiCheck: { checked: false }, progressCheck: { checked: false },
      document: { createElement: () => ({ getContext: () => null }) }, getCaptionSyncOffsetSeconds: () => 0,
      generatedCaptions: [{ text, timestamp: [1.125, 6.5], words: [] }], getCaptionBottomSafety: () => 80 };
    const names = ['fitCaptionBlock', 'getCaptionSourceFontSize', 'getCaptionFontFamily', 'getCaptionWordTimeline', 'getCaptionWordEnd', 'spokenPhraseStart', 'stripIgnoredIntroCaption', 'removeIgnoredIntroCaptions', 'toAssTimestamp', 'escapeAssCaptionText', 'hexToAss', 'getAssStyleConfig', 'buildPreviewMatchedAss'];
    const ass = vm.runInNewContext(names.map(fn).join('\n') + '\nbuildPreviewMatchedAss()', context);
    const style = ass.split('\n').find(line => line.startsWith('Style: Preview,')).split(',');
    assert.equal(style[1], text.startsWith('Welcome') ? 'Nunito Black' : 'Nirmala UI');
    assert.ok(Math.abs(Number(style[2]) - (text.startsWith('Welcome') ? 137.7 : 100)) < 1e-8);
    const visible = ass.split('\n').filter(line => line.startsWith('Dialogue:'))
      .map(line => line.split(',').slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/g, ' '));
    assert.ok(visible.some(value => value.includes(text)), 'Caption glyph text must survive ASS override tags.');
    assert.equal(context.sizeSlider.value, 50);
  }
});
