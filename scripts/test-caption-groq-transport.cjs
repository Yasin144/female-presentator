'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { fixture, plain } = require('./test-caption-groq-ipc.cjs');

const retryDelays = calls => calls.delays.filter(milliseconds => milliseconds !== 180000);
const models = calls => calls.fetch.map(request => request.init.body.get('model'));
const LARGE = 'whisper-large-v3', TURBO = 'whisper-large-v3-turbo';
const transcript = words => ({ text: words.map(word => word.word).join(' '), words, segments: [] });

for (const limitedAttempts of [1, 2]) {
  test(`Groq transport recovers after ${limitedAttempts} rate-limited request${limitedAttempts === 1 ? '' : 's'}`, async () => {
    const f = fixture({
      statuses: [...Array(limitedAttempts).fill(429), 200],
      retryAfters: Array(limitedAttempts).fill('0.001'), fastRetryTimers: true,
    });
    const result = plain(await f.invoke());
    f.assertReleased();
    assert.equal(result.ok, true);
    assert.equal(result.timingSource, 'word');
    assert.equal(f.calls.fetch.length, limitedAttempts + 1);
    assert.deepEqual(retryDelays(f.calls), Array(limitedAttempts).fill(1));
    assert.equal(f.calls.progress.at(-1).value, 100);
  });
}

test('Groq transport stops after three rate-limited requests and releases every timer', async () => {
  const f = fixture({ statuses: [429, 429, 429, 200], retryAfters: ['0.001', '0.001', '0.001'], fastRetryTimers: true });
  const result = plain(await f.invoke());
  f.assertReleased();
  assert.equal(result.ok, false);
  assert.match(result.error, /quota|limited/i);
  assert.equal(result.code, 'CAPTION_GROQ_RATE_LIMIT');
  assert.equal(result.providerHttpStatus, 429);
  assert.equal(result.retryAfterMs, 1);
  assert.equal(result.retryAfterEstimated, false);
  assert.ok(Number.isSafeInteger(result.retryAt));
  assert.equal(f.calls.fetch.length, 3);
  assert.deepEqual(retryDelays(f.calls), [1, 1]);
  assert.equal(f.calls.progress.some(item => item.value === 100), false);
});

for (const [label, retryAfter, expected] of [
  ['missing', null, 32000],
  ['empty', '', 32000],
  ['zero', '0', 32000],
  ['negative', '-10', 32000],
  ['invalid', 'tomorrow', 32000],
  ['nonfinite', 'Infinity', 32000],
  ['not-a-number', 'NaN', 32000],
  ['sub-millisecond', '0.0001', 1],
  ['fractional milliseconds', '0.0011', 2],
  ['fractional seconds', '1.0001', 1001],
  ['one second', '1', 1000],
  ['exact maximum', '60', 60000],
  ['huge finite seconds', '1e308', 32000],
]) {
  test(`Groq rate-limit Retry-After handles ${label}`, async () => {
    const f = fixture({ statuses: [429, 200], retryAfters: [retryAfter], fastRetryTimers: true });
    const result = plain(await f.invoke());
    f.assertReleased();
    assert.equal(result.ok, true);
    assert.equal(f.calls.fetch.length, 2);
    assert.deepEqual(retryDelays(f.calls), [expected]);
    assert.match(f.calls.warnings[0][0], new RegExp(`retrying in ${Math.ceil(expected / 1000)} seconds`));
  });
}

for (const [label, retryAfter, delay] of [
  ['ninety seconds', '90', 90000],
  ['one hour', '3600', 3600000],
  ['future HTTP-date', 'Wed, 14 Oct 2026 08:01:30 GMT', 90000],
]) {
  test(`Groq ${label} cooldown pauses without a premature retry`, async () => {
    const now = Date.parse('2026-10-14T08:00:00Z');
    const f = fixture({ now, statuses: [429, 200], retryAfters: [retryAfter], fastRetryTimers: true });
    const result = plain(await f.invoke());
    f.assertReleased();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CAPTION_GROQ_RATE_LIMIT');
    assert.equal(result.providerHttpStatus, 429);
    assert.equal(result.retryAfterMs, delay);
    assert.equal(result.retryAt, now + delay);
    assert.equal(result.retryAfterEstimated, false);
    assert.equal(f.calls.fetch.length, 1);
    assert.deepEqual(retryDelays(f.calls), []);
    assert.equal(f.calls.progress.some(item => item.value === 100), false);
  });
}

for (const [label, retryAfter, expected, estimated] of [
  ['future HTTP-date', 'Wed, 14 Oct 2026 08:00:09 GMT', 9000, false],
  ['past HTTP-date', 'Wed, 14 Oct 2026 07:59:59 GMT', 32000, true],
  ['absent header', null, 32000, true],
  ['malformed header', 'fixture-token fixture-private-org', 32000, true],
]) {
  test(`Groq exhausted ${label} exposes safe cooldown metadata`, async () => {
    const now = Date.parse('2026-10-14T08:00:00Z');
    const f = fixture({ now, statuses: [429, 429, 429, 200], retryAfters: Array(3).fill(retryAfter), fastRetryTimers: true });
    const result = plain(await f.invoke());
    f.assertReleased();
    assert.equal(result.code, 'CAPTION_GROQ_RATE_LIMIT');
    assert.equal(result.retryAfterMs, expected);
    assert.equal(result.retryAt, now + expected);
    assert.equal(result.retryAfterEstimated, estimated);
    assert.equal(f.calls.fetch.length, 3);
    assert.deepEqual(retryDelays(f.calls), [expected, expected]);
    if (estimated) assert.match(result.error, /estimated cooldown/);
    assert.equal(f.calls.bodyReads, 0);
    assert.equal(f.calls.discardedBodies, 3);
    assert.equal(/fixture-token|fixture-private-org|fixture-private-audio/.test(JSON.stringify({ result, warnings: f.calls.warnings })), false);
  });
}

for (const attempt of [1, 3]) {
  test(`Groq malformed JSON on request ${attempt} fails without late progress or another request`, async () => {
    const f = fixture({
      statuses: [...Array(attempt - 1).fill(429), 200],
      retryAfters: Array(attempt - 1).fill('0.001'), fastRetryTimers: true, jsonFailsAt: attempt,
    });
    const result = plain(await f.invoke());
    f.assertReleased();
    assert.equal(result.ok, false);
    assert.match(result.error, /Could not connect/);
    assert.equal(f.calls.fetch.length, attempt);
    assert.equal(f.calls.progress.some(item => item.value === 100), false);
    assert.equal(result.error.includes('Fixture invalid JSON'), false);
    assert.equal(result.error.includes('fixture-token'), false);
  });
}

test('Groq cancellation on the final allowed retry discards a late successful response', async () => {
  const f = fixture({
    statuses: [429, 429, 200], retryAfters: ['0.001', '0.001'],
    fastRetryTimers: true, cancelAtJsonRequest: 3,
  });
  const result = plain(await f.invoke());
  f.assertReleased();
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal(f.calls.fetch.length, 3);
  assert.deepEqual(retryDelays(f.calls), [1, 1]);
  assert.equal(f.calls.progress.some(item => item.value === 100), false);
  assert.equal(f.calls.fetch.at(-1).init.signal.aborted, true, 'Cancellation reaches the final in-flight request');
});

test('Groq initial recognition uses large-v3 and overlapping timing retries use turbo', async () => {
  const original = transcript([{ word: 'Tiger', start: 2, end: 3 }, { word: 'Fox', start: 2.5, end: 4 }]);
  const verified = transcript([{ word: 'Tiger', start: 2, end: 2.8 }, { word: 'Fox', start: 3, end: 4 }]);
  const f = fixture({ duration: 10, responses: [original, original, original, verified] });
  const result = plain(await f.invoke());
  f.assertReleased();
  assert.equal(result.ok, true);
  assert.deepEqual(models(f.calls), [LARGE, LARGE, TURBO, TURBO]);
  assert.deepEqual(result.words, verified.words);
  assert.equal(result.timingVerification, 'short-audio');
});

test('Groq focused isolated-label retry retains large-v3', async () => {
  const original = transcript([{ word: 'Elephant', start: 2, end: 4 }]);
  const wrong = transcript([{ word: 'Zebra', start: 0.7, end: 1.1 }]);
  const verified = transcript([{ word: 'Elephant', start: 0.7, end: 1.1 }]);
  const f = fixture({ duration: 10, responses: [original, wrong, verified] });
  const result = plain(await f.invoke());
  f.assertReleased();
  assert.equal(result.ok, true);
  assert.deepEqual(models(f.calls), [LARGE, LARGE, LARGE]);
});

test('Groq broad opening prefix checks and focused tail checks retain large-v3', async () => {
  const original = transcript([{ word: 'InfoKids', start: 0, end: 6.26 }]);
  const broad = transcript([{ word: 'InfoKids', start: 0.02, end: 6.18 }]);
  const tail = transcript([{ word: 'InfoKids', start: 0.54, end: 1.92 }]);
  const stable = transcript([{ word: 'InfoKids', start: 1.1, end: 2.4 }]);
  const f = fixture({ duration: 10, responses: [original, broad, broad, tail, stable, stable] });
  const result = plain(await f.invoke());
  f.assertReleased();
  assert.equal(result.ok, true);
  assert.deepEqual(models(f.calls), Array(6).fill(LARGE));
});

const correctionOriginal = transcript([
  { word: 'The', start: 2, end: 3 },
  { word: 'elefant', start: 2.5, end: 3.5 },
  { word: 'walks', start: 4, end: 4.5 },
]);
const correction = transcript([
  { word: 'The', start: 2, end: 2.4 },
  { word: 'elephant', start: 2.5, end: 3.5 },
  { word: 'walks', start: 4, end: 4.5 },
]);
const invalidRecognition = { text: '', words: [], segments: [] };

test('Groq spelling correction after a failed large-v3 verification requires two agreeing turbo passes', async () => {
  const f = fixture({ duration: 10, responses: [correctionOriginal, invalidRecognition, correction, correction] });
  const result = plain(await f.invoke());
  f.assertReleased();
  assert.equal(result.ok, true);
  assert.equal(result.text, 'The elephant walks');
  assert.deepEqual(models(f.calls), [LARGE, LARGE, TURBO, TURBO]);
  assert.match(result.warnings.join(' '), /elefant.*elephant.*Review/);
});

for (const [label, finalRecognition] of [
  ['missing timestamps', invalidRecognition],
  ['different correction text', transcript(correction.words.map(word => word.word === 'elephant' ? { ...word, word: 'dolphin' } : word))],
  ['timing disagreement', transcript(correction.words.map(word => ({ ...word, start: word.start + 0.4, end: word.end + 0.4 })))],
  ['overlapping timestamps', correctionOriginal],
]) {
  test(`Groq turbo correction rejects ${label} at the existing verification attempt cap`, async () => {
    const f = fixture({ duration: 10, responses: [correctionOriginal, invalidRecognition, correction, finalRecognition] });
    const result = plain(await f.invoke());
    f.assertReleased();
    assert.equal(result.ok, false);
    assert.match(result.error, /could not verify/);
    assert.deepEqual(models(f.calls), [LARGE, LARGE, TURBO, TURBO]);
    assert.equal(f.calls.progress.some(item => item.value === 100), false);
  });
}

test('Groq turbo cannot exceed the existing changed-word allowance', async () => {
  const excessive = transcript(correction.words.map(word => word.word === 'The' ? { ...word, word: 'A' } : word));
  const f = fixture({ duration: 10, responses: [correctionOriginal, invalidRecognition, excessive, excessive] });
  const result = plain(await f.invoke());
  f.assertReleased();
  assert.equal(result.ok, false);
  assert.match(result.error, /could not verify/);
  assert.deepEqual(models(f.calls), [LARGE, LARGE, TURBO, TURBO]);
});

for (const remaining of [1, 2]) {
  test(`Groq turbo retries cannot exceed ${remaining} remaining verification request${remaining === 1 ? '' : 's'}`, async () => {
    const f = fixture({ duration: 10, response: invalidRecognition });
    const state = { requests: 16 - remaining };
    await assert.rejects(f.context.verifyGroqCaptionSpeechTimings({
      words: correctionOriginal.words, pcm: Buffer.alloc(10 * 32000), sampleRate: 16000, duration: 10,
      apiKey: 'fixture-token', languageHint: 'auto', verificationState: state,
    }), /request limit reached/);
    f.assertReleased();
    assert.equal(state.requests, 16);
    assert.deepEqual(models(f.calls), [LARGE, TURBO].slice(0, remaining));
  });
}

for (const model of [LARGE, TURBO]) {
  test(`Groq HTTP 429 retries preserve selected model ${model}`, async () => {
    const f = fixture({ statuses: [429, 429, 200], retryAfters: ['0.001', '0.001'], fastRetryTimers: true });
    const json = plain(await f.context.callGroqWhisperForBuffer(
      f.context.buildWavChunkBuffer(Buffer.alloc(5 * 32000)), 'fixture-token', 'auto', undefined, '', model,
    ));
    f.assertReleased();
    assert.ok(json.words.length);
    assert.deepEqual(models(f.calls), Array(3).fill(model));
    assert.deepEqual(retryDelays(f.calls), [1, 1]);
  });
}

function replayFixture(options = {}) {
  const directory = path.resolve(__dirname, '..');
  const script = fs.readFileSync(path.join(__dirname, 'check-caption-groq-recordings.cjs'), 'utf8');
  const helpers = fs.readFileSync(path.join(directory, 'main.cjs'), 'utf8');
  const fixtureRoot = path.resolve('groq-replay-memory-fixture');
  const recordings = Array.from({ length: options.fileCount || 4 }, (_, index) => path.join(fixtureRoot, `recording-${index + 1}.wav`));
  const audio = fixture().context.buildWavChunkBuffer(Buffer.alloc(5 * 32000));
  const files = new Map(recordings.map(file => [file, audio]));
  const calls = { api: [], desktopProbe: 0, readAudio: [], writes: [], snapshots: [], bodyReads: 0, logs: [] };
  const module = { exports: {} };
  const processStub = { env: { GROQ_API_KEY: 'fixture-replay-token' }, on() {}, removeListener() {}, exitCode: undefined };
  const requireStub = name => {
    if (name === 'node:fs') return {
      existsSync: () => { throw new Error('Replay tests must not inspect saved keys'); },
      readFileSync: file => {
        if (file === path.join(directory, 'main.cjs')) return helpers;
        assert.ok(files.has(file), 'Replay may only read explicit in-memory recordings');
        calls.readAudio.push(file); return files.get(file);
      },
      mkdirSync() {},
      writeFileSync: (file, value) => {
        calls.writes.push({ file, value }); files.set(file, value);
        if (file.endsWith('summary.json.tmp')) calls.snapshots.push(JSON.parse(value));
      },
      renameSync: (from, to) => { assert.ok(files.has(from)); files.set(to, files.get(from)); files.delete(from); },
    };
    if (name === 'node:path') return path;
    if (name === 'node:vm') return vm;
    if (name === 'acorn') return require('acorn');
    throw new Error('Unexpected replay dependency: ' + name);
  };
  const context = vm.createContext({
    require: requireStub, module, __dirname: path.join(directory, 'scripts'), Buffer, AbortController, AbortSignal,
    FormData, Blob, performance, process: processStub,
    setTimeout: (fn, ms) => setTimeout(fn, ms === 180000 ? ms : 0), clearTimeout,
    console: { log: value => calls.logs.push(value), error() {} },
    fetch: async (url, init) => {
      if (url === 'http://127.0.0.1:9228/json/version') { calls.desktopProbe++; return { ok: false, status: 404 }; }
      assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
      calls.api.push({ url, init });
      const requestIndex = calls.api.length - 1;
      const status = options.statuses?.[requestIndex] || 200;
      return {
        ok: status === 200, status,
        headers: { get: name => name === 'retry-after' ? options.retryAfters?.[requestIndex] || null : null },
        body: { cancel: async () => {} },
        json: async () => {
          if (status !== 200) { calls.bodyReads++; throw new Error('fixture-replay-token private account body'); }
          return options.responses?.[requestIndex] || transcript([{ word: 'Hello', start: 1, end: 1.5 }]);
        },
      };
    },
  });
  vm.runInContext(script, context, { filename: 'memory-only-groq-replay.cjs' });
  return {
    calls, process: processStub, recordings,
    run: () => module.exports.run({ live: true, language: 'auto', contentMode: 'speech', recoverMissing: options.recoverMissing === true,
      files: recordings, report: path.join(fixtureRoot, 'summary.json'), rawDir: path.join(fixtureRoot, 'responses') }),
  };
}

test('live replay pauses on quota, preserves prior captions, and leaves remaining WAVs pending without reading them', async () => {
  const f = replayFixture({ statuses: [200, 429, 200, 200], retryAfters: [null, '90'] });
  const report = plain(await f.run());
  assert.equal(report.status, 'paused');
  assert.deepEqual(report.recordings.map(item => item.status), ['passed', 'failed', 'pending', 'pending']);
  assert.deepEqual(report.summary, { recordings: 4, passed: 1, validatedOffline: 0, failed: 1, cancelled: 0, pending: 2, requests: 2 });
  assert.equal(report.rateLimit.code, 'CAPTION_GROQ_RATE_LIMIT');
  assert.equal(report.rateLimit.retryAfterMs, 90000);
  assert.equal(report.rateLimit.retryAfterEstimated, false);
  assert.equal(f.calls.api.length, 2); assert.equal(f.calls.desktopProbe, 1);
  assert.deepEqual(f.calls.readAudio, f.recordings.slice(0, 2));
  assert.equal(f.calls.bodyReads, 0);
  assert.equal(f.process.exitCode, 1);
  for (const pending of report.recordings.slice(2)) {
    assert.equal(pending.pendingReason, 'CAPTION_GROQ_RATE_LIMIT');
    assert.equal(pending.retryAt, report.rateLimit.retryAt);
    assert.equal(pending.retryAfterMs, 90000);
    assert.equal(pending.requestCount, 0);
  }
  assert.ok(report.recordings[0].resultPath);
  assert.ok(f.calls.writes.some(write => write.file === report.recordings[0].resultPath));
  assert.equal(f.calls.writes.some(write => write.value.includes('fixture-replay-token')), false);
});

for (const phase of ['optional timing verification', 'automatic gap recovery']) {
  test(`live replay saves passed captions then pauses on ${phase} quota without reading later WAVs`, async () => {
    const optional = phase === 'optional timing verification';
    const original = transcript([{ word: 'Hello', start: 1, end: optional ? 3 : 1.5 }]);
    const f = replayFixture({ responses: [original], statuses: [200, 429, 200, 200], retryAfters: [null, '90'], recoverMissing: true });
    const report = plain(await f.run());
    assert.equal(report.status, 'paused');
    assert.deepEqual(report.recordings.map(item => item.status), ['passed', 'pending', 'pending', 'pending']);
    assert.deepEqual(report.summary, { recordings: 4, passed: 1, validatedOffline: 0, failed: 0, cancelled: 0, pending: 3, requests: 2 });
    assert.equal(report.rateLimit.code, 'CAPTION_GROQ_RATE_LIMIT');
    assert.equal(report.rateLimit.retryAfterMs, 90000); assert.equal(report.rateLimit.retryAfterEstimated, false);
    assert.equal(f.calls.api.length, 2); assert.deepEqual(f.calls.readAudio, f.recordings.slice(0, 1));
    assert.equal(f.calls.bodyReads, 0); assert.equal(f.process.exitCode, 1);
    const current = report.recordings[0];
    assert.ok(current.resultPath);
    const saved = JSON.parse(f.calls.writes.find(write => write.file === current.resultPath).value);
    assert.deepEqual(saved.words, original.words);
    assert.equal(saved.timingVerification, undefined);
    assert.equal(saved.rateLimit.retryAfterMs, 90000);
    assert.match(saved.warnings.join(' '), /quota.*retained/i);
    for (const pending of report.recordings.slice(1)) {
      assert.equal(pending.pendingReason, 'CAPTION_GROQ_RATE_LIMIT');
      assert.equal(pending.retryAt, report.rateLimit.retryAt); assert.equal(pending.requestCount, 0);
    }
    assert.ok(f.calls.snapshots.some(snapshot => snapshot.recordings[0].status === 'passed' && snapshot.status === 'paused'));
    assert.equal(f.calls.writes.some(write => write.value.includes('fixture-replay-token')), false);
  });
}

test('live replay persists each HTTP attempt before terminal quota and saves all pending recordings', async () => {
  const f = replayFixture({ statuses: [429, 429, 429, 200], retryAfters: ['0.001', '0.001', '1.25'] });
  const report = plain(await f.run());
  assert.equal(f.calls.api.length, 3);
  assert.equal(report.summary.requests, 3); assert.equal(report.summary.pending, 3);
  assert.equal(report.rateLimit.retryAfterMs, 1250);
  for (const requests of [1, 2, 3]) {
    assert.ok(f.calls.snapshots.some(snapshot => snapshot.summary.requests === requests
      && snapshot.recordings[0].status === 'running'), `HTTP attempt ${requests} must be persisted before the recording finishes`);
  }
  assert.equal(f.calls.snapshots[0].summary.pending, 4);
  assert.equal(f.calls.snapshots.at(-1).status, 'paused');
  assert.deepEqual(f.calls.snapshots.at(-1).recordings.map(item => item.status), ['failed', 'pending', 'pending', 'pending']);
  assert.equal(f.calls.readAudio.length, 1);
});

test('live replay continues non-quota failures and keeps incremental successful recording results', async () => {
  const f = replayFixture({ fileCount: 2, statuses: [401, 200] });
  const report = plain(await f.run());
  assert.equal(report.status, 'finished');
  assert.deepEqual(report.recordings.map(item => item.status), ['failed', 'passed']);
  assert.equal(report.rateLimit, undefined);
  assert.equal(report.recordings[0].providerHttpStatus, 401);
  assert.equal(report.summary.pending, 0); assert.equal(f.calls.api.length, 2);
  assert.ok(f.calls.snapshots.some(snapshot => snapshot.recordings[0].status === 'failed' && snapshot.recordings[1].status === 'pending'));
  assert.ok(f.calls.snapshots.some(snapshot => snapshot.recordings[1].status === 'passed' && !snapshot.finishedAt));
  assert.equal(f.calls.bodyReads, 0);
});
