'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let tools;
before(async () => { tools = await import('../src/studioTools.mjs'); });

function fixture(fromPreview = true, state = {}) {
  const calls = [];
  const node = (id, hidden = false) => {
    const classes = new Set(hidden ? ['hidden'] : []);
    return { id, hidden: false, open: false, dataset: {}, value: 'Retain selected files and text',
      classList: { contains: value => classes.has(value), add: value => classes.add(value), remove: value => classes.delete(value) },
      scrollIntoView: options => calls.push(['scroll', id, options]),
      querySelector: selector => selector === 'summary' ? ({ focus: options => calls.push(['focus', id, selector, options]) }) : null,
    };
  };
  const input = node('inputPanel', fromPreview), stage = node('stagePanel', !fromPreview);
  const entries = new Map([['inputPanel', input], ['stagePanel', stage], ['introPosterSection', node('introPosterSection')], ...tools.PREPARATION_TOOLS.map(tool => [tool.id, node(tool.id)])]);
  return { input, stage, entries, calls, context: { document: { getElementById: id => entries.get(id) }, state } };
}

test('all retained tool destinations exist once, with Sing Song and local captions prominently listed', () => {
  const input = fs.readFileSync(path.join(__dirname, '../src/components/InputPanel.jsx'), 'utf8');
  assert.equal(new Set(tools.PREPARATION_TOOLS.map(tool => tool.id)).size, 10);
  assert.deepEqual(tools.PREPARATION_TOOLS.filter(tool => tool.primary).map(tool => tool.id), ['singSongSection', 'aiCaptionSection']);
  for (const tool of tools.PREPARATION_TOOLS) assert.equal(input.split(`id="${tool.id}"`).length - 1, 1, tool.id);
});

test('idle preview navigation only reveals and focuses the existing section, retaining live data', () => {
  const state = { pdf: { currentTimeMs: 1200, pages: [1, 2] }, images: [{ name: 'original' }] };
  const f = fixture(true, state), before = JSON.stringify(state);
  const target = f.entries.get('singSongSection');
  assert.deepEqual(tools.revealPreparationTool('singSongSection', f.context), { ok: true });
  assert.equal(f.entries.get('singSongSection'), target);
  assert.equal(target.value, 'Retain selected files and text');
  assert.equal(target.open, true);
  assert.equal(f.input.classList.contains('hidden'), false);
  assert.equal(f.stage.classList.contains('hidden'), true);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(f.calls.map(call => call[0]), ['scroll', 'focus']);
});

test('each in-flight presentation state refuses tool navigation without mutating work or visibility', () => {
  const states = [undefined, { speaking: true }, { exportingVideo: true }, { generatingNarration: true },
    { pdfLoading: true }, { inputPreviewing: true }, { pdf: { preparingNarration: true } },
    { pdf: { preparingArtwork: true } }, { activeAudio: {} }, { introPlayback: { active: true } },
    { recording: { recorder: { state: 'recording' } } }, { actionLocks: { export: true } },
    { actionLocks: { pdfPresent: true } }, { actionLocks: { play: true } },
    { stageVideo: { element: { paused: false, ended: false } } }];
  for (const state of states) {
    const f = fixture(true);
    f.context.state = state;
    const before = JSON.stringify(state);
    const result = tools.revealPreparationTool('aiCaptionSection', f.context);
    assert.equal(result.ok, false, before || 'unknown state');
    assert.match(result.message, /busy/);
    assert.equal(f.input.classList.contains('hidden'), true);
    assert.equal(f.stage.classList.contains('hidden'), false);
    assert.equal(f.entries.get('aiCaptionSection').open, false);
    assert.deepEqual(f.calls, []);
    assert.equal(JSON.stringify(state), before);
  }
});

test('export preparation guard is honored independently of the visible state', () => {
  const f = fixture();
  f.context.exporting = true;
  assert.equal(tools.revealPreparationTool('singSongSection', f.context).ok, false);
  assert.deepEqual(f.calls, []);
});

test('a job beginning after the initial check still prevents the deferred reveal', () => {
  const f = fixture(true, {});
  assert.equal(tools.checkPreparationToolAccess('singSongSection', f.context).ok, true);
  f.context.state.generatingNarration = true;
  assert.equal(tools.revealPreparationTool('singSongSection', f.context).ok, false);
  assert.deepEqual(f.calls, []);
});

test('already visible preparation tools may show progress without stopping a background job', () => {
  const state = { generatingNarration: true, actionLocks: { export: true } };
  const f = fixture(false, state), before = JSON.stringify(state);
  assert.equal(tools.revealPreparationTool('aiCaptionSection', f.context).ok, true);
  assert.equal(JSON.stringify(state), before);
  assert.equal(f.stage.classList.contains('hidden'), true);
});

test('invalid targets and incomplete startup produce a readable error and no actions', () => {
  const f = fixture();
  assert.equal(tools.revealPreparationTool('captionVideoInput', f.context).ok, false);
  f.entries.delete('singSongSection');
  assert.match(tools.revealPreparationTool('singSongSection', f.context).message, /loading/);
  assert.deepEqual(f.calls, []);
});

test('a focused song tool exposes no unrelated lesson, PDF, or caption sections', () => {
  const f = fixture(false);
  f.input.children = [...f.entries.values()].filter(node => node !== f.input && node !== f.stage);
  tools.focusPreparationTool('singSongSection', f.context.document);
  assert.deepEqual(f.input.children.filter(node => node.dataset.studioToolVisible === 'true').map(node => node.id), ['singSongSection']);
  assert.ok(f.input.children.every(node => node.value === 'Retain selected files and text'));
});

test('written lessons include only their relevant preparation helpers', () => {
  const f = fixture(false);
  f.input.children = [...f.entries.values()].filter(node => node !== f.input && node !== f.stage);
  tools.focusPreparationTool('lessonContentSection', f.context.document);
  const visible = f.input.children.filter(node => node.dataset.studioToolVisible === 'true').map(node => node.id).sort();
  assert.deepEqual(visible, ['lessonContentSection', 'introPosterSection', 'mediaSection', 'narrationSection', 'speechToolsSection', 'templateWorkflowSection'].sort());
});

test('PDF Presenter exposes its own PDF controls and the shared Intro & Poster section', () => {
  const f = fixture(false);
  f.input.children = [...f.entries.values()].filter(node => node !== f.input && node !== f.stage);
  tools.focusPreparationTool('pdfSection', f.context.document);
  const visible = f.input.children.filter(node => node.dataset.studioToolVisible === 'true').map(node => node.id).sort();
  assert.deepEqual(visible, ['introPosterSection', 'pdfSection']);
});

test('the local caption action strip belongs only to the local caption screen', () => {
  const f = fixture(false);
  const strip = { id: '', dataset: {}, classList: { contains: () => false }, querySelector: selector => selector === '#aiCapSttBtn' ? {} : null };
  f.input.children = [strip, f.entries.get('aiCaptionSection'), f.entries.get('singSongSection')];
  tools.focusPreparationTool('aiCaptionSection', f.context.document);
  assert.equal(strip.dataset.studioToolVisible, 'true');
  tools.focusPreparationTool('singSongSection', f.context.document);
  assert.equal(strip.dataset.studioToolVisible, 'false');
  assert.equal(f.entries.get('aiCaptionSection').dataset.studioToolVisible, 'false');
});
