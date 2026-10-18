'use strict';

// Real FFmpeg, synthetic media and a mocked TTS response. No Electron or provider.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { test, after } = require('node:test');
const acorn = require('acorn');
const { validateSyncedNarrationSegments } = require('../synced-narration-timing.cjs');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'generated-media', `my-exporter-voice-sync-qa-${Date.now()}`);
fs.mkdirSync(path.join(directory, 'Downloads'), { recursive: true });
const ffmpeg = process.platform === 'win32' ? execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0] : 'ffmpeg';
const sourcePath = path.join(directory, 'source.mp4');
const run = args => execFileSync(ffmpeg, ['-v', 'error', ...args], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
run(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30000/1001:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=900:sample_rate=44100:duration=5',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourcePath]);

function writeWav(filename, duration, voiced) {
  const rate = 44100, count = Math.round(duration * rate), data = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) {
    const time = i / rate;
    data.writeInt16LE(voiced(time) ? Math.round(13000 * Math.sin(2 * Math.PI * 660 * time)) : 0, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(data.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(filename, Buffer.concat([header, data]));
}
const paddedWav = path.join(directory, 'padded-voice.wav'), paddedMp3 = path.join(directory, 'padded-voice.mp3');
writeWav(paddedWav, 1.2, time => (time >= .3 && time < .55) || (time >= .7 && time < .95));
run(['-y', '-i', paddedWav, '-c:a', 'libmp3lame', '-b:a', '192k', paddedMp3]);
const silentWav = path.join(directory, 'silent-voice.wav'); writeWav(silentWav, 1, () => false);
const sourceDigest = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');

const mainPath = path.join(root, 'main.cjs'), main = fs.readFileSync(mainPath, 'utf8');
const ast = acorn.parse(main, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
const helpers = []; let callback;
(function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && ['myExporterProbePath', 'buildAtempoChain'].includes(node.id?.name)) helpers.push(main.slice(node.start, node.end));
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'ipcMain' && node.callee.property.name === 'handle' && node.arguments[0]?.value === 'export-synced-translated-video') callback = main.slice(node.arguments[1].start, node.arguments[1].end);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
})(ast);
assert.ok(callback); assert.equal(helpers.length, 2);
let ttsBuffer = fs.readFileSync(paddedMp3), ttsCalls = [], counter = 0, filterGraphs = [];
const progress = [], results = [];
const context = vm.createContext({
  require: createRequire(mainPath), path, Buffer,
  os: { tmpdir: () => directory, homedir: () => directory },
  fs: { ...fs, writeFileSync: (filename, data, ...options) => {
    if (path.basename(filename) === 'mix_filter.txt') filterGraphs.push(String(data));
    return fs.writeFileSync(filename, data, ...options);
  } },
  findMyExporterFFmpeg: () => ffmpeg,
  createVideoOutputPath: destination => path.join(destination, `dub-${++counter}.mp4`),
  getSyncedVoicePool: () => ({ female: ['fixture-female'], male: ['fixture-male'] }),
  generateSyncedEdgeTtsClip: async (text, voice) => {
    ttsCalls.push({ text, voice }); return { voice, response: { buffer: ttsBuffer } };
  },
});
vm.runInContext(helpers.join('\n'), context);
const invoke = vm.runInContext('(' + callback + ')', context);
const probe = context.myExporterProbePath;
const event = { sender: { send: (channel, data) => { assert.equal(channel, 'translate-dub-progress'); progress.push(data); } } };
const options = segments => ({ videoPath: sourcePath, segments, voice: 'fixture-female', targetLanguage: 'te', voiceMode: 'female' });
const segments = [
  { start: 1, end: 2, text: 'Tiger', translatedText: 'పులి', timingSource: 'word' },
  { start: 3.5, end: 4, text: 'Fox', translatedText: 'నక్క', timingSource: 'word' },
];
function pcm(filename) { return run(['-i', filename, '-map', '0:a:0', '-ar', '44100', '-ac', '1', '-f', 's16le', 'pipe:1']); }
function rms(bytes, start, end) {
  let sum = 0, count = 0;
  for (let i = Math.round(start * 44100); i < Math.min(Math.round(end * 44100), bytes.length / 2); i++) {
    const value = bytes.readInt16LE(i * 2) / 32768; sum += value * value; count++;
  }
  return count ? Math.sqrt(sum / count) : 0;
}
function onset(bytes, start, end) {
  for (let time = start; time < end; time += .005) if (rms(bytes, time, time + .005) > .03) return time;
  return NaN;
}
function verifySpeechTiming(bytes) {
  assert.ok(Math.abs(onset(bytes, .8, 1.3) - 1) < .025, 'First voice did not start at its exact source word');
  assert.ok(Math.abs(onset(bytes, 3.3, 3.8) - 3.5) < .025, 'Second voice did not start at its exact source word');
  assert.ok(rms(bytes, 0, .9) < .001, 'Source leading pause was removed');
  assert.ok(rms(bytes, 2.1, 3.4) < .001, 'Source gap between narration phrases was removed');
  assert.ok(rms(bytes, 1.29, 1.36) < .001, 'Meaningful internal voice pause was removed');
  assert.ok(rms(bytes, 1.02, 1.2) > .1); assert.ok(rms(bytes, 1.43, 1.6) > .1);
  assert.ok(rms(bytes, 4.08, 4.9) < .001, 'Long voice escaped its exact speech slot');
}

test('strict speech validation preserves exact narrow bounds, metadata and leading gaps without mutating input', () => {
  const input = [{ start: .7, end: .75, text: 'A', translatedText: 'ఆ', timingSource: 'word' }, { start: .75, end: .8, text: 'B' }];
  const before = JSON.stringify(input), validated = validateSyncedNarrationSegments(input, 1);
  assert.equal(validated[0].start, .7); assert.equal(validated[0].end, .75); assert.equal(validated[0].timingSource, 'word');
  assert.equal(validated[1].narrationText, 'B'); assert.equal(JSON.stringify(input), before);
});

test('invalid, overlapping and backward timing fail before any TTS request', async () => {
  const invalid = [
    [{ start: 1, end: 2, text: 'A' }, { start: 1.5, end: 3, text: 'B' }],
    [{ start: 3, end: 4, text: 'B' }, { start: 1, end: 2, text: 'A' }],
    [{ start: NaN, end: 2, text: 'A' }], [{ start: 1, end: Infinity, text: 'A' }],
    [{ start: '1', end: 2, text: 'A' }], [{ start: -1, end: 2, text: 'A' }],
    [{ start: 2, end: 2, text: 'A' }], [{ start: 4, end: 6, text: 'A' }],
    [{ start: 1, end: 2, text: 'English must not silently replace failed translation', translatedText: '' }],
  ];
  const initialCalls = ttsCalls.length;
  for (const rows of invalid) {
    const result = await invoke(event, options(rows)); results.push(result);
    assert.equal(result.ok, false); assert.match(result.error, /Narration segment/); assert.equal(result.audioBase64, undefined);
  }
  assert.equal(ttsCalls.length, initialCalls);
  assert.equal(progress.some(item => item.pct === 100), false);
});

test('unreadable source duration is rejected instead of inventing a five-minute timeline', async () => {
  const actualProbe = context.myExporterProbePath;
  try {
    context.myExporterProbePath = () => ({ duration: 0 });
    const result = await invoke(event, options(segments));
    assert.equal(result.ok, false); assert.match(result.error, /finite source duration/); assert.equal(ttsCalls.length, 0);
  } finally { context.myExporterProbePath = actualProbe; }
});

test('real native mux removes provider padding and keeps source pauses, original video packets and duration', async () => {
  const result = await invoke(event, options(segments)); results.push(result);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.voiceMode, 'female');
  assert.equal(result.audioContentType, 'audio/mpeg'); assert.deepEqual(ttsCalls.map(item => item.text), ['పులి', 'నక్క']);
  verifySpeechTiming(pcm(result.outputPath));
  const hashVideo = filename => crypto.createHash('sha256').update(run(['-i', filename, '-map', '0:v:0', '-c:v', 'copy', '-an', '-f', 'h264', 'pipe:1'])).digest('hex');
  assert.equal(hashVideo(result.outputPath), hashVideo(sourcePath), 'Original video was reencoded or retimed');
  assert.ok(Math.abs(probe(result.outputPath).duration - probe(sourcePath).duration) < .03, 'Source duration changed');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'), sourceDigest);
  assert.ok(filterGraphs.at(-1).includes('adelay=44100S:all=1')); assert.ok(filterGraphs.at(-1).includes('adelay=154350S:all=1'));
  assert.equal(progress.at(-1).pct, 100);
});

test('audio-only preview uses the same synchronized audio and preserves the MP3 IPC contract', async () => {
  const result = await invoke(event, { ...options(segments), audioOnly: true }); results.push(result);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.outputPath, undefined); assert.equal(result.audioContentType, 'audio/mpeg');
  const filename = path.join(directory, 'audio-only-preview.mp3'); fs.writeFileSync(filename, Buffer.from(result.audioBase64, 'base64'));
  verifySpeechTiming(pcm(filename));
});

test('narrow adjacent verified words never acquire the old minimum 120ms interval', async () => {
  const result = await invoke(event, { ...options([{ start: 1, end: 1.05, translatedText: 'ఆ' }, { start: 1.05, end: 1.1, translatedText: 'ఈ' }]), audioOnly: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  const filter = filterGraphs.at(-1); assert.equal((filter.match(/atrim=duration=0\.050000/g) || []).length, 2);
  assert.ok(filter.includes('adelay=46305S:all=1')); assert.equal(filter.includes('0.120000'), false);
});

test('all-silent generated narration fails instead of claiming a successful voice replacement', async () => {
  const previous = ttsBuffer, priorSuccessCount = progress.filter(item => item.pct === 100).length;
  try {
    ttsBuffer = fs.readFileSync(silentWav);
    const result = await invoke(event, options([segments[0]])); results.push(result);
    assert.equal(result.ok, false); assert.match(result.error, /no audible speech/); assert.equal(result.outputPath, undefined);
    assert.equal(progress.filter(item => item.pct === 100).length, priorSuccessCount);
  } finally { ttsBuffer = previous; }
});

after(() => {
  assert.equal(fs.readdirSync(directory).some(name => name.startsWith('pattan-synced-dub-')), false, 'Temporary voice preparation was not cleaned up');
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ directory, ttsCalls, results: results.map(({ audioBase64, ...result }) => result), filterGraphs }, null, 2));
  console.log(`Voice-sync QA artifacts: ${directory}`);
});
