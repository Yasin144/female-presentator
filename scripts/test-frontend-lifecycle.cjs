'use strict';

// Execute production callbacks with media/IPC mocks; never open the running app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

function sourceFile(relative) {
  const text = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  return { text, ast: parser.parse(text, { sourceType: 'module', plugins: ['jsx'] }) };
}
const app = sourceFile('src/App.jsx');
const resizer = sourceFile('src/components/VideoResizer/VideoResizer.jsx');
const quotes = sourceFile('src/components/QuoteStudio/QuoteStudio.jsx');
const exporter = sourceFile('src/components/MyExporter/MyExporter.jsx');
function find(file, predicate) {
  let result;
  traverse(file.ast, { enter(p) { if (!result && predicate(p.node, p)) result = p.node; } });
  assert.ok(result, 'Expected production node was not found');
  return result;
}
function code(file, node) { return file.text.slice(node.start, node.end); }
function variable(file, name) { return find(file, n => n.type === 'VariableDeclarator' && n.id.name === name); }
function callback(file, name, context = {}) {
  return vm.runInNewContext(`(${code(file, variable(file, name).init)})`, context);
}

test('mobile-link refresh shares the component callback with polling and IPC events', () => {
  let bindings = [];
  traverse(app.ast, { ReferencedIdentifier(p) {
    if (p.node.name === 'updateLinkState') bindings.push(p.scope.getBinding('updateLinkState'));
  } });
  assert.ok(bindings.length >= 6);
  assert.ok(bindings.every(binding => binding && binding === bindings[0]));
  assert.equal(bindings[0].scope.path.node.id.name, 'App');
  let state = { wifiUrl: 'http://lan.example', mobileUrl: '', updatedAt: '' };
  const update = callback(app, 'updateLinkState', {
    useCallback: fn => fn,
    setMobileLinkData: fn => { state = fn(state); },
  });
  update({ mobileUrl: 'https://mock.example', wifiUrl: 'http://lan.example', updatedAt: 'mock-time' });
  assert.equal(state.mobileUrl, 'https://mock.example');
  assert.equal(state.updatedAt, 'mock-time');
  const previous = state;
  update({ mobileUrl: 'https://mock.example', wifiUrl: 'http://lan.example' });
  assert.equal(state, previous);
  update({ mobileUrl: 'https://new.mock.example' });
  assert.equal(state.wifiUrl, 'http://lan.example');
  update(null);
  assert.equal(state.mobileUrl, 'https://new.mock.example');
});

function previewSync() {
  const node = find(resizer, n => n.type === 'FunctionDeclaration' && n.id.name === 'syncResizerPreviewMedia');
  return vm.runInNewContext(`(${code(resizer, node)})`);
}
function media(overrides = {}) {
  return { currentTime: 0, playbackRate: 1, paused: false, ended: false, seeking: false,
    plays: 0, pauses: 0,
    play() { this.plays += 1; return Promise.resolve(); },
    pause() { this.pauses += 1; }, ...overrides };
}
test('resizer background follows playback, position, rate and remains muted', () => {
  const fg = media({ currentTime: 7.5, playbackRate: 1.5 });
  const bg = media();
  previewSync()(fg, bg);
  assert.equal(bg.currentTime, 7.5);
  assert.equal(bg.playbackRate, 1.5);
  assert.equal(bg.muted, true);
  assert.equal(bg.plays, 1);
});
test('resizer background stops for pause, end and seeking, then follows exact seeks', () => {
  for (const state of ['paused', 'ended', 'seeking']) {
    const fg = media({ [state]: true, currentTime: 3.08 });
    const bg = media({ currentTime: 3 });
    previewSync()(fg, bg, true);
    assert.equal(bg.pauses, 1);
    assert.equal(bg.plays, 0);
    assert.equal(bg.currentTime, 3.08);
  }
});
test('resizer tolerates unavailable media and autoplay rejection', async () => {
  const sync = previewSync();
  assert.doesNotThrow(() => sync(null, null));
  assert.doesNotThrow(() => sync(media(), media({ play() { throw new Error('loading'); } })));
  sync(media(), media({ play() { return Promise.reject(new Error('autoplay blocked')); } }));
  await new Promise(resolve => setImmediate(resolve));
});
test('resizer main video wires every playback transition to synchronization', () => {
  const video = find(resizer, n => n.type === 'JSXOpeningElement' && n.name.name === 'video' &&
    n.attributes.some(a => a.name?.name === 'ref' && a.value?.expression?.name === 'previewVideoRef'));
  const attributes = new Set(video.attributes.map(a => a.name?.name));
  for (const name of ['onPlay', 'onPlaying', 'onPause', 'onEnded', 'onSeeking', 'onSeeked', 'onRateChange', 'onTimeUpdate']) {
    assert.ok(attributes.has(name), name);
  }
});
test('navigation visibility reaches Quote Studio and Video Resizer', () => {
  for (const name of ['QuoteStudio', 'VideoResizer']) {
    const component = find(app, n => n.type === 'JSXOpeningElement' && n.name.name === name);
    const active = component.attributes.find(a => a.name?.name === 'active');
    assert.ok(active);
    assert.match(code(app, active), /!captionOpen/);
    assert.match(code(app, active), /currentModule/);
  }
});

function quotePreview(context = {}) {
  const names = ['stopPreviewMusic', 'stopPreviewSpeech', 'startPreviewMusic', 'speak'];
  const defs = names.map(name => `const ${code(quotes, variable(quotes, name))};`).join('\n');
  const refs = {
    previewMusicGenerationRef: { current: 0 }, previewSourceRef: { current: null },
    previewGainRef: { current: null }, previewSpeechRef: { current: null },
  };
  const env = { ...refs, active: true, voiceOn: true, musicOn: true, time: 0, volume: 18,
    autoDucking: true, musicStart: 0, voice: 'Warm Female', storyLines: ['A local preview.'],
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)), ...context };
  const api = vm.runInNewContext(`(()=>{${defs};return{${names.join(',')}}})()`, env);
  return { api, refs, env };
}
test('Quote Studio cancels only its own narration, never unrelated speech on initial mount', () => {
  let cancels = 0;
  const synth = { cancel() { cancels += 1; }, speak() {} };
  const { api, refs } = quotePreview({ window: { speechSynthesis: synth }, speechSynthesis: synth,
    SpeechSynthesisUtterance: function(text) { this.text = text; } });
  api.stopPreviewSpeech();
  assert.equal(cancels, 0);
  api.speak();
  assert.ok(refs.previewSpeechRef.current);
  api.stopPreviewSpeech();
  assert.equal(cancels, 1);
  assert.equal(refs.previewSpeechRef.current, null);
  api.stopPreviewSpeech();
  assert.equal(cancels, 1);
});
test('Quote Studio stops narration on pause, hide, voice-off and unmount', () => {
  const effect = find(quotes, n => n.type === 'CallExpression' && n.callee.name === 'useEffect' &&
    n.arguments[1]?.elements?.map(x => x.name).join(',') === 'playing,active,voiceOn');
  for (const state of [{ playing: false, active: true, voiceOn: true },
    { playing: true, active: false, voiceOn: true }, { playing: true, active: true, voiceOn: false }]) {
    let stopped = 0, hiddenPause = 0;
    vm.runInNewContext(`(${code(quotes, effect.arguments[0])})()`, {
      ...state, stopPreviewSpeech: () => stopped++, setPlaying: value => { if (!value) hiddenPause++; },
    });
    assert.equal(stopped, 1);
    assert.equal(hiddenPause, state.active ? 0 : 1);
  }
  const cleanup = find(quotes, n => n.type === 'CallExpression' && n.callee.name === 'useEffect' &&
    n.arguments[1]?.elements?.length === 0 && code(quotes, n.arguments[0]).includes('stopPreviewSpeech'));
  let stopped = 0;
  const dispose = vm.runInNewContext(`(${code(quotes, cleanup.arguments[0])})()`, {
    stopPreviewSpeech: () => stopped++, stopPreviewMusic: () => {},
  });
  dispose();
  assert.equal(stopped, 1);
});
test('pending Quote Studio music cannot start after pause or navigation cleanup', async () => {
  let resolve, starts = 0;
  const ready = new Promise(done => { resolve = done; });
  const { api } = quotePreview({ ensureSoundtrack: () => ready });
  const pending = api.startPreviewMusic();
  api.stopPreviewMusic();
  resolve({ ctx: { createBufferSource() { starts++; throw new Error('Must not start'); } }, buffer: {} });
  await pending;
  assert.equal(starts, 0);
});
test('Quote Studio track changes use the new render, and music-off is a playback dependency', () => {
  const change = code(quotes, variable(quotes, 'changeMusic'));
  assert.doesNotMatch(change, /setTimeout|startPreviewMusic/);
  const effect = find(quotes, n => n.type === 'CallExpression' && n.callee.name === 'useEffect' &&
    code(quotes, n.arguments[0]).includes('startPreviewMusic(time)'));
  const dependencies = code(quotes, effect.arguments[1]);
  assert.match(dependencies, /active/);
  assert.match(dependencies, /musicOn/);
  assert.match(dependencies, /soundtrack\.id/);
});

test('Quote Studio rejects misleading narration export before capture or IPC', async () => {
  const notices = [];
  const exportVideo = callback(quotes, 'exportVideo', {
    exporting: false, voiceOn: true, setExportStatus: value => notices.push(value),
  });
  await exportVideo();
  assert.equal(notices.length, 1);
  assert.equal(notices[0].error, true);
  assert.match(notices[0].phase, /preview-only.*not included.*Turn off Preview voice/);
  assert.match(quotes.text, /Preview voice \(not exported\)/);
  assert.doesNotMatch(quotes.text, /primary mix|Auto ducking protects narration/);
});

test('My Exporter audio selection clears multi-scene selection and can mark cut start/end', () => {
  let selectedIds, progress;
  const env = {
    selectedAudioId: '', audioCutSelectionModeId: 'audio-1', audioSelectionRef: { current: null },
    setSelectedAudioId: value => { env.selectedAudioId = value; }, setSelectedId: () => {},
    setSelectedCaptionId: () => {}, setSelectedIds: value => { selectedIds = value; },
    setAudioSelection: value => { env.audioSelectionRef.current = value; },
    setAudioCutSelectionModeId: value => { env.audioCutSelectionModeId = value; },
    setProgress: value => { progress = value; }, seekTimeline: () => {},
  };
  const select = callback(exporter, 'selectAudioAtPointer', env);
  const event = { clientX: 25, target: { closest: () => null },
    currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) } };
  select(event, { id: 'audio-1', start: 0, duration: 10 });
  assert.equal(selectedIds.length, 0);
  assert.equal(env.audioSelectionRef.current.start, 2.5);
  assert.equal(env.audioSelectionRef.current.awaitingEnd, true);
  select({ ...event, clientX: 75 }, { id: 'audio-1', start: 0, duration: 10 });
  assert.equal(env.audioSelectionRef.current.start, 2.5);
  assert.equal(env.audioSelectionRef.current.end, 7.5);
  assert.equal(env.audioSelectionRef.current.awaitingEnd, false);
  assert.match(progress.phase, /END set/);
});
test('My Exporter project operations refuse work while processing', async () => {
  for (const name of ['newProject', 'saveProject', 'deleteProject']) {
    await callback(exporter, name, { blockBusyProjectChange: () => true })();
  }
  let reads = 0;
  const event = { target: { files: [{ text() { reads++; throw new Error('Busy file must not be read'); } }], value: 'x' } };
  await callback(exporter, 'openProjectFile', { blockBusyProjectChange: () => true })(event);
  assert.equal(reads, 0);
  assert.equal(event.target.value, '');
});
test('My Exporter rechecks processing after asynchronous project reads and dialogs', async () => {
  let busy = false;
  const open = callback(exporter, 'openProjectFile', { blockBusyProjectChange: () => busy });
  await open({ target: { files: [{ async text() { busy = true; return '{"format":"pattan-my-exporter-project"}'; } }], value: '' } });
  busy = false;
  const save = callback(exporter, 'saveProject', {
    blockBusyProjectChange: () => busy, projectName: 'Mock project',
    window: { electronAPI: { async showSaveDialog() { busy = true; return { filePath: 'D:/mock.pattanproject' }; } } },
  });
  await save();
});
test('My Exporter does not overwrite active project UI after pending save/delete completes', async () => {
  let busy = false, warning = '';
  const projectBusyRef = { current: false };
  const common = { blockBusyProjectChange: () => busy, projectName: 'Mock project',
    projectPath: 'D:/mock.pattanproject', projectBusyRef, setWarning: value => { warning = value; } };
  const save = callback(exporter, 'saveProject', {
    ...common, projectData: () => ({}), textToBase64: text => text,
    window: { electronAPI: {
      async showSaveDialog() { return { filePath: 'D:/mock.pattanproject' }; },
      async writeFile() { busy = true; return { ok: true }; },
    } },
  });
  await save();
  busy = false;
  const remove = callback(exporter, 'deleteProject', {
    ...common, window: { confirm: () => true, electronAPI: {
      async myExporterDeleteProject() { projectBusyRef.current = true; return { ok: true }; },
    } },
  });
  await remove();
  assert.match(warning, /active processing project was kept open/);
});
test('My Exporter project toolbar controls are disabled during processing', () => {
  const handlers = new Set(['newProject', 'saveProject', 'deleteProject']);
  let count = 0;
  traverse(exporter.ast, { JSXOpeningElement(p) {
    const click = p.node.attributes.find(a => a.name?.name === 'onClick');
    const expression = click?.value?.expression;
    if (!handlers.has(expression?.name) && !(expression && code(exporter, expression).includes('projectInput.current?.click()'))) return;
    count++;
    const disabled = p.node.attributes.find(a => a.name?.name === 'disabled');
    assert.ok(disabled);
    assert.match(code(exporter, disabled), /captioning \|\| exporting/);
  } });
  assert.ok(count >= 8);
});
test('active React components have no undefined callback identifiers', () => {
  const globals = require('globals');
  for (const file of [app, quotes, resizer, exporter]) {
    const unknown = [];
    traverse(file.ast, { ReferencedIdentifier(p) {
      const name = p.node.name;
      if (!p.scope.getBinding(name) && !(name in globals.browser) && !(name in globals.es2025)) unknown.push(`${name}:${p.node.loc.start.line}`);
    } });
    assert.deepEqual(unknown, []);
  }
});

test('unsupported Quote Studio controls are disabled without replacing saved preferences', () => {
  for (const expression of ['language', 'series', 'brand.brandFont', 'brand.outro', 'brand.watermark', 'brand.intro']) {
    const control = find(quotes, n => n.type === 'JSXOpeningElement' && ['input', 'select'].includes(n.name.name) &&
      n.attributes.some(a => ['value', 'checked'].includes(a.name?.name) && a.value?.expression && code(quotes, a.value.expression) === expression));
    assert.ok(control.attributes.some(a => a.name?.name === 'disabled'), expression);
    assert.ok(control.attributes.some(a => a.name?.name === 'title'), `${expression} needs an explanation`);
  }
  assert.match(quotes.text, /Language \(English only\)/);
  assert.match(quotes.text, /Creator series \(unavailable\)/);
  assert.match(quotes.text, /Brand font \(unavailable\)/);
  assert.match(quotes.text, /Outro style \(unavailable\)/);
  assert.match(quotes.text, /Watermark \(not applied\)/);
  assert.match(quotes.text, /Intro \(unavailable\)/);
});
test('working Quote Studio controls stay enabled and text styles disclose preview-only scope', () => {
  for (const expression of ['animation', 'brand.channelName', 'brand.handle', 'brand.preferredCta', 'brand.branding']) {
    const control = find(quotes, n => n.type === 'JSXOpeningElement' && ['input', 'select'].includes(n.name.name) &&
      n.attributes.some(a => ['value', 'checked'].includes(a.name?.name) && a.value?.expression && code(quotes, a.value.expression) === expression));
    assert.ok(!control.attributes.some(a => a.name?.name === 'disabled'), expression);
  }
  assert.match(quotes.text, /Preview text style \(not exported\)/);
  assert.match(quotes.text, /export uses static text/);
  assert.match(quotes.text, /value="word-reveal" disabled/);
  assert.match(quotes.text, /value="typewriter">Soft Fade/);
});
