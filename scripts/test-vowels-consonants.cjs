'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'InputPanel.jsx'), 'utf8');

test('Vowels and Consonants helper offers create, display and narrated presentation', () => {
  for (const id of ['applyVowelsConsonantsBtn', 'showVowelsConsonantsBtn', 'readVowelsConsonantsBtn']) {
    assert.match(panel, new RegExp(`id="${id}"`));
    assert.match(source, new RegExp(`const ${id} = document\\.getElementById\\("${id}"\\)`));
  }
  assert.match(source, /applyVowelsConsonantsBuilder\(\{ readAfterShow: true \}\)/);
});

test('the lesson has five vowels, twenty-one consonants and sequential narration chunks', () => {
  assert.match(source, /const VOWEL_LETTERS = \["A", "E", "I", "O", "U"\]/);
  assert.match(source, /const CONSONANT_LETTERS = "BCDFGHJKLMNPQRSTVWXYZ"\.split/);
  assert.match(source, /entry\.kind === "consonant" \? 620/);
  assert.match(source, /entry\.kind === "vowel" \? 460/);
  assert.match(source, /getVowelsConsonantsNarrationChunkEntries\(text\)/);
});

test('the full reference lesson board follows narration chunk start times for playback and export', () => {
  assert.match(source, /function getVisibleVowelsConsonantsProgress/);
  assert.match(source, /syncProfile\?\.profile\?\.chunkStartsMs/);
  assert.match(source, /drawVowelsConsonantsBoard\(contentArea, vowelsConsonantsData\)/);
  assert.match(source, /if \(vowelsConsonantsData\)/);
  assert.match(source, /All the letters together form the English alphabet/);
  assert.match(source, /5 vowels: A, E, I, O and U/);
  assert.match(source, /21 consonants/);
});

test('dynamic PDF lesson helper uses selected readable page text', () => {
  assert.match(panel, /id="createDynamicPdfLessonBtn"/);
  assert.match(panel, /id="readDynamicPdfLessonBtn"/);
  assert.match(source, /function getDynamicPdfLessonText/);
  assert.match(source, /applyDynamicPdfLessonBuilder\(\{ readAfterShow: true \}\)/);
});

test('unspoken lesson letters stay hidden during playback/export', () => {
  assert.match(source, /state\.speaking \|\| state\.exportingVideo\) \? \(visible \? \(active \? entrance : 1\) : 0\) : 1/);
  assert.match(source, /cueProgress/);
  assert.match(source, /ctx\.scale\(0\.72 \+ entrance \* 0\.28/);
});

test('export keeps measured vowel and consonant cue starts after exact alignment', () => {
  assert.match(source, /const measuredVowelsConsonantsStarts/);
  assert.match(source, /exactProfile\.chunkStartsMs = measuredVowelsConsonantsStarts\.slice/);
});

test('cue timestamps include real combiner lead-ins to avoid cumulative drift', () => {
  assert.match(source, /const leadInMs = previousGapMs > 200 \? 80 : 0/);
  assert.match(source, /globalCursorMs \+= leadInMs/);
});

test('creating the lesson clears an old faster audio timeline', () => {
  assert.match(source, /async function applyVowelsConsonantsBuilder[\s\S]*?resetNarrationState\(\)/);
});
