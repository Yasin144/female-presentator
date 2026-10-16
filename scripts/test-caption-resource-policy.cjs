'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareCaptionVoiceMemory } = require('../caption-resource-policy.cjs');

const GIB = 1024 ** 3;

function fixture(overrides = {}) {
  const calls = { memory: 0, probe: 0, pause: 0, resume: 0, decisions: [] };
  const options = {
    freeMemoryBytes: () => { calls.memory++; return calls.memory === 1 ? 2 * GIB : 4 * GIB; },
    getNarrationProgress: async () => { calls.probe++; return { active: false }; },
    pauseVoice: async () => { calls.pause++; return () => { calls.resume++; }; },
    onDecision: facts => calls.decisions.push(facts),
    ...overrides,
  };
  return { calls, options };
}

function hasCode(code, reason) {
  return error => {
    assert.equal(error.code, code);
    if (reason) assert.equal(error.reason, reason);
    assert.match(error.message, /caption/i);
    return true;
  };
}

test('enough memory keeps the voice loaded without health or pause calls', async () => {
  for (const bytes of [3 * GIB, 4 * GIB]) {
    const { calls, options } = fixture({ freeMemoryBytes: () => bytes });
    const resume = await prepareCaptionVoiceMemory(options);
    await Promise.all([resume(), resume()]);
    assert.equal(calls.probe, 0);
    assert.equal(calls.pause, 0);
    assert.equal(calls.resume, 0);
    assert.deepEqual(calls.decisions, [{ decision: 'keep-loaded', reason: 'enough-memory', freeMemoryBytes: bytes, minimumMemoryBytes: 3 * GIB }]);
  }
});

test('the enough-memory branch does not require voice-service callbacks', async () => {
  const resume = await prepareCaptionVoiceMemory({ freeMemoryBytes: () => 3 * GIB });
  assert.equal(typeof resume, 'function');
  await resume();
});

test('low memory never pauses active narration', async () => {
  const { calls, options } = fixture({ getNarrationProgress: async () => { calls.probe++; return { active: true }; } });
  await assert.rejects(prepareCaptionVoiceMemory(options), hasCode('CAPTION_RESOURCE_BUSY', 'voice-active'));
  assert.equal(calls.probe, 1);
  assert.equal(calls.pause, 0);
  assert.match(calls.decisions[0].reason, /voice-active/);
});

test('failed and unknown progress checks never pause a voice service', async () => {
  for (const progress of [null, undefined, {}, { active: 'false' }, { active: 0 }, false]) {
    const { calls, options } = fixture({ getNarrationProgress: async () => progress });
    await assert.rejects(prepareCaptionVoiceMemory(options), hasCode('CAPTION_RESOURCE_BUSY', 'voice-check-failed'));
    assert.equal(calls.pause, 0);
  }
  const { calls, options } = fixture({ getNarrationProgress: async () => { throw new Error('PRIVATE_HTTP_RESPONSE_123'); } });
  await assert.rejects(prepareCaptionVoiceMemory(options), error => {
    hasCode('CAPTION_RESOURCE_BUSY', 'voice-check-failed')(error);
    assert.doesNotMatch(error.message, /PRIVATE/);
    return true;
  });
  assert.equal(calls.pause, 0);
  assert.doesNotMatch(JSON.stringify(calls.decisions), /PRIVATE/);
});

test('idle low-memory voice is released and returned resume runs exactly once', async () => {
  const { calls, options } = fixture();
  const resume = await prepareCaptionVoiceMemory(options);
  assert.equal(calls.memory, 2);
  assert.equal(calls.probe, 1);
  assert.equal(calls.pause, 1);
  assert.equal(calls.resume, 0);
  const first = resume();
  assert.equal(first, resume());
  await Promise.all([first, resume()]);
  assert.equal(calls.resume, 1);
  assert.deepEqual(calls.decisions.map(value => value.reason), ['idle-low-memory', 'memory-ready']);
});

test('a caller may inject a different positive free-memory threshold', async () => {
  const { calls, options } = fixture({ freeMemoryBytes: () => GIB });
  await prepareCaptionVoiceMemory(options, GIB);
  assert.equal(calls.pause, 0);
  assert.equal(calls.decisions[0].minimumMemoryBytes, GIB);
  for (const invalid of [0, -1, NaN, Infinity, '3']) {
    await assert.rejects(prepareCaptionVoiceMemory(options, invalid), TypeError);
  }
});

test('low memory after pausing restores SC3 before reporting an error', async () => {
  const { calls, options } = fixture({ freeMemoryBytes: () => 2 * GIB });
  await assert.rejects(prepareCaptionVoiceMemory(options), error => {
    hasCode('CAPTION_RESOURCE_BUSY', 'memory-still-low')(error);
    assert.equal(calls.resume, 1);
    assert.match(error.message, /free memory/);
    return true;
  });
  assert.equal(calls.pause, 1);
});

test('failed or invalid initial memory checks do not probe or pause', async () => {
  for (const memory of [null, '4000000000', NaN, Infinity, -1]) {
    const { calls, options } = fixture({ freeMemoryBytes: () => memory });
    await assert.rejects(prepareCaptionVoiceMemory(options), hasCode('CAPTION_RESOURCE_BUSY', 'memory-check-failed'));
    assert.equal(calls.probe, 0);
    assert.equal(calls.pause, 0);
  }
  const { calls, options } = fixture({ freeMemoryBytes: async () => { throw new Error('PRIVATE'); } });
  await assert.rejects(prepareCaptionVoiceMemory(options), hasCode('CAPTION_RESOURCE_BUSY', 'memory-check-failed'));
  assert.equal(calls.pause, 0);
});

test('a failed memory recheck still restores the acquired voice model', async () => {
  const { calls, options } = fixture({ freeMemoryBytes: async () => { calls.memory++; if (calls.memory === 1) return GIB; throw new Error('PRIVATE'); } });
  await assert.rejects(prepareCaptionVoiceMemory(options), hasCode('CAPTION_RESOURCE_BUSY', 'memory-check-failed'));
  assert.equal(calls.resume, 1);
});

test('cancellation before the policy performs no resource operations', async () => {
  const { calls, options } = fixture({ isCancelled: () => true });
  await assert.rejects(prepareCaptionVoiceMemory(options), hasCode('CAPTION_RESOURCE_CANCELLED'));
  assert.equal(calls.memory, 0);
  assert.equal(calls.probe, 0);
  assert.equal(calls.pause, 0);
});

test('cancellation during initial memory or progress awaits prevents pausing', async () => {
  for (const phase of ['memory', 'probe']) {
    let cancelled = false;
    const { calls, options } = fixture({
      isCancelled: () => cancelled,
      ...(phase === 'memory'
        ? { freeMemoryBytes: async () => { cancelled = true; return 4 * GIB; } }
        : { getNarrationProgress: async () => { cancelled = true; return { active: false }; } }),
    });
    await assert.rejects(prepareCaptionVoiceMemory(options), hasCode('CAPTION_RESOURCE_CANCELLED'));
    assert.equal(calls.pause, 0);
  }
});

test('cancellation during pause restores the acquired resume closure once', async () => {
  let cancelled = false;
  const { calls, options } = fixture({
    isCancelled: () => cancelled,
    pauseVoice: async () => { calls.pause++; cancelled = true; return async () => { calls.resume++; }; },
  });
  await assert.rejects(prepareCaptionVoiceMemory(options), hasCode('CAPTION_RESOURCE_CANCELLED'));
  assert.equal(calls.pause, 1);
  assert.equal(calls.resume, 1);
  assert.equal(calls.memory, 1);
});

test('cancellation during the memory recheck restores SC3 before rejecting', async () => {
  let cancelled = false;
  const { calls, options } = fixture({
    isCancelled: () => cancelled,
    freeMemoryBytes: async () => { calls.memory++; if (calls.memory === 1) return GIB; cancelled = true; return 4 * GIB; },
  });
  await assert.rejects(prepareCaptionVoiceMemory(options), hasCode('CAPTION_RESOURCE_CANCELLED'));
  assert.equal(calls.resume, 1);
});

test('logging cannot leak service responses or interrupt policy cleanup', async () => {
  const { calls, options } = fixture({
    getNarrationProgress: async () => ({ active: false, filePath: 'PRIVATE_SOURCE', apiKey: 'PRIVATE_KEY' }),
  });
  const resume = await prepareCaptionVoiceMemory(options);
  assert.doesNotMatch(JSON.stringify(calls.decisions), /PRIVATE/);
  await resume();
  const another = fixture({ onDecision: () => { throw new Error('PRIVATE'); } });
  const restore = await prepareCaptionVoiceMemory(another.options);
  await restore();
  assert.equal(another.calls.resume, 1);
});

test('cancel from a decision callback prevents a pause or restores a completed pause', async () => {
  for (const reason of ['idle-low-memory', 'memory-ready']) {
    let cancelled = false;
    const { calls, options } = fixture({
      isCancelled: () => cancelled,
      onDecision: facts => { if (facts.reason === reason) cancelled = true; },
    });
    await assert.rejects(prepareCaptionVoiceMemory(options), hasCode('CAPTION_RESOURCE_CANCELLED'));
    assert.equal(calls.pause, reason === 'idle-low-memory' ? 0 : 1);
    assert.equal(calls.resume, reason === 'idle-low-memory' ? 0 : 1);
  }
});

test('pause and restore failures keep sanitized resource errors and one restore attempt', async () => {
  const failedPause = fixture({ pauseVoice: async () => { throw new Error('PRIVATE'); } });
  await assert.rejects(prepareCaptionVoiceMemory(failedPause.options), hasCode('CAPTION_RESOURCE_BUSY', 'voice-pause-failed'));
  const { calls, options } = fixture({
    freeMemoryBytes: () => GIB,
    pauseVoice: async () => () => { calls.resume++; throw new Error('PRIVATE'); },
  });
  await assert.rejects(prepareCaptionVoiceMemory(options), hasCode('CAPTION_RESOURCE_BUSY', 'memory-still-low'));
  assert.equal(calls.resume, 1);
  assert.doesNotMatch(JSON.stringify(calls.decisions), /PRIVATE/);
});
