const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

test('image-led lessons render a stable full-sentence caption after their pictures', () => {
  assert.match(script, /function getCurrentLessonSentenceCaption\(/);
  assert.match(script, /function drawCurrentLessonSentenceCaption\(/);
  assert.match(script, /drawOptionalImages\(currentPageIndex, totalPageCount\);\s*drawCurrentLessonSentenceCaption\(currentPageIndex\);/);
});

test('PDF contextual lessons use the PDF narration text and clock for karaoke', () => {
  const start = script.indexOf('function drawPdfContextScene');
  const end = script.indexOf('\nfunction ensurePdfPageRenderImageLoaded', start);
  const renderer = script.slice(start, end);
  assert.match(renderer, /drawCurrentLessonSentenceCaption\(currentPageIndex, \{/);
  assert.match(renderer, /text: getPdfPresentationText\(\)/);
  assert.match(renderer, /elapsedMs: state\.pdf\.currentTimeMs/);
  assert.match(renderer, /syncProfileData: state\.pdf\.narration\?\.syncProfile/);
});

test('karaoke layer is not skipped by generated picture scenes without page-image metadata', () => {
  const start = script.indexOf('function drawCurrentLessonSentenceCaption');
  const end = script.indexOf('\nfunction drawSceneVfx', start);
  const renderer = script.slice(start, end);
  assert.doesNotMatch(renderer, /if\s*\([^\n]*getStageHasVisibleImagesForPage/);
  assert.match(renderer, /state\.speaking\s*\|\| state\.exportingVideo/);
  assert.match(renderer, /rgba\(10,18,32,\.86\)/);
});

test('karaoke captions keep the sentence visible and distinguish completed and spoken words', () => {
  const start = script.indexOf('function drawCurrentLessonSentenceCaption');
  const end = script.indexOf('\nfunction drawSceneVfx', start);
  const renderer = script.slice(start, end);
  assert.match(renderer, /item\.wordIndex === caption\.activeWordIndex/);
  assert.match(renderer, /item\.wordIndex < caption\.activeWordIndex/);
  assert.match(renderer, /ctx\.fillStyle = "#fde047"/);
  assert.match(renderer, /completed \? "#67e8f9" : "#ffffff"/);
});

test('caption sentence boundaries follow punctuation and line breaks', () => {
  const start = script.indexOf('function getCurrentLessonSentenceCaption');
  const end = script.indexOf('\nfunction drawCurrentLessonSentenceCaption', start);
  const resolver = script.slice(start, end);
  assert.match(resolver, /\\r\?\\n/);
  assert.match(resolver, /\[\.\!\?\]/);
});
