'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const source = fs.readFileSync(path.join(__dirname, '..', 'src/caption/CaptionBurner.tsx'), 'utf8');
const callbacks = new Map();
let clickCallback;
let contentModeCallback;
let engineCallback;
traverse(parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }), {
  VariableDeclarator(p) {
    const node = p.node;
    if (node.init?.type === 'CallExpression' && node.init.callee.name === 'useCallback') {
      const callback = node.init.arguments[0];
      callbacks.set(node.id.name, source.slice(callback.start, callback.end));
    }
  },
  JSXOpeningElement(p) {
    const attrs = p.node.attributes;
    const title = attrs.find(a => a.name?.name === 'title')?.value?.value;
    const label = attrs.find(a => a.name?.name === 'label')?.value?.value;
    const onClick = attrs.find(a => a.name?.name === 'onClick')?.value?.expression;
    const onChange = attrs.find(a => a.name?.name === 'onChange')?.value?.expression;
    if (title === 'Generate new captions with current audio content, engine and language') {
      clickCallback = source.slice(onClick.start, onClick.end);
    }
    if (label === 'Audio content') contentModeCallback = source.slice(onChange.start, onChange.end);
    if (label === 'Engine') engineCallback = source.slice(onChange.start, onChange.end);
  },
});
assert.ok(clickCallback, 'The Retranscribe button must use the explicit retranscription action');

function evaluate(code, context) {
  return vm.runInContext(`(${stripTypeScriptTypes(code)})`, context);
}

function harness(options = {}) {
  const previousCaptions = [{ start: 1, end: 2, text: 'Old edited lyrics' }];
  const captions = [{ start: 1, end: 2, text: 'Jingle bells' }];
  const original = {
    id: 'song', status: options.status || 'transcribed', video: { name: 'song.mp4', file: { name: 'song.mp4' } },
    language: 'English', captions: previousCaptions, outputUrl: 'file:///old-export.mp4',
    outputPath: 'D:\\old-export.mp4', outputFileName: 'old-export.mp4', progress: 100,
  };
  const calls = { transcriptions: [], exports: [], patches: [] };
  const state = { item: original, burnedUrl: original.outputUrl, editingCapIndex: 0 };
  const context = {
    AbortController, console: { error() {} },
    S: { language: 'English', engine: 'local', contentMode: options.mode || 'song', maxWordsPerCaption: 8 },
    apiKey: '', processing: false, autoBurn: options.autoBurn ?? true,
    activeItem: original, abortControllersRef: { current: {} }, eraseJobRef: { current: null },
    CAPTION_LANGUAGES: ['Auto-Detect', 'English'],
    upd(id, patch) { calls.patches.push(patch); state.item = { ...state.item, ...patch }; },
    setProc(value) { context.processing = value; },
    setS(update) { context.S = update(context.S); },
    setAutoBurn(value) { context.autoBurn = value; },
    setEditingCapIndex(value) { state.editingCapIndex = value; },
    setBurnedVideoUrl(value) { state.burnedUrl = value; },
    setError(value) { state.error = value; },
    notify() {},
    isCancelError(error) { return error.name === 'AbortError'; },
    async transcribeWithHuggingFace(...args) {
      calls.transcriptions.push(args);
      args[4]('Transcribing', 8);
      if (options.result) return options.result(args);
      return { captions, detectedLang: 'English' };
    },
    async burnItem(...args) { calls.exports.push(args); },
  };
  vm.createContext(context);
  for (const name of ['transcribeItem', 'processSingleItem', 'retranscribeItem']) {
    assert.ok(callbacks.has(name), name);
    context[name] = evaluate(callbacks.get(name), context);
  }
  return {
    context, calls, state, original, captions, previousCaptions,
    click: evaluate(clickCallback, context),
    selectContentMode: evaluate(contentModeCallback, context),
    selectEngine: evaluate(engineCallback, context),
  };
}

test('Retranscribe reruns ASR for ready or exported captions, uses current settings and stops at review', async () => {
  for (const status of ['transcribed', 'completed']) {
    const h = harness({ status, autoBurn: true });
    h.original.video.sourcePath = 'D:\\clean-source.mp4';
    await h.click();
    assert.equal(h.calls.transcriptions.length, 1, status);
    const args = h.calls.transcriptions[0];
    assert.equal(args[0], h.original.video.file);
    assert.equal(args[1], 'English');
    assert.equal(args[5], 'local');
    assert.equal(args[7], 'song');
    assert.equal(args[8], 'D:\\clean-source.mp4');
    assert.equal(h.calls.exports.length, 0, 'Retranscribe must not export even with Auto Burn on');
    assert.equal(h.state.item.captions, h.captions);
    assert.equal(h.state.item.status, 'transcribed');
    assert.equal(h.state.item.outputPath, undefined);
    assert.equal(h.state.item.outputUrl, undefined);
    assert.equal(h.state.item.outputFileName, undefined);
    assert.equal(h.state.burnedUrl, null);
    assert.equal(h.state.editingCapIndex, null);
    assert.match(h.state.item.message, /Captions regenerated/);
    assert.equal(h.context.processing, false);
  }
});

test('switching to Song preserves existing edits until Retranscribe applies the new content setting', async () => {
  const h = harness({ mode: 'speech' });
  h.context.S.engine = 'groq';
  h.selectContentMode('Song / lyrics');
  assert.equal(h.state.item.captions, h.previousCaptions);
  assert.equal(h.calls.transcriptions.length, 0);
  assert.equal(h.context.S.contentMode, 'song');
  assert.equal(h.context.S.engine, 'local');
  await h.click();
  assert.equal(h.calls.transcriptions[0][7], 'song');
  assert.equal(h.calls.transcriptions[0][5], 'local');
});

test('Gemini engine selects song content and is preserved when Song is selected again', async () => {
  const h = harness({ mode: 'speech' });
  h.selectEngine('Gemini song accuracy');
  assert.equal(h.context.S.engine, 'gemini');
  assert.equal(h.context.S.contentMode, 'song');
  h.selectContentMode('Song / lyrics');
  assert.equal(h.context.S.engine, 'gemini');
  assert.equal(h.state.item.captions, h.previousCaptions);
  await h.click();
  assert.equal(h.calls.transcriptions[0][5], 'gemini');
  assert.equal(h.calls.transcriptions[0][7], 'song');
  h.selectContentMode('Speech');
  assert.equal(h.context.S.contentMode, 'speech');
  assert.equal(h.context.S.engine, 'local');
});

test('duplicate clicks share one active transcription and release the lock after completion', async () => {
  let finish;
  const h = harness({ result: () => new Promise(resolve => { finish = resolve; }) });
  const pending = h.click();
  await h.click();
  assert.equal(h.calls.transcriptions.length, 1);
  assert.equal(h.context.processing, true);
  finish({ captions: h.captions, detectedLang: 'English' });
  await pending;
  assert.equal(h.context.processing, false);
  assert.equal(Object.keys(h.context.abortControllersRef.current).length, 0);
});

test('failed or cancelled retranscription preserves the previous editor text and releases the lock', async () => {
  for (const name of ['Error', 'AbortError']) {
    const h = harness({ result: async () => { const error = new Error('Stopped'); error.name = name; throw error; } });
    await h.click();
    assert.equal(h.state.item.captions, h.previousCaptions);
    assert.equal(h.state.item.status, name === 'AbortError' ? 'cancelled' : 'failed');
    assert.equal(h.calls.exports.length, 0);
    assert.equal(h.context.processing, false);
    assert.equal(Object.keys(h.context.abortControllersRef.current).length, 0);
  }
});

test('song generation pauses for lyric review while Speech can still Auto Burn', async () => {
  for (const mode of ['song', 'speech']) {
    const h = harness({ mode, status: 'idle', autoBurn: true });
    h.original.captions = undefined;
    await h.context.processSingleItem(h.original, new AbortController().signal);
    assert.equal(h.calls.transcriptions.length, 1);
    assert.equal(h.calls.exports.length, mode === 'speech' ? 1 : 0);
    if (mode === 'song') {
      assert.equal(h.context.autoBurn, false);
      assert.equal(h.state.item.status, 'transcribed');
      assert.match(h.state.item.message, /Review lyrics and timing before Export Video/);
    }
  }
});
