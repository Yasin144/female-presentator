const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

test('image-led lessons expose a stable full-sentence caption renderer', () => {
  assert.match(script, /function getCurrentLessonSentenceCaption\(/);
  assert.match(script, /function drawCurrentLessonSentenceCaption\(/);
});

test('PDF contextual lessons use the PDF narration text and clock for karaoke', () => {
  const start = script.indexOf('function drawPdfContextScene');
  const end = script.indexOf('\nfunction ensurePdfPageRenderImageLoaded', start);
  const renderer = script.slice(start, end);
  assert.match(renderer, /requestCanvasExportFrame\(\);/);
});

test('every captured frame receives karaoke after specialized scene rendering', () => {
  const canvasFrame = script.slice(
    script.indexOf('function requestCanvasExportFrame'),
    script.indexOf('\nfunction drawPdfContextScene')
  );
  const videoFrame = script.slice(
    script.indexOf('function requestExportVideoFrame'),
    script.indexOf('\nasync function saveBlobWithHandle')
  );
  assert.match(canvasFrame, /drawFinalSynchronizedKaraokeOverlay\(\);/);
  assert.match(videoFrame, /drawFinalSynchronizedKaraokeOverlay\(\);/);
  assert.match(script, /function drawFinalSynchronizedKaraokeOverlay\(\)/);
  assert.match(script, /if \(isPdfPresentationMode\(\)\)/);
  assert.match(script, /text: getPdfPresentationText\(\)/);
  assert.match(script, /elapsedMs: state\.pdf\.currentTimeMs/);
  assert.match(script, /syncProfileData: state\.pdf\.narration\?\.syncProfile/);
  assert.match(script, /state\.lastNarrationText \|\| buildNarrationText\(state\.text\)/);
  assert.match(script, /!state\.speaking && !state\.exportingVideo/);
});

test('karaoke layer is not skipped by generated picture scenes without page-image metadata', () => {
  const start = script.indexOf('function drawCurrentLessonSentenceCaption');
  const end = script.indexOf('\nfunction drawSceneVfx', start);
  const renderer = script.slice(start, end);
  assert.doesNotMatch(renderer, /if\s*\([^\n]*getStageHasVisibleImagesForPage/);
  assert.match(renderer, /const narrationActive = state\.speaking \|\| state\.exportingVideo/);
  assert.doesNotMatch(renderer, /rgba\(10,18,32,\.86\)/);
});

test('karaoke captions match the reference: full white sentence and one yellow spoken word', () => {
  const start = script.indexOf('function drawCurrentLessonSentenceCaption');
  const end = script.indexOf('\nfunction drawSceneVfx', start);
  const renderer = script.slice(start, end);
  assert.match(renderer, /item\.wordIndex === caption\.activeWordIndex/);
  assert.match(renderer, /active \? "#fde047" : "#ffffff"/);
  assert.doesNotMatch(renderer, /completed \? "#67e8f9"/);
  assert.doesNotMatch(renderer, /roundRect\(x - 7/);
});

test('lesson export keeps exact Whisper timing attached to the spoken narration text', () => {
  const start = script.indexOf('async function exportVideo');
  const end = script.indexOf('\nasync function handleAlternatePdfDownload', start);
  const exporter = script.slice(start, end);
  assert.match(exporter, /const exactAlignmentText = buildNarrationText\(exportText\);/);
  assert.match(exporter, /buildExactWhisperSyncProfile\(\s*exportNarrationBlob,\s*exactAlignmentText,/);
  assert.match(exporter, /state\.narration\.syncProfile = \{[\s\S]*?text: exactAlignmentText,/);
});

test('exact alignment retains Whisper phrase text and word timing for karaoke', () => {
  const start = script.indexOf('async function buildExactWhisperSyncProfile');
  const end = script.indexOf('\nfunction getSpeechSyncFrame', start);
  const builder = script.slice(start, end);
  assert.match(builder, /word: String\(word\.word \|\| word\.text/);
  assert.match(builder, /const captionSegments =/);
  assert.match(builder, /normalizeSpokenCaptionWord\(word\.word\)/);
  assert.match(builder, /return \{ units, captionSegments, totalDurationMs: finalDurationMs \}/);
});

test('karaoke resolves a whole recognized phrase before its active word', () => {
  const start = script.indexOf('function getCurrentLessonSentenceCaption');
  const end = script.indexOf('\nfunction drawCurrentLessonSentenceCaption', start);
  const resolver = script.slice(start, end);
  assert.match(resolver, /const exactCaptionSegments =/);
  assert.match(resolver, /segment\.words/);
  assert.match(resolver, /text: normalizeSpokenCaptionText\(segment\.text\)/);
});

test('spoken caption numerals are displayed as words', () => {
  assert.match(script, /function normalizeSpokenCaptionWord/);
  assert.match(script, /convertIntegerToInternationalWords\(String\(parsed\)\)/);
});

test('scene renderers do not paint the final karaoke layer twice', () => {
  const directDraws = [...script.matchAll(/drawCurrentLessonSentenceCaption\(/g)];
  // Definition + the two branches inside the single final compositor.
  assert.equal(directDraws.length, 3);
});

test('caption sentence boundaries follow punctuation and line breaks', () => {
  const start = script.indexOf('function getCurrentLessonSentenceCaption');
  const end = script.indexOf('\nfunction drawCurrentLessonSentenceCaption', start);
  const resolver = script.slice(start, end);
  assert.match(resolver, /\\r\?\\n/);
  assert.match(resolver, /\[\.\!\?\]/);
});
