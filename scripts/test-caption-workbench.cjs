'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

let workbench;
test.before(async () => {
  // Transform the actual component without starting a dev server or its optimizer.
  const { transformWithOxc } = await import('vite');
  const stripModuleSyntax = code => code.replace(/^import .*;\r?\n/gm, '')
    .replace(/^export default .*;\r?\n/gm, '').replace(/^export /gm, '');
  const toolsPath = path.resolve(__dirname, '../src/caption/caption-tools.ts');
  const toolsResult = await transformWithOxc(fs.readFileSync(toolsPath, 'utf8'), toolsPath);
  const names = ['parseSubtitleFile', 'serializeSubtitles', 'inspectCaptionQuality', 'shiftCaptionTiming',
    'scaleCaptionTiming', 'replaceCaptionText', 'fitLyricsToCaptions', 'splitCaption', 'mergeCaptionWithNext'];
  const utils = new Function(stripModuleSyntax(toolsResult.code) + `\nreturn {${names.join(',')}};`)();
  const workbenchPath = path.resolve(__dirname, '../src/caption/CaptionWorkbench.tsx');
  const result = await transformWithOxc(fs.readFileSync(workbenchPath, 'utf8'), workbenchPath, { jsx: { runtime: 'classic' } });
  workbench = new Function('React', 'utils',
    `const {useEffect,useMemo,useRef,useState}=React; const {${names.join(',')}}=utils;\n`
    + stripModuleSyntax(result.code)
    + '\nreturn {CaptionWorkbench,recordCaptionHistory,travelCaptionHistory,validateCaptionTimingEdit};')(React, utils);
});

const caption = (overrides = {}) => ({
  start: 1, end: 3, text: 'Jingle bells',
  words: [{ text: 'Jingle', start: 1, end: 1.8 }, { text: 'bells', start: 2, end: 3 }],
  ...overrides,
});
const snapshot = (start = 1, timingSource = 'word') => ({
  captions: [caption({ start, end: start + 2, words: undefined })],
  timingSource,
  warnings: timingSource === 'estimated' ? ['Review song timing'] : [],
});

test('word timing editor accepts valid bounds and returns independent word objects', () => {
  const original = caption();
  const accepted = workbench.validateCaptionTimingEdit(original, 8);
  assert.deepEqual(accepted, original);
  assert.notEqual(accepted.words[0], original.words[0]);
});

test('timing editor rejects incomplete, inverted and out-of-video caption times', () => {
  for (const invalid of [
    caption({ start: NaN }), caption({ end: Infinity }),
    caption({ start: -1 }), caption({ end: 1 }), caption({ end: 9 }),
  ]) assert.throws(() => workbench.validateCaptionTimingEdit(invalid, 8));
});

test('timing editor rejects word times outside cue bounds or overlapping words', () => {
  for (const words of [
    [{ text: 'Jingle', start: .5, end: 1.8 }],
    [{ text: 'bells', start: 2, end: 3.5 }],
    [{ text: 'bells', start: 2, end: 2 }],
    [{ text: 'Jingle', start: 1, end: 2.1 }, { text: 'bells', start: 2, end: 3 }],
    [{ text: 'bells', start: NaN, end: 3 }],
  ]) assert.throws(() => workbench.validateCaptionTimingEdit(caption({ words }), 8));
});

test('submillisecond violations cannot be saved and fail the same bounds as later export tools', () => {
  assert.throws(() => workbench.validateCaptionTimingEdit(caption({ end: 3.0005 }), 3), /after the video/);
  assert.throws(() => workbench.validateCaptionTimingEdit(caption({
    words: [{ text: 'Jingle', start: .9995, end: 1.8 }, { text: 'bells', start: 2, end: 3 }],
  }), 8), /inside/);
  assert.throws(() => workbench.validateCaptionTimingEdit(caption({
    words: [{ text: 'Jingle', start: 1, end: 1.8 }, { text: 'bells', start: 2, end: 3.0005 }],
  }), 8), /inside/);
  assert.throws(() => workbench.validateCaptionTimingEdit(caption({
    words: [{ text: 'Jingle', start: 1, end: 2.0005 }, { text: 'bells', start: 2, end: 3 }],
  }), 8), /overlaps/);
});

test('history keeps at most 30 edits and does not duplicate parent acknowledgments', () => {
  let history = { past: [], present: snapshot(), future: [] };
  for (let index = 2; index <= 45; index++) history = workbench.recordCaptionHistory(history, snapshot(index));
  assert.equal(history.past.length, 30);
  assert.equal(history.present.captions[0].start, 45);
  assert.equal(workbench.recordCaptionHistory(history, snapshot(45)), history);
});

test('undo and redo restore words and timing provenance, while new edits clear redo', () => {
  let history = { past: [], present: { ...snapshot(), captions: [caption()] }, future: [] };
  history = workbench.recordCaptionHistory(history, snapshot(2, 'estimated'));
  const undone = workbench.travelCaptionHistory(history, 'undo');
  assert.equal(undone.present.timingSource, 'word');
  assert.equal(undone.present.captions[0].words[0].text, 'Jingle');
  const redone = workbench.travelCaptionHistory(undone, 'redo');
  assert.equal(redone.present.timingSource, 'estimated');
  assert.deepEqual(redone.present.warnings, ['Review song timing']);
  const changed = workbench.recordCaptionHistory(undone, snapshot(4));
  assert.equal(changed.future.length, 0);
  const original = snapshot(7);
  const copied = workbench.recordCaptionHistory(changed, original);
  original.captions[0].text = 'Changed externally';
  assert.equal(copied.present.captions[0].text, 'Jingle bells');
});

test('workbench renders all advanced operations and discloses estimated timing', () => {
  const html = renderToStaticMarkup(React.createElement(workbench.CaptionWorkbench, {
    itemId: 'song', videoName: 'Song.mp4', captions: [caption()], duration: 12,
    disabled: false, timingSource: 'estimated', warnings: ['Review timing'],
    onChange() {}, onSeek() {},
  }));
  for (const text of ['Export SRT', 'Export VTT', 'Save editable draft (JSON)', 'Use exact lyrics', 'Save timing', 'Split caption', 'Merge with next', 'Apply shift', 'Apply stretch', 'Replace all matches', 'Quality review', 'Some word times are estimated']) {
    assert.ok(html.includes(text), `Expected ${text}`);
  }
  assert.ok(!html.includes('Apply exact lyrics'), 'Lyrics must be reviewed before the Apply control appears');
});

test('empty busy workbench disables import and export without crashing', () => {
  const html = renderToStaticMarkup(React.createElement(workbench.CaptionWorkbench, {
    itemId: 'empty', videoName: 'New.mp4', captions: [], disabled: true,
    onChange() {}, onSeek() {},
  }));
  assert.match(html, /aria-label="Import subtitle file"[^>]*disabled=""/);
  assert.match(html, /disabled=""[^>]*>Export SRT/);
  assert.ok(html.includes('Generate or import captions first'));
});
