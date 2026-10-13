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
const localPanel = read('src/components/LocalCaptionPanel.jsx');
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

test('Caption Burner export leaves a short phrase pause blank for karaoke and standard styles', () => {
  const cue = { start: 0, end: 2, text: 'First second', words: [
    { text: 'First', start: 0, end: .5 }, { text: 'second', start: .9, end: 2 },
  ] };
  for (const style of ['white-yellow', 'minimal']) {
    const lines = dialogues(buildAss([cue], { ...settings, style }, { width: 1920, height: 1080 }));
    assert.match(lines[0], /00:00:00\.00,00:00:00\.50/);
    assert.match(lines[1], /00:00:00\.90,00:00:02\.00/);
  }
});

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
  let exportCallback;
  traverse(ast, { CallExpression(p) {
    const call = p.node;
    if (call.callee.type === 'MemberExpression' && call.callee.object.name === 'exportBtn'
      && call.callee.property.name === 'addEventListener' && call.arguments[0]?.value === 'click') {
      exportCallback = p.get('arguments')[1];
    }
  } });
  assert.ok(exportCallback?.node.async, 'Local export must await its preview');
  const body = exportCallback.node.body.body;
  assert.equal(body[0].type, 'IfStatement');
  assert.equal(body[0].test.callee?.name, 'captionLocalBusy', 'A running caption job must block another export');
  assert.equal(body[0].consequent.type, 'ReturnStatement');
  const exportTry = body.find(statement => statement.type === 'TryStatement');
  assert.ok(exportTry, 'Export owns cleanup for its busy state');
  const steps = exportTry.block.body;
  const guardIndex = steps.findIndex(statement => statement.type === 'IfStatement'
    && statement.test.type === 'UnaryExpression' && statement.test.operator === '!'
    && statement.test.argument.type === 'AwaitExpression'
    && statement.test.argument.argument.callee?.name === 'confirmCaptionExportPreview');
  assert.ok(guardIndex >= 0, 'Preview result must be awaited and checked before export');
  const busyIndex = steps.findIndex(statement => statement.type === 'ExpressionStatement'
    && statement.expression.type === 'AssignmentExpression'
    && statement.expression.left.name === 'isRecording' && statement.expression.right.value === true);
  assert.ok(busyIndex >= 0 && busyIndex < guardIndex, 'The editing lock must be set before asynchronous preview');
  const guardExit = steps[guardIndex].consequent;
  assert.equal(guardExit.type === 'BlockStatement' ? guardExit.body.at(-1)?.type : guardExit.type,
    'ReturnStatement', 'A rejected preview must return before burning');
  const burnCalls = [];
  exportCallback.traverse({ CallExpression(p) {
    if (['burnCaptions', 'fastBurnAss'].includes(p.node.callee.property?.name)) burnCalls.push(p.node);
    assert.doesNotMatch(p.node.callee.name || '', /^transcribe/, 'Export preview must not restart transcription');
  } });
  assert.ok(burnCalls.length && burnCalls.every(call => call.start > steps[guardIndex].end),
    'Native burning must follow the awaited preview guard');
});

test('local captions default to bottom and export without repeated confirmation', () => {
  assert.match(legacy, /let captionPosY = 0\.90;/);
  assert.match(localPanel, /id="captionPositionPreset"[^>]*defaultValue="bottom"/);
  assert.match(localPanel, /id="captionPositionY"[^>]+defaultValue="90"/);
  const preview = fn('confirmCaptionExportPreview');
  assert.doesNotMatch(preview, /window\.(confirm|alert|prompt)\(/);
  assert.match(preview, /return true;/);
  assert.match(preview, /if \(!generatedCaptions.length\) return false;/);
});

test('Caption Burner shows the complete group and highlights only the active word', () => {
  for (const style of ['white-yellow', 'karaoke', 'minimal', 'pill', 'outline']) {
    const lines = dialogues(buildAss(captions, { ...settings, style }, { width: 2560, height: 1440 }));
    assert.equal(visible(lines[0]), captions[0].text, style);
    assert.equal(visible(lines[3]), captions[0].text, style);
    assert.equal(visible(lines[4]), captions[0].text, style);
  }
});
test('white-yellow karaoke keeps inactive white text readable on pale video', () => {
  const ass = buildAss(captions, settings, { width: 2560, height: 1440 });
  assert.match(ass, /Style: Default,Arial,110,[^\n]*,\d+,\d+,1,/);
  assert.match(ass, /Style: Default,Arial,110,[^\n]*&H00101820/);
  assert.match(read('src/caption/CaptionBurner.tsx'), /-1px -1px 0 #17212b/);
  assert.match(read('caption-script.js'), /styleType === 'white-yellow'[\s\S]*?Math\.max\(2, Math\.round\(fontSize \* 0\.09\)\)/);
  assert.match(read('script.js'), /rgba\(12,18,24,\.96\)/);
});

test('held sung notes retain their complete recognized duration', () => {
  const ass = buildAss([{start:2,end:6,text:'Hello',words:[{text:'Hello',start:2,end:6}]}], settings, {width:1920,height:1080});
  assert.match(dialogues(ass)[0], /00:00:02\.00,00:00:06\.00/);
});
test('Caption Burner does not insert a dominant lesson letter or change recognized names', () => {
  const tokens = ['B', 'for', 'ball', 'B', 'for', 'book', 'Info', 'Kits'];
  const ws = tokens.map((text, i) => ({ text, start: i, end: i + .8 }));
  const output = dialogues(buildAss([{ text: tokens.join(' '), start: 0, end: 7.8, words: ws }], settings, { width: 2560, height: 1440 }));
  assert.equal(visible(output.at(-1)), 'B for ball B for book Info Kits');
});
test('selected output size survives portrait and landscape export without hidden rescaling', () => {
  for (const [width, height] of [[2560, 1440], [1080, 1920], [360, 640]]) {
    const ass = buildAss(captions, settings, { width, height });
    assert.match(ass, /Style: Default,Arial,110,/);
    assert.match(ass, new RegExp('pos\\(' + width / 2 + ',' + (height - 80) + '\\)'));
  }
});
test('AI Captioning Local preview keeps the complete caption group visible', () => {
  const get = vm.runInNewContext(fn('spokenPhraseStart') + '\n(' + fn('getVisibleCaptionText') + ')', { CAPTION_WORD_LIMIT: 8 });
  assert.equal(get('I for ice cream J for jug', 0), 'I for ice cream J for jug');
  assert.equal(get('I for ice cream J for jug', 3), 'I for ice cream J for jug');
  assert.equal(get('I for ice cream', -1), '');
  assert.equal(get('one two three four five six seven eight nine ten', 8), 'nine ten');
});
function localAss(karaoke, width = 2560, height = 1440, size = 110) {
  const context = { CAPTION_WORD_LIMIT: 8, CAPTION_BOTTOM_OFFSET_PX: 80, SHORT_CAPTION_GAP_SECONDS: .75,
    CAPTION_PREVIEW_MAX_DIM: 1920, QUEUE_EXPORT_FONT_SIZE: 50,
    sourceVideo: { videoWidth: width, videoHeight: height, duration: 7 }, renderCanvas: {},
    sizeSlider: { value: size }, styleSelect: { value: 'white-yellow' }, colorPicker: { value: '#ffffff' }, strokeSlider: { value: 80 }, captionPosX: .5, captionPosY: .5,
    widthSlider: { value: 85 }, gapSlider: { value: 120 }, fontSelect: { value: 'Arial' }, boldCheck: { checked: true }, heightSlider: { value: 100 }, karaokeCheck: { checked: karaoke }, emojiCheck: { checked: false }, progressCheck: { checked: false },
    document: { createElement: () => ({ getContext: () => null }) }, getCaptionSyncOffsetSeconds: () => 0,
    generatedCaptions: [{ text: captions[0].text, timestamp: [0, 6.8], words: words.map(w => ({ text: w.text, timestamp: [w.start, w.end] })) }],
    getCaptionBottomSafety: () => 80,
  };
  const code = ['fitCaptionBlock', 'getCaptionSourceFontSize', 'getCaptionFontFamily', 'getCaptionWordTimeline', 'getCaptionWordEnd', 'spokenPhraseStart', 'stripIgnoredIntroCaption', 'removeIgnoredIntroCaptions', 'toAssTimestamp', 'escapeAssCaptionText', 'hexToAss', 'getAssStyleConfig', 'buildPreviewMatchedAss'].map(fn).join('\n');
  return vm.runInNewContext(code + '\nbuildPreviewMatchedAss()', context);
}
test('AI Captioning Local export keeps the complete group with karaoke on and off', () => {
  for (const karaoke of [true, false]) {
    const ass = localAss(karaoke), lines = dialogues(ass);
    const fontSize = Number(ass.split('\n').find(line => line.startsWith('Style: Preview,')).split(',')[2]);
    assert.ok(Math.abs(fontSize - 110 * 2560 / 1920) < 1e-8, `QHD source font must preserve the selected preview size; got ${fontSize}`);
    assert.match(ass, /\\an5\\pos\(1280,720\)/);
    assert.equal(visible(lines[0]), captions[0].text);
    assert.equal(visible(lines[3]), captions[0].text);
    assert.equal(visible(lines[4]), captions[0].text);
  }
});

test('Local font selection retains its displayed size on capped landscape and portrait previews', () => {
  for (const [width, height, expectedSourceFont] of [
    [3840, 2160, 100], [2160, 3840, 100], [2560, 1440, 50 * 2560 / 1920],
    [1920, 1080, 50], [1080, 1920, 50], [1280, 720, 50], [640, 360, 50],
  ]) {
    const context = { CAPTION_PREVIEW_MAX_DIM: 1920, QUEUE_EXPORT_FONT_SIZE: 50,
      sourceVideo: { videoWidth: width, videoHeight: height }, renderCanvas: {}, sizeSlider: { value: 50 } };
    const api = vm.runInNewContext(fn('getCaptionSourceFontSize') + '\n' + fn('selectedQueueFontSize')
      + '\n({getCaptionSourceFontSize,selectedQueueFontSize})', context);
    const sourceFont = api.getCaptionSourceFontSize(width, height);
    assert.ok(Math.abs(sourceFont - expectedSourceFont) < 1e-8, `${width}x${height}: ${sourceFont}`);
    assert.equal(api.selectedQueueFontSize(), sourceFont, 'Queued native export must use the same source font');
    const previewScale = Math.min(1, 1920 / Math.max(width, height));
    assert.ok(Math.abs(sourceFont * previewScale - 50) < 1e-8, 'The capped preview must retain the selected 50px size');
    const assFont = Number(localAss(false, width, height, 50).split('\n')
      .find(line => line.startsWith('Style: Preview,')).split(',')[2]);
    assert.ok(Math.abs(assFont - sourceFont) < 1e-8, 'ASS must share the source font actually used on the preview');
  }
});

test('Local source font keeps its fallback and minimum without changing the size slider', () => {
  for (const [selected, expected] of [[undefined, 50], ['', 50], ['invalid', 50], [5, 12], [50, 50], [110, 110]]) {
    const slider = { value: selected };
    const getFont = vm.runInNewContext(fn('getCaptionSourceFontSize') + '\ngetCaptionSourceFontSize', {
      CAPTION_PREVIEW_MAX_DIM: 1920, QUEUE_EXPORT_FONT_SIZE: 50, sizeSlider: slider,
      sourceVideo: { videoWidth: 1920, videoHeight: 1080 }, renderCanvas: {},
    });
    assert.equal(getFont(), expected);
    assert.equal(slider.value, selected, 'Font scaling must preserve the user selection');
  }
});

test('the actual Local frame renderer carries the selected font through source-to-preview scaling', () => {
  for (const [width, height] of [[3840, 2160], [2160, 3840], [1920, 1080], [640, 360]]) {
    const calls = [], scales = [];
    const noop = () => {};
    const ctx = { save: noop, restore: noop, drawImage: noop, imageSmoothingEnabled: true,
      scale: (x, y) => scales.push([x, y]), measureText: text => ({ width: text.length * 20 }) };
    const context = {
      CAPTION_WORD_LIMIT: 8, SHORT_CAPTION_GAP_SECONDS: .75, CAPTION_PREVIEW_MAX_DIM: 1920, QUEUE_EXPORT_FONT_SIZE: 50,
      window: {}, sourceVideo: { videoWidth: width, videoHeight: height, readyState: 2 }, renderCanvas: {},
      filterSelect: { value: 'none' }, syncSlider: { value: 0 }, generatedCaptions: [{ text: 'Hello', timestamp: [0, 2] }],
      bgMusicAudio: null, bgMusicCheck: null, getBrollForText: () => null, sizeSlider: { value: 50 },
      gapSlider: { value: 120 }, heightSlider: { value: 100 }, widthSlider: { value: 85 },
      karaokeCheck: { checked: false }, lastSfxWordIndex: -1, emojiCheck: { checked: false },
      fontSelect: { value: 'Arial' }, boldCheck: { checked: true }, captionPosX: .5, captionPosY: .9,
      styleSelect: { value: 'white-yellow' }, sharedWatermarkImage: null, progressCheck: { checked: false },
      drawWrappedText: (...args) => calls.push(args),
    };
    const code = ['fitCaptionBlock', 'captionHasSpeechAtTime', 'getCaptionSourceFontSize', 'getCaptionFontFamily', 'getCaptionWordTimeline', 'getCaptionWordEnd',
      'getCaptionActiveWordIndex', 'getVisibleCaptionText', 'getWrappedCaptionLines', 'renderCaptionFrame'].map(fn).join('\n');
    const previewScale = Math.min(1, 1920 / Math.max(width, height));
    vm.runInNewContext(code + '\nrenderCaptionFrame', context)(ctx, width * previewScale, height * previewScale, .5);
    assert.deepEqual(scales, [[previewScale, previewScale]], 'The actual frame must apply source coordinate scaling');
    assert.equal(calls.length, 1, 'The actual frame must reach caption painting');
    const sourceFont = calls[0][10];
    assert.ok(Math.abs(sourceFont * previewScale - 50) < 1e-8, `${width}x${height}: selected 50px must remain visible at 50px`);
  }
});

test('both Local native burn paths use the shared source font', () => {
  assert.match(fn('selectedQueueFontSize'), /return getCaptionSourceFontSize\(\)/);
  assert.match(fn('exportActiveCaptionVideoForQueue'), /fontSize:\s*selectedQueueFontSize\(\)/);
  let directNativeBurn;
  traverse(ast, { CallExpression(p) {
    if (p.node.callee.property?.name !== 'burnCaptions') return;
    const property = p.node.arguments[0]?.properties?.find(value => value.key?.name === 'fontSize');
    if (property?.value?.name === '_fontSize') directNativeBurn = p;
  } });
  assert.ok(directNativeBurn, 'The single-video native export must provide its source font');
  const owner = directNativeBurn.getFunctionParent();
  const declaredFonts = [];
  owner.traverse({ VariableDeclarator(p) {
    if (p.node.id.name === '_fontSize') declaredFonts.push(p.node.init);
  } });
  assert.equal(declaredFonts.length, 1);
  assert.equal(declaredFonts[0].type, 'CallExpression');
  assert.equal(declaredFonts[0].callee.name, 'getCaptionSourceFontSize');
});

test('Voice Presenter preview defaults to no captions and offers both modes', () => {
  const panel = read('src/components/StagePanel.jsx');
  const presenter = read('script.js');
  assert.match(panel, /id="stagePreviewWithoutCaptionsBtn"[\s\S]*aria-pressed="true"/);
  assert.match(panel, /id="stagePreviewWithCaptionsBtn"[\s\S]*aria-pressed="false"/);
  assert.match(presenter, /previewCaptionsEnabled: false/);
  assert.match(presenter, /if \(!state\.previewCaptionsEnabled\) return false;/);
  assert.match(presenter, /setStagePreviewCaptionMode\(false\);/);
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
  assert.match(localPanel, /id="captionSizeSlider"[^>]*min="20"[^>]*max="140"/);
  const python = read('whisper-transcribe-caption.py');
  assert.doesNotMatch(python, /= repair_known_nursery_lyrics\(/);
});
