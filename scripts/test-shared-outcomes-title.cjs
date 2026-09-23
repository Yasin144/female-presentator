const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'vanilla.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const inputPanel = fs.readFileSync(path.join(root, 'src', 'components', 'InputPanel.jsx'), 'utf8');

test('PDF and Lesson presenters expose one synchronized Learning Outcomes title', () => {
  assert.match(html, /id="outcomesTitleInput"/);
  assert.match(html, /id="pdfOutcomesTitleInput"/);
  assert.match(html, /id="savePdfOutcomesTitleBtn"/);
  assert.match(inputPanel, /id="pdfOutcomesTitleInput"/);
  assert.match(inputPanel, /id="savePdfOutcomesTitleBtn"/);
  assert.match(inputPanel, /id="pdfOutcomesTitleStatus"/);
  assert.match(script, /\[outcomesTitleInput, pdfOutcomesTitleInput\]/);
  assert.match(script, /bindSharedOutcomesTitleControl\(outcomesTitleInput, saveOutcomesTitleBtn\)/);
  assert.match(script, /bindSharedOutcomesTitleControl\(pdfOutcomesTitleInput, savePdfOutcomesTitleBtn\)/);
  assert.match(script, /OUTCOMES_TITLE_STORAGE_KEY = "learning-outcomes-template-title"/);
  assert.match(script, /LESSON-I2 -> LESSON-12, 5I to 60 -> 51 to 60/);
  assert.match(script, /if \(state\.titleIntroActive\) \{/);
  assert.match(script, /typeof exportProgress === "number" && Number\.isFinite\(exportProgress\)/);
  assert.match(script, /frameIndex \/ \(totalFrames - 1\)/);
  assert.match(script, /state\.titleIntroMotionProgress = 1;/);
  assert.match(script, /state\.titleIntroMotionProgress = null;/);
  assert.match(script, /state\.titleOutroMotionProgress = totalFrames <= 1/);
  assert.match(script, /targetX \+ \(offscreenRight - targetX\) \* exportEased/);
  assert.match(script, /!state\.titleAnim\.holdUntilSpeaking && !state\.exportingVideo/);
  assert.match(script, /const hasPdfTitleCard = Boolean\(getPresentationTitleText\(\)\)/);
  assert.match(script, /EXPORT_TITLE_OUTRO_MS \/ Math\.max\(1, exportRenderSpeedMultiplier\)/);
  assert.match(script, /outroDurationMs > 0 && encodedSourceTimeMs >= contentDurationMs/);
  assert.match(script, /createSilentWavBlob\(pdfOutroSourceDurationMs\)/);
});

test('numeric OCR mistakes in saved lesson titles are corrected without changing ordinary text', () => {
  const source = script.match(/function normalizeOutcomesTitle\(value = ""\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, 'normalizeOutcomesTitle source should be available');
  const normalize = Function(`${source}; return normalizeOutcomesTitle;`)();
  assert.equal(normalize('LESSON-I2 Numbers 5I to 60'), 'LESSON-12 Numbers 51 to 60');
  assert.equal(normalize('UNIT II – Vowels'), 'UNIT II – Vowels');
});
