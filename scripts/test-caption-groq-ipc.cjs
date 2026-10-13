'use strict';

// Run the actual native callbacks and Groq helpers against memory-only audio,
// fake child processes and mocked HTTP. These tests never load models or keys.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
const callbacks = new Map(), helperSources = [];
const helperNames = new Set(['buildWavChunkBuffer', 'throwIfCaptionTranscriptionCancelled', 'waitForGroqCaptionRetry', 'callGroqWhisperForBuffer', 'readGroqCaptionWav', 'assertGroqCaptionWordTimeline', 'groqCaptionTimingWindows', 'verifyGroqCaptionSpeechTimings', 'recoverGroqCaptionGaps', 'verifyGroqCaptionOpeningSegment', 'transcribeCaptionWavWithGroq']);
(function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && helperNames.has(node.id?.name)) helperSources.push(source.slice(node.start, node.end));
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
      && node.callee.object.name === 'ipcMain' && node.callee.property.name === 'handle') {
    const [channel, callback] = node.arguments;
    if (['transcribe-video', 'transcribe-video-groq', 'cancel-transcribe-video'].includes(channel?.value)) callbacks.set(channel.value, source.slice(callback.start, callback.end));
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
})(ast);
assert.equal(helperSources.length, helperNames.size);
assert.equal(callbacks.size, 3);
const plain = value => JSON.parse(JSON.stringify(value));
const recognized = {
  text: 'Jingle bells Jingle bells', language: 'english',
  segments: [{ text: 'Jingle bells', start: 0.2, end: 1.2 }, { text: 'Jingle bells', start: 2.2, end: 3.2 }],
  words: [{ word: 'Jingle', start: 0.2, end: 0.7 }, { word: 'bells', start: 0.7, end: 1.2 }, { word: 'Jingle', start: 2.2, end: 2.7 }, { word: 'bells', start: 2.7, end: 3.2 }],
};

test('timing verification retains Indic vowel marks when checking unchanged words', async () => {
  const original = { language: 'hindi', text: 'कल अब',
    segments: [{ text: 'कल अब', start: 1, end: 2.5 }],
    words: [{ word: 'कल', start: 1, end: 2 }, { word: 'अब', start: 1.5, end: 2.5 }] };
  const changed = { text: 'काल अब',
    words: [{ word: 'काल', start: 1, end: 1.4 }, { word: 'अब', start: 2, end: 2.4 }] };
  const f = fixture({ duration: 10, responses: [original, changed, changed] });
  const result = await f.invoke({ languageHint: 'hi' });
  f.assertReleased();
  assert.equal(result.ok, false);
  assert.match(result.error, /could not verify/);
});

function fixture(options = {}) {
  const root = path.resolve('caption-groq-fixture'), videoPath = path.join(root, 'song.mp4');
  const ffmpegPath = path.join(root, 'ffmpeg.exe');
  const files = new Map([[videoPath, Buffer.from('fixture video')]]);
  const timers = new Set(), calls = { spawn: [], fetch: [], kills: [], progress: [], policy: 0, fallback: 0 };
  let cancel, releaseExtraction, requestStarted;
  const requested = new Promise(resolve => { requestStarted = resolve; });
  const context = vm.createContext({
    Buffer, path, AbortController, AbortSignal, FormData, Blob,
    ROOT: root, process: { env: { GROQ_API_KEY: options.missingKey ? '' : 'fixture-token' } },
    os: { freemem: () => 6 * 1024 ** 3 }, SINGING_ENV: {},
    activeCaptionTranscribeProcess: null, activeCaptionSongController: null, activeCaptionTranscribeCancelRequested: false,
    ensureCaptionWorkDir: (...parts) => path.join(root, 'caption-work', ...parts),
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; },
    clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); },
    fs: {
      existsSync: name => files.has(name) || name === ffmpegPath,
      statSync: name => ({ size: files.get(name).length }),
      readFileSync: name => { assert.ok(files.has(name), 'No real files or credentials may be read'); return files.get(name); },
      unlinkSync: name => files.delete(name),
    },
    require: name => {
      if (name === 'child_process') return { execSync: () => ffmpegPath };
      if (name === './caption-audio-preprocess.cjs') return { prepareCaptionAudio: async () => {
        const audioPath = path.join(root, 'caption-work', 'vocal-focus', 'fixture.wav');
        files.set(audioPath, context.buildWavChunkBuffer(Buffer.alloc(5 * 32000)));
        return { audioPath, cleanupFiles: [audioPath], warnings: ['Fixture vocal focus'] };
      } };
      throw new Error('Unexpected module: ' + name);
    },
    prepareCaptionVoiceMemory: async () => { calls.policy++; throw new Error('Cloud engine must not request local model memory'); },
    postJsonForBufferWithRecovery: async (...args) => {
      calls.fallback++;
      if (!options.localFallback) throw new Error('Explicit Groq must not fall back');
      calls.fallbackArgs = args;
      if (options.cancelDuringFallback) await cancel();
      return { statusCode: 200, buffer: Buffer.from(JSON.stringify(options.localFallback)) };
    },
    fetch: async (url, init) => {
      assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions', 'Cloud captioning must not unload or contact local models');
      calls.fetch.push({ url, init }); requestStarted();
      if (options.pendingRequest || options.pendingRequestAt === calls.fetch.length) return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('Fixture abort'), { name: 'AbortError' })), { once: true });
      });
      if (options.networkFails || options.networkFailsAt === calls.fetch.length) throw new Error('Fixture network failure');
      if (options.status) return { ok: false, status: options.status, headers: { get: () => null }, body: { cancel: async () => {} } };
      const json = options.responses?.[calls.fetch.length - 1] || options.response || recognized;
      return { ok: true, json: async () => { if (options.cancelAtJson) await cancel(); return plain(json); } };
    },
    killProcessTree: proc => {
      calls.kills.push(proc.pid);
      if (!proc.finished) setImmediate(() => { proc.finished = true; proc.emit('exit', 1); });
    },
    spawn: (command, args) => {
      assert.ok(args.includes('-vn') || options.localFallback, 'Explicit Groq must not spawn Python/Whisper');
      const proc = new EventEmitter(); proc.stderr = new EventEmitter(); proc.stdout = new EventEmitter(); proc.pid = 100 + calls.spawn.length; proc.finished = false;
      calls.spawn.push({ command, args: plain(args) });
      if (!args.includes('-vn')) {
        setImmediate(() => { proc.stdout.emit('data', Buffer.from('{"error":"Fixture primary worker failed"}\n')); proc.finished = true; proc.emit('exit', 1); });
        return proc;
      }
      releaseExtraction = () => {
        if (proc.finished) return;
        files.set(args.at(-1), options.wav || context.buildWavChunkBuffer(Buffer.alloc((options.duration || 5) * 32000)));
        proc.finished = true; proc.emit('exit', 0);
      };
      setImmediate(async () => {
        if (options.cancelExtraction) await cancel();
        else if (!options.holdExtraction) releaseExtraction();
      });
      return proc;
    },
  });
  vm.runInContext(helperSources.join('\n'), context);
  cancel = vm.runInContext('(' + callbacks.get('cancel-transcribe-video') + ')', context);
  const native = vm.runInContext('(' + callbacks.get('transcribe-video') + ')', context);
  const legacy = vm.runInContext('(' + callbacks.get('transcribe-video-groq') + ')', context);
  const event = { sender: { send: (channel, value) => calls.progress.push({ channel, value }) } };
  return {
    context, calls, files, root, cancel, requested,
    release: () => releaseExtraction(),
    invoke: (overrides = {}, useLegacy = false) => (useLegacy ? legacy : native)(event, { videoPath, engine: 'groq', contentMode: 'speech', languageHint: 'auto', ...overrides }),
    assertReleased() {
      assert.equal(context.activeCaptionTranscribeProcess, null);
      assert.equal(context.activeCaptionSongController, null);
      assert.equal(context.activeCaptionTranscribeCancelRequested, false);
      assert.equal(timers.size, 0, 'Network timeout/retry timers must be released');
      assert.equal(calls.policy, 0); if (!options.localFallback) assert.equal(calls.fallback, 0);
    },
  };
}

test('explicit native Groq uses large-v3 and genuine word intervals without local model activity', async () => {
  const f = fixture(); const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.engine, 'groq'); assert.equal(result.timingSource, 'word');
  assert.deepEqual(result.words, recognized.words); assert.equal(result.text, recognized.text);
  assert.equal(f.calls.spawn.length, 1); assert.equal(f.calls.fetch.length, 1);
  const form = f.calls.fetch[0].init.body;
  assert.equal(form.get('model'), 'whisper-large-v3');
  assert.equal(form.get('response_format'), 'verbose_json'); assert.equal(form.get('temperature'), '0');
  assert.deepEqual(form.getAll('timestamp_granularities[]'), ['word', 'segment']);
  assert.equal(form.has('prompt'), false);
  assert.deepEqual(result.warnings, []); assert.equal(f.calls.progress.at(-1).value, 100);
});

test('loaded Groq speech capability can be probed without video, audio, key or filesystem access', async () => {
  const f = fixture({ missingKey: true });
  for (const method of ['existsSync', 'statSync', 'readFileSync']) {
    f.context.fs[method] = () => { throw new Error('Capability probe must not inspect files or keys'); };
  }
  const result = plain(await f.invoke({ videoPath: undefined, engine: 'groq', contentMode: 'speech', capabilityProbe: true }));
  assert.deepEqual(result, { ok: true, capabilityProbe: true, groqSpeechTimingRepairVersion: 1 });
  assert.equal(f.calls.spawn.length, 0); assert.equal(f.calls.fetch.length, 0);
  assert.equal(f.calls.progress.length, 0); f.assertReleased();
});

test('read-only timing capability does not reset, cancel or steal an unrelated running caption job', async () => {
  const f = fixture({ holdExtraction: true });
  const pending = f.invoke();
  const controller = f.context.activeCaptionSongController, process = f.context.activeCaptionTranscribeProcess;
  assert.ok(controller); assert.ok(process);
  const probe = plain(await f.invoke({ videoPath: undefined, engine: 'groq', contentMode: 'speech', capabilityProbe: true }));
  assert.equal(probe.groqSpeechTimingRepairVersion, 1);
  assert.equal(f.context.activeCaptionSongController, controller);
  assert.equal(f.context.activeCaptionTranscribeProcess, process);
  assert.equal(controller.signal.aborted, false);
  assert.equal(f.context.activeCaptionTranscribeCancelRequested, false);
  assert.equal(f.calls.spawn.length, 1); assert.equal(f.calls.fetch.length, 0); assert.equal(f.calls.kills.length, 0);
  f.release(); assert.equal((await pending).ok, true); f.assertReleased();
});

test('capability response is restricted to an explicit Groq speech probe', async () => {
  for (const options of [
    { engine: 'local', contentMode: 'speech', capabilityProbe: true },
    { engine: 'groq', contentMode: 'song', capabilityProbe: true },
    { engine: 'groq', contentMode: undefined, capabilityProbe: true },
    { engine: 'groq', contentMode: 'speech', capabilityProbe: 'true' },
  ]) {
    const f = fixture({ missingKey: true });
    const result = plain(await f.invoke({ videoPath: undefined, ...options })); f.assertReleased();
    assert.equal(result.ok, false); assert.equal(result.capabilityProbe, undefined);
    assert.match(result.error, /No video path/);
    assert.equal(f.calls.spawn.length, 0); assert.equal(f.calls.fetch.length, 0);
  }
});

test('Groq song mode retains repeated lyrics and actual word intervals', async () => {
  const f = fixture(); const result = plain(await f.invoke({ contentMode: 'song' })); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.contentMode, 'song'); assert.equal(result.timingSource, 'word');
  assert.equal(result.text, 'Jingle bells Jingle bells'); assert.deepEqual(result.words, recognized.words);
});

test('Groq vocabulary hints contain only explicitly supplied user content and are bounded', async () => {
  const f = fixture(); const hints = 'Jingle, sleigh, Telugu '.repeat(100);
  assert.equal((await f.invoke({ transcriptionHints: '  ' + hints + '  ' })).ok, true); f.assertReleased();
  assert.equal(f.calls.fetch[0].init.body.get('prompt'), hints.trim().slice(0, 1000));
  assert.equal(f.calls.fetch[0].init.body.get('prompt').length, 1000);
});

test('explicit Groq errors and missing keys never fall back to local or HTTP transcription', async () => {
  for (const options of [{ status: 401 }, { networkFails: true }, { missingKey: true }]) {
    const f = fixture(options); const result = plain(await f.invoke()); f.assertReleased();
    assert.equal(result.ok, false); assert.equal(result.engine, 'groq'); assert.match(result.error, /Groq/);
    assert.equal(f.calls.spawn.length, 1); assert.equal(f.calls.fetch.length, options.missingKey ? 0 : 1);
  }
});

test('a transient user-supplied Groq key overrides the configured key without persisting it', async () => {
  for (const useLegacy of [false, true]) {
    const f = fixture({ missingKey: true });
    const result = plain(await f.invoke({ apiKey: '  fixture-manual-token  ' }, useLegacy)); f.assertReleased();
    assert.equal(result.ok, true);
    assert.equal(f.calls.fetch[0].init.headers.Authorization, 'Bearer fixture-manual-token');
    assert.equal(f.context.process.env.GROQ_API_KEY, '');
    assert.equal(JSON.stringify(result).includes('fixture-manual-token'), false);
  }
});

test('segment-only Groq result discloses estimated highlighting', async () => {
  const f = fixture({ response: { ...recognized, words: [] } });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.timingSource, 'estimated'); assert.deepEqual(result.words, []);
  assert.deepEqual(result.segments, recognized.segments); assert.match(result.warnings.join(' '), /estimated/);
});

test('malformed word intervals use the complete segment timeline instead of hiding words', async () => {
  const f = fixture({ response: { ...recognized, words: [{ word: 'Jingle', start: 0.2, end: 0.7 }, { word: 'bells', start: null, end: 1.2 }] } });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.timingSource, 'estimated'); assert.deepEqual(result.words, []);
  assert.equal(result.text, recognized.text); assert.deepEqual(result.segments, recognized.segments);
});

test('WAV metadata chunks are parsed without shifting the audio payload', async () => {
  const f = fixture(); const pcm = Buffer.alloc(5 * 32000, 37);
  const basic = f.context.buildWavChunkBuffer(pcm);
  const metadata = Buffer.from([74, 85, 78, 75, 1, 0, 0, 0, 7, 0]); // odd JUNK chunk + padding
  const wav = Buffer.concat([basic.subarray(0, 12), metadata, basic.subarray(12)]);
  wav.writeUInt32LE(wav.length - 8, 4);
  const result = await f.context.transcribeCaptionWavWithGroq({ audioBuffer: wav, apiKey: 'fixture-token' });
  assert.equal(result.timingSource, 'word');
  const uploaded = Buffer.from(await f.calls.fetch[0].init.body.get('file').arrayBuffer());
  assert.deepEqual(uploaded.subarray(44), pcm); f.assertReleased();
});

test('overlapping Groq chunks shift real timestamps and retain each boundary word once', async () => {
  const responses = [
    { language: 'english', text: 'bells bells', segments: [], words: [{ word: 'bells', start: 538.2, end: 538.8 }, { word: 'bells', start: 539.2, end: 539.8 }] },
    { text: 'bells bells bells', segments: [], words: [{ word: 'bells', start: 0.2, end: 0.8 }, { word: 'bells', start: 1.2, end: 1.8 }, { word: 'bells', start: 3, end: 3.5 }] },
  ];
  const f = fixture({ duration: 542, responses }); const result = plain(await f.invoke({ contentMode: 'song' })); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(f.calls.fetch.length, 2);
  assert.deepEqual(result.words, [{ word: 'bells', start: 538.2, end: 538.8 }, { word: 'bells', start: 539.2, end: 539.8 }, { word: 'bells', start: 541, end: 541.5 }]);
  assert.equal(result.text, 'bells bells bells'); assert.equal(result.timingSource, 'word');
});

test('mixed word and segment chunks retain the entire transcript with honest timing metadata', async () => {
  const f = fixture({ duration: 542, responses: [recognized, { text: 'Ending verse', segments: [{ text: 'Ending verse', start: 2, end: 3 }], words: [] }] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.timingSource, 'estimated'); assert.deepEqual(result.words, []);
  assert.equal(result.text, 'Jingle bells Jingle bells Ending verse'); assert.equal(result.segments.at(-1).start, 540);
});

test('word-only chunks remain represented when another chunk has segment-only timing', async () => {
  const f = fixture({ duration: 542, responses: [{ ...recognized, segments: [] }, { text: 'Ending verse', segments: [{ text: 'Ending verse', start: 2, end: 3 }], words: [] }] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.timingSource, 'estimated'); assert.deepEqual(result.words, []);
  assert.equal(result.text, 'Jingle bells Jingle bells Ending verse');
});

test('real cancellation IPC aborts a Groq request and releases the caption job', async () => {
  const f = fixture({ pendingRequest: true }); const pending = f.invoke(); await f.requested; await f.cancel();
  const result = plain(await pending); f.assertReleased();
  assert.equal(result.ok, false); assert.equal(result.cancelled, true); assert.equal(f.calls.kills.length, 0);
  assert.equal(f.calls.fetch[0].init.signal.aborted, true);
});

test('real cancellation IPC interrupts rate-limit retry without another paid request', async () => {
  const f = fixture({ status: 429 }); const pending = f.invoke(); await f.requested;
  await new Promise(resolve => setImmediate(resolve)); // enter the rate-limit wait
  await f.cancel();
  const result = plain(await pending); f.assertReleased();
  assert.equal(result.cancelled, true); assert.equal(f.calls.fetch.length, 1);
});

test('late cancellation during the final Groq response cannot become successful captions', async () => {
  const f = fixture({ cancelAtJson: true }); const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, false); assert.equal(result.cancelled, true); assert.equal(f.calls.fetch.length, 1);
});

test('cancelling native extraction prevents any Groq request', async () => {
  const f = fixture({ cancelExtraction: true }); const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.cancelled, true); assert.equal(f.calls.fetch.length, 0); assert.equal(f.calls.kills.length, 1);
});

test('native and legacy caption IPC share a guard that cannot reset or steal the running job', async () => {
  const f = fixture({ holdExtraction: true }); const pending = f.invoke();
  const controller = f.context.activeCaptionSongController;
  const nativeBusy = plain(await f.invoke({ engine: 'local' }));
  const legacyBusy = plain(await f.invoke({}, true));
  assert.equal(nativeBusy.code, 'CAPTION_TRANSCRIPTION_BUSY'); assert.equal(legacyBusy.code, 'CAPTION_TRANSCRIPTION_BUSY');
  assert.equal(f.context.activeCaptionSongController, controller); assert.equal(f.calls.spawn.length, 1);
  f.release(); assert.equal((await pending).ok, true); f.assertReleased();
});

test('caption work-directory failure cannot acquire a stale shared transcription guard', async () => {
  for (const useLegacy of [false, true]) {
    const f = fixture(); const original = f.context.ensureCaptionWorkDir;
    f.context.ensureCaptionWorkDir = () => { throw new Error('Fixture directory failure'); };
    await assert.rejects(f.invoke({}, useLegacy), /Fixture directory failure/); f.assertReleased();
    f.context.ensureCaptionWorkDir = original;
    assert.equal((await f.invoke({}, useLegacy)).ok, true); f.assertReleased();
  }
});

test('legacy Indic Groq IPC uses the same model, cancellation and timing metadata', async () => {
  const f = fixture(); const result = plain(await f.invoke({ languageHint: 'hi' }, true)); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.engine, 'groq'); assert.equal(result.language, 'hi');
  assert.deepEqual(result.words, recognized.words); assert.equal(f.calls.fetch[0].init.body.get('language'), 'hi');
});

test('Groq song vocal focus shares extracted audio preparation and keeps its warnings', async () => {
  const f = fixture(); const result = plain(await f.invoke({ contentMode: 'song', audioMode: 'vocal-focus' })); f.assertReleased();
  assert.equal(result.ok, true); assert.deepEqual(result.warnings, ['Fixture vocal focus']);
  assert.equal(f.files.has(path.join(f.root, 'caption-work', 'vocal-focus', 'fixture.wav')), false);
});

test('no usable timestamp response and malformed WAV fail instead of fabricating synchronization', async () => {
  for (const options of [{ response: { text: 'words without intervals' } }, { wav: Buffer.from('invalid WAV') }]) {
    const f = fixture(options); const result = plain(await f.invoke()); f.assertReleased();
    assert.equal(result.ok, false); assert.equal(result.engine, 'groq'); assert.match(result.error, /timestamps|WAV/);
  }
});

test('sparse speech repair uses source PCM offsets and keeps original words while fixing Fox overlap', async () => {
  const original = [
    { word: 'InfoKids', start: 0, end: 6.24 },
    { word: 'Wild', start: 8.82, end: 9.16 }, { word: 'Animals', start: 9.16, end: 9.76 },
    { word: 'Lion', start: 19.22, end: 20.06 }, { word: 'Elephant', start: 21.5, end: 24.12 },
    { word: 'Bear', start: 26.78, end: 27.64 }, { word: 'Giraffe.', start: 34.96, end: 35.5 },
    { word: 'Tiger.', start: 38.6, end: 38.94 }, { word: 'Fox.', start: 38.48, end: 40.46 },
    { word: 'Hippopotamus.', start: 47.04, end: 47.92 }, { word: 'Rhinoceros.', start: 48.7, end: 51.44 },
    { word: 'Wolf.', start: 54.68, end: 55.04 }, { word: 'Zebra', start: 58.76, end: 59.1 },
  ];
  const response = words => ({ words, text: words.map(word => word.word).join(' '), segments: [] });
  const options = { duration: 64, responses: [response(original),
    response([{ word: 'infokids', start: 5, end: 6.12 }]),
    response([{ word: 'Elephant', start: .62, end: 1 }]),
    response([{ word: 'tiger', start: 2.64, end: 3.06 }, { word: 'fox', start: 6.18, end: 7.24 }]),
    response([{ word: 'rhinoceros', start: 1.26, end: 2.08 }]),
  ] };
  const f = fixture(options);
  const pcm = Buffer.alloc(64 * 32000);
  for (let sample = 0; sample < pcm.length / 2; sample++) pcm.writeInt16LE(sample % 32767, sample * 2);
  options.wav = f.context.buildWavChunkBuffer(pcm);
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.timingSource, 'word');
  assert.equal(result.timingVerification, 'short-audio'); assert.equal(result.verifiedTimingWindows, 4);
  assert.equal(f.calls.fetch.length, 5);
  assert.deepEqual(result.words.map(word => word.word), original.map(word => word.word), 'Timing repair must preserve original spelling and punctuation');
  for (const [word, expected] of [['InfoKids', 5], ['Elephant', 22.74], ['Tiger.', 38.64], ['Fox.', 42.18], ['Rhinoceros.', 50.7]]) {
    assert.ok(Math.abs(result.words.find(item => item.word === word).start - expected) < 1e-9, word);
  }
  for (let index = 1; index < result.words.length; index++) assert.ok(result.words[index].start >= result.words[index - 1].end);
  assert.equal(result.segments.map(segment => segment.text).join(' '), result.words.map(word => word.word).join(' '));
  for (const segment of result.segments) {
    const first = result.words.findIndex(word => word.start === segment.start);
    const last = result.words.findIndex(word => word.end === segment.end);
    assert.ok(first >= 0 && last >= first, 'Every phrase uses repaired word bounds');
    assert.equal(segment.text, result.words.slice(first, last + 1).map(word => word.word).join(' '));
  }
  const windows = [[0, 8.24], [22.12, 26.12], [36, 46], [49.44, 53.44]];
  for (let index = 0; index < windows.length; index++) {
    const [start, end] = windows[index];
    const upload = Buffer.from(await f.calls.fetch[index + 1].init.body.get('file').arrayBuffer());
    assert.deepEqual(upload.subarray(44), pcm.subarray(Math.floor(start * 16000) * 2, Math.ceil(end * 16000) * 2));
    assert.equal(f.calls.fetch[index + 1].init.body.has('prompt'), false);
  }
  const progress = f.calls.progress.map(item => item.value);
  assert.ok(progress.slice(0, -1).every(value => value < 100), 'Completion must wait for verification');
  assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]));
  assert.equal(progress.at(-1), 100);
});

test('failed optional checks retain original non-overlapping timing and identify the uncertain word for review', async () => {
  const original = { text: 'Elephant', segments: [], words: [{ word: 'Elephant', start: 2, end: 4 }] };
  for (const fresh of [
    { text: 'Zebra', words: [{ word: 'Zebra', start: .7, end: 1.1 }] },
    { text: '', words: [] },
    { text: 'Elephant', words: [{ word: 'Elephant', start: 0, end: 2 }] },
    { text: 'Elephant', words: [{ word: 'Elephant', start: 1, end: .8 }] },
    { text: 'Elephant Bear', words: [{ word: 'Elephant', start: .7, end: 1.1 }] },
  ]) {
    const f = fixture({ duration: 10, responses: [original, fresh, fresh] });
    const result = plain(await f.invoke()); f.assertReleased();
    assert.equal(result.ok, true); assert.equal(result.engine, 'groq');
    assert.equal(f.calls.fetch.length, 3); assert.deepEqual(result.words, original.words);
    assert.equal(result.timingVerification, undefined);
    assert.match(result.warnings.join(' '), /optional.*retained.*Elephant \(2\.00–4\.00s\)/);
    assert.equal(f.calls.progress.at(-1).value, 100);
  }
});

test('a repeated conflicting short-window timeline fails instead of sorting or using old segments', async () => {
  const bad = { text: 'Tiger Fox', segments: [{ text: 'Tiger Fox', start: 2, end: 5 }],
    words: [{ word: 'Tiger', start: 3, end: 4 }, { word: 'Fox', start: 2.8, end: 4.5 }] };
  const f = fixture({ duration: 15, responses: [bad, bad, bad] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, false); assert.match(result.error, /verify/); assert.equal(f.calls.fetch.length, 3);
});

test('short-window verification recovers on its single retry using verified source timing', async () => {
  const original = { text: 'Elephant', segments: [], words: [{ word: 'Elephant', start: 2, end: 4 }] };
  const wrong = { text: 'Zebra', words: [{ word: 'Zebra', start: .7, end: 1.1 }] };
  const verified = { text: 'Elephant', words: [{ word: 'Elephant', start: .7, end: 1.1 }] };
  const f = fixture({ duration: 10, responses: [original, wrong, verified] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true);
  assert.equal(f.calls.fetch.length, 3);
  assert.equal(result.words[0].word, 'Elephant');
  assert.ok(Math.abs(result.words[0].start - 2.7) < .001);
  assert.ok(Math.abs(result.words[0].end - 3.1) < .001);
});

test('a conflict needing over twenty seconds is verified with bounded broader audio', async () => {
  const original = { text: 'Tiger Fox', segments: [], words: [
    { word: 'Tiger', start: 2, end: 24 }, { word: 'Fox', start: 23, end: 25 },
  ] };
  const verified = { text: 'Tiger Fox', words: [
    { word: 'Tiger', start: 20, end: 21 }, { word: 'Fox', start: 23, end: 24 },
  ] };
  const f = fixture({ duration: 40, responses: [original, verified] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true);
  assert.equal(f.calls.fetch.length, 2);
  assert.equal(result.words[0].start, 20);
  assert.equal(result.words[1].start, 23);
});

test('verification still rejects context exceeding the sixty-second bound', async () => {
  const original = { text: 'Tiger Fox', segments: [], words: [
    { word: 'Tiger', start: 2, end: 65 }, { word: 'Fox', start: 64, end: 66 },
  ] };
  const f = fixture({ duration: 90, responses: [original] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, false);
  assert.match(result.error, /short audio window/);
  assert.equal(f.calls.fetch.length, 1);
});

test('verification accepts identical text split into different ASR tokens', async () => {
  const original = { text: 'InfoKids', segments: [], words: [{ word: 'InfoKids', start: 2, end: 4 }] };
  const verified = { text: 'Info Kids', words: [
    { word: 'Info', start: .7, end: 1 }, { word: 'Kids', start: 1, end: 1.4 },
  ] };
  const f = fixture({ duration: 10, responses: [original, verified] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true);
  assert.equal(result.words[0].word, 'InfoKids');
  assert.ok(Math.abs(result.words[0].start - 2.7) < .001);
  assert.ok(Math.abs(result.words[0].end - 3.4) < .001);
});

test('verification resolves small forward boundary overlaps without reordering words', async () => {
  const original = { text: 'Tiger Fox', segments: [], words: [
    { word: 'Tiger', start: 2, end: 3 }, { word: 'Fox', start: 2.9, end: 4 },
  ] };
  const verified = { text: 'Tiger Fox', words: [
    { word: 'Tiger', start: .5, end: 1.2 }, { word: 'Fox', start: 1.06, end: 1.5 },
  ] };
  const f = fixture({ duration: 10, responses: [original, verified] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true);
  assert.ok(Math.abs(result.words[0].end - 1.13) < .001);
  assert.equal(result.words[0].end, result.words[1].start);
  assert.equal(result.segments.length, 1, 'Verified Groq words remain grouped like Local captions');
  assert.equal(result.segments[0].text, 'Tiger Fox');
  assert.equal(result.segments[0].start, result.words[0].start);
  assert.equal(result.segments[0].end, result.words[1].end);
  assert.match(result.warnings.join(' '), /midpoint/);
});

test('verification clamps only small final-word overruns to the physical clip end', async () => {
  const original = { text: 'Elephant', segments: [], words: [{ word: 'Elephant', start: 2, end: 4 }] };
  const verified = { text: 'Elephant', words: [{ word: 'Elephant', start: 3.6, end: 4.32 }] };
  const f = fixture({ duration: 10, responses: [original, verified] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true);
  assert.equal(result.words[0].end, 6);
});

test('automatic gap recovery inserts confirmed missing speech while retaining existing word timings', async () => {
  const original = { text: 'Hello world', segments: [], words: [
    { word: 'Hello', start: 1, end: 1.3 }, { word: 'world', start: 4, end: 4.3 },
  ] };
  const recovered = { text: 'Example', words: [{ word: 'Example', start: 1, end: 1.4 }] };
  const f = fixture({ duration: 5, responses: [original, recovered, recovered] });
  const result = plain(await f.invoke({ autoRecoverMissingSpeech: true })); f.assertReleased();
  assert.equal(result.ok, true);
  assert.equal(result.text, 'Hello Example world');
  assert.equal(result.words[0].start, 1);
  assert.equal(result.words[2].start, 4);
  assert.match(result.warnings.join(' '), /recovery added 1/);
  assert.equal(f.calls.fetch.length, 3);
});

test('two matching audio passes can correct a spelling with stable surrounding words', async () => {
  const original = { text: 'She Riya reads', segments: [], words: [
    { word: 'She', start: 1, end: 1.4 }, { word: 'Riya', start: 1.3, end: 1.8 },
    { word: 'reads', start: 2, end: 2.3 },
  ] };
  const corrected = { text: 'She Ria reads', words: [
    { word: 'She', start: 1, end: 1.3 }, { word: 'Ria', start: 1.3, end: 1.7 },
    { word: 'reads', start: 2, end: 2.3 },
  ] };
  const f = fixture({ duration: 5, responses: [original, corrected, corrected] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true);
  assert.equal(result.text, 'She Ria reads');
  assert.equal(f.calls.fetch.length, 3);
  assert.match(result.warnings.join(' '), /Riya → Ria.*Review/);
  assert.deepEqual(result.segments.map(segment => segment.text), ['She Ria', 'reads']);
});

test('changed text with disagreeing audio timings remains rejected', async () => {
  const original = { text: 'She Riya reads', segments: [], words: [
    { word: 'She', start: 1, end: 1.4 }, { word: 'Riya', start: 1.3, end: 1.8 },
    { word: 'reads', start: 2, end: 2.3 },
  ] };
  const first = { text: 'She Ria reads', words: [
    { word: 'She', start: 1, end: 1.3 }, { word: 'Ria', start: 1.3, end: 1.7 },
    { word: 'reads', start: 2, end: 2.3 },
  ] };
  const second = { ...first, words: first.words.map(word => ({ ...word, start: word.start + .4, end: word.end + .4 })) };
  const f = fixture({ duration: 5, responses: [original, first, second] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, false);
  assert.match(result.error, /could not verify/);
});

test('a small audio-end overrun keeps valid word timing instead of continuous segment fallback', async () => {
  const original = { text: 'Hello world', segments: [{ text: 'Hello world', start: 0, end: 5 }],
    words: [{ word: 'Hello', start: 1, end: 1.3 }, { word: 'world', start: 4.8, end: 5.14 }] };
  const f = fixture({ duration: 5, response: original });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true);
  assert.equal(result.timingSource, 'word');
  assert.equal(result.words[1].end, 5);
  assert.equal(result.words[0].end, 1.3);
});

test('automatic recovery refuses inconsistent short recognition instead of inventing a word', async () => {
  const original = { text: 'Hello world', segments: [], words: [
    { word: 'Hello', start: 1, end: 1.3 }, { word: 'world', start: 4, end: 4.3 },
  ] };
  const f = fixture({ duration: 5, responses: [original,
    { words: [{ word: 'Example', start: 1, end: 1.4 }] },
    { words: [{ word: 'Sentence', start: 1, end: 1.4 }] }] });
  const result = plain(await f.invoke({ autoRecoverMissingSpeech: true })); f.assertReleased();
  assert.equal(result.ok, true);
  assert.equal(result.text, 'Hello world');
});

test('recovery request failure retains the original captions and reports unchecked gaps', async () => {
  const original = { text: 'Hello world', segments: [], words: [
    { word: 'Hello', start: 1, end: 1.3 }, { word: 'world', start: 4, end: 4.3 },
  ] };
  const f = fixture({ duration: 5, response: original, networkFailsAt: 2 });
  const result = plain(await f.invoke({ autoRecoverMissingSpeech: true })); f.assertReleased();
  assert.equal(result.ok, true);
  assert.deepEqual(result.words, original.words);
  assert.match(result.warnings.join(' '), /retained.*unchecked/);
});

test('recovery discloses its window limit without adding silent audio as words', async () => {
  const original = { text: 'Hello', segments: [], words: [{ word: 'Hello', start: 0, end: .3 }] };
  const f = fixture({ duration: 100, responses: [original], response: { words: [], segments: [], text: '' } });
  const result = plain(await f.invoke({ autoRecoverMissingSpeech: true })); f.assertReleased();
  assert.equal(result.ok, true);
  assert.deepEqual(result.words, original.words);
  assert.equal(f.calls.fetch.length, 9);
  assert.match(result.warnings.join(' '), /8 of 10/);
});

test('song timestamps never trigger speech verification and conflicting song words fail directly', async () => {
  for (const words of [
    [{ word: 'bells', start: .2, end: 4 }],
    [{ word: 'Tiger', start: 3, end: 4 }, { word: 'Fox', start: 2.8, end: 4.5 }],
  ]) {
    const f = fixture({ response: { words, text: words.map(word => word.word).join(' '), segments: [] } });
    const result = plain(await f.invoke({ contentMode: 'song' })); f.assertReleased();
    assert.equal(f.calls.fetch.length, 1);
    if (words.length === 1) { assert.equal(result.ok, true); assert.deepEqual(result.words, words); }
    else {
      assert.equal(result.ok, false); assert.match(result.error, /conflicting/);
      assert.ok(f.calls.progress.every(item => item.value < 100));
    }
  }
});

test('continuous speech and ordinary narrow words keep their original timestamps without verification', async () => {
  const words = [{ word: 'Long', start: .2, end: 2.5 }, { word: 'sentence', start: 2.5, end: 3.1 }];
  const f = fixture({ response: { text: 'Long sentence', segments: [], words } });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(f.calls.fetch.length, 1); assert.deepEqual(result.words, words);
  assert.equal(result.timingVerification, undefined);
});

test('automatic verification request count is bounded before paying for any repair calls', async () => {
  const words = Array.from({ length: 9 }, (_, index) => ({ word: 'label' + index, start: index * 6, end: index * 6 + 2 }));
  const f = fixture({ duration: 60, response: { text: words.map(word => word.word).join(' '), words, segments: [] } });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, false); assert.match(result.error, /too many uncertain/); assert.equal(f.calls.fetch.length, 1);
});

test('cancelling short-window verification aborts its request and releases the shared job', async () => {
  const response = { text: 'Elephant', words: [{ word: 'Elephant', start: 2, end: 4 }], segments: [] };
  const f = fixture({ duration: 10, response, pendingRequestAt: 2 });
  const pending = f.invoke(); await f.requested; await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.fetch.length, 2);
  const busy = plain(await f.invoke()); assert.equal(busy.code, 'CAPTION_TRANSCRIPTION_BUSY');
  await f.cancel(); const result = plain(await pending); f.assertReleased();
  assert.equal(result.cancelled, true); assert.equal(f.calls.fetch[1].init.signal.aborted, true);
  assert.equal(f.calls.fetch.length, 2); assert.ok(f.calls.progress.every(item => item.value < 100));
});

test('word-only Groq replies keep phrases grouped and retain natural speech gaps', async () => {
  const words = [{ word: 'I', start: 1, end: 1.2 }, { word: 'can', start: 1.2, end: 1.5 },
    { word: 'read.', start: 1.5, end: 1.9 }, { word: 'Next', start: 2.7, end: 3 }];
  const f = fixture({ response: { text: 'I can read. Next', words } });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.deepEqual(result.words, words);
  assert.deepEqual(result.segments, [{ text: 'I can read.', start: 1, end: 1.9 }, { text: 'Next', start: 2.7, end: 3 }]);
});

test('a partial word list cannot silently remove speech represented by complete source segments', async () => {
  const f = fixture({ response: { ...recognized, words: recognized.words.slice(0, 1) } });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.text, recognized.text);
  assert.equal(result.timingSource, 'estimated'); assert.deepEqual(result.words, []);
  assert.deepEqual(result.segments, recognized.segments); assert.match(result.warnings.join(' '), /estimated/);
});

test('missing both word and segment coverage rejects incomplete captions rather than dropping recognized speech', async () => {
  const f = fixture({ response: { ...recognized, segments: recognized.segments.slice(0, 1), words: recognized.words.slice(0, 1) } });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, false); assert.match(result.error, /complete caption timestamps/);
  assert.equal(result.words, undefined); assert.equal(f.calls.fetch.length, 1);
});

test('an invalid fallback segment cannot silently remove part of recognized speech', async () => {
  const f = fixture({ response: { ...recognized, words: [], segments: [recognized.segments[0], { ...recognized.segments[1], start: null }] } });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, false); assert.match(result.error, /incomplete caption segment timestamps/);
});

test('segment transcript coverage is checked even when the API omits its top-level text', async () => {
  const f = fixture({ response: { segments: recognized.segments, words: recognized.words.slice(0, 1) } });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.text, recognized.text);
  assert.deepEqual(result.words, []); assert.equal(result.timingSource, 'estimated');
});

test('unusable fallback segment overlaps fail instead of covering pauses with conflicting groups', async () => {
  const f = fixture({ response: { text: 'Hello world', words: [], segments: [
    { text: 'Hello', start: .2, end: 2.5 }, { text: 'world', start: 1.5, end: 3 },
  ] } });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, false); assert.match(result.error, /overlapping caption segment timestamps/);
});

test('broad zero-start segment timing is replaced only after two agreeing opening audio passes', async () => {
  const original = { text: 'InfoKids', segments: [{ text: 'InfoKids', start: 0, end: 6.2 }], words: [] };
  const verified = { text: 'InfoKids', words: [{ word: 'InfoKids', start: 4.8, end: 6.05 }] };
  const f = fixture({ duration: 8, responses: [original, verified, verified] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.timingSource, 'word');
  assert.deepEqual(result.words, verified.words);
  assert.deepEqual(result.segments, [{ text: 'InfoKids', start: 4.8, end: 6.05 }]);
  assert.equal(f.calls.fetch.length, 3); assert.match(result.warnings.join(' '), /Two short audio passes verified the opening/);
});

test('a broad opening word is checked even when its next word has no pause', async () => {
  const original = { text: 'InfoKids ten', words: [{ word: 'InfoKids', start: 0, end: 6 }, { word: 'ten', start: 6, end: 6.5 }] };
  const verified = { text: 'InfoKids ten', words: [{ word: 'InfoKids', start: 4.7, end: 5.8 }, { word: 'ten', start: 6, end: 6.5 }] };
  const f = fixture({ duration: 10, responses: [original, verified] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.words[0].start, 4.7);
  assert.equal(result.timingVerification, 'short-audio'); assert.equal(f.calls.fetch.length, 2);
});

test('opening verification includes genuine early speech instead of imposing an intro delay', async () => {
  const original = { text: 'Hello', words: [{ word: 'Hello', start: 0, end: 5 }] };
  const verified = { text: 'Hello', words: [{ word: 'Hello', start: .2, end: .8 }] };
  const f = fixture({ duration: 8, responses: [original, verified] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.words[0].start, .2);
  const upload = Buffer.from(await f.calls.fetch[1].init.body.get('file').arrayBuffer());
  assert.equal(upload.length - 44, 7 * 32000, 'Opening check retains the complete audio prefix');
});

test('two unchanged broad opening rechecks permit two focused tail passes without changing caption words', async () => {
  const original = { text: 'InfoKids Time to listen.', words: [
    { word: 'InfoKids', start: 0, end: 6.26 }, { word: 'Time', start: 8.86, end: 9.16 },
    { word: 'to', start: 9.16, end: 9.42 }, { word: 'listen.', start: 9.42, end: 10.48 },
  ] };
  const broad = { text: 'InfoKids', words: [{ word: 'InfoKids', start: .02, end: 6.18 }] };
  const first = { text: 'Info Kids', words: [
    { word: 'Info', start: .54, end: 1.04 }, { word: 'Kids', start: 1.04, end: 1.92 },
  ] };
  const second = { text: 'InfoKids', words: [{ word: 'InfoKids', start: .80, end: 2.18 }] };
  const f = fixture({ duration: 61, responses: [original, broad, broad, first, second] });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.equal(result.timingVerification, 'short-audio');
  assert.equal(f.calls.fetch.length, 5);
  assert.equal(result.words[0].word, 'InfoKids');
  assert.ok(Math.abs(result.words[0].start - 4.81) < .001);
  assert.ok(Math.abs(result.words[0].end - 6.19) < .001);
  assert.deepEqual(result.words.slice(1), original.words.slice(1));
  assert.deepEqual(result.segments.map(segment => segment.text), ['InfoKids', 'Time to listen.']);
  for (const [index, seconds] of [[1, 8.26], [2, 8.26], [3, 4], [4, 4.25]]) {
    const upload = Buffer.from(await f.calls.fetch[index].init.body.get('file').arrayBuffer());
    assert.equal(upload.length - 44, Math.round(seconds * 32000), 'Only the bounded opening audio is uploaded');
  }
});

test('focused opening fallback requires agreeing complete-prefix recognition before any additional request', async () => {
  const original = { text: 'InfoKids', words: [{ word: 'InfoKids', start: 0, end: 6.26 }] };
  const broad = { text: 'InfoKids', words: [{ word: 'InfoKids', start: .02, end: 6.18 }] };
  for (const second of [
    { text: 'Kids', words: [{ word: 'Kids', start: .02, end: 6.18 }] },
    { text: 'InfoKids', words: [{ word: 'InfoKids', start: .02, end: 5.8 }] },
    { text: 'InfoKids extra', words: broad.words },
  ]) {
    const f = fixture({ duration: 10, responses: [original, broad, second] });
    const result = plain(await f.invoke()); f.assertReleased();
    assert.equal(result.ok, false); assert.equal(f.calls.fetch.length, 3);
    assert.equal(result.words, undefined);
  }
});

test('focused opening passes cannot delete words, accept crop-edge timing or invent a delayed caption', async () => {
  const original = { text: 'InfoKids', words: [{ word: 'InfoKids', start: 0, end: 6.26 }] };
  const broad = { text: 'InfoKids', words: [{ word: 'InfoKids', start: .02, end: 6.18 }] };
  const good = { text: 'InfoKids', words: [{ word: 'InfoKids', start: .54, end: 1.92 }] };
  for (const [first, second, expectedRequests] of [
    [{ text: 'Kids', words: [{ word: 'Kids', start: .54, end: 1.92 }] }, good, 4],
    [{ text: 'InfoKids extra', words: good.words }, good, 4],
    [{ text: 'InfoKids', words: [{ word: 'InfoKids', start: 0, end: 1.4 }] }, good, 4],
    [good, { text: 'InfoKids', words: [{ word: 'InfoKids', start: 1.3, end: 2.7 }] }, 5],
    [good, { text: 'InfoKids', words: [{ word: 'InfoKids', start: .8, end: .8 }] }, 5],
  ]) {
    const f = fixture({ duration: 10, responses: [original, broad, broad, first, second] });
    const result = plain(await f.invoke()); f.assertReleased();
    assert.equal(result.ok, false); assert.equal(f.calls.fetch.length, expectedRequests);
    assert.equal(result.words, undefined);
    assert.equal(f.calls.progress.some(item => item.value === 100), false);
  }
});

test('cancelling a focused opening check stops the additional request and preserves the shared job guard', async () => {
  const original = { text: 'InfoKids', words: [{ word: 'InfoKids', start: 0, end: 6.26 }] };
  const broad = { text: 'InfoKids', words: [{ word: 'InfoKids', start: .02, end: 6.18 }] };
  const f = fixture({ duration: 10, responses: [original, broad, broad], pendingRequestAt: 4 });
  const pending = f.invoke(); await f.requested;
  for (let attempt = 0; attempt < 5 && f.calls.fetch.length < 4; attempt += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.fetch.length, 4);
  const busy = plain(await f.invoke()); assert.equal(busy.code, 'CAPTION_TRANSCRIPTION_BUSY');
  await f.cancel(); const result = plain(await pending); f.assertReleased();
  assert.equal(result.cancelled, true); assert.equal(f.calls.fetch[3].init.signal.aborted, true);
  assert.equal(f.calls.fetch.length, 4);
});

test('focused opening retries retain the existing sixteen-request timing verification budget', async () => {
  const words = [{ word: 'InfoKids', start: 0, end: 6.26 },
    ...Array.from({ length: 7 }, (_, index) => ({ word: 'label' + index, start: 12 + index * 6, end: 14 + index * 6 }))];
  const original = { text: words.map(word => word.word).join(' '), words };
  const broad = { text: 'InfoKids', words: [{ word: 'InfoKids', start: .02, end: 6.18 }] };
  const responses = [original, broad, broad,
    { text: 'InfoKids', words: [{ word: 'InfoKids', start: .54, end: 1.92 }] },
    { text: 'InfoKids', words: [{ word: 'InfoKids', start: .79, end: 2.17 }] }];
  for (let index = 0; index < 7; index += 1) responses.push(
    { text: 'wrong', words: [{ word: 'wrong', start: .7, end: 1.1 }] },
    { text: 'label' + index, words: [{ word: 'label' + index, start: .7, end: 1.1 }] });
  const f = fixture({ duration: 60, responses });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, false); assert.match(result.error, /request limit/);
  assert.equal(f.calls.fetch.length, 17, 'One initial recognition plus at most sixteen verification requests');
});

test('an unverified broad zero-start segment cannot return continuous opening captions', async () => {
  const original = { text: 'InfoKids', segments: [{ text: 'InfoKids', start: 0, end: 6.2 }], words: [] };
  const f = fixture({ duration: 8, response: original });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, false); assert.match(result.error, /opening.*timing/);
  assert.equal(result.words, undefined); assert.equal(f.calls.progress.some(item => item.value === 100), false);
});

test('an optional audio request failure keeps usable original captions with a review warning', async () => {
  const original = { text: 'Elephant', words: [{ word: 'Elephant', start: 2, end: 4 }] };
  const f = fixture({ duration: 10, response: original, networkFailsAt: 2 });
  const result = plain(await f.invoke()); f.assertReleased();
  assert.equal(result.ok, true); assert.deepEqual(result.words, original.words);
  assert.equal(result.timingVerification, undefined); assert.match(result.warnings.join(' '), /optional.*Elephant \(2\.00–4\.00s\).*connect/);
});

test('Local fallback preserves requested recognition options, warnings and timing metadata', async () => {
  const fallback = { ...recognized, duration: 5, timingSource: 'word', warnings: ['Review the opening words.'] };
  const f = fixture({ localFallback: fallback });
  const result = plain(await f.invoke({ engine: 'local', languageHint: 'hi', transcriptionHints: 'Ria', autoRecoverMissingSpeech: false }));
  f.assertReleased();
  const [, , payload, , , signal] = f.calls.fallbackArgs;
  assert.equal(payload.language, 'hi'); assert.equal(payload.transcriptionHints, 'Ria');
  assert.equal(payload.autoRecoverMissingSpeech, false); assert.equal(payload.contentMode, 'speech');
  assert.equal(payload.sourceName, 'song.mp4'); assert.equal(signal.aborted, false);
  assert.equal(result.ok, true); assert.equal(result.engine, 'local'); assert.equal(result.duration, 5);
  assert.equal(result.timingSource, 'word'); assert.deepEqual(result.words, recognized.words);
  assert.match(result.warnings.join(' '), /Review the opening words.*backup transcription worker/);
  assert.equal(f.calls.progress.at(-1).value, 100);
});

test('Local fallback cancellation cannot publish a late successful response', async () => {
  const f = fixture({ localFallback: recognized, cancelDuringFallback: true });
  const result = plain(await f.invoke({ engine: 'local' })); f.assertReleased();
  assert.equal(result.ok, false); assert.equal(result.cancelled, true);
  assert.equal(f.calls.fallbackArgs[5].aborted, true); assert.equal(f.calls.kills.length, 0, 'Completed primary process must not be killed while HTTP is running');
  assert.equal(f.calls.progress.some(item => item.value === 100), false);
});

test('Local fallback error or empty payload cannot be reported as successful captions', async () => {
  for (const fallback of [{ error: 'Fixture backup rejected input' }, { text: '', segments: [], words: [] }]) {
    const f = fixture({ localFallback: fallback });
    const result = plain(await f.invoke({ engine: 'local' })); f.assertReleased();
    assert.equal(result.ok, false); assert.match(result.error, /Backup transcription also failed/);
    assert.equal(f.calls.progress.some(item => item.value === 100), false);
  }
});
