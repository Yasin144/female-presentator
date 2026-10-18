'use strict';

// These are source-media times, independent of an editor's trim, speed or timeline.
function validateSyncedNarrationSegments(input, sourceDuration) {
  if (typeof sourceDuration !== 'number' || !Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    throw new Error('Could not read a finite source duration for synchronized narration.');
  }
  if (!Array.isArray(input) || !input.length) throw new Error('Synchronized narration requires timestamped segments.');
  let previousEnd = 0;
  return input.map((segment, index) => {
    const label = `Narration segment ${index + 1}`;
    if (!segment || typeof segment !== 'object') throw new Error(`${label} is invalid. Generate speech timestamps again.`);
    const { start, end } = segment;
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`${label} needs finite numeric speech timestamps. Generate speech timestamps again.`);
    }
    if (start < 0 || end <= start || end > sourceDuration) {
      throw new Error(`${label} is outside the source video or has an empty speech interval. Generate speech timestamps again.`);
    }
    if (start < previousEnd) {
      throw new Error(`${label} overlaps or precedes the previous speech interval. Generate verified speech timestamps again.`);
    }
    const narrationText = String(segment.translatedText ?? segment.text ?? '').trim();
    if (!narrationText) throw new Error(`${label} has no translated narration text.`);
    previousEnd = end;
    return { ...segment, start, end, narrationText };
  });
}

// Run leading-silence removal once in each direction. Unlike stop_periods=-1,
// this keeps meaningful pauses inside an utterance intact.
const edgeSilenceFilter = [
  'silenceremove=start_periods=1:start_duration=0.005:start_threshold=-60dB:start_silence=0:detection=peak:window=0.005',
  'areverse',
  'silenceremove=start_periods=1:start_duration=0.005:start_threshold=-60dB:start_silence=0:detection=peak:window=0.005',
  'areverse',
  'asetpts=PTS-STARTPTS',
].join(',');

async function trimGeneratedNarrationClip(ffmpeg, inputPath, outputPath) {
  const { spawn } = require('node:child_process');
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-v', 'error', '-y', '-i', inputPath, '-map', '0:a:0',
      '-af', edgeSilenceFilter, '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', outputPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-2000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Generated narration preparation failed (${code}): ${stderr.slice(-400)}`)));
  });
}

module.exports = { validateSyncedNarrationSegments, trimGeneratedNarrationClip };
