const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
function functionSource(name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\r?\\n\\}`, 'm'));
  assert.ok(match, `Production function ${name} must exist`);
  return match[0];
}

test('embedded PDF pictures retain exact page bounds for synchronized highlighting', async () => {
  const OPS = { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintJpegXObject: 5, paintImageMaskXObject: 6 };
  const context = vm.createContext({ window: { pdfjsLib: { OPS } } });
  vm.runInContext(`${functionSource('extractPdfEmbeddedImageBounds')}; globalThis.extract = extractPdfEmbeddedImageBounds;`, context);
  const page = { getOperatorList: async () => ({
    fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
    argsArray: [null, [185, 0, 0, 114, 63, 546], ['bus', 773, 477], null]
  }) };
  const result = await context.extract(page, { width: 638, height: 842 });
  assert.equal(result.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result[0])), { x: 63, y: 182, width: 185, height: 114 });
});

test('tiny icons and near-full-page backgrounds are not treated as lesson pictures', async () => {
  const OPS = { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintJpegXObject: 5, paintImageMaskXObject: 6 };
  const context = vm.createContext({ window: { pdfjsLib: { OPS } } });
  vm.runInContext(`${functionSource('extractPdfEmbeddedImageBounds')}; globalThis.extract = extractPdfEmbeddedImageBounds;`, context);
  const page = { getOperatorList: async () => ({
    fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
    argsArray: [null, [10, 0, 0, 10, 5, 5], ['icon'], null, null, [630, 0, 0, 830, 0, 0], ['background'], null]
  }) };
  assert.equal((await context.extract(page, { width: 638, height: 842 })).length, 0);
});

test('lazy exact-page loading preserves picture bounds for the live glow and exported video', () => {
  const loader = functionSource('ensurePdfPageRenderImageLoaded');
  assert.match(loader, /extractPdfEmbeddedImageBounds\(pdfPage, sourceViewport\)/);
  assert.match(loader, /page\.embeddedImageBounds\s*=/);
});

test('spoken relation numerals target the matching value on the printed number line', () => {
  const context = vm.createContext({ state: { pdf: { actionsEnabled: true } } });
  vm.runInContext(`${functionSource('getPdfNumberLineActionBox')}; globalThis.pick = getPdfNumberLineActionBox;`, context);
  const rows = [
    { words: [{ text: '1' }, { text: 'comes' }, { text: 'before' }, { text: '2' }] },
    { words: Array.from({ length: 11 }, (_, number) => ({ text: String(number), x: number * 20, y: 500, width: 10, height: 12 })) }
  ];
  assert.equal(context.pick(rows, { text: '1' }).x, 20);
  assert.equal(context.pick(rows, { text: '2' }).x, 40);
  context.state.pdf.actionsEnabled = false;
  assert.equal(context.pick(rows, { text: '2' }), null);
});

test('picture actions reject numerals and relation words that caused unrelated multiple glows', () => {
  const context = vm.createContext({});
  vm.runInContext(`${functionSource('isPdfPictureActionWord')}; globalThis.isPictureWord = isPdfPictureActionWord;`, context);
  for (const text of ['10', 'before', 'after', 'between', 'comes', 'similarly', 'number', 'line']) {
    assert.equal(context.isPictureWord({ text }), false, `${text} must not activate a picture`);
  }
  for (const text of ['car', 'cars', 'duck', 'apples', 'green']) {
    assert.equal(context.isPictureWord({ text }), true, `${text} may activate a relevant picture`);
  }
});

test('car comparison narration maps red, green and blue to the correct car in sentence order', () => {
  const context = vm.createContext({ clamp: (value, min, max) => Math.min(max, Math.max(min, value)) });
  vm.runInContext(`${functionSource('getPdfCarColorAction')}; globalThis.pickCar = getPdfCarColorAction;`, context);
  const row = {
    text: 'The blue car is after the red and green cars.',
    words: ['The', 'blue', 'car', 'is', 'after', 'the', 'red', 'and', 'green', 'cars']
      .map(text => ({ text }))
  };
  const bounds = [
    { x: 430, y: 170, width: 112, height: 70 },
    { x: 120, y: 170, width: 112, height: 70 },
    { x: 275, y: 170, width: 112, height: 70 },
    { x: 0, y: 0, width: 638, height: 842 }
  ];
  assert.equal(context.pickCar(row, { text: 'blue', wordIndex: 1 }, bounds, 638, 842).box.x, 430);
  assert.equal(context.pickCar(row, { text: 'car', wordIndex: 2 }, bounds, 638, 842).box.x, 430);
  assert.equal(context.pickCar(row, { text: 'red', wordIndex: 6 }, bounds, 638, 842).box.x, 120);
  assert.equal(context.pickCar(row, { text: 'green', wordIndex: 8 }, bounds, 638, 842).box.x, 275);
  assert.equal(context.pickCar(row, { text: 'cars', wordIndex: 9 }, bounds, 638, 842).box.x, 275);
});

test('interactive PDF actions start off until the teacher enables them', () => {
  assert.match(source, /actionsEnabled:\s*false/);
  const inputPanel = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'InputPanel.jsx'), 'utf8');
  assert.match(inputPanel, /aria-pressed="false"[^>]*>Actions: Off<\/button>/);
});

test('number-line and picture action branches are mutually exclusive', () => {
  const renderer = functionSource('drawPdfReadingHighlight');
  assert.match(renderer, /if \(!numberLineBox && state\.pdf\.actionsEnabled !== false && isPdfPictureActionWord\(segment\)/);
});

test('original PDF mode keeps word highlights and actions on detected counting pages', () => {
  const renderer = functionSource('drawPdfReadingHighlight');
  assert.match(renderer, /getPdfCountingDisplayMode\(\) === "reveal"/);
  assert.match(renderer, /page\?\.countingActivity \|\| page\?\.placeValueActivity/);
  assert.doesNotMatch(renderer, /^\s*if \(page\?\.countingActivity \|\| page\?\.placeValueActivity/m);
  const narrationBuilder = functionSource('requestPdfNarrationBlob');
  assert.match(narrationBuilder, /revealPreparedCounting && placeValue/);
  assert.match(narrationBuilder, /revealPreparedCounting && activity/);
});

test('PDF word highlights use measured narration timestamps instead of character estimates', () => {
  const context = vm.createContext({
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    analyzeSpeechSyncUnits: text => String(text).split(/\s+/).filter(Boolean).map(word => ({ spokenText: word }))
  });
  vm.runInContext(`${functionSource('applyExactPdfReadingTiming')}; globalThis.applyTiming = applyExactPdfReadingTiming;`, context);
  const pdfTiming = [{ readingSegments: [
    { text: 'red', startMs: 0, endMs: 100 },
    { text: 'green', startMs: 100, endMs: 200 },
    { text: 'blue', startMs: 200, endMs: 300 }
  ] }];
  const plans = [[{ kind: 'reading', text: 'red green blue', displayText: 'red green blue' }]];
  const exact = { units: [
    { spokenText: 'red', speechStartMs: 3260, speechEndMs: 3860, pauseEndMs: 3860 },
    { spokenText: 'green', speechStartMs: 5140, speechEndMs: 5500, pauseEndMs: 5500 },
    { spokenText: 'blue', speechStartMs: 5880, speechEndMs: 6160, pauseEndMs: 6160 }
  ] };
  assert.equal(context.applyTiming(pdfTiming, plans, exact), true);
  assert.deepEqual(pdfTiming[0].readingSegments.map(segment => [segment.startMs, segment.endMs]), [
    [3260, 3860], [5140, 5500], [5880, 6160]
  ]);
});
