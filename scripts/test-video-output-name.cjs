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
test('repeated and in-flight exports save directly to Downloads without touching the source', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-name-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'colors part 1.mp4');
  fs.writeFileSync(source, 'original source');
  const first = createVideoOutputPath(directory, source);
  const second = createVideoOutputPath(directory, source);
  assert.notEqual(first, second);
  assert.equal(path.basename(first), 'colors part 1 (1).mp4');
  assert.equal(path.basename(second), 'colors part 1 (2).mp4');
  for (const target of [first, second]) {
    assert.equal(path.dirname(target), directory);
    assert.notEqual(target, source);
    fs.writeFileSync(target, 'export', { flag: 'wx' });
  }
  assert.equal(fs.readFileSync(source, 'utf8'), 'original source');
  assert.ok(fs.readdirSync(directory, { withFileTypes: true }).every(entry => entry.isFile()));
});

test('a first export keeps its original name and skips existing numbered files', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-name-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = createVideoOutputPath(directory, 'C:\\Videos\\Lesson FINAL.mov');
  assert.equal(first, path.join(directory, 'Lesson FINAL.mp4'));
  fs.writeFileSync(first, 'first export', { flag: 'wx' });
  const existing = path.join(directory, 'Lesson FINAL (1).mp4');
  fs.writeFileSync(existing, 'existing export', { flag: 'wx' });
  const next = createVideoOutputPath(directory, 'C:\\Videos\\Lesson FINAL.mov');
  assert.equal(next, path.join(directory, 'Lesson FINAL (2).mp4'));
  assert.equal(fs.readFileSync(existing, 'utf8'), 'existing export');
  assert.ok(fs.readdirSync(directory, { withFileTypes: true }).every(entry => entry.isFile()));
});
test('native uploaded-video exporters use original-name allocation', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  for (const channel of ['sc3-replace-video-audio', 'export-translated-video', 'export-synced-translated-video', 'burn-captions', 'video-resizer-export']) {
    const start = main.indexOf(`ipcMain.handle('${channel}'`);
    const end = main.indexOf('ipcMain.handle(', start + 20);
    assert.ok(start >= 0, channel);
    assert.match(main.slice(start, end < 0 ? undefined : end), /createVideoOutputPath/, channel);
  }
  assert.match(main, /ipcMain\.handle\('erase-captions', \(event, opts\) => erasePreviousCaptions/);
  assert.match(fs.readFileSync(path.join(__dirname, '../caption-eraser.cjs'), 'utf8'), /allocateOutput \|\| createVideoOutputPath/);
});

test('caption finalization copies to Downloads and never deletes a conflicting user file', t => {
  const vm = require('node:vm');
  const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const start = main.indexOf('    let copiedOutput = false;');
  const end = main.indexOf("    console.log('[BurnCaptions] Done:'", start);
  assert.ok(start >= 0 && end > start, 'Production caption finalization exists');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-name-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const partialOutFile = path.join(directory, 'caption-render.part.mp4');
  const outFile = path.join(directory, 'Lesson.mp4');
  fs.writeFileSync(partialOutFile, 'finished caption render');
  fs.writeFileSync(outFile, 'existing user video');
  assert.throws(() => vm.runInNewContext(main.slice(start, end), { fs, partialOutFile, outFile }),
    /Could not finalize captioned video/);
  assert.equal(fs.readFileSync(outFile, 'utf8'), 'existing user video');
  assert.equal(fs.readFileSync(partialOutFile, 'utf8'), 'finished caption render');

  const uniqueOutput = createVideoOutputPath(directory, 'Lesson.mp4');
  vm.runInNewContext(main.slice(start, end), { fs, partialOutFile, outFile: uniqueOutput });
  assert.equal(path.dirname(uniqueOutput), directory);
  assert.equal(fs.readFileSync(uniqueOutput, 'utf8'), 'finished caption render');
  assert.equal(fs.existsSync(partialOutFile), false);
  assert.equal(fs.readFileSync(outFile, 'utf8'), 'existing user video');
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
