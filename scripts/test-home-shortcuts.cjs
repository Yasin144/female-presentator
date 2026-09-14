'use strict';

// Run the actual production handlers in a DOM-shaped sandbox. No app launch,
// media playback, renderer reload, service request, or file selection occurs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const ast = parser.parse(source, { sourceType: 'script' });
const code = node => source.slice(node.start, node.end);
let guard, draftHandler, presentationHandler;
traverse(ast, {
  FunctionDeclaration({ node }) {
    if (node.id?.name === 'canUsePresentatorKeyboardShortcuts') guard = node;
  },
  CallExpression({ node }) {
    if (node.callee.object?.name !== 'document' || node.callee.property?.name !== 'addEventListener' ||
        node.arguments[0]?.value !== 'keydown') return;
    const callback = node.arguments[1];
    if (!callback || !code(callback).includes('canUsePresentatorKeyboardShortcuts()')) return;
    if (code(callback).includes('saveDraft()')) draftHandler = callback;
    if (code(callback).includes('showScreenBtn')) presentationHandler = callback;
  },
});
assert.ok(guard && draftHandler && presentationHandler, 'Both production shortcut handlers must use the view guard');

function fixture(options = {}) {
  const calls = [];
  const makeNode = (id, visible = true) => ({
    id, hidden: false, visible, display: 'block', visibility: 'visible', style: {},
    getClientRects() { return this.visible && !this.hidden ? [{}] : []; },
    classList: { contains: name => name === 'hidden' && !visible },
    click: () => calls.push(id),
  });
  const input = makeNode('inputPanel', !options.stage);
  const stage = makeNode('stagePanel', Boolean(options.stage));
  const workspace = makeNode('workspace', options.workspaceVisible !== false);
  const shell = {
    dataset: { module: options.module || 'presentator', section: options.section || 'pdfSection', caption: String(Boolean(options.caption)) },
    querySelector: () => workspace,
  };
  const modals = [];
  const nodes = new Map([['inputPanel', input], ['stagePanel', stage],
    ...['showScreenBtn', 'editBtn', 'playBtn', 'downloadBtn', 'prevPageBtn', 'nextPageBtn'].map(id => [id, makeNode(id)]),
  ]);
  const context = vm.createContext({
    window: { getComputedStyle: element => ({ display: element.display, visibility: element.visibility }) },
    document: {
      querySelector: () => options.legacy ? null : shell,
      querySelectorAll: () => modals,
      getElementById: id => nodes.get(id),
      body: { classList: { contains: name => name === 'tdub-open' && Boolean(options.translator) } },
    },
    inputPanel: input, stagePanel: stage, shortcutsOverlay: { style: {} },
    saveDraft: () => calls.push('saveDraft'),
  });
  vm.runInContext(code(guard), context);
  const handlers = [draftHandler, presentationHandler].map(node => vm.runInContext(`(${code(node)})`, context));
  const key = (value, ctrlKey = true) => {
    const event = { key: value, ctrlKey, target: { tagName: 'BUTTON' }, preventDefault() { this.defaultPrevented = true; } };
    handlers.forEach(handler => handler(event));
    return event;
  };
  return { calls, shell, input, stage, workspace, modals, makeNode, key, guard: context.canUsePresentatorKeyboardShortcuts };
}

test('Home and the other mounted workspaces cannot invoke lesson shortcuts', () => {
  for (const module of ['home', 'quotes', 'exporter', 'resizer']) {
    for (const stage of [false, true]) {
      const f = fixture({ module, stage });
      for (const key of ['s', 'Enter', 'e', 'p', 'ArrowUp', 'ArrowDown', 'Escape']) {
        assert.equal(f.key(key, key !== 'Escape').defaultPrevented, undefined, module + ': ' + key);
      }
      assert.deepEqual(f.calls, [], module);
    }
  }
});

test('Sing Song, local captions, and other focused helpers do not control the lesson', () => {
  for (const section of ['singSongSection', 'aiCaptionSection', 'audioToTextSection', 'narrationSection', 'speechToolsSection', 'mediaSection', 'templateWorkflowSection', 'serverControlsSection']) {
    const f = fixture({ section });
    for (const key of ['s', 'Enter', 'e', 'p', 'ArrowDown']) f.key(key);
    assert.deepEqual(f.calls, [], section);
  }
});

test('visible PDF and written lesson screens retain save and preview shortcuts', () => {
  for (const section of ['pdfSection', 'lessonContentSection']) {
    const f = fixture({ section });
    f.key('s');
    f.key('Enter');
    assert.deepEqual(f.calls, ['saveDraft', 'showScreenBtn'], section);
  }
});

test('visible stage retains play, export, page navigation, and back controls', () => {
  const f = fixture({ stage: true, section: 'mediaSection' });
  f.key('p');
  f.key('e');
  f.key('ArrowUp');
  f.key('ArrowDown');
  f.key('Escape', false);
  assert.deepEqual(f.calls, ['playBtn', 'downloadBtn', 'prevPageBtn', 'nextPageBtn', 'editBtn']);
});

test('Caption Burner and Translate Audio prevent shortcuts reaching the mounted lesson', () => {
  for (const options of [{ caption: true }, { translator: true }]) {
    const f = fixture({ ...options, stage: true });
    f.key('Escape', false);
    f.key('p');
    f.key('e');
    assert.deepEqual(f.calls, []);
  }
});

test('visible dialogs block lesson shortcuts and Escape never clicks the underlying Edit button', () => {
  const f = fixture({ stage: true });
  f.modals.push(f.makeNode('search-dialog'));
  for (const key of ['Escape', 'p', 'e', 'ArrowDown']) f.key(key, key !== 'Escape');
  assert.deepEqual(f.calls, []);
  f.modals[0].visible = false;
  f.key('p');
  assert.deepEqual(f.calls, ['playBtn'], 'A mounted but hidden dialog does not disable shortcuts');
});

test('actual workspace and panel visibility are required independently of module state', () => {
  const f = fixture({ stage: true, workspaceVisible: false });
  assert.equal(f.guard(), false);
  f.workspace.visible = true;
  f.workspace.display = 'none';
  assert.equal(f.guard(), false);
  f.workspace.display = 'block';
  f.workspace.visibility = 'hidden';
  assert.equal(f.guard(), false);
  f.workspace.visibility = 'visible';
  f.stage.hidden = true;
  assert.equal(f.guard(), false);
  f.stage.hidden = false;
  assert.equal(f.guard(), true);
});

test('view-only shortcut guard leaves the original media nodes and state untouched', () => {
  const f = fixture({ module: 'home', stage: true });
  const inputBefore = { hidden: f.input.hidden, visible: f.input.visible };
  const stageBefore = { hidden: f.stage.hidden, visible: f.stage.visible };
  for (let index = 0; index < 4; index++) assert.equal(f.guard(), false);
  assert.deepEqual({ hidden: f.input.hidden, visible: f.input.visible }, inputBefore);
  assert.deepEqual({ hidden: f.stage.hidden, visible: f.stage.visible }, stageBefore);
  assert.deepEqual(f.calls, []);
});

test('standalone legacy pages without the simple shell preserve their existing shortcuts', () => {
  const f = fixture({ legacy: true, module: 'home', section: 'singSongSection' });
  f.key('s');
  f.key('Enter');
  assert.deepEqual(f.calls, ['saveDraft', 'showScreenBtn']);
});
