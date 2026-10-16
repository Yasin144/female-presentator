'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { prepareCaptionAudio, createCaptionAudioPreparer } = require('../caption-audio-preprocess.cjs');

function wav({ seconds = 2, channels = 2, sampleRate = 44100 } = {}) {
  const byteRate = channels * sampleRate * 2;
  const buffer = Buffer.alloc(44 + Math.round(byteRate * seconds));
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(byteRate, 28); buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caption-audio-tests-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputPath = path.join(root, 'song with spaces & literal $(echo test).mp4');
  const pythonPath = path.join(root, 'venv', 'Scripts', 'python.exe');
  const ffmpegPath = path.join(root, 'ffmpeg.exe');
  const cacheDirectory = path.join(root, 'model-cache');
  const modelDirectory = path.join(root, 'venv', 'Lib', 'site-packages', 'demucs', 'remote');
  const outputDirectory = path.join(root, 'prepared');
  await Promise.all([fs.mkdir(path.dirname(pythonPath), { recursive: true }),
    fs.mkdir(cacheDirectory), fs.mkdir(modelDirectory, { recursive: true }), fs.mkdir(outputDirectory)]);
  await Promise.all([fs.writeFile(inputPath, 'untouched original'), fs.writeFile(pythonPath, ''), fs.writeFile(ffmpegPath, ''),
    fs.writeFile(path.join(modelDirectory, 'htdemucs.yaml'), "models: ['955717e8']\n"),
    fs.writeFile(path.join(modelDirectory, 'files.txt'), 'root: hybrid_transformer/\n955717e8-8726e21a.th\n'),
    fs.writeFile(path.join(cacheDirectory, '955717e8-8726e21a.th'), 'cached model')]);
  return { root, inputPath, pythonPath, ffmpegPath, cacheDirectory, outputDirectory, modelDirectory };
}

function mockRuntime(f, behavior = {}) {
  const calls = [];
  const killed = [];
  const spawnImpl = (executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = calls.length + 101;
    child.exitCode = null;
    child.signalCode = null;
    const call = { executable, args, options, child };
    calls.push(call);
    setImmediate(async () => {
      try {
        if (args[0] === '-m') {
          if (behavior.beforeDemucs) await behavior.beforeDemucs(call);
          if (behavior.hangDemucs) return;
          child.stderr.write('authorization=PRIVATE_KEY_DO_NOT_EXPOSE https://example.invalid/SECRET_KEY\n' + 'x'.repeat(12000));
          if (behavior.failDemucs) { child.emit('close', 1); return; }
          const stemPath = path.join(args[args.indexOf('-o') + 1], 'htdemucs', 'source');
          await fs.mkdir(stemPath, { recursive: true });
          await fs.writeFile(path.join(stemPath, 'vocals.wav'), behavior.invalidWav
            ? Buffer.from('broken audio') : wav({ seconds: behavior.vocalSeconds || 2 }));
          await fs.writeFile(path.join(stemPath, 'no_vocals.wav'), wav());
          child.stderr.write('\r 56%|progress|\r 100%|progress|\n');
        } else {
          const channels = Number(args[args.indexOf('-ac') + 1]);
          const sampleRate = Number(args[args.indexOf('-ar') + 1]);
          await fs.writeFile(args[args.length - 1], wav({ seconds: behavior.finalSeconds && channels === 1 ? behavior.finalSeconds : 2, channels, sampleRate }));
        }
        child.exitCode = 0;
        child.emit('close', 0);
      } catch (error) { child.emit('error', error); }
    });
    return child;
  };
  const terminateProcessTreeImpl = async child => {
    killed.push(child.pid);
    child.signalCode = 'SIGKILL';
    child.emit('close', null);
  };
  const prepare = createCaptionAudioPreparer({ spawnImpl, terminateProcessTreeImpl,
    modelCacheDirectory: f.cacheDirectory, separationTimeoutMs: behavior.timeoutMs || 1000 });
  return { prepare, calls, killed };
}

test('original audio needs no enhancement runtime, model, or output writes', async t => {
  const f = await fixture(t);
  const result = await prepareCaptionAudio({ inputPath: f.inputPath });
  assert.deepEqual(result, { audioPath: f.inputPath, cleanupFiles: [], warnings: [] });
  assert.deepEqual(await fs.readdir(f.outputDirectory), []);
  assert.equal(await fs.readFile(f.inputPath, 'utf8'), 'untouched original');
});

test('successful vocal focus preserves duration and source, uses only cached models, and cleans intermediate files', async t => {
  const f = await fixture(t);
  const runtime = mockRuntime(f);
  const progress = [];
  const result = await runtime.prepare({ ...f, mode: 'vocal-focus', onProgress: event => progress.push(event) });
  assert.notEqual(result.audioPath, f.inputPath);
  assert.deepEqual(result.cleanupFiles, [result.audioPath]);
  assert.match(result.warnings.join(' '), /local Demucs/);
  assert.match(result.warnings.join(' '), /miss quiet/);
  assert.equal(await fs.readFile(f.inputPath, 'utf8'), 'untouched original');
  const audio = await fs.readFile(result.audioPath);
  assert.equal(audio.readUInt16LE(22), 1);
  assert.equal(audio.readUInt32LE(24), 16000);
  assert.equal(audio.readUInt32LE(40) / audio.readUInt32LE(28), 2);
  assert.deepEqual(await fs.readdir(f.outputDirectory), [path.basename(result.audioPath)]);
  assert.equal(runtime.calls.length, 3);
  assert.ok(runtime.calls.every(call => call.options.windowsHide && call.options.shell === false));
  const sourceArgs = runtime.calls[0].args;
  assert.equal(sourceArgs[sourceArgs.indexOf('-i') + 1], f.inputPath);
  assert.equal(sourceArgs[sourceArgs.indexOf('-ac') + 1], '2');
  assert.equal(sourceArgs[sourceArgs.indexOf('-ar') + 1], '44100');
  const demucsArgs = runtime.calls[1].args;
  assert.deepEqual(demucsArgs.slice(0, 6), ['-m', 'demucs', '--two-stems', 'vocals', '--shifts', '0']);
  assert.ok(demucsArgs.includes('--repo'));
  assert.equal(demucsArgs[demucsArgs.indexOf('-d') + 1], 'cpu');
  assert.equal(runtime.calls[1].options.env.PYTHONNOUSERSITE, '1');
  assert.equal(runtime.calls[1].options.env.TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD, '1');
  assert.equal(runtime.calls[0].options.env.TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD, process.env.TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD);
  assert.ok(progress.some(event => event.pct > 15 && event.pct < 90));
  assert.equal(progress[progress.length - 1].pct, 100);
  assert.doesNotMatch(JSON.stringify({ progress, result }), /PRIVATE_KEY|SECRET_KEY|authorization|example\.invalid/);
});

test('missing Python or FFmpeg explicitly falls back without starting a process', async t => {
  const f = await fixture(t);
  const runtime = mockRuntime(f);
  const result = await runtime.prepare({ ...f, pythonPath: path.join(f.root, 'missing.exe'), mode: 'vocal-focus' });
  assert.deepEqual(result.cleanupFiles, []);
  assert.equal(result.audioPath, f.inputPath);
  assert.match(result.warnings.join(' '), /runtime is missing/);
  assert.equal(runtime.calls.length, 0);
});

test('missing cached models cannot cause automatic downloads', async t => {
  const f = await fixture(t);
  await fs.unlink(path.join(f.cacheDirectory, '955717e8-8726e21a.th'));
  const runtime = mockRuntime(f);
  const result = await runtime.prepare({ ...f, mode: 'vocal-focus' });
  assert.equal(result.audioPath, f.inputPath);
  assert.match(result.warnings.join(' '), /cached weights are missing/);
  assert.equal(runtime.calls.length, 0);
  assert.deepEqual(await fs.readdir(f.outputDirectory), []);
});

test('tool failures are explicit, sanitized fallbacks with no retained artifacts', async t => {
  const f = await fixture(t);
  const runtime = mockRuntime(f, { failDemucs: true });
  const result = await runtime.prepare({ ...f, mode: 'vocal-focus' });
  assert.equal(result.audioPath, f.inputPath);
  assert.deepEqual(result.cleanupFiles, []);
  assert.match(result.warnings.join(' '), /Captions will use the original audio/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_KEY|SECRET_KEY|authorization|example\.invalid/);
  assert.deepEqual(await fs.readdir(f.outputDirectory), []);
});

test('duration changes and invalid vocal files fall back instead of shifting caption timestamps', async t => {
  const f = await fixture(t);
  for (const behavior of [{ vocalSeconds: 3 }, { finalSeconds: 3 }, { invalidWav: true }]) {
    const runtime = mockRuntime(f, behavior);
    const result = await runtime.prepare({ ...f, mode: 'vocal-focus' });
    assert.equal(result.audioPath, f.inputPath);
    assert.match(result.warnings.join(' '), /original timing/);
    assert.deepEqual(await fs.readdir(f.outputDirectory), []);
  }
});

test('timeout kills the active process tree, cleans files, and falls back visibly', async t => {
  const f = await fixture(t);
  const runtime = mockRuntime(f, { hangDemucs: true, timeoutMs: 15 });
  const result = await runtime.prepare({ ...f, mode: 'vocal-focus' });
  assert.equal(result.audioPath, f.inputPath);
  assert.match(result.warnings.join(' '), /time limit/);
  assert.deepEqual(runtime.killed, [102]);
  assert.deepEqual(await fs.readdir(f.outputDirectory), []);
});

test('cancellation terminates separation and rejects rather than continuing with fallback transcription', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const runtime = mockRuntime(f, { hangDemucs: true, beforeDemucs: () => controller.abort() });
  await assert.rejects(runtime.prepare({ ...f, mode: 'vocal-focus', signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(runtime.killed, [102]);
  assert.deepEqual(await fs.readdir(f.outputDirectory), []);
});

test('an already cancelled job never starts a process', async t => {
  const f = await fixture(t);
  const runtime = mockRuntime(f);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runtime.prepare({ ...f, mode: 'vocal-focus', signal: controller.signal }), { name: 'AbortError' });
  assert.equal(runtime.calls.length, 0);
});

test('separate concurrent jobs use distinct destinations and clean only their own files', async t => {
  const f = await fixture(t);
  const runtime = mockRuntime(f);
  const [first, second] = await Promise.all([
    runtime.prepare({ ...f, mode: 'vocal-focus' }), runtime.prepare({ ...f, mode: 'vocal-focus' }),
  ]);
  assert.notEqual(first.audioPath, second.audioPath);
  assert.deepEqual((await fs.readdir(f.outputDirectory)).sort(), [path.basename(first.audioPath), path.basename(second.audioPath)].sort());
  assert.equal(await fs.readFile(path.join(f.cacheDirectory, '955717e8-8726e21a.th'), 'utf8'), 'cached model');
});

test('invalid input and unsupported modes fail before doing work', async t => {
  const f = await fixture(t);
  await assert.rejects(prepareCaptionAudio({ inputPath: path.join(f.root, 'missing.mp4') }), /existing input/);
  await assert.rejects(prepareCaptionAudio({ inputPath: f.inputPath, mode: 'invented' }), /Invalid caption audio/);
});
