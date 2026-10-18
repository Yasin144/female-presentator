'use strict';

// Exercise the actual main-process export/cache callbacks without loading Electron.
// Native FFmpeg renders synthetic footage only; no app, API or user media is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const acorn = require('acorn');
const { createMyExporterEngine } = require('../my-exporter-engine.cjs');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
const callbacks = new Map(), helpers = [];
(function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && ['myExporterAssColor', 'validateMyExporterJob'].includes(node.id?.name)) helpers.push(source.slice(node.start, node.end));
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'ipcMain' && node.callee.property.name === 'handle') {
    const [channel, callback] = node.arguments;
    if (['my-exporter-export', 'my-exporter-preflight', 'my-exporter-cancel', 'my-exporter-crop-save', 'my-exporter-caption-cache-load', 'my-exporter-caption-cache-save'].includes(channel?.value)) callbacks.set(channel.value, source.slice(callback.start, callback.end));
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
})(ast);
assert.equal(callbacks.size, 6); assert.equal(helpers.length, 2);
const ffmpeg = process.platform === 'win32' ? execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0] : 'ffmpeg';
const ffprobe = process.platform === 'win32' ? path.join(path.dirname(ffmpeg), 'ffprobe.exe') : 'ffprobe';
const directory = path.resolve(__dirname, '..', 'generated-media', `my-exporter-ipc-qa-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true });
const captionsAss = [], progress = [], results = [];
const engine = createMyExporterEngine({ findFFmpeg: () => ffmpeg, ffprobePath: ffprobe, outputDimensions: [640, 360], cacheDirectory: path.join(directory, 'caption-cache') });
const context = vm.createContext({ path, myExporterEngine: engine, fs: { ...fs, writeFileSync: (filename, data, options) => {
  if (path.basename(filename) === 'captions.ass') captionsAss.push(String(data));
  return fs.writeFileSync(filename, data, options);
} } });
vm.runInContext(helpers.join('\n'), context);
const invoke = Object.fromEntries([...callbacks].map(([channel, callback]) => [channel, vm.runInContext('(' + callback + ')', context)]));
const event = { sender: { send: (channel, data) => { assert.equal(channel, 'my-exporter-progress'); progress.push(data); } } };
const output = name => path.join(directory, name + '.mp4');
const plain = value => JSON.parse(JSON.stringify(value));
const frame = (filename, time) => execFileSync(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', filename, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
const count = (bytes, fromY, toY, matches) => {
  let total = 0;
  for (let y = fromY; y < toY; y++) for (let x = 0; x < 640; x++) {
    const offset = (y * 640 + x) * 3;
    if (matches(bytes[offset], bytes[offset + 1], bytes[offset + 2])) total++;
  }
  return total;
};
const white = (r, g, b) => Math.min(r, g, b) > 170;
const red = (r, g, b) => r > 130 && g < 80 && b < 80;
const yellow = (r, g, b) => r > 150 && g > 120 && b < 80;
async function render(name, options) {
  const payload = { jobId: name, outputPath: output(name), scenes: [{ kind: 'gap', duration: 1.5 }], fps: 24, quality: 'small', ...options };
  const preflight = plain(await invoke['my-exporter-preflight'](event, payload));
  assert.equal(preflight.ok, true, JSON.stringify(preflight)); assert.equal(preflight.exportCapabilitiesVersion, 2);
  const result = plain(await invoke['my-exporter-export'](event, payload)); results.push(result);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.jobId, name);
  assert.equal(progress.filter(item => item.jobId === name).at(-1).pct, 100);
  return { result, ass: captionsAss.at(-1) };
}

test('native main IPC burns multiline captions and colored titles with actual settings', async () => {
  const { result, ass } = await render('captions-and-title', { captionFontSize: 42, captionWidth: 70, captionHeight: 120, captionMaxChars: 16,
    captions: [{ start: .25, end: 1.25, text: 'ALPHA BETA GAMMA DELTA' }],
    textOverlays: [{ start: 0, end: 1.5, text: 'TITLE\nSECOND', x: 50, y: 25, color: '#ff0000', fontSize: 120, opacity: 1, shape: 'none' }] });
  assert.match(ass, /Style: Caption,Arial,14,/); assert.ok(ass.includes(',70,120,0,0,'));
  assert.ok(ass.includes(String.raw`ALPHA BETA GAMMA\NDELTA`));
  assert.ok(ass.includes(String.raw`TITLE\NSECOND`)); assert.equal(ass.includes(String.raw`\\N`), false);
  assert.ok(ass.includes(String.raw`\pos(320,90)`)); assert.ok(ass.includes(String.raw`\c&H000000FF`));
  const data = frame(result.outputPath, .7);
  assert.ok(count(data, 260, 355, white) > 20, 'Caption was not burned');
  assert.ok(count(data, 30, 180, red) > 20, 'Title color/position was not burned');
});

test('export without captions keeps titles while removing all caption dialogues', async () => {
  const { result, ass } = await render('titles-with-captions-disabled', { burnCaptions: false,
    captions: [{ start: 0, end: 1.5, text: 'THIS MUST NOT APPEAR' }],
    textOverlays: [{ start: 0, end: 1.5, text: 'TITLE', x: 50, y: 25, color: '#ff0000', fontSize: 120, opacity: 1 }] });
  assert.equal(ass.includes('THIS MUST NOT APPEAR'), false);
  const data = frame(result.outputPath, .7);
  assert.equal(count(data, 260, 355, white), 0); assert.ok(count(data, 30, 180, red) > 20);
});

test('real word starts retain karaoke pauses and leading unhighlighted text', async () => {
  const { result, ass } = await render('karaoke-word-pauses', { captionStyle: 'karaoke', captions: [{ start: .25, end: 1.25, text: 'ALPHA BETA',
    words: [{ text: 'ALPHA', start: .5, end: .65 }, { text: 'BETA', start: 1, end: 1.1 }] }] });
  assert.ok(ass.includes('Dialogue: 0,0:00:00.25,0:00:00.50,Caption'));
  assert.ok(ass.includes(String.raw`{\k50}ALPHA {\k25}BETA`)); assert.equal(ass.includes(String.raw`\\k`), false);
  const before = frame(result.outputPath, .4), paused = frame(result.outputPath, .8), after = frame(result.outputPath, 1.15);
  assert.equal(count(before, 260, 355, yellow), 0); assert.ok(count(before, 260, 355, white) > 10);
  assert.ok(count(paused, 260, 355, yellow) > 4); assert.ok(count(paused, 260, 355, white) > 4, 'Second word highlighted before its actual start');
  assert.ok(count(after, 260, 355, yellow) > 10);
});

test('transparent title and automatic Indic font remain represented in the native finishing contract', async () => {
  const { result, ass } = await render('transparent-indic-title', { burnCaptions: false,
    textOverlays: [{ start: 0, end: 1.5, text: 'ఏనుగు', x: 50, y: 25, fontFamily: 'Arial', fontSize: 120, opacity: 0 }] });
  assert.match(ass, /Style: Text0,Nirmala UI,/); assert.ok(ass.includes(String.raw`\alpha&HFF&`));
  assert.equal(count(frame(result.outputPath, .7), 0, 360, white), 0);
});

test('cache IPC envelopes hash long keys and atomically preserve valid data against invalid saves', async () => {
  const key = JSON.stringify({ version: 3, path: 'D:/' + 'long lesson path/'.repeat(30) + 'source.mp4', fileSize: 100, modifiedAt: 123, engine: 'groq', mode: 'speech' });
  const data = { transcript: { ok: true, text: 'ALPHA BETA', words: [{ word: 'ALPHA', start: .5, end: .65 }, { word: 'BETA', start: 1, end: 1.1 }] } };
  assert.deepEqual(plain(await invoke['my-exporter-caption-cache-load'](event, { key })), { ok: true, found: false, data: null });
  assert.equal((await invoke['my-exporter-caption-cache-save'](event, { key, data })).ok, true);
  const loaded = plain(await invoke['my-exporter-caption-cache-load'](event, { key })); assert.equal(loaded.found, true); assert.deepEqual(loaded.data, data);
  const files = fs.readdirSync(path.join(directory, 'caption-cache')); assert.equal(files.length, 1); assert.match(files[0], /^[0-9a-f]{64}\.json$/);
  const invalid = { transcript: { ...data.transcript, words: [{ word: 'BETA', start: 1, end: 2 }, { word: 'ALPHA', start: .5, end: .7 }] } };
  assert.equal((await invoke['my-exporter-caption-cache-save'](event, { key, data: invalid })).ok, false);
  assert.deepEqual(plain(await invoke['my-exporter-caption-cache-load'](event, { key })).data, data);
  const legacy = 'legacy-key'; fs.writeFileSync(path.join(directory, 'caption-cache', encodeURIComponent(legacy) + '.json'), JSON.stringify(data));
  assert.equal((await invoke['my-exporter-caption-cache-load'](event, { key: legacy })).found, true);
  fs.writeFileSync(path.join(directory, 'caption-cache', encodeURIComponent('corrupt') + '.json'), '{broken');
  assert.equal((await invoke['my-exporter-caption-cache-load'](event, { key: 'corrupt' })).found, false);
  assert.equal((await invoke['my-exporter-caption-cache-save'](event, { key: '', data })).ok, false);
  assert.equal(fs.readdirSync(path.join(directory, 'caption-cache')).some(name => name.endsWith('.tmp')), false);
});

test('actual crop IPC returns percent geometry and media metadata', async () => {
  const result = plain(await invoke['my-exporter-crop-save'](event, { inputPath: output('captions-and-title'), outputPath: output('ipc-cropped'),
    crop: { x: 0, y: 0, width: 50, height: 100 }, start: .1, end: 1.1 }));
  results.push(result); assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual([result.width, result.height, result.duration], [320, 360, 1]);
  assert.equal(result.frameRate, 24); assert.equal(result.hasAudio, true); assert.ok(result.videoBitrate > 0);
});

test.after(() => { fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2)); console.log('Native IPC QA artifacts:', directory); });
