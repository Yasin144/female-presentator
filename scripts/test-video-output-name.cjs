'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { originalVideoName, createVideoOutputPath } = require('../video-output-name.cjs');
test('preserves spaces, Unicode, capitalization and multi-dot video names', () => {
  for (const name of ['colors part 1.mp4', 'Lesson 2 FINAL.mp4', 'తెలుగు పాఠం.mp4', 'lesson.part.1.mp4']) assert.equal(originalVideoName(name), name);
  assert.equal(originalVideoName('C:\\Videos\\My Lesson.mov'), 'My Lesson.mp4');
  assert.equal(originalVideoName('/videos/My Lesson.mp4', 'webm'), 'My Lesson.webm');
});
test('removes traversal and invalid Windows filename characters', () => {
  assert.equal(originalVideoName('../../lesson.mp4'), 'lesson.mp4');
  assert.equal(originalVideoName('bad?name.mp4'), 'bad_name.mp4');
  assert.equal(originalVideoName('CON.mp4'), '_CON.mp4');
  assert.equal(originalVideoName('', '../bad'), 'video.mp4');
});
test('repeated exports retain the exact filename without touching the source', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-name-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'colors part 1.mp4');
  fs.writeFileSync(source, 'original source');
  const first = createVideoOutputPath(directory, source);
  const second = createVideoOutputPath(directory, source);
  assert.notEqual(first, second);
  for (const target of [first, second]) {
    assert.equal(path.basename(target), 'colors part 1.mp4');
    assert.notEqual(target, source);
    fs.writeFileSync(target, 'export', { flag: 'wx' });
  }
  assert.equal(fs.readFileSync(source, 'utf8'), 'original source');
});
test('native uploaded-video exporters use original-name allocation', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  for (const channel of ['sc3-replace-video-audio', 'erase-captions', 'export-translated-video', 'export-synced-translated-video', 'burn-captions', 'video-resizer-export']) {
    const start = main.indexOf(`ipcMain.handle('${channel}'`);
    const end = main.indexOf('ipcMain.handle(', start + 20);
    assert.ok(start >= 0, channel);
    assert.match(main.slice(start, end < 0 ? undefined : end), /createVideoOutputPath/, channel);
  }
});

test('successful desktop exports reveal only saved media and preserve the observer result', async () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const start = source.indexOf('const revealExportChannels =');
  const end = source.indexOf('\nfunction findFFmpegExecutable', start);
  const handlers = {}, revealed = [];
  const ipcMain = {};
  vm.runInNewContext(source.slice(start, end), {
    ipcMain, observeWhatsAppJob: (_channel, fn) => fn,
    desktopOnlyIpcChannels: new Set(), mobileIpcHandlers: new Map(),
    originalIpcHandle: (channel, fn) => { handlers[channel] = fn; },
    fs: { existsSync: p => p !== 'missing.mp4', statSync: () => ({ size: 100 }) },
    shell: { showItemInFolder: p => revealed.push(p) }, console,
  });
  for (const [channel, result] of [
    ['burn-captions', { ok: true, outputPath: 'saved.mp4' }],
    ['burn-captions', { ok: false, outputPath: 'failed.mp4' }],
    ['burn-captions', { ok: true, outputPath: 'missing.mp4' }],
    ['transcribe-video', { ok: true, outputPath: 'internal.wav' }],
    ['write-file', { ok: true, filePath: 'saved.wav' }],
  ]) {
    ipcMain.handle(channel, async () => result);
    assert.equal(await handlers[channel]({}), result);
  }
  assert.deepEqual(revealed, ['saved.mp4', 'saved.wav']);
  assert.doesNotMatch(source, /createVideoOutputPath\(app.getPath\('downloads'\)/);
});
