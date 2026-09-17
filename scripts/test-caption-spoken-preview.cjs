'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const legacy = read('caption-script.js');
const ast = parser.parse(legacy);
function fn(name) { let result; traverse(ast, { FunctionDeclaration(p) { if (p.node.id?.name === name) result = legacy.slice(p.node.start, p.node.end); } }); assert.ok(result, name); return result; }
const burnSource = read('src/caption/burn.ts').split('export async function burnCaptions')[0].replace(/^import .*;\r?\n/gm, '');
const buildAss = vm.runInNewContext(stripTypeScriptTypes(burnSource).replace(/^export /gm, '') + '\nbuildAss', {});
const words = ['I', 'for', 'ice', 'cream', 'J', 'for', 'jug'].map((text, i) => ({ text, start: i, end: i + 0.8 }));
const captions = [{ text: words.map(w => w.text).join(' '), start: 0, end: 6.8, words }];
const settings = { fontSize: 110, fontColor: 'White', bgColor: 'Transparent', style: 'white-yellow', position: 'bottom', xPos: 50, yPos: 90, language: 'English', offset: 0, maxWordsPerCaption: 8 };
const dialogues = text => text.split('\n').filter(line => line.startsWith('Dialogue:'));
const visible = line => line.split(',').slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/g, ' ').trim();

test('custom positions use a middle anchor and exact source-relative coordinates', () => {
  for (const [width, height] of [[2560, 1440], [1080, 1920]]) {
    for (const [xPos, yPos] of [[50, 50], [25, 30], [75, 85]]) {
      const ass = buildAss(captions, { ...settings, position: 'custom', xPos, yPos, fontFamily: 'Georgia' }, { width, height });
      assert.ok(ass.includes(`\\an5\\pos(${Math.round(width*xPos/100)},${Math.round(height*yPos/100)})`));
      assert.match(ass, /Style: Default,Georgia,110,/);
    }
  }
});

test('preview stays available without blocking Caption Burner exports', () => {
  assert.doesNotMatch(read('src/caption/CaptionBurner.tsx'), /Preview required:|reviewedCaptions/);
  assert.match(read('src/caption/CaptionBurner.tsx'), /Preview caption on video/);
  assert.match(read('src/caption/CaptionBurner.tsx'), /yPos: 90/);
  assert.match(fn('exportActiveCaptionVideoForQueue'), /await confirmCaptionExportPreview/);
  assert.match(legacy, /if \(!await confirmCaptionExportPreview\(\)\) return;/);
});

test('local captions default to bottom and export without repeated confirmation', () => {
  assert.match(legacy, /let captionPosY = 0\.90;/);
  assert.match(read('src/components/InputPanel.jsx'), /id="captionPositionPreset" defaultValue="bottom"/);
  assert.match(read('src/components/InputPanel.jsx'), /id="captionPositionY"[^>]+defaultValue="90"/);
  const preview = fn('confirmCaptionExportPreview');
  assert.doesNotMatch(preview, /window\.(confirm|alert|prompt)\(/);
  assert.match(preview, /return true;/);
  assert.match(preview, /if \(!generatedCaptions.length\) return false;/);
});

test('Caption Burner exported karaoke and plain styles never preload future words', () => {
  for (const style of ['white-yellow', 'karaoke', 'minimal', 'pill', 'outline']) {
    const lines = dialogues(buildAss(captions, { ...settings, style }, { width: 2560, height: 1440 }));
    assert.equal(visible(lines[0]), 'I', style);
    assert.equal(visible(lines[3]), 'I for ice cream', style);
    assert.doesNotMatch(visible(lines[3]), /jug|\bJ\b/);
    assert.equal(visible(lines[4]), 'J', 'New alphabet object clears the previous object phrase');
  }
});

test('held sung notes retain their complete recognized duration', () => {
  const ass = buildAss([{start:2,end:6,text:'Hello',words:[{text:'Hello',start:2,end:6}]}], settings, {width:1920,height:1080});
  assert.match(dialogues(ass)[0], /00:00:02\.00,00:00:06\.00/);
});
test('Caption Burner does not insert a dominant lesson letter or change recognized names', () => {
  const tokens = ['B', 'for', 'ball', 'B', 'for', 'book', 'Info', 'Kits'];
  const ws = tokens.map((text, i) => ({ text, start: i, end: i + .8 }));
  const output = dialogues(buildAss([{ text: tokens.join(' '), start: 0, end: 7.8, words: ws }], settings, { width: 2560, height: 1440 }));
  assert.equal(visible(output.at(-1)), 'B for book Info Kits');
});
test('selected output size survives portrait and landscape export without hidden rescaling', () => {
  for (const [width, height] of [[2560, 1440], [1080, 1920], [360, 640]]) {
    const ass = buildAss(captions, settings, { width, height });
    assert.match(ass, /Style: Default,Arial,110,/);
    assert.match(ass, new RegExp('pos\\(' + width / 2 + ',' + (height - 80) + '\\)'));
  }
});
test('AI Captioning Local preview uses only spoken prefix, including short groups and pauses', () => {
  const get = vm.runInNewContext(fn('spokenPhraseStart') + '\n(' + fn('getVisibleCaptionText') + ')', { CAPTION_WORD_LIMIT: 8 });
  assert.equal(get('I for ice cream J for jug', 0), 'I');
  assert.equal(get('I for ice cream J for jug', 3), 'I for ice cream');
  assert.equal(get('I for ice cream', -1), '');
  assert.equal(get('one two three four five six seven eight nine ten', 8), 'nine');
});
function localAss(karaoke) {
  const context = { CAPTION_WORD_LIMIT: 8, CAPTION_BOTTOM_OFFSET_PX: 80,
    sourceVideo: { videoWidth: 2560, videoHeight: 1440, duration: 7 }, renderCanvas: {},
    sizeSlider: { value: 110 }, styleSelect: { value: 'white-yellow' }, colorPicker: { value: '#ffffff' }, strokeSlider: { value: 80 }, captionPosX: .5, captionPosY: .5,
    widthSlider: { value: 85 }, fontSelect: { value: 'Arial' }, boldCheck: { checked: true }, heightSlider: { value: 100 }, karaokeCheck: { checked: karaoke }, emojiCheck: { checked: false }, progressCheck: { checked: false },
    document: { createElement: () => ({ getContext: () => null }) }, getCaptionSyncOffsetSeconds: () => 0,
    generatedCaptions: [{ text: captions[0].text, timestamp: [0, 6.8], words: words.map(w => ({ text: w.text, timestamp: [w.start, w.end] })) }],
    getCaptionBottomSafety: () => 80,
  };
  const code = ['spokenPhraseStart', 'stripIgnoredIntroCaption', 'removeIgnoredIntroCaptions', 'toAssTimestamp', 'escapeAssCaptionText', 'hexToAss', 'getAssStyleConfig', 'buildPreviewMatchedAss'].map(fn).join('\n');
  return vm.runInNewContext(code + '\nbuildPreviewMatchedAss()', context);
}
test('AI Captioning Local export matches spoken-only preview with karaoke on and off', () => {
  for (const karaoke of [true, false]) {
    const ass = localAss(karaoke), lines = dialogues(ass);
    assert.match(ass, /Style: Preview,Arial,110,/);
    assert.match(ass, /\\an5\\pos\(1280,720\)/);
    assert.equal(visible(lines[0]), 'I');
    assert.equal(visible(lines[3]), 'I for ice cream');
    assert.equal(visible(lines[4]), 'J');
  }
});
test('normalization preserves transcription instead of auto-fixing names, brands or lesson wording', () => {
  const input = 'I am Oli. Info Kits. The video for a moment.';
  const normalize = vm.runInNewContext('(' + fn('normalizeNurseryCaptionText') + ')');
  assert.equal(normalize(input), input);
  const strip = vm.runInNewContext('(' + fn('stripIgnoredIntroCaption') + ')');
  assert.equal(strip('Info Kids', 0), 'Info Kids');
  const ts = read('src/caption/transcribe.ts');
  const block = ts.slice(ts.indexOf('function normalizeNurseryCaptionText'), ts.indexOf('function getLanguageCode'));
  assert.equal(vm.runInNewContext(stripTypeScriptTypes(block) + '\nnormalizeNurseryCaptionText')(input), input);
});
test('size samples update immediately, queues preserve selection, and old burned output is not double-captioned', () => {
  const screen = read('src/caption/CaptionBurner.tsx');
  assert.match(screen, /data-caption-size-preview/);
  assert.match(screen, /fontSize: S.fontSize/);
  assert.match(screen, /!burnedVideoUrl && previewCap/);
  assert.match(screen, /const previewCap = activeCap/);
  assert.doesNotMatch(screen, /fontSize: QUEUE_EXPORT_FONT_SIZE \}/);
  assert.doesNotMatch(fn('forceQueueExportFontSize'), /sizeSlider.value\s*=/);
  assert.match(fn('updateCaptionStyleValueLabels'), /sample.style.fontSize/);
  assert.match(read('src/components/InputPanel.jsx'), /id="captionSizeSlider" min="20" max="140"/);
  const python = read('whisper-transcribe-caption.py');
  assert.doesNotMatch(python, /= repair_known_nursery_lyrics\(/);
});
