'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync(path.join(__dirname, '..', 'src/caption/burn.ts'), 'utf8')
  .split('export async function burnCaptions')[0].replace(/^import .*;\r?\n/gm, '');
const api = vm.runInNewContext(stripTypeScriptTypes(source).replace(/^export /gm, '')
  + '\n({ buildAss, captionGroupAtTime, normalizeCaptionTimeline, toAss })', {});
const settings = { fontSize: 50, fontColor: 'White', bgColor: 'Transparent', style: 'white-yellow',
  position: 'bottom', xPos: 50, yPos: 90, language: 'English', offset: 0, maxWordsPerCaption: 8 };
const meta = { width: 1920, height: 1080 };
const cueFromWords = words => ({ text: words.map(w => w.text).join(' '), start: words[0].start,
  end: words[words.length - 1].end, words });
const dialogues = text => text.split('\n').filter(line => line.startsWith('Dialogue:'));
const visible = line => line.split(',').slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/g, ' ').trim();
const plain = value => JSON.parse(JSON.stringify(value));
const parseTime = value => {
  const [h, m, s] = value.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

test('edited long caption uses the same bounded groups in Caption Burner preview and export', () => {
  const words = Array.from({ length: 13 }, (_, i) => ({ text: `word${i + 1}`, start: 1 + i * .2, end: 1.15 + i * .2 }));
  const cue = cueFromWords(words);
  for (const limit of [4, 8]) {
    const lines = dialogues(api.buildAss([cue], { ...settings, maxWordsPerCaption: limit }, meta));
    for (const line of lines) {
      const [start, end] = line.split(',').slice(1, 3).map(parseTime);
      const group = api.captionGroupAtTime(cue, (start + end) / 2, limit);
      assert.equal(group.text, visible(line));
      assert.ok(group.words.length <= limit);
    }
    assert.equal(api.captionGroupAtTime(cue, words[limit - 1].end + .01, limit), null,
      'A group must disappear at its last spoken word rather than hold until the next group');
  }
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src/caption/CaptionBurner.tsx'), 'utf8'),
    /captionGroupAtTime\(caption, curTime, S\.maxWordsPerCaption, S\.offset\)/);
});

test('phrase pauses split preview and export into the same full groups', () => {
  const cue = cueFromWords([{ text: 'First', start: 1, end: 1.2 }, { text: 'phrase', start: 1.25, end: 1.5 },
    { text: 'Second', start: 2, end: 2.2 }, { text: 'phrase', start: 2.25, end: 2.5 }]);
  assert.equal(api.captionGroupAtTime(cue, 1.3).text, 'First phrase');
  assert.equal(api.captionGroupAtTime(cue, 1.75), null);
  assert.equal(api.captionGroupAtTime(cue, 2.3).text, 'Second phrase');
  assert.deepEqual(dialogues(api.buildAss([cue], settings, meta)).map(visible), ['First phrase', 'First phrase', 'Second phrase', 'Second phrase']);
});

test('invalid, missing, backwards and overlapping word times never get sorted or stretched into export', () => {
  const invalidWords = [
    [{ text: 'First', start: 2, end: 3 }, { text: 'Future', start: 1, end: 1.5 }],
    [{ text: 'First', start: 1, end: 2 }, { text: 'Future', start: 1.5, end: 3 }],
    [{ text: 'First', start: 1, end: 1 }], [{ text: 'First', start: -1, end: 2 }],
    [{ text: 'First', start: 1, end: Infinity }], [{ text: 'First', start: '1', end: 2 }],
    [{ text: 'First', start: null, end: 2 }], [{ text: 'First', end: 2 }],
    [{ text: 'First', start: 0, end: 2 }], [{ text: 'First', start: 1, end: 5 }],
  ];
  for (const words of invalidWords) {
    const cue = { start: 1, end: 4, text: 'First Future', words };
    assert.throws(() => api.buildAss([cue], settings, meta), /timing|synchronization/);
    assert.equal(api.captionGroupAtTime(cue, 2), null, 'Invalid drafts keep the editor alive without fabricating a preview');
  }
});

test('backwards and overlapping source cues fail before applying even a negative offset', () => {
  for (const cues of [[{ start: 2, end: 3, text: 'Later' }, { start: 1, end: 1.5, text: 'Earlier' }],
    [{ start: 1, end: 2, text: 'First' }, { start: 1.5, end: 3, text: 'Second' }]]) {
    for (const offset of [0, -5]) assert.throws(() => api.buildAss(cues, { ...settings, offset }, meta), /overlap|backwards/);
  }
});

test('negative sync offset drops elapsed words and preserves the same remaining group in preview and export', () => {
  const cue = cueFromWords([{ text: 'Elapsed', start: .5, end: .8 }, { text: 'Crossing', start: .9, end: 1.2 },
    { text: 'Visible', start: 1.3, end: 1.6 }]);
  const before = plain(cue);
  const group = api.captionGroupAtTime(cue, .1, 8, -1);
  assert.equal(group.text, 'Crossing Visible');
  assert.equal(group.start, 0);
  assert.ok(Math.abs(group.words[0].end - .2) < 1e-9);
  const lines = dialogues(api.buildAss([cue], { ...settings, offset: -1 }, meta));
  assert.ok(lines.every(line => visible(line) === group.text));
  assert.deepEqual(plain(cue), before, 'Grouping and shifting own their words and never alter saved source timings');
  assert.equal(api.captionGroupAtTime(cue, 0, 8, -2), null);
  assert.deepEqual(dialogues(api.buildAss([cue], { ...settings, offset: -2 }, meta)), []);
});

test('estimated imported long cues follow the same group limit and offset in preview and export', () => {
  const cue = { start: 1, end: 3, text: 'one two three four five six seven eight nine ten', words: [] };
  for (const line of dialogues(api.buildAss([cue], { ...settings, offset: -.5 }, meta))) {
    const [start, end] = line.split(',').slice(1, 3).map(parseTime);
    assert.equal(api.captionGroupAtTime(cue, (start + end) / 2, 8, -.5).text, visible(line));
  }
});

test('ASS timestamp rounding carries into seconds, minutes and hours', () => {
  assert.equal(api.toAss(1.996), '00:00:02.00');
  assert.equal(api.toAss(59.996), '00:01:00.00');
  assert.equal(api.toAss(3599.996), '01:00:00.00');
  assert.equal(api.toAss(1.991), '00:00:01.99');
});

test('the real preview highlight callback applies positive and negative offsets once', () => {
  const previewSource = fs.readFileSync(path.join(__dirname, '..', 'src/caption/CaptionBurner.tsx'), 'utf8');
  let highlightPrefix;
  traverse(parser.parse(previewSource, { sourceType: 'module', plugins: ['typescript', 'jsx'] }), {
    ArrowFunctionExpression(p) {
      if (p.node.body.type !== 'BlockStatement') return;
      const statements = p.node.body.body;
      const first = statements[0];
      if (first?.type !== 'VariableDeclaration' || first.declarations[0].id.name !== 'allWords') return;
      const last = statements.find(statement => statement.type === 'VariableDeclaration'
        && statement.declarations[0].id.name === 'safeIndex');
      if (last) highlightPrefix = previewSource.slice(first.start, last.end);
    },
  });
  assert.ok(highlightPrefix, 'Run the actual component highlight selection before its JSX rendering');
  const cue = cueFromWords([{ text: 'One', start: 1, end: 1.2 }, { text: 'Two', start: 1.3, end: 1.5 },
    { text: 'Three', start: 1.6, end: 1.8 }]);
  for (const offset of [-.75, 1.2]) {
    const curTime = 1.4 + offset;
    const group = api.captionGroupAtTime(cue, curTime, 8, offset);
    const actualIndex = vm.runInNewContext(`(() => { ${highlightPrefix}; return safeIndex; })()`, {
      curTime, S: { offset }, previewCap: group, getWords: cap => cap.words, SHORT_CAPTION_GAP_SECONDS: .75,
    });
    assert.equal(actualIndex, 1, `Word Two is highlighted when offset = ${offset}`);
    assert.equal(group.words[actualIndex].text, 'Two');
  }
});

test('stale word text cannot replace edited caption text or export old words', () => {
  const sourceWords = [{ text: 'Rhea', start: 1, end: 1.3 }, { text: 'speaks.', start: 1.35, end: 1.6 }];
  for (const text of ['Ria speaks.', 'Ria reads a book.']) {
    const cue = { start: 1, end: 1.6, text, words: sourceWords };
    assert.throws(() => api.buildAss([cue], settings, meta), /text no longer matches its timed words/);
    assert.equal(api.captionGroupAtTime(cue, 1.1), null);
    assert.deepEqual(sourceWords.map(word => word.text), ['Rhea', 'speaks.']);
  }
  const multiline = { start: 1, end: 1.6, text: 'Rhea\nspeaks.', words: sourceWords };
  assert.equal(api.captionGroupAtTime(multiline, 1.1).text, 'Rhea speaks.', 'Only whitespace differences retain word timing');
});
