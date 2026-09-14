'use strict';

// A PDF-only, on-demand worker. It never starts or pauses any app service.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CHANNEL = 'presentator-pdf-counting-ocr';
const ENGINE = 'Windows OCR';
const MAX_PNG_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 3000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function failure(error) {
  return { ok: false, text: '', items: [], engine: ENGINE, error: String(error?.message || error) };
}

function validatePngDataUrl(request) {
  const prefix = 'data:image/png;base64,';
  const value = request?.dataUrl;
  if (typeof value !== 'string' || !value.startsWith(prefix)) throw new Error('OCR requires a PNG data URL.');
  const encoded = value.slice(prefix.length);
  if (!encoded || encoded.length > Math.ceil(MAX_PNG_BYTES / 3) * 4) throw new Error('The OCR image must be at most 8 MB.');
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('The OCR image has invalid base64 data.');
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length > MAX_PNG_BYTES || buffer.toString('base64') !== encoded) throw new Error('The OCR image has invalid or oversized base64 data.');
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)
      || buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('The OCR image is not a valid PNG.');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new Error('OCR images must be between 1 and 3000 pixels on each side.');
  }
  return buffer;
}

function normalizeResult(value) {
  if (!value || value.ok !== true) return failure(value?.error || 'Windows OCR could not read this page.');
  if (typeof value.text !== 'string' || value.text.length > 120000 || !Array.isArray(value.items) || value.items.length > 10000) {
    return failure('Windows OCR returned an invalid or excessively large result.');
  }
  const items = [];
  for (const item of value.items) {
    const t = item?.transform;
    if (typeof item?.str !== 'string' || item.str.length > 2000 || !Array.isArray(t) || t.length !== 6
        || !t.every(Number.isFinite) || !Number.isFinite(item.height) || !Number.isFinite(item.width)
        || item.width <= 0 || item.height <= 0 || item.width > MAX_IMAGE_DIMENSION || item.height > MAX_IMAGE_DIMENSION
        || t[4] < 0 || t[4] > MAX_IMAGE_DIMENSION || t[5] > 0 || t[5] < -MAX_IMAGE_DIMENSION) {
      return failure('Windows OCR returned invalid word positions.');
    }
    items.push({ str: item.str, transform: [1, 0, 0, item.height, t[4], t[5]], height: item.height, width: item.width });
  }
  return { ok: true, text: value.text, items, engine: ENGINE };
}

function runWindowsWorker(executable, scriptFile, imageFile, options = {}) {
  const spawnProcess = options.spawnProcess || spawn;
  const timeoutMs = options.timeoutMs ?? 30000;
  return new Promise((resolve, reject) => {
    let child;
    let stdout = '';
    let stderr = '';
    let finished = false;
    let fatalError = null;
    let timer;
    let killTimer;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      error ? reject(error) : resolve(result);
    };
    const terminateOwnWorker = error => {
      if (finished || fatalError) return;
      fatalError = error;
      // This is only the child spawned below, never a process-name/tree kill.
      try { child.kill(); } catch (_) {}
      if (!finished) killTimer = setTimeout(() => finish(fatalError), 1000);
    };
    try {
      child = spawnProcess(executable, [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', scriptFile, '-ImagePath', imageFile,
      ], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) { finish(error); return; }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (finished || fatalError) return;
      stdout += chunk;
      if (stdout.length > 2 * 1024 * 1024) terminateOwnWorker(new Error('Windows OCR output exceeded the safe size limit.'));
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.once('error', error => finish(new Error(`Windows OCR could not start (${error.code || 'worker error'}).`)));
    child.once('close', code => {
      if (fatalError) { finish(fatalError); return; }
      try {
        const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
        if (code !== 0 && result.ok === true) throw new Error(`Windows OCR exited with code ${code}.`);
        finish(null, result);
      } catch (error) {
        finish(new Error(stderr.trim() || error.message || 'Windows OCR returned no result.'));
      }
    });
    timer = setTimeout(() => terminateOwnWorker(new Error('Windows OCR timed out after 30 seconds.')), timeoutMs);
  });
}

function createPdfCountingOcr(options = {}) {
  const platform = options.platform || process.platform;
  const getTempPath = options.getTempPath || os.tmpdir;
  const scriptPath = options.scriptPath || path.join(__dirname, 'scripts', 'pdf-counting-ocr.ps1');
  const executable = options.executable || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const worker = options.runWorker || ((script, image) => runWindowsWorker(executable, script, image));
  let reservations = 0;
  let tail = Promise.resolve();

  async function recognize(buffer) {
    let directory;
    let imageFile;
    let workerFile;
    try {
      directory = await fs.mkdtemp(path.join(getTempPath(), 'presentator-pdf-ocr-'));
      imageFile = path.join(directory, 'page.png');
      workerFile = path.join(directory, 'ocr.ps1');
      // Copy the trusted bundled script, so this also works from Electron ASAR.
      await fs.writeFile(workerFile, await fs.readFile(scriptPath), { flag: 'wx' });
      await fs.writeFile(imageFile, buffer, { flag: 'wx' });
      return normalizeResult(await worker(workerFile, imageFile));
    } catch (error) { return failure(error); }
    finally {
      // Exact files created by this invocation only. No recursive deletion.
      for (const file of [imageFile, workerFile]) {
        if (file) await fs.unlink(file).catch(() => {});
      }
      if (directory) await fs.rmdir(directory).catch(() => {});
    }
  }

  return async request => {
    if (platform !== 'win32') return failure('Local PDF OCR is available on Windows only.');
    // At most one active request plus one waiting request, including PNG memory.
    if (reservations >= 2) return failure('PDF OCR is busy. Please wait for the current page.');
    let buffer;
    try { buffer = validatePngDataUrl(request); } catch (error) { return failure(error); }
    reservations += 1;
    const operation = tail.then(() => recognize(buffer));
    tail = operation.catch(() => {});
    try { return await operation; }
    finally { reservations -= 1; }
  };
}

function registerPdfCountingOcr(ipcMain, options) {
  const recognize = createPdfCountingOcr(options);
  ipcMain.handle(CHANNEL, (_event, request) => recognize(request));
  return recognize;
}

module.exports = { CHANNEL, createPdfCountingOcr, registerPdfCountingOcr, validatePngDataUrl, normalizeResult, runWindowsWorker };
