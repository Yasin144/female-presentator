'use strict';

// Execute the actual Local IPC callbacks with memory-only files and children.
// No FFmpeg, models, server, credentials or network requests are started.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { StringDecoder } = require('node:string_decoder');
const { test } = require('node:test');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
const callbacks = new Map();
const helperSources = [];
(function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && /^normalizeLocalCaption/.test(node.id?.name)) {
    helperSources.push(source.slice(node.start, node.end));
  }
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
      && node.callee.object.name === 'ipcMain' && node.callee.property.name === 'handle') {
    const [channel, callback] = node.arguments;
    if (['transcribe-video', 'cancel-transcribe-video'].includes(channel?.value)) {
      callbacks.set(channel.value, source.slice(callback.start, callback.end));
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
})(ast);
assert.equal(callbacks.size, 2);
const plain = value => JSON.parse(JSON.stringify(value));
const recognized = {
  text: 'Hello world.', language: 'en', duration: 5, timingSource: 'word',
  segments: [{ text: 'Hello world.', start: 0.2, end: 1.3 }],
  words: [{ word: 'Hello', start: 0.2, end: 0.7 }, { word: 'world.', start: 0.7, end: 1.3 }],
  warnings: ['Review the opening words.'],
};

function fixture(options = {}) {
  const root = path.resolve('caption-local-ipc-fixture');
  const videoPath = path.join(root, 'source video.mp4');
  const ffmpegPath = path.join(root, 'ffmpeg.exe');
  const voicePython = path.join(root, '.voiceclone-venv', 'Scripts', 'python.exe');
  const singingPython = path.join(root, '.singing-venv', 'Scripts', 'python.exe');
  const captionScript = path.join(root, 'whisper-transcribe-caption.py');
  const files = new Map([[videoPath, Buffer.from('fixture video')]]);
  const timers = new Map();
  const calls = { spawn: [], fallback: [], progress: [], kills: [], reads: [], removed: [], warnings: [], preprocess: [], diagnostics: [], errors: [] };
  let cancel, extractionProcess, workerProcess, releaseExtraction, releaseWorker;
  let extractionStarted, workerStarted, fallbackStarted;
  const extractionReady = new Promise(resolve => { extractionStarted = resolve; });
  const workerReady = new Promise(resolve => { workerStarted = resolve; });
  const fallbackReady = new Promise(resolve => { fallbackStarted = resolve; });
  const context = vm.createContext({
    Buffer, path, StringDecoder, AbortController, AbortSignal,
    process: { env: { FIXTURE_ENV: 'preserved' } }, ROOT: root, SINGING_ENV: { FIXTURE_SINGING: 'inherited' },
    activeCaptionTranscribeProcess: null, activeCaptionSongController: null, activeCaptionTranscribeCancelRequested: false,
    ensureCaptionWorkDir: (...parts) => path.join(root, 'caption-work', ...parts),
    prepareCaptionVoiceMemory: async () => { throw new Error('Local captions must not invoke unrelated model policy.'); },
    fetch: async () => { throw new Error('No real network request may be made by Local captions.'); },
    console: { log() {}, error(...args) { calls.errors.push(plain(args)); }, warn(...args) { calls.warnings.push(plain(args)); } },
    setTimeout: (fn, ms) => { const token = {}; timers.set(token, { fn, ms }); return token; },
    clearTimeout: token => timers.delete(token),
    fs: {
      existsSync: name => files.has(name) || name === ffmpegPath
        || (name === voicePython && !options.noVoicePython)
        || (name === singingPython && !options.noSingingPython)
        || (name === captionScript && !options.noCaptionScript),
      statSync: name => { assert.ok(files.has(name)); return { size: files.get(name).length }; },
      readFileSync: name => { calls.reads.push(name); assert.ok(files.has(name), 'Only memory-only fixture audio may be read.'); return files.get(name); },
      writeFileSync: (name, contents) => {
        if (options.diagnosticWriteFails) throw new Error('Fixture diagnostics directory is unavailable.');
        assert.equal(path.dirname(name), path.join(root, 'caption-work', 'diagnostics'));
        const data = Buffer.from(contents);
        files.set(name, data); calls.diagnostics.push({ path: name, body: JSON.parse(data.toString('utf8')) });
      },
      unlinkSync: name => { calls.removed.push(name); files.delete(name); },
    },
    require: name => {
      if (name === 'child_process' || name === 'node:child_process') return { execSync: () => ffmpegPath + '\n' };
      if (name === 'string_decoder' || name === 'node:string_decoder') return { StringDecoder };
      if (name === './caption-audio-preprocess.cjs') return { prepareCaptionAudio: async request => {
        calls.preprocess.push(request);
        if (options.cancelPreprocess) await cancel();
        if (options.preprocessFails) throw new Error('Fixture vocal preparation failed.');
        request.onProgress({ pct: 90 }); request.onProgress({ pct: 20 }); request.onProgress({ pct: 100 });
        const inside = path.join(request.outputDirectory, 'focused.wav');
        const outside = path.join(root, 'unrelated.wav');
        files.set(inside, Buffer.from('focused fixture WAV')); files.set(outside, Buffer.from('unrelated data'));
        return { audioPath: options.preprocessOriginal ? videoPath : inside, cleanupFiles: [inside, outside, request.outputDirectory], warnings: ['Fixture vocal warning.'] };
      } };
      throw new Error('Unexpected dependency: ' + name);
    },
    postJsonForBufferWithRecovery: async (...args) => {
      calls.fallback.push(args); fallbackStarted();
      if (options.cancelFallback) await cancel();
      if (options.holdFallback) await new Promise((resolve, reject) => {
        args[5].addEventListener('abort', () => reject(Object.assign(new Error('Fixture fallback aborted.'), { name: 'AbortError' })), { once: true });
      });
      if (options.fallbackThrows) throw new Error('Fixture backup unavailable.');
      const body = Object.hasOwn(options, 'fallbackResult') ? options.fallbackResult : recognized;
      return {
        statusCode: options.fallbackStatus ?? 200,
        buffer: Buffer.from(options.fallbackRaw ?? JSON.stringify(body)),
      };
    },
    killProcessTree: proc => {
      calls.kills.push(proc.pid);
      if (options.holdKill) return;
      if (!proc.finished) setImmediate(() => {
        proc.finished = true; proc.stdout.end(); proc.stderr.end(); proc.emit('exit', 1); proc.emit('close', 1);
      });
    },
    spawn: (command, args, spawnOptions) => {
      const proc = new EventEmitter(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
      proc.pid = 100 + calls.spawn.length; proc.finished = false;
      const extraction = args.includes('-vn');
      calls.spawn.push({ command, args: plain(args), options: plain(spawnOptions), extraction });
      const finish = (code = 0) => { if (!proc.finished) { proc.finished = true; proc.emit('exit', code); proc.emit('close', code); } };
      if (extraction) {
        extractionProcess = proc; extractionStarted();
        releaseExtraction = () => {
          if (proc.finished) return;
          if (options.extractionError) { proc.finished = true; proc.emit('error', new Error('Fixture FFmpeg cannot start.')); return; }
          if (options.extractionCode) { proc.stderr.write(Buffer.from('Fixture media has no audio.')); finish(options.extractionCode); return; }
          files.set(args.at(-1), Buffer.from('fixture extracted WAV')); finish();
        };
        if (!options.holdExtraction) setImmediate(releaseExtraction);
      } else {
        workerProcess = proc; workerStarted();
        releaseWorker = () => {
          if (proc.finished) return;
          if (options.workerError) { proc.finished = true; proc.emit('error', new Error('Fixture Python unavailable.')); return; }
          const body = Object.hasOwn(options, 'primaryResult') ? options.primaryResult : recognized;
          const output = options.primaryRaw ?? 'PROGRESS:40\n' + JSON.stringify(body) + '\n';
          const chunks = options.chunks || [Buffer.from(output)];
          const sendOutput = () => {
            for (const chunk of chunks) proc.stdout.write(chunk);
            proc.stdout.end();
            if (options.stderrAfterStdout) setImmediate(() => proc.stderr.end(Buffer.from(options.stderr || '')));
            else proc.stderr.end(Buffer.from(options.stderr || ''));
          };
          if (options.stdoutAfterExit) {
            proc.emit('exit', options.workerCode ?? 0);
            setImmediate(() => { sendOutput(); proc.finished = true; proc.emit('close', options.workerCode ?? 0); });
          } else { sendOutput(); finish(options.workerCode ?? 0); }
        };
        if (!options.holdWorker) setImmediate(releaseWorker);
      }
      return proc;
    },
  });
  if (helperSources.length) vm.runInContext(helperSources.join('\n'), context);
  cancel = vm.runInContext('(' + callbacks.get('cancel-transcribe-video') + ')', context);
  const native = vm.runInContext('(' + callbacks.get('transcribe-video') + ')', context);
  const event = { sender: { send: (channel, value) => {
    calls.progress.push({ channel, value });
    if (options.rendererGone) throw new Error('Fixture renderer destroyed.');
  } } };
  return {
    calls, context, files, root, videoPath, voicePython, singingPython, captionScript,
    cancel, extractionReady, workerReady, fallbackReady,
    invoke: (overrides = {}) => native(event, { videoPath, engine: 'local', contentMode: 'speech', languageHint: 'auto', ...overrides }).then(plain),
    releaseExtraction: () => releaseExtraction(), releaseWorker: () => releaseWorker(),
    fireWatchdog: () => {
      assert.equal(timers.size, 1);
      const [token, timer] = timers.entries().next().value;
      timers.delete(token); timer.fn(); return timer.ms;
    },
    get extractionProcess() { return extractionProcess; }, get workerProcess() { return workerProcess; },
    assertReleased() {
      assert.equal(context.activeCaptionTranscribeProcess, null);
      assert.equal(context.activeCaptionSongController, null);
      assert.equal(context.activeCaptionTranscribeCancelRequested, false);
      assert.equal(timers.size, 0, 'Every terminal path clears the Local watchdog.');
    },
  };
}

test('Local primary preserves genuine words, segments, language, duration and timing metadata', async () => {
  const f = fixture(); const result = await f.invoke(); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.engine, 'local');
  assert.equal(result.text, recognized.text); assert.deepEqual(result.words, recognized.words);
  assert.deepEqual(result.segments, recognized.segments); assert.equal(result.language, 'en');
  assert.equal(result.duration, 5); assert.equal(result.timingSource, 'word');
  assert.deepEqual(result.warnings, recognized.warnings); assert.equal(result.contentMode, 'speech');
  assert.equal(f.calls.fallback.length, 0); assert.equal(f.calls.progress.at(-1).value, 100);
  assert.equal(f.calls.diagnostics.length, 0);
});

for (const [name, payload, expected] of [
  ['overlapping words', { ...recognized, words: [{ word: 'Hello', start: 0.2, end: 0.8 }, { word: 'world.', start: 0.7, end: 1.3 }] },
    { array: 'words', index: 1, label: 'world.', start: 0.7, end: 1.3, previousEnd: 0.8, duration: 5, reason: 'overlapping or negative timestamp' }],
  ['collapsed word', { ...recognized, words: [{ word: recognized.text, start: 0.2, end: 0.2 }] },
    { array: 'words', index: 0, label: recognized.text, start: 0.2, end: 0.2, previousEnd: 0, duration: 5, reason: 'empty or inverted interval' }],
  ['word beyond duration', { ...recognized, words: [{ word: recognized.text, start: 0.2, end: 6 }] },
    { array: 'words', index: 0, label: recognized.text, start: 0.2, end: 6, previousEnd: 0, duration: 5, reason: 'outside audio duration' }],
  ['overlapping segments', { ...recognized, segments: [{ text: 'Hello', start: 0.2, end: 0.8 }, { text: 'world.', start: 0.7, end: 1.3 }] },
    { array: 'segments', index: 1, label: 'world.', start: 0.7, end: 1.3, previousEnd: 0.8, duration: 5, reason: 'overlapping or negative timestamp' }],
]) test(`Local diagnostics identify the exact rejected ${name}`, async () => {
  const f = fixture({ primaryResult: payload, stderr: 'Fixture decoder detail.' });
  const result = await f.invoke({ apiKey: 'fixture-super-secret-api-key' }); f.assertReleased();
  assert.equal(result.ok, false); assert.equal(result.code, 'CAPTION_LOCAL_RESULT_INVALID');
  assert.deepEqual(result.timingIssue, expected);
  assert.ok(result.error.includes(`${expected.array}[${expected.index}]: ${expected.reason}`));
  assert.equal(f.calls.diagnostics.length, 1);
  const diagnostic = f.calls.diagnostics[0];
  assert.equal(result.diagnosticPath, diagnostic.path); assert.equal(diagnostic.body.sourceVideo, f.videoPath);
  assert.equal(diagnostic.body.audioPath, f.calls.spawn[0].args.at(-1));
  assert.deepEqual(diagnostic.body.timingIssue, expected); assert.deepEqual(diagnostic.body.result, payload);
  assert.equal(diagnostic.body.exitCode, 0); assert.equal(diagnostic.body.stderr, 'Fixture decoder detail.');
  assert.ok(diagnostic.body.stdout.includes(JSON.stringify(payload))); assert.equal(diagnostic.body.stdoutTruncated, false);
  assert.equal(f.calls.fallback.length, 0);
  const saved = JSON.stringify(diagnostic.body);
  assert.equal(saved.includes('fixture-super-secret-api-key'), false); assert.equal(saved.includes('FIXTURE_ENV'), false);
  assert.equal(f.calls.errors.some(args => args.includes(diagnostic.path)), true);
});

test('Local diagnostics directory failure preserves the original rejection and releases the job', async () => {
  const f = fixture({ diagnosticWriteFails: true, primaryResult: { ...recognized, words: [{ word: recognized.text, start: 0.2, end: 0.2 }] } });
  const result = await f.invoke(); f.assertReleased();
  assert.equal(result.code, 'CAPTION_LOCAL_RESULT_INVALID'); assert.match(result.error, /conflicting or incomplete/);
  assert.equal(result.timingIssue.reason, 'empty or inverted interval'); assert.equal(result.diagnosticPath, undefined);
  assert.equal(f.calls.fallback.length, 0); assert.match(f.calls.warnings.flat().join(' '), /Could not save Local failure diagnostics/);
});

test('Local failed final validation from Python is not duplicated by HTTP recognition', async () => {
  const timingIssue = { array: 'words', index: 4, reason: 'empty interval' };
  const f = fixture({ workerCode: 1, primaryResult: { error: 'Word timing repair could not verify this phrase.', code: 'CAPTION_LOCAL_RESULT_INVALID', timingIssue } });
  const result = await f.invoke(); f.assertReleased();
  assert.equal(result.code, 'CAPTION_LOCAL_RESULT_INVALID'); assert.match(result.error, /could not verify this phrase/);
  assert.deepEqual(result.timingIssue, timingIssue); assert.equal(f.calls.fallback.length, 0);
  assert.equal(f.calls.diagnostics[0].body.exitCode, 1);
});

test('Local failure diagnostics preserve late fragmented UTF-8 stdout', async () => {
  const text = '\u0c28\u0c2e\u0c38\u0c4d\u0c15\u0c3e\u0c30\u0c02';
  const payload = { ...recognized, text, words: [{ word: text, start: 0.2, end: 0.2 }], segments: [{ text, start: 0.2, end: 1.3 }] };
  const output = Buffer.from('PROGRESS:40\n' + JSON.stringify(payload));
  const split = output.findIndex(byte => byte > 127) + 1;
  const f = fixture({ stdoutAfterExit: true, chunks: [output.subarray(0, split), output.subarray(split)] });
  const result = await f.invoke(); f.assertReleased();
  assert.equal(result.code, 'CAPTION_LOCAL_RESULT_INVALID'); assert.equal(result.timingIssue.label, text);
  assert.equal(f.calls.diagnostics[0].body.result.text, text);
  assert.ok(f.calls.diagnostics[0].body.stdout.includes(text));
});

test('Local failure diagnostics wait for stderr after stdout and process exit', async () => {
  const f = fixture({ stdoutAfterExit: true, stderrAfterStdout: true, stderr: 'Late decoder failure detail.',
    primaryResult: { ...recognized, words: [{ word: recognized.text, start: 0.2, end: 0.2 }] } });
  const result = await f.invoke(); f.assertReleased();
  assert.equal(result.code, 'CAPTION_LOCAL_RESULT_INVALID');
  assert.equal(f.calls.diagnostics[0].body.stderr, 'Late decoder failure detail.');
});

test('Local cancellation does not save a misleading worker failure diagnostic', async () => {
  const f = fixture({ holdWorker: true }); const pending = f.invoke(); await f.workerReady;
  await f.cancel(); assert.equal((await pending).cancelled, true); f.assertReleased();
  assert.equal(f.calls.diagnostics.length, 0);
});

test('Local HTTP failures preserve the worker error body separately from primary diagnostics', async () => {
  const f = fixture({ workerCode: 1, primaryResult: { error: 'Fixture primary failure.' }, fallbackStatus: 503,
    fallbackResult: { error: 'Fixture Local service is busy. Wait for the active job.' } });
  const result = await f.invoke(); f.assertReleased();
  assert.equal(result.ok, false); assert.match(result.error, /HTTP 503.*Local service is busy/);
  assert.equal(f.calls.diagnostics.length, 2);
  assert.notEqual(f.calls.diagnostics[0].path, f.calls.diagnostics[1].path);
  assert.equal(f.calls.diagnostics[1].body.transport, 'http'); assert.equal(f.calls.diagnostics[1].body.statusCode, 503);
  assert.match(f.calls.diagnostics[1].body.responseBody, /Local service is busy/);
});

for (const fallbackRaw of ['invalid json', JSON.stringify({ ...recognized, words: [{ word: recognized.text, start: 0.2, end: 0.2 }] })]) {
  test(`Local invalid HTTP 200 replies preserve bounded failure diagnostics: ${fallbackRaw.slice(0, 30)}`, async () => {
    const f = fixture({ workerError: true, fallbackRaw }); const result = await f.invoke(); f.assertReleased();
    assert.equal(result.ok, false); assert.match(result.error, /Backup transcription also failed/);
    const diagnostic = f.calls.diagnostics.at(-1);
    assert.equal(result.diagnosticPath, diagnostic.path); assert.equal(diagnostic.body.transport, 'http');
    assert.equal(diagnostic.body.statusCode, 200); assert.equal(diagnostic.body.responseBody, fallbackRaw);
    if (fallbackRaw !== 'invalid json') {
      assert.equal(result.code, 'CAPTION_LOCAL_RESULT_INVALID'); assert.equal(result.timingIssue.reason, 'empty or inverted interval');
      assert.deepEqual(diagnostic.body.result, JSON.parse(fallbackRaw));
    }
  });
}

for (const [end, accepted] of [[5, true], [5.01, true], [5.0101, false]]) {
  test(`Local duration allowance remains strict at end ${end}`, async () => {
    const payload = { ...recognized, words: [{ word: recognized.text, start: 0.2, end }], segments: [{ text: recognized.text, start: 0.2, end }] };
    const f = fixture({ primaryResult: payload }); const result = await f.invoke(); f.assertReleased();
    assert.equal(result.ok, accepted); assert.equal(f.calls.fallback.length, 0);
    if (!accepted) assert.equal(result.timingIssue.reason, 'outside audio duration');
  });
}

for (const language of ['auto', 'en', 'hi', 'te', 'ta', 'ar', 'zh', 'ja', 'es', 'fr']) {
  for (const mode of ['speech', 'song']) {
    test(`Local worker receives ${mode} / ${language} options without losing explicit hints`, async () => {
      const hints = 'User supplied vocabulary '.repeat(70);
      const f = fixture(); const result = await f.invoke({ languageHint: language, contentMode: mode, transcriptionHints: hints, autoRecoverMissingSpeech: false });
      f.assertReleased(); assert.equal(result.ok, true);
      const worker = f.calls.spawn.find(call => !call.extraction);
      assert.equal(worker.command, f.voicePython); assert.equal(worker.args[0], f.captionScript);
      assert.equal(worker.args[2], language); assert.equal(worker.args[3], 'source video.mp4');
      assert.equal(worker.args[4], mode); assert.equal(worker.args[5], hints.slice(0, 1000)); assert.equal(worker.args[6], 'no-recovery');
      assert.equal(worker.options.env.PYTHONIOENCODING, 'utf-8'); assert.equal(worker.options.env.FIXTURE_ENV, 'preserved');
      assert.equal(worker.options.env.FIXTURE_SINGING, 'inherited'); assert.equal(worker.options.windowsHide, true);
      assert.equal(worker.options.env.PYTHONPATH, path.join(f.root, '.voiceclone-venv', 'Lib', 'site-packages'));
    });
  }
}

for (const [options, expectedPython, expectedScript] of [
  [{}, '.voiceclone-venv', 'whisper-transcribe-caption.py'],
  [{ noVoicePython: true }, '.singing-venv', 'whisper-transcribe-caption.py'],
  [{ noVoicePython: true, noSingingPython: true }, 'python', 'whisper-transcribe-caption.py'],
  [{ noCaptionScript: true }, '.voiceclone-venv', 'whisper-transcribe.py'],
]) test(`Local runtime selection ${expectedPython} / ${expectedScript}`, async () => {
  const f = fixture(options); assert.equal((await f.invoke()).ok, true); f.assertReleased();
  const worker = f.calls.spawn.find(call => !call.extraction);
  assert.ok(worker.command.includes(expectedPython)); assert.ok(worker.args[0].endsWith(expectedScript));
  assert.equal(worker.args[6], 'recover');
  if (expectedPython !== 'python') assert.equal(worker.options.env.PYTHONPATH,
    path.join(f.root, expectedPython, 'Lib', 'site-packages'));
});

test('Local extraction uses fixed mono 16 kHz PCM and a hidden child process', async () => {
  const f = fixture(); assert.equal((await f.invoke()).ok, true); f.assertReleased();
  const extraction = f.calls.spawn[0];
  assert.deepEqual(extraction.args.slice(0, -1), ['-y', '-i', f.videoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1']);
  assert.equal(extraction.options.windowsHide, true); assert.equal(extraction.options.stdio, 'pipe');
  assert.equal(f.files.has(extraction.args.at(-1)), true, 'Source WAV remains available for diagnostics.');
});

for (const chunks of [
  ['PRO', 'GRESS:10\nPROGRESS:4', '0\r', '\nPROGRESS:20\nPROGRESS:500\n'],
  ['PROGRESS:0\r\nPROGRESS:70\n', 'PROGRESS:12\nPROGRESS:99\n'],
  ['not progress\nPROGRESS:40\n', 'PROGRESS:nope\nPROGRESS:80\n'],
]) test(`Local fragmented progress remains monotonic: ${chunks.join('|')}`, async () => {
  const f = fixture({ chunks: [...chunks.map(chunk => Buffer.from(chunk)), Buffer.from(JSON.stringify(recognized))] });
  assert.equal((await f.invoke()).ok, true); f.assertReleased();
  const progress = f.calls.progress.map(call => call.value);
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.every((value, index) => value >= 0 && value <= 100 && (!index || value >= progress[index - 1])));
  assert.ok(f.calls.progress.every(call => call.channel === 'caption-transcribe-progress'));
});

const multilingual = ['\u0c28\u0c2e\u0c38\u0c4d\u0c15\u0c3e\u0c30\u0c02', '\u0928\u092e\u0938\u094d\u0924\u0947', '\u0627\u0644\u0639\u0631\u0628\u064a\u0629', '\u4f60\u597d', '\u3053\u3093\u306b\u3061\u306f', 'caf\u00e9', '\ud83c\udfb5'];
for (const text of multilingual) {
  const primaryResult = { ...recognized, text, segments: [{ text, start: 0.2, end: 1.3 }], words: [{ word: text, start: 0.2, end: 1.3 }] };
  const output = Buffer.from('PROGRESS:50\n' + JSON.stringify(primaryResult) + '\n');
  const firstMultibyte = output.findIndex(byte => byte > 127);
  for (const split of [firstMultibyte + 1, firstMultibyte + 2]) {
    test(`Local UTF-8 reply survives a child stdout byte split for ${JSON.stringify(text)} at ${split}`, async () => {
      const f = fixture({ chunks: [output.subarray(0, split), output.subarray(split)] });
      const result = await f.invoke(); f.assertReleased();
      assert.equal(result.ok, true); assert.equal(result.text, text);
      assert.deepEqual(result.words, primaryResult.words); assert.deepEqual(result.segments, primaryResult.segments);
    });
  }
}

for (const options of [
  { primaryRaw: '' }, { primaryRaw: 'PROGRESS:10\ninvalid json\n' },
  { primaryResult: { error: 'Fixture ASR allocation failure.' }, workerCode: 1 },
  { primaryResult: recognized, workerCode: 1, stderr: 'Fixture process crashed.' },
  { workerError: true },
]) test(`Local primary failure recovers through HTTP: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options); const result = await f.invoke(); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.engine, 'local'); assert.equal(result.duration, 5);
  assert.equal(result.timingSource, 'word'); assert.deepEqual(result.words, recognized.words);
  assert.match(result.warnings.join(' '), /backup transcription worker/);
  assert.equal(f.calls.fallback.length, 1); assert.equal(f.calls.progress.at(-1).value, 100);
});

for (const primaryResult of [{}, { text: '', words: [], segments: [] }, { ok: false }, [], 'invalid result', 42]) {
  test(`Local unusable primary response fails without duplicating recognition: ${JSON.stringify(primaryResult)}`, async () => {
    const f = fixture({ primaryResult }); const result = await f.invoke(); f.assertReleased();
    assert.equal(result.ok, false); assert.equal(result.code, 'CAPTION_LOCAL_RESULT_INVALID');
    assert.equal(f.calls.fallback.length, 0);
    assert.equal(f.calls.progress.some(call => call.value === 100), false);
  });
}

for (const primaryResult of [{}, { text: '', words: [], segments: [] }, { error: 'Fixture no lyrics.' }, [], 'invalid result', 42]) {
  test(`Local song mode rejects unusable primary result without HTTP fallback: ${JSON.stringify(primaryResult)}`, async () => {
    const f = fixture({ primaryResult }); const result = await f.invoke({ contentMode: 'song' }); f.assertReleased();
    assert.equal(result.ok, false); assert.match(result.error, /Local (song transcription failed|caption result is invalid)/);
    assert.equal(f.calls.fallback.length, 0); assert.equal(f.calls.progress.some(call => call.value === 100), false);
  });
}

for (const options of [
  { fallbackThrows: true }, { fallbackStatus: 503 }, { fallbackStatus: 401 },
  { fallbackRaw: 'invalid json' }, { fallbackResult: null }, { fallbackResult: {} },
  { fallbackResult: { error: 'Fixture backup failed.' } }, { fallbackResult: { ok: false } },
  { fallbackResult: { text: '', words: [], segments: [] } },
]) test(`Local failed backup never produces successful captions: ${JSON.stringify(options)}`, async () => {
  const f = fixture({ primaryResult: { error: 'Fixture primary failed.' }, ...options });
  const result = await f.invoke(); f.assertReleased();
  assert.equal(result.ok, false); assert.match(result.error, /Backup transcription also failed/);
  assert.equal(f.calls.progress.some(call => call.value === 100), false);
});

for (const language of ['auto', 'en', 'hi', 'te']) {
  for (const recovery of [undefined, true, false]) {
    test(`Local backup preserves ${language} and recovery=${recovery}`, async () => {
      const f = fixture({ workerError: true });
      const result = await f.invoke({ languageHint: language, transcriptionHints: 'Explicit vocabulary', autoRecoverMissingSpeech: recovery }); f.assertReleased();
      assert.equal(result.ok, true); assert.equal(f.calls.fallback.length, 1);
      const [port, endpoint, payload, timeout, attempts, signal] = f.calls.fallback[0];
      assert.equal(port, 8428); assert.equal(endpoint, '/api/transcribe'); assert.equal(payload.language, language);
      assert.equal(payload.contentMode, 'speech'); assert.equal(payload.sourceName, 'source video.mp4');
      assert.equal(payload.wordTimestamps, true); assert.equal(payload.transcriptionHints, 'Explicit vocabulary');
      assert.equal(payload.autoRecoverMissingSpeech, recovery !== false); assert.equal(payload.audioBase64, Buffer.from('fixture extracted WAV').toString('base64'));
      assert.equal(timeout, 300000); assert.equal(attempts, 3); assert.equal(signal.aborted, false);
    });
  }
}

for (const primaryResult of [
  { ...recognized, timingSource: 'estimated', words: [], warnings: ['Estimated timestamps.', 42, null] },
  { ...recognized, warnings: [null, 42, 'Keep only the useful warning.'] },
  { ...recognized, text: '', words: recognized.words, segments: [] },
]) test(`Local primary filters warnings and keeps timing mode ${primaryResult.timingSource}`, async () => {
  const f = fixture({ primaryResult }); const result = await f.invoke(); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.timingSource, primaryResult.timingSource);
  assert.deepEqual(result.words, primaryResult.words);
  assert.deepEqual(result.warnings, primaryResult.warnings.filter(warning => typeof warning === 'string'));
});

test('Local vocal preparation uses its focused WAV and monotonic mapped progress', async () => {
  const f = fixture(); const result = await f.invoke({ contentMode: 'song', audioMode: 'vocal-focus' }); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.contentMode, 'song');
  const request = f.calls.preprocess[0]; const worker = f.calls.spawn.find(call => !call.extraction);
  assert.equal(request.inputPath, f.videoPath); assert.equal(request.mode, 'vocal-focus');
  assert.equal(worker.args[1], path.join(request.outputDirectory, 'focused.wav'));
  assert.deepEqual(result.warnings, ['Fixture vocal warning.', ...recognized.warnings]);
  assert.deepEqual(f.calls.removed, [path.join(request.outputDirectory, 'focused.wav')]);
  assert.equal(f.files.has(path.join(f.root, 'unrelated.wav')), true);
  const progress = f.calls.progress.map(call => call.value);
  assert.ok(progress.every((value, index) => !index || value >= progress[index - 1])); assert.equal(progress.at(-1), 100);
});

test('Local vocal preparation may retain the original extracted WAV', async () => {
  const f = fixture({ preprocessOriginal: true }); assert.equal((await f.invoke({ contentMode: 'song', audioMode: 'vocal-focus' })).ok, true); f.assertReleased();
  assert.equal(f.calls.spawn[1].args[1], f.calls.spawn[0].args.at(-1));
});

test('Local speech does not prepare singing vocals when audioMode is vocal-focus', async () => {
  const f = fixture(); assert.equal((await f.invoke({ audioMode: 'vocal-focus' })).ok, true); f.assertReleased();
  assert.equal(f.calls.preprocess.length, 0);
});

test('Local failed vocal preparation terminates song mode without a duplicate worker', async () => {
  const f = fixture({ preprocessFails: true }); const result = await f.invoke({ contentMode: 'song', audioMode: 'vocal-focus' }); f.assertReleased();
  assert.equal(result.ok, false); assert.match(result.error, /vocal preparation failed/);
  assert.equal(f.calls.spawn.length, 1); assert.equal(f.calls.fallback.length, 0);
});

for (const stage of ['extraction', 'worker', 'fallback']) test(`Local cancellation during ${stage} stops completion and releases job guard`, async () => {
  const f = fixture({ holdExtraction: stage === 'extraction', holdWorker: stage === 'worker', workerError: stage === 'fallback', holdFallback: stage === 'fallback' });
  const pending = f.invoke();
  await (stage === 'extraction' ? f.extractionReady : stage === 'worker' ? f.workerReady : f.fallbackReady);
  const controller = f.context.activeCaptionSongController;
  const busy = await f.invoke(); assert.equal(busy.code, 'CAPTION_TRANSCRIPTION_BUSY');
  const groqBusy = await f.invoke({ engine: 'groq' }); assert.equal(groqBusy.code, 'CAPTION_TRANSCRIPTION_BUSY');
  const geminiBusy = await f.invoke({ engine: 'gemini', contentMode: 'song' }); assert.equal(geminiBusy.code, 'CAPTION_TRANSCRIPTION_BUSY');
  assert.equal(f.context.activeCaptionSongController, controller);
  await f.cancel(); const result = await pending; f.assertReleased();
  assert.equal(result.ok, false); assert.equal(result.cancelled, true); assert.equal(controller.signal.aborted, true);
  assert.equal(f.calls.progress.some(call => call.value === 100), false);
  assert.equal(f.calls.kills.length, stage === 'fallback' ? 0 : 1);
  assert.equal(f.calls.fallback.length, stage === 'fallback' ? 1 : 0);
});

test('Local cancellation rejects a late successful backup reply', async () => {
  const f = fixture({ workerError: true, cancelFallback: true }); const result = await f.invoke(); f.assertReleased();
  assert.equal(result.cancelled, true); assert.equal(f.calls.fallback[0][5].aborted, true);
  assert.equal(f.calls.progress.some(call => call.value === 100), false);
});

test('Local cancellation during vocal preparation prevents Whisper start and cleans generated focus audio', async () => {
  const f = fixture({ cancelPreprocess: true }); const result = await f.invoke({ contentMode: 'song', audioMode: 'vocal-focus' }); f.assertReleased();
  assert.equal(result.cancelled, true); assert.equal(f.calls.spawn.length, 1); assert.equal(f.calls.fallback.length, 0);
  assert.equal(f.calls.removed.length, 1);
});

test('Local job guard is released after completion and cancellation does not leak into the next job', async () => {
  const f = fixture({ holdWorker: true }); const pending = f.invoke(); await f.workerReady; await f.cancel();
  assert.equal((await pending).cancelled, true); f.assertReleased();
  const next = f.invoke();
  while (!f.context.activeCaptionTranscribeProcess || f.context.activeCaptionTranscribeProcess === f.extractionProcess) await new Promise(resolve => setImmediate(resolve));
  f.releaseWorker(); assert.equal((await next).ok, true); f.assertReleased();
});

test('Local timeout terminates the primary and avoids a duplicate HTTP recognition', async () => {
  const f = fixture({ holdWorker: true }); const pending = f.invoke(); await f.workerReady;
  const milliseconds = f.fireWatchdog(); const result = await pending; f.assertReleased();
  assert.equal(result.ok, false); assert.equal(result.code, 'CAPTION_PRIMARY_TIMEOUT');
  assert.equal(f.calls.kills.length, 1); assert.equal(f.calls.fallback.length, 0);
  assert.equal(f.calls.progress.some(call => call.value === 100), false);
  const minutes = Number(result.error.match(/after (\d+) minutes/)?.[1]);
  assert.equal(milliseconds, minutes * 60000, 'Timeout message must match the actual configured watchdog.');
});

test('Local timeout ignores late progress while a subsequent job retains its guard and succeeds', async () => {
  const f = fixture({ holdWorker: true, holdKill: true }); const pending = f.invoke(); await f.workerReady;
  const worker = f.workerProcess; f.fireWatchdog();
  assert.equal((await pending).code, 'CAPTION_PRIMARY_TIMEOUT'); f.assertReleased();
  const next = f.invoke();
  while (f.calls.spawn.length < 4) await new Promise(resolve => setImmediate(resolve));
  const nextController = f.context.activeCaptionSongController, nextWorker = f.context.activeCaptionTranscribeProcess;
  assert.ok(nextController); assert.notEqual(nextWorker, worker);
  const before = f.calls.progress.length;
  worker.stdout.write(Buffer.from('PROGRESS:99\n' + JSON.stringify(recognized) + '\n'));
  worker.emit('exit', 0); worker.stdout.end(); worker.stderr.end(); worker.finished = true; worker.emit('close', 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.progress.length, before, 'A terminal timeout cannot publish late process progress or success.');
  assert.equal(f.context.activeCaptionSongController, nextController);
  assert.equal(f.context.activeCaptionTranscribeProcess, nextWorker);
  assert.equal(nextController.signal.aborted, false);
  assert.equal((await f.invoke()).code, 'CAPTION_TRANSCRIPTION_BUSY');
  f.releaseWorker(); assert.equal((await next).ok, true); f.assertReleased();
  assert.equal(f.calls.progress.filter(call => call.value === 100).length, 1);
});

test('Local destroyed renderer cannot fail a successful native transcription', async () => {
  const f = fixture({ rendererGone: true }); assert.equal((await f.invoke()).ok, true); f.assertReleased();
});

for (const overrides of [{ videoPath: undefined }, { videoPath: 'missing.mp4' }, { engine: 'unknown' }]) {
  test(`Local early validation avoids child or HTTP work: ${JSON.stringify(overrides)}`, async () => {
    const f = fixture(); const result = await f.invoke(overrides); f.assertReleased();
    assert.equal(result.ok, false); assert.equal(f.calls.spawn.length, 0); assert.equal(f.calls.fallback.length, 0);
  });
}

for (const options of [{ extractionCode: 1 }, { extractionError: true }]) test(`Local extraction failure never starts recognition: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options); const result = await f.invoke(); f.assertReleased();
  assert.equal(result.ok, false); assert.match(result.error, /FFmpeg/);
  assert.equal(f.calls.spawn.length, 1); assert.equal(f.calls.fallback.length, 0);
  assert.equal(f.calls.progress.some(call => call.value === 100), false);
});

const invalidTimelines = [
  ['words are an object', { ...recognized, words: {} }],
  ['segments are an object', { ...recognized, segments: {} }],
  ['word is null', { ...recognized, words: [null] }],
  ['word lacks text', { ...recognized, words: [{ start: 0.2, end: 1.3 }] }],
  ['word text is whitespace', { ...recognized, words: [{ word: ' ', start: 0.2, end: 1.3 }] }],
  ['word start is null', { ...recognized, words: [{ word: 'Hello world.', start: null, end: 1.3 }] }],
  ['word start is a string', { ...recognized, words: [{ word: 'Hello world.', start: '0.2', end: 1.3 }] }],
  ['word start is boolean', { ...recognized, words: [{ word: 'Hello world.', start: false, end: 1.3 }] }],
  ['word start is negative', { ...recognized, words: [{ word: 'Hello world.', start: -0.1, end: 1.3 }] }],
  ['word collapses', { ...recognized, words: [{ word: 'Hello world.', start: 1.3, end: 1.3 }] }],
  ['word is inverted', { ...recognized, words: [{ word: 'Hello world.', start: 1.3, end: 0.2 }] }],
  ['word end is infinite', { ...recognized, words: [{ word: 'Hello world.', start: 0.2, end: Infinity }] }],
  ['word begins at NaN', { ...recognized, words: [{ word: 'Hello world.', start: NaN, end: 1.3 }] }],
  ['word is outside duration', { ...recognized, words: [{ word: 'Hello world.', start: 0.2, end: 6 }] }],
  ['words overlap', { ...recognized, words: [{ word: 'Hello', start: 0.2, end: 0.8 }, { word: 'world.', start: 0.7, end: 1.3 }] }],
  ['words omit recognized speech', { ...recognized, words: recognized.words.slice(0, 1) }],
  ['segment is null', { ...recognized, segments: [null] }],
  ['segment lacks text', { ...recognized, segments: [{ start: 0.2, end: 1.3 }] }],
  ['segment starts at null', { ...recognized, segments: [{ text: recognized.text, start: null, end: 1.3 }] }],
  ['segment is inverted', { ...recognized, segments: [{ text: recognized.text, start: 1.3, end: 0.2 }] }],
  ['segments overlap', { ...recognized, words: [], segments: [{ text: 'Hello', start: 0.2, end: 0.8 }, { text: 'world.', start: 0.7, end: 1.3 }] }],
  ['segment omits recognized speech', { ...recognized, words: [], segments: [{ text: 'Hello', start: 0.2, end: 0.7 }] }],
  ['text has no timestamps', { text: recognized.text, words: [], segments: [] }],
  ['noSpeech cannot erase text', { text: recognized.text, words: [], segments: [], noSpeech: true }],
  ['noSpeech must be boolean', { text: '', words: [], segments: [], noSpeech: 'true' }],
];
for (const [description, body] of invalidTimelines) {
  test(`Local primary rejects invalid timeline: ${description}`, async () => {
    const f = fixture({ primaryResult: body }); const result = await f.invoke(); f.assertReleased();
    assert.equal(result.ok, false); assert.equal(result.code, 'CAPTION_LOCAL_RESULT_INVALID');
    assert.equal(f.calls.fallback.length, 0); assert.equal(f.calls.progress.some(call => call.value === 100), false);
  });
  test(`Local HTTP backup rejects invalid timeline: ${description}`, async () => {
    const f = fixture({ workerError: true, fallbackResult: body }); const result = await f.invoke(); f.assertReleased();
    assert.equal(result.ok, false); assert.match(result.error, /Backup transcription also failed/);
    assert.equal(f.calls.fallback.length, 1); assert.equal(f.calls.progress.some(call => call.value === 100), false);
  });
}

for (const backup of [false, true]) test(`Local explicitly verified silence is valid via ${backup ? 'backup' : 'primary'}`, async () => {
  const silence = { text: '', words: [], segments: [], duration: 5, noSpeech: true, warnings: ['No speech detected.'] };
  const f = fixture(backup ? { workerError: true, fallbackResult: silence } : { primaryResult: silence });
  const result = await f.invoke(); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.noSpeech, true); assert.equal(result.engine, 'local');
  assert.equal(result.duration, 5); assert.deepEqual(result.words, []); assert.deepEqual(result.segments, []);
  assert.equal(result.timingSource, 'estimated'); assert.equal(f.calls.progress.at(-1).value, 100);
});

test('Local waits for remaining stdout after process exit before completing recognition', async () => {
  const f = fixture({ stdoutAfterExit: true }); const result = await f.invoke(); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.text, recognized.text);
  assert.equal(f.calls.fallback.length, 0, 'Late but valid buffered output must not start duplicate recognition.');
});

test('Local incomplete word list cannot omit segment speech when top-level text is absent', async () => {
  const primaryResult = { language: 'en', segments: recognized.segments, words: recognized.words.slice(0, 1) };
  const f = fixture({ primaryResult }); const result = await f.invoke(); f.assertReleased();
  assert.equal(result.ok, false); assert.equal(result.code, 'CAPTION_LOCAL_RESULT_INVALID');
  assert.equal(f.calls.progress.some(call => call.value === 100), false);
});

for (const duration of [-1, '5', null]) test(`Local rejects invalid supplied duration ${JSON.stringify(duration)}`, async () => {
  const f = fixture({ primaryResult: { text: '', segments: [], words: [], noSpeech: true, duration } });
  const result = await f.invoke(); f.assertReleased();
  assert.equal(result.ok, false); assert.equal(result.code, 'CAPTION_LOCAL_RESULT_INVALID');
  assert.equal(f.calls.progress.some(call => call.value === 100), false);
});

for (const [name, primaryResult] of [
  ['word-only genuine intervals', { ...recognized, segments: [] }],
  ['segment-only explicit estimated mode', { ...recognized, words: [], timingSource: 'estimated' }],
  ['words beginning at zero', { text: 'Hello', duration: 5, language: 'en', segments: [], words: [{ word: 'Hello', start: 0, end: 0.1 }] }],
  ['word ending exactly at video duration', { text: 'Hello', duration: 5, language: 'en', segments: [], words: [{ word: 'Hello', start: 4, end: 5 }] }],
  ['long real silence between words', { text: 'Hello world.', duration: 120, language: 'en', segments: [], words: [{ word: 'Hello', start: 0.2, end: 0.7 }, { word: 'world.', start: 119, end: 120 }] }],
  ['repeated lyrics', { text: 'bells bells', duration: 5, language: 'en', segments: [], words: [{ word: 'bells', start: 0.2, end: 0.7 }, { word: 'bells', start: 2.2, end: 2.7 }] }],
]) {
  for (const backup of [false, true]) test(`Local ${backup ? 'backup' : 'primary'} preserves ${name}`, async () => {
    const f = fixture(backup ? { workerError: true, fallbackResult: primaryResult } : { primaryResult });
    const result = await f.invoke(); f.assertReleased();
    assert.equal(result.ok, true); assert.equal(result.text, primaryResult.text);
    assert.deepEqual(result.words, primaryResult.words); assert.deepEqual(result.segments, primaryResult.segments);
    assert.equal(result.duration, primaryResult.duration); assert.equal(result.engine, 'local');
    assert.equal(result.timingSource, primaryResult.words.length ? 'word' : 'estimated');
  });
}

test('Local invalid result does not retain its cancellation state or process before a successful retry', async () => {
  const options = { primaryResult: {} }; const f = fixture(options);
  assert.equal((await f.invoke()).code, 'CAPTION_LOCAL_RESULT_INVALID'); f.assertReleased();
  options.primaryResult = recognized;
  const result = await f.invoke(); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.text, recognized.text); assert.equal(f.calls.spawn.length, 4);
});

module.exports = { fixture, recognized, plain };

for (const label of [42, true, { fake: 'hello' }, ['hello']]) {
  test(`Local rejects non-string word labels ${JSON.stringify(label)}`, async () => {
    const f = fixture({ primaryResult: { text: '', duration: 5, words: [{ word: label, start: 1, end: 1.5 }], segments: [] } });
    const result = await f.invoke(); f.assertReleased();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CAPTION_LOCAL_RESULT_INVALID');
    assert.equal(f.calls.fallback.length, 0);
    assert.equal(f.calls.progress.some(item => item.value === 100), false);
  });
}
