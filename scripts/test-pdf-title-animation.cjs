const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

test('exported PDF title entrance remains visible after recorder startup', () => {
  const match = script.match(/const EXPORT_TITLE_PREROLL_MS = (\d+);/);
  assert.ok(match, 'title preroll constant is present');
  assert.ok(Number(match[1]) >= 1400, 'title motion is long enough to survive MediaRecorder startup');
  assert.match(script, /state\.titleIntroMotionProgress = totalFrames <= 1/);
});

test('place-value title card animates its heading and types its subtitle', () => {
  assert.match(script, /const rawIntroProgress = state\.titleIntroActive/);
  assert.match(script, /const titleProgress = rawIntroProgress \* rawIntroProgress/);
  assert.match(script, /const visibleSubtitle = subtitleText\.slice\(0, Math\.ceil/);
  assert.match(script, /H \* \.42 \+ \(1 - titleProgress\) \* 70 \* scale/);
});

test('realtime export pre-arms the title before creating the capture stream', () => {
  const start = script.indexOf('async function recordLessonVideoRealtimeForExport');
  const capture = script.indexOf('canvasStream = createExportCanvasStream', start);
  const preArm = script.indexOf('state.titleIntroMotionProgress = 0;', start);
  assert.ok(start >= 0 && preArm > start && capture > preArm,
    'the first captured canvas frame must be the hidden title-animation start');
  assert.match(script.slice(start, start + 9000), /state\.titleIntroMotionProgress = null;/);
});

test('exact PDF frame encoder advances title motion on encoded timestamps', () => {
  const start = script.indexOf('async function encodePdfExactTimelineForExport');
  const end = script.indexOf('async function renderPdfTimelineForExport', start);
  const encoder = script.slice(start, end);
  assert.match(encoder, /const titleIntroDurationMs = Math\.min\(/);
  assert.match(encoder, /state\.titleIntroActive = encodedSourceTimeMs < titleIntroDurationMs/);
  assert.match(encoder, /encodedSourceTimeMs \/ titleIntroDurationMs/);
  assert.match(encoder, /state\.titleIntroMotionProgress = null;/);
});
