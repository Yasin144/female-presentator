'use strict';

// Optional local preprocessing for song captions. Originals are never modified.
// Demucs gets an explicit local repository, so missing weights cannot trigger a download.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { constants } = require('node:fs');

const SEPARATION_TIMEOUT_MS = 8 * 60 * 1000;
const CONVERSION_TIMEOUT_MS = 90 * 1000;
const MAX_PROCESS_OUTPUT_CHARS = 4096;

function abortError() {
  const error = new Error('Caption vocal preparation cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function sanitizedOutput(value) {
  // Output is used only to recognize progress and missing dependencies. Never
  // return tool output, user filenames, URLs, or authentication values in errors.
  return String(value).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/(?:[a-z]:[\\/]|\/)[^\r\n]*/gi, '[path]')
    .replace(/(?:api[_-]?key|authorization|token|secret)\s*[:=]\s*[^\s]+/gi, '[credential]')
    .replace(/[A-Za-z0-9_+-]{32,}/g, '[value]')
    .slice(-MAX_PROCESS_OUTPUT_CHARS);
}

async function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && Number.isInteger(child.pid) && child.pid > 0) {
    await new Promise(resolve => {
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true, shell: false, timeout: 5000,
      }, error => {
        if (error) { try { child.kill('SIGKILL'); } catch (_) {} }
        resolve();
      });
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (_) { try { child.kill('SIGKILL'); } catch (_) {} }
  }
}

function makeProcessRunner(spawnImpl, terminateImpl) {
  return (executable, args, { signal, timeoutMs, cwd, env, onOutput }) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    let child;
    let settled = false;
    let output = '';
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    };
    const stop = error => {
      if (settled) return;
      settled = true;
      cleanup();
      // Wait for tree termination before deleting any files being written.
      Promise.resolve().then(() => terminateImpl(child)).catch(() => {}).then(() => reject(error));
    };
    const cancel = () => stop(abortError());
    try {
      child = spawnImpl(executable, args, {
        cwd, env, windowsHide: true, shell: false,
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (_) {
      reject(new Error('The local audio preparation tool could not start.'));
      return;
    }
    const collect = chunk => {
      if (settled) return;
      const safe = sanitizedOutput(chunk);
      output = (output + safe).slice(-MAX_PROCESS_OUTPUT_CHARS);
      try { onOutput?.(safe); } catch (_) {}
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.once('error', () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('The local audio preparation tool could not start.'));
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) resolve();
      else {
        const error = new Error(/No module named|Could not find pre-trained|neither a single pre-trained/i.test(output)
          ? 'The installed vocal separation model is unavailable.'
          : 'The local audio preparation tool could not finish.');
        error.code = 'CAPTION_AUDIO_TOOL_FAILED';
        reject(error);
      }
    });
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      const error = new Error('Local vocal preparation exceeded its time limit.');
      error.code = 'CAPTION_AUDIO_TIMEOUT';
      stop(error);
    }, timeoutMs);
    if (signal?.aborted) cancel();
  });
}

async function isFile(filename) {
  try { return (await fs.stat(filename)).isFile(); } catch (_) { return false; }
}

async function inspectPcmWav(filename) {
  const file = await fs.open(filename, 'r');
  try {
    const size = (await file.stat()).size;
    const header = Buffer.alloc(12);
    if ((await file.read(header, 0, 12, 0)).bytesRead !== 12
      || header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error('The prepared audio is not a valid WAV file.');
    }
    let byteRate = 0;
    let dataBytes = 0;
    let channels = 0;
    let sampleRate = 0;
    let offset = 12;
    for (let chunks = 0; offset + 8 <= size && chunks < 256; chunks++) {
      const chunk = Buffer.alloc(8);
      if ((await file.read(chunk, 0, 8, offset)).bytesRead !== 8) break;
      const kind = chunk.toString('ascii', 0, 4);
      const length = chunk.readUInt32LE(4);
      if (offset + 8 + length > size) throw new Error('The prepared audio is incomplete.');
      if (kind === 'fmt ' && length >= 16) {
        const format = Buffer.alloc(16);
        if ((await file.read(format, 0, 16, offset + 8)).bytesRead !== 16
          || ![1, 3, 0xfffe].includes(format.readUInt16LE(0))) {
          throw new Error('The prepared audio format is unsupported.');
        }
        channels = format.readUInt16LE(2);
        sampleRate = format.readUInt32LE(4);
        byteRate = format.readUInt32LE(8);
      }
      if (kind === 'data') dataBytes += length;
      offset += 8 + length + (length % 2);
    }
    if (!(byteRate > 0 && dataBytes > 0 && channels > 0 && sampleRate > 0)) {
      throw new Error('The prepared audio is empty or invalid.');
    }
    return { duration: dataBytes / byteRate, channels, sampleRate };
  } finally { await file.close(); }
}

async function removeOwnedDirectory(parentDirectory, directory) {
  const relative = path.relative(parentDirectory, directory);
  if (!relative || path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`)
    || !path.basename(directory).startsWith('caption-vocals-')) {
    throw new Error('Invalid caption preparation cleanup directory.');
  }
  await fs.rm(directory, { recursive: true, force: true });
}

function modelCacheDirectory() {
  const torchRoot = process.env.TORCH_HOME
    || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'torch');
  return path.join(torchRoot, 'hub', 'checkpoints');
}

async function cachedDemucsModel(pythonPath, cacheDirectory) {
  const venvRoot = path.dirname(path.dirname(pythonPath));
  const demucsRemote = path.join(venvRoot, 'Lib', 'site-packages', 'demucs', 'remote');
  let yaml;
  let manifest;
  try {
    [yaml, manifest] = await Promise.all([
      fs.readFile(path.join(demucsRemote, 'htdemucs.yaml'), 'utf8'),
      fs.readFile(path.join(demucsRemote, 'files.txt'), 'utf8'),
    ]);
  } catch (_) { return null; }
  // The installed htdemucs bag uses hexadecimal signatures. Refuse unfamiliar
  // metadata instead of letting Demucs discover a remote repository.
  const match = yaml.match(/^models:\s*\[([^\]\r\n]+)\]/m);
  if (!match) return null;
  const signatures = match[1].split(',').map(value => value.trim().replace(/^['"]|['"]$/g, ''));
  if (!signatures.length || signatures.length > 8 || signatures.some(value => !/^[0-9a-f]{8}$/.test(value))) return null;
  const files = [];
  for (const signature of signatures) {
    const filename = manifest.split(/\r?\n/).map(line => line.trim())
      .find(line => new RegExp(`^${signature}-[0-9a-f]{8,64}\\.th$`).test(line));
    if (!filename || !await isFile(path.join(cacheDirectory, filename))) return null;
    files.push({ source: path.join(cacheDirectory, filename), filename });
  }
  return { yaml, files };
}

function createCaptionAudioPreparer(dependencies = {}) {
  const runProcess = makeProcessRunner(dependencies.spawnImpl || spawn,
    dependencies.terminateProcessTreeImpl || terminateProcessTree);
  const separationTimeoutMs = dependencies.separationTimeoutMs || SEPARATION_TIMEOUT_MS;
  const conversionTimeoutMs = dependencies.conversionTimeoutMs || CONVERSION_TIMEOUT_MS;

  return async function prepareCaptionAudio(options = {}) {
    const { inputPath, outputDirectory, ffmpegPath, pythonPath, onProgress, signal, mode = 'original' } = options;
    if (typeof inputPath !== 'string' || !inputPath || !await isFile(inputPath)) throw new Error('Caption preparation needs an existing input file.');
    if (!['original', 'vocal-focus'].includes(mode)) throw new Error('Invalid caption audio preparation mode.');
    throwIfAborted(signal);
    if (mode === 'original') return { audioPath: inputPath, cleanupFiles: [], warnings: [] };
    const report = (pct, phase, detail = '') => {
      try { onProgress?.({ pct, phase, detail }); } catch (_) {}
    };
    const fallback = warning => {
      report(100, 'Using original audio', warning);
      return { audioPath: inputPath, cleanupFiles: [], warnings: [warning] };
    };
    if (typeof pythonPath !== 'string' || !await isFile(pythonPath)
      || typeof ffmpegPath !== 'string' || !await isFile(ffmpegPath)) {
      throwIfAborted(signal);
      return fallback('Vocal focus is unavailable because its local Python or FFmpeg runtime is missing. Captions will use the original audio.');
    }
    const pythonRuntime = path.resolve(pythonPath);
    const ffmpegRuntime = path.resolve(ffmpegPath);
    const model = await cachedDemucsModel(pythonRuntime, dependencies.modelCacheDirectory || modelCacheDirectory());
    throwIfAborted(signal);
    if (!model) return fallback('Vocal focus is unavailable because the installed Demucs model or cached weights are missing. Captions will use the original audio.');
    if (typeof outputDirectory !== 'string' || !outputDirectory) throw new Error('Caption preparation needs an output directory.');
    await fs.mkdir(outputDirectory, { recursive: true });
    const directory = await fs.realpath(outputDirectory);
    throwIfAborted(signal);
    const workDirectory = await fs.mkdtemp(path.join(directory, 'caption-vocals-'));
    const preparedPath = path.join(directory, `${path.basename(workDirectory)}.wav`);
    let preparedCreated = false;
    try {
      const repo = path.join(workDirectory, 'models');
      await fs.mkdir(repo);
      await fs.writeFile(path.join(repo, 'htdemucs.yaml'), model.yaml, { flag: 'wx' });
      for (const modelFile of model.files) {
        throwIfAborted(signal);
        const target = path.join(repo, modelFile.filename);
        // Hard links keep the model read-only in practice and avoid copying an
        // 80 MB weight file on the usual same-volume path. Cross-volume works too.
        try { await fs.link(modelFile.source, target); }
        catch (_) { await fs.copyFile(modelFile.source, target, constants.COPYFILE_EXCL); }
      }
      const stereo = path.join(workDirectory, 'source.wav');
      const converted = path.join(workDirectory, 'vocals-16k.wav');
      const env = {
        ...process.env, PYTHONNOUSERSITE: '1', PYTHONUNBUFFERED: '1',
        OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || String(Math.max(1, Math.min(8, os.cpus().length))),
        PATH: `${path.dirname(ffmpegRuntime)}${path.delimiter}${process.env.PATH || ''}`,
      };
      const demucsEnv = {
        ...env,
        // The installed Demucs checkpoint includes its model class metadata.
        // PyTorch 2.6's new default rejects that metadata in LocalRepo. This
        // compatibility override is confined to the separation subprocess;
        // LocalRepo still verifies the cached model's filename checksum.
        TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1',
      };
      report(5, 'Preparing song audio', 'Preparing stereo audio for local vocal separation.');
      await runProcess(ffmpegRuntime, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', path.resolve(inputPath),
        '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', stereo],
      { signal, timeoutMs: conversionTimeoutMs, cwd: workDirectory, env });
      throwIfAborted(signal);
      const original = await inspectPcmWav(stereo);
      report(15, 'Separating song vocals', 'The local model separates singing from accompaniment. This may take several minutes.');
      let lastProgress = 15;
      await runProcess(pythonRuntime, ['-m', 'demucs', '--two-stems', 'vocals', '--shifts', '0', '-d', 'cpu',
        '-n', 'htdemucs', '--repo', repo, '-o', path.join(workDirectory, 'stems'), stereo],
      { signal, timeoutMs: separationTimeoutMs, cwd: workDirectory, env: demucsEnv, onOutput: output => {
        const percents = [...output.matchAll(/\b(\d{1,3})%/g)];
        if (!percents.length) return;
        const pct = Math.max(15, Math.min(85, 15 + Math.round(Number(percents[percents.length - 1][1]) * 0.7)));
        if (pct > lastProgress) {
          lastProgress = pct;
          report(pct, 'Separating song vocals', 'Processing audio locally.');
        }
      } });
      throwIfAborted(signal);
      const vocals = path.join(workDirectory, 'stems', 'htdemucs', 'source', 'vocals.wav');
      const separated = await inspectPcmWav(vocals);
      if (Math.abs(original.duration - separated.duration) > 0.08) throw new Error('Vocal separation changed the audio duration.');
      report(90, 'Preparing vocals for captions', 'Keeping the original timeline while converting vocals to caption audio.');
      await runProcess(ffmpegRuntime, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', vocals,
        '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', converted],
      { signal, timeoutMs: conversionTimeoutMs, cwd: workDirectory, env });
      throwIfAborted(signal);
      const prepared = await inspectPcmWav(converted);
      if (prepared.channels !== 1 || prepared.sampleRate !== 16000 || Math.abs(original.duration - prepared.duration) > 0.1) {
        throw new Error('Prepared vocals did not preserve the original caption timeline.');
      }
      await fs.copyFile(converted, preparedPath, constants.COPYFILE_EXCL);
      preparedCreated = true;
      throwIfAborted(signal);
      await removeOwnedDirectory(directory, workDirectory);
      throwIfAborted(signal);
      report(100, 'Vocal focus ready', 'Local vocal audio is ready. Review captions because vocal separation can alter or miss quiet words.');
      throwIfAborted(signal);
      return {
        audioPath: preparedPath, cleanupFiles: [preparedPath],
        warnings: ['Vocal focus used local Demucs separation. Separation can alter or miss quiet singing and background speech; review the lyrics.'],
      };
    } catch (error) {
      if (preparedCreated) await fs.unlink(preparedPath).catch(() => {});
      await removeOwnedDirectory(directory, workDirectory).catch(() => {});
      if (signal?.aborted || error?.name === 'AbortError') throw abortError();
      if (error?.code === 'CAPTION_AUDIO_TIMEOUT') {
        return fallback('Vocal focus exceeded its local processing time limit. Captions will use the original audio.');
      }
      return fallback('Vocal focus could not produce complete vocals with the original timing. Captions will use the original audio.');
    }
  };
}

const prepareCaptionAudio = createCaptionAudioPreparer();

module.exports = { prepareCaptionAudio, createCaptionAudioPreparer, SEPARATION_TIMEOUT_MS };
