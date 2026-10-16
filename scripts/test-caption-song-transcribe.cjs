'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { transcribeSongAudio, normalizeSongTranscript, extractTranscript, readWavDuration, MAX_AUDIO_BYTES } = require('../caption-song-transcribe.cjs');

function wav(seconds = 8) {
  const byteRate = 32000;
  const buffer = Buffer.alloc(44 + byteRate * seconds);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(byteRate, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
}

function result(segments, finishReason = 'STOP') {
  return { candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify({ language: 'en', segments }) }] } }] };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('WAV duration handles metadata chunks and rejects a truncated WAV', () => {
  const original = wav(8);
  const header = Buffer.from(original.subarray(0, 12));
  const metadata = Buffer.alloc(12);
  metadata.write('JUNK', 0); metadata.writeUInt32LE(3, 4); metadata.write('abc', 8);
  const withMetadata = Buffer.concat([header, metadata, original.subarray(12)]);
  withMetadata.writeUInt32LE(withMetadata.length - 8, 4);
  assert.equal(readWavDuration(withMetadata), 8);
  assert.equal(readWavDuration(original.subarray(0, original.length - 1)), undefined);
  assert.equal(readWavDuration(Buffer.from('no audio')), undefined);
});

test('every repetition and overlapping voice survives in a safe single caption timeline', () => {
  const normalized = normalizeSongTranscript({ language: 'en', segments: [
    { start: 5, end: 7, text: 'Jingle bells, jingle bells.' },
    { start: 1, end: 3, text: 'Jingle bells, jingle bells.' },
    { start: 2.5, end: 4, text: 'Merry Christmas to all!' },
    { start: 3.8, end: 4.5, text: 'Oh, what fun.' },
  ] }, 8);
  assert.equal(normalized.segments.length, 2);
  assert.equal(normalized.segments[0].start, 1);
  assert.equal(normalized.segments[0].end, 4.5);
  assert.equal((normalized.text.match(/Jingle bells, jingle bells\./g) || []).length, 2);
  assert.match(normalized.text, /Merry Christmas to all!/);
  assert.match(normalized.text, /Oh, what fun\./);
  assert.equal(normalized.words.map(word => word.word).join(' '), normalized.text.replace(/\s+/g, ' '));
  for (let i = 0; i < normalized.words.length; i++) {
    const word = normalized.words[i];
    assert.ok(Number.isFinite(word.start) && Number.isFinite(word.end));
    assert.ok(word.start >= 0 && word.end > word.start && word.end <= 8);
    if (i) assert.ok(normalized.words[i - 1].end <= word.start);
    assert.equal(word.timingSource, 'estimated');
  }
  assert.equal(normalized.timingSource, 'estimated');
  assert.equal(normalized.contentMode, 'song');
  assert.equal(normalized.engine, 'gemini');
  assert.match(normalized.warnings.join(' '), /estimated/);
  assert.match(normalized.warnings.join(' '), /Overlapping/);
});

test('invalid, empty, nonnumeric, nonfinite and out-of-range timestamps fail instead of creating captions', () => {
  for (const segments of [[], [{ start: 0, end: 1, text: '' }], [{ start: -1, end: 1, text: 'heard' }],
    [{ start: '0', end: 1, text: 'heard' }], [{ start: 0, end: NaN, text: 'heard' }],
    [{ start: 0, end: Infinity, text: 'heard' }], [{ start: 1, end: 1, text: 'heard' }],
    [{ start: 0, end: 8.01, text: 'heard' }], [{ start: 0, end: 1, text: { arbitrary: true } }]]) {
    assert.throws(() => normalizeSongTranscript({ segments }, 8));
  }
  assert.throws(() => normalizeSongTranscript({ segments: [{ start: 0, end: 1, text: 'words' }] }, NaN));
  assert.throws(() => normalizeSongTranscript({ segments: [{ start: 0, end: 1, text: 'x'.repeat(100001) }] }, 8), /oversized/);
});

test('truncated, blocked, malformed, and empty model responses are rejected', () => {
  const line = { start: 0, end: 1, text: 'heard' };
  assert.throws(() => extractTranscript(result([line], 'MAX_TOKENS'), 8), /incomplete/);
  assert.throws(() => extractTranscript({ promptFeedback: { blockReason: 'SAFETY' } }, 8), /could not/);
  assert.throws(() => extractTranscript({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not JSON' }] } }] }, 8), /invalid/);
  assert.throws(() => extractTranscript({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '', thought: true }] } }] }, 8), /no recognizable/);
  assert.throws(() => extractTranscript({ candidates: [] }, 8), /could not finish/);
});

test('a real request shape uses supplied audio and language only, then reports estimated timing', async () => {
  const audioBuffer = wav();
  const progress = [];
  const calls = [];
  const transcript = await transcribeSongAudio({ audioBuffer, apiKey: 'test-key', languageHint: 'en', onProgress: event => progress.push(event),
    fetchImpl: async (url, request) => {
      calls.push(url);
      assert.equal(request.headers['x-goog-api-key'], 'test-key');
      assert.ok(!url.includes('test-key'));
      const body = JSON.parse(request.body);
      assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'audio/wav');
      assert.ok(Buffer.from(body.contents[0].parts[1].inlineData.data, 'base64').equals(audioBuffer));
      const prompt = body.contents[0].parts[0].text;
      assert.match(prompt, /every repeated/);
      assert.match(prompt, /8\.000 second/);
      assert.match(prompt, /selected language code is en/);
      assert.doesNotMatch(prompt, /jingle|christmas|filename|title/i);
      return jsonResponse(result([{ start: 1, end: 3, text: 'heard sung words' }]));
    },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /gemini-3\.6-flash:generateContent$/);
  assert.equal(transcript.text, 'heard sung words');
  assert.equal(transcript.duration, 8);
  assert.equal(transcript.timingSource, 'estimated');
  assert.deepEqual(progress.map(event => event.pct), [12, 90, 98]);
});

test('unsupported configured models discover a supported generateContent model without choosing image, TTS or embedding', async () => {
  const urls = [];
  const transcript = await transcribeSongAudio({ audioBuffer: wav(), apiKey: 'test-key', model: 'gemini-3.0-flash',
    fetchImpl: async url => {
      urls.push(url);
      if (url.endsWith('gemini-3.0-flash:generateContent')) return jsonResponse({ error: { message: 'missing' } }, 404);
      if (url.includes('/models?')) return jsonResponse({ models: [
        { name: 'models/gemini-3.8-flash-image', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      ] });
      assert.ok(url.endsWith('gemini-2.5-flash:generateContent'));
      return jsonResponse(result([{ start: 1, end: 2, text: 'heard' }]));
    },
  });
  assert.equal(urls.length, 3);
  assert.equal(transcript.model, 'gemini-2.5-flash');
});

test('oversized audio and invalid duration never trigger a network request', async () => {
  let calls = 0;
  const options = { apiKey: 'test-key', fetchImpl: async () => { calls++; throw new Error('unreachable'); } };
  await assert.rejects(transcribeSongAudio({ ...options, audioBuffer: Buffer.alloc(MAX_AUDIO_BYTES + 1), duration: 8 }), /too large/);
  await assert.rejects(transcribeSongAudio({ ...options, audioBuffer: wav(), duration: Infinity }), /valid duration/);
  await assert.rejects(transcribeSongAudio({ ...options, audioBuffer: wav(), duration: '8' }), /valid duration/);
  await assert.rejects(transcribeSongAudio({ ...options, audioBuffer: Buffer.alloc(1) }), /valid duration/);
  assert.equal(calls, 0);
});

test('remote and network errors never expose credentials or remote response text', async () => {
  const secret = 'very-private-test-key';
  for (const status of [400, 401, 403, 429, 500]) {
    await assert.rejects(transcribeSongAudio({ audioBuffer: wav(), apiKey: secret, retryDelayMs: 1,
      fetchImpl: async () => jsonResponse({ error: { message: `remote echoed ${secret}` } }, status),
    }), error => { assert.ok(!error.message.includes(secret)); assert.ok(!error.message.includes('remote echoed')); return true; });
  }
  await assert.rejects(transcribeSongAudio({ audioBuffer: wav(), apiKey: secret,
    fetchImpl: async () => { throw new Error(secret); },
  }), error => { assert.ok(!error.message.includes(secret)); return true; });
});

test('cancellation and timeout stop the request and never return a successful transcript', async () => {
  const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const controller = new AbortController();
  const pending = transcribeSongAudio({ audioBuffer: wav(), apiKey: 'test-key', signal: controller.signal, fetchImpl });
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  await assert.rejects(transcribeSongAudio({ audioBuffer: wav(), apiKey: 'test-key', fetchImpl, timeoutMs: 5 }), /timed out/);
  let calls = 0;
  await assert.rejects(transcribeSongAudio({ audioBuffer: wav(), apiKey: 'test-key', signal: controller.signal,
    fetchImpl: async () => { calls++; },
  }), error => error.name === 'AbortError');
  assert.equal(calls, 0);
});

test('response streaming is capped before a maliciously large JSON body is read', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(3 * 1024 * 1024)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(transcribeSongAudio({ audioBuffer: wav(), apiKey: 'test-key',
    fetchImpl: async () => new Response(stream),
  }), /oversized response/);
  assert.equal(cancelled, true);
});

test('transient HTTP failures retry once and retain the original audio request', async () => {
  for (const status of [429, 500, 502, 503, 504]) {
    const calls = [];
    const transcript = await transcribeSongAudio({ audioBuffer: wav(), apiKey: 'test-key', retryDelayMs: 1,
      fetchImpl: async (_url, request) => {
        calls.push(request.body);
        return calls.length === 1 ? jsonResponse({ error: {} }, status) : jsonResponse(result([{ start: 1, end: 2, text: 'heard' }]));
      },
    });
    assert.equal(transcript.text, 'heard');
    assert.equal(calls.length, 2);
    assert.equal(calls[0], calls[1]);
  }
  let calls = 0;
  await assert.rejects(transcribeSongAudio({ audioBuffer: wav(), apiKey: 'test-key', retryDelayMs: 1,
    fetchImpl: async () => { calls++; return jsonResponse({}, 503); },
  }), /HTTP 503/);
  assert.equal(calls, 2);
});

test('Retry-After is bounded and its wait is cancelled by the overall timeout or user', async () => {
  let calls = 0;
  const longWait = () => { calls++; return new Response('{}', { status: 503, headers: { 'Retry-After': '600' } }); };
  await assert.rejects(transcribeSongAudio({ audioBuffer: wav(), apiKey: 'test-key', fetchImpl: longWait, timeoutMs: 15 }), /timed out/);
  assert.equal(calls, 1);
  const controller = new AbortController();
  await assert.rejects(transcribeSongAudio({ audioBuffer: wav(), apiKey: 'test-key', fetchImpl: longWait, signal: controller.signal,
    onProgress: event => { if (event.pct === 18) controller.abort(); },
  }), error => error.name === 'AbortError');
  assert.equal(calls, 2);
  let successfulCalls = 0;
  const transcript = await transcribeSongAudio({ audioBuffer: wav(), apiKey: 'test-key', fetchImpl: async () => {
    successfulCalls++;
    return successfulCalls === 1 ? new Response('{}', { status: 503, headers: { 'Retry-After': '0' } }) : jsonResponse(result([{ start: 0, end: 1, text: 'heard' }]));
  } });
  assert.equal(transcript.text, 'heard');
  assert.equal(successfulCalls, 2);
});
