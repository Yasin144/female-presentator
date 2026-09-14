'use strict';

// Execute extracted production notification boundaries with fake APIs only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const root = path.resolve(__dirname, '..');
function readFunctions(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const functions = new Map();
  traverse(parser.parse(source, { sourceType: 'script' }), {
    FunctionDeclaration({ node }) { functions.set(node.id.name, source.slice(node.start, node.end)); },
  });
  return { source, functions };
}
const captions = readFunctions('caption-script.js');
const translate = readFunctions('translate-dub-module.js');

for (const [label, parsed, name] of [
  ['caption', captions, 'createCaptionWhatsAppJob'],
  ['translation', translate, 'createTranslateWhatsAppJob'],
]) {
  test(`${label} terminal helper reports once, preserves errors, and suppresses cancellation`, () => {
    const reports = [];
    const context = vm.createContext({ window: { electronAPI: { reportWhatsAppJob: event => reports.push(event) } } });
    vm.runInContext(parsed.functions.get(name), context);
    const makeJob = context[name];
    const complete = makeJob('Example job');
    complete('progress', 'Still working');
    complete('completed', 'Output ready');
    complete('completed', 'Duplicate');
    complete('failed', new Error('Late cleanup error'));
    const fail = makeJob('Failed job');
    fail('failed', new Error('Disk full'));
    for (const detail of [{ name: 'AbortError' }, { cancelled: true }, { canceled: true }, new Error('Operation cancelled')]) {
      const cancel = makeJob('Cancelled job');
      cancel('failed', detail);
      cancel('completed', 'Must stay cancelled');
    }
    const explicit = makeJob('Explicit cancel');
    explicit('cancelled');
    explicit('completed', 'No late success');
    assert.equal(reports.length, 2);
    assert.equal(reports[0].status, 'completed');
    assert.equal(reports[1].details, 'Disk full');
    assert.notEqual(reports[0].id, reports[1].id);
  });
  test(`${label} unavailable, rejected and throwing notification bridges cannot break a job`, async () => {
    for (const api of [undefined, {}, { reportWhatsAppJob: () => { throw new Error('Offline'); } }, { reportWhatsAppJob: () => Promise.reject(new Error('Offline')) }]) {
      const context = vm.createContext({ window: { electronAPI: api } });
      vm.runInContext(parsed.functions.get(name), context);
      assert.doesNotThrow(() => context[name]('Example')('completed', 'Ready'));
    }
    await new Promise(resolve => setImmediate(resolve));
  });
}

function translateFixture(options = {}) {
  const reports = [];
  const api = {
    reportWhatsAppJob: event => reports.push(event),
    showSaveDialog: async () => options.cancel ? { canceled: true } : { filePath: 'C:/temporary/fake.mp3' },
    writeFile: async () => options.writeFail ? { ok: false, error: 'Disk full' } : { ok: true },
  };
  const state = { busy: false, audioBase64: 'fake-audio', target: { code: 'hi', label: 'Hindi' }, file: { name: 'fake.wav' } };
  const context = vm.createContext({
    window: { electronAPI: api }, api: () => api, state,
    els: { save: {}, generate: {}, exportVideo: {}, translation: { value: 'test' } },
    setBusy: value => { state.busy = value; }, setStatus: () => {},
    cleanText: value => String(value || '').trim(), safeBaseName: () => 'fake', isVideoFile: () => false,
    synthesizeTranslatedAudio: async () => { if (options.regenerateFail) throw new Error('Voice engine unavailable'); },
  });
  for (const name of ['createTranslateWhatsAppJob', 'regenerateAudio', 'saveAudio']) vm.runInContext(translate.functions.get(name), context);
  return { context, reports, state };
}

test('actual translated-audio regeneration reports complete or the terminal failure once', async () => {
  for (const regenerateFail of [false, true]) {
    const { context, reports, state } = translateFixture({ regenerateFail });
    await context.regenerateAudio();
    assert.equal(reports.length, 1);
    assert.equal(reports[0].status, regenerateFail ? 'failed' : 'completed');
    if (regenerateFail) assert.equal(reports[0].details, 'Voice engine unavailable');
    assert.equal(state.busy, false);
  }
});

test('actual MP3 save reports its result but excludes cancelled dialogs and empty audio', async () => {
  for (const options of [{}, { writeFail: true }, { cancel: true }, { empty: true }]) {
    const { context, reports, state } = translateFixture(options);
    if (options.empty) state.audioBase64 = '';
    await context.saveAudio();
    if (options.cancel || options.empty) assert.equal(reports.length, 0);
    else {
      assert.equal(reports.length, 1);
      assert.equal(reports[0].status, options.writeFail ? 'failed' : 'completed');
      assert.doesNotMatch(reports[0].details, /temporary|fake\.mp3/);
    }
  }
});

function captionTranslationFixture(options = {}) {
  const reports = [];
  const context = vm.createContext({
    window: { electronAPI: { reportWhatsAppJob: event => reports.push(event) } },
    generatedCaptions: options.empty ? [] : [{ text: 'First' }, { text: 'Second' }],
    statusText: {}, document: { getElementById: () => null },
    TRANSLATE_SERVER: 'http://fake-local-service', AbortSignal: { timeout: () => undefined },
    editorPanel: { style: {} }, populateEditor: () => {},
    fetch: async url => {
      if (options.healthFail && url.endsWith('/health')) throw new Error('Connection refused');
      return { ok: !options.batchFail || url.endsWith('/health'), status: 503, json: async () => ({ results: options.noResults ? [] : ['One', 'Two'] }) };
    },
  });
  for (const name of ['createCaptionWhatsAppJob', 'translateCaptionsTo']) vm.runInContext(captions.functions.get(name), context);
  return { context, reports };
}

test('actual HTTP caption translation has one truthful terminal report and no empty-input success', async () => {
  for (const options of [{}, { healthFail: true }, { batchFail: true }, { noResults: true }, { empty: true }]) {
    const { context, reports } = captionTranslationFixture(options);
    await context.translateCaptionsTo('hi');
    if (options.empty) assert.equal(reports.length, 0);
    else {
      assert.equal(reports.length, 1);
      assert.equal(reports[0].status, Object.keys(options).length ? 'failed' : 'completed');
      if (options.healthFail) assert.match(reports[0].details, /Connection refused/);
      if (options.noResults) assert.match(reports[0].details, /no caption results/);
    }
  }
});

test('intermediate HTTP fallback errors are not separately reported', () => {
  assert.doesNotMatch(translate.functions.get('translateSegmentTexts'), /WhatsApp|notify/);
  assert.doesNotMatch(captions.functions.get('transcribeWithLocalServer'), /WhatsApp|notify/);
  const single = captions.functions.get('transcribeActiveCaptionVideo');
  assert.match(single, /notificationRoute = 'native'/);
  assert.match(single, /notificationRoute = 'fallback'/);
  assert.match(single, /notificationRoute !== 'native' && !captionTranscriptionCancelRequested/);
  assert.match(single, /captionTranscriptionCancelRequested \? 'cancelled' : 'completed'/);
  assert.equal((single.match(/captionTranscriptionCancelRequested \? 'cancelled' : 'failed'/g) || []).length, 2);
});

test('native export notices are not duplicated and browser results do not claim disk persistence', () => {
  assert.doesNotMatch(captions.functions.get('notifyCaptionStudio'), /reportWhatsAppJob|createCaptionWhatsAppJob/);
  assert.match(captions.source, /if \(!nativeExportObserved\) notifyExport\('failed'/);
  assert.match(captions.source, /notifyExport\(_blob\.size \? 'completed' : 'failed'/);
  assert.match(captions.source, /notifyShort\(blob\.size \? 'completed' : 'failed'/);
  assert.match(captions.source, /Video prepared; download requested:/);
  assert.match(captions.source, /addEventListener\('error', event => notifyExport/);
  assert.match(captions.source, /addEventListener\('error', event => notifyShort/);
  assert.match(captions.functions.get('transcribeCaptionQueueFrom'), /notifyQueue\(failedCount \? 'failed' : 'completed'/);
});
