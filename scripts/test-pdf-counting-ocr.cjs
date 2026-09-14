'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createPdfCountingOcr, validatePngDataUrl, normalizeResult, runWindowsWorker, registerPdfCountingOcr, CHANNEL } = require('../pdf-counting-ocr.cjs');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const request = { dataUrl: 'data:image/png;base64,' + PNG.toString('base64') };
const RESULT = { ok: true, text: 'ELEVEN DOGS', items: [{ str: 'ELEVEN', transform: [1, 0, 0, 15, 30, -40], height: 15, width: 50 }], engine: 'Windows OCR' };

test('rejects invalid formats, noncanonical base64, oversized payloads, and PNG dimensions', () => {
  assert.deepEqual(validatePngDataUrl(request), PNG);
  for (const dataUrl of ['', 'data:image/jpeg;base64,' + PNG.toString('base64'), 'data:image/png;base64,!!!!', 'data:image/png;base64,YQ=A', 'data:image/png;base64,' + 'A'.repeat(12 * 1024 * 1024)]) {
    assert.throws(() => validatePngDataUrl({ dataUrl }));
  }
  const huge = Buffer.from(PNG);
  huge.writeUInt32BE(3001, 16);
  assert.throws(() => validatePngDataUrl({ dataUrl: 'data:image/png;base64,' + huge.toString('base64') }), /3000/);
  const bad = Buffer.from(PNG);
  bad[0] = 0;
  assert.throws(() => validatePngDataUrl({ dataUrl: 'data:image/png;base64,' + bad.toString('base64') }), /valid PNG/);
});

test('preserves engine words/negative-y positions without semantic guesses', () => {
  assert.deepEqual(normalizeResult(RESULT), RESULT);
  assert.equal(normalizeResult({ ok: true, text: '', items: [] }).ok, true);
  assert.equal(normalizeResult({ ...RESULT, items: [{ ...RESULT.items[0], transform: [1, 0, 0, 15, 30, 40] }] }).ok, false);
  assert.equal(normalizeResult({ ok: false, error: 'No language' }).error, 'No language');
});

test('allows one active worker and one queued request, cleans only their exact temporary files', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-ocr-unit-'));
  let release;
  let entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  let running = 0;
  let maxRunning = 0;
  const seen = [];
  const recognize = createPdfCountingOcr({
    platform: 'win32', getTempPath: () => base,
    runWorker: async (script, image) => {
      calls += 1;
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      seen.push(path.dirname(image));
      assert.equal(path.dirname(script), path.dirname(image));
      assert.ok(path.dirname(image).startsWith(base + path.sep));
      assert.deepEqual(await fs.readFile(image), PNG);
      assert.match(await fs.readFile(script, 'utf8'), /RecognizeAsync/);
      if (calls === 1) {
        entered();
        await new Promise(resolve => { release = resolve; });
      }
      running -= 1;
      return RESULT;
    },
  });
  try {
    const first = recognize(request);
    await enteredPromise;
    const second = recognize(request);
    assert.match((await recognize(request)).error, /busy/);
    release();
    assert.equal((await first).ok, true);
    assert.equal((await second).ok, true);
    assert.equal(calls, 2);
    assert.equal(maxRunning, 1);
    assert.equal(new Set(seen).size, 2);
    assert.deepEqual(await fs.readdir(base), []);
  } finally { await fs.rmdir(base); }
});

test('cleans scoped files after worker failure and never starts on invalid/non-Windows input', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-ocr-unit-'));
  let calls = 0;
  const options = { platform: 'win32', getTempPath: () => base, runWorker: async () => { calls += 1; throw new Error('Test failure'); } };
  try {
    const recognize = createPdfCountingOcr(options);
    assert.equal((await recognize({ dataUrl: 'bad' })).ok, false);
    assert.equal((await createPdfCountingOcr({ ...options, platform: 'linux' })(request)).ok, false);
    assert.equal(calls, 0);
    assert.equal((await recognize(request)).error, 'Test failure');
    assert.equal(calls, 1);
    assert.deepEqual(await fs.readdir(base), []);
  } finally { await fs.rmdir(base); }
});

test('worker uses hidden shell-free -File invocation and kills only its child on timeout', async () => {
  let killed = 0;
  const spawnProcess = (executable, args, options) => {
    assert.equal(executable, 'trusted-powershell.exe');
    assert.deepEqual(args.slice(-4), ['-File', 'trusted-script.ps1', '-ImagePath', 'scoped-page.png']);
    assert.equal(options.windowsHide, true);
    assert.equal(options.shell, false);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { killed += 1; setImmediate(() => child.emit('close', 1)); return true; };
    return child;
  };
  await assert.rejects(runWindowsWorker('trusted-powershell.exe', 'trusted-script.ps1', 'scoped-page.png', { spawnProcess, timeoutMs: 20 }), /timed out/);
  assert.equal(killed, 1);
});

test('registers only the dedicated PDF IPC channel', async () => {
  let channel;
  let handler;
  registerPdfCountingOcr({ handle: (name, listener) => { channel = name; handler = listener; } }, { platform: 'linux' });
  assert.equal(channel, CHANNEL);
  assert.equal((await handler({}, request)).engine, 'Windows OCR');
});

if (process.env.PDF_OCR_REAL_TEST === '1') {
  test('real Windows OCR reads the existing nursery render through the module', { skip: process.platform !== 'win32' }, async () => {
    const pagePath = path.join(__dirname, '..', 'tmp', 'pdfs', 'nursery-pages', 'page-26.png');
    const dataUrl = 'data:image/png;base64,' + (await fs.readFile(pagePath)).toString('base64');
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-ocr-real-test-'));
    try {
      const result = await createPdfCountingOcr({ getTempPath: () => base })({ dataUrl });
      assert.equal(result.ok, true, result.error);
      assert.match(result.text, /DOGS/i);
      assert.match(result.text, /ELEVEN/i);
      assert.ok(result.items.length >= 2);
      assert.ok(result.items.every(item => item.transform[5] <= 0));
      assert.deepEqual(await fs.readdir(base), []);
      console.log('Real OCR:', JSON.stringify(result));
    } finally { await fs.rmdir(base); }
  });
}
