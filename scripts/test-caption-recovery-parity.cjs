'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../caption-script.js'), 'utf8');
const helpers = source.slice(source.indexOf('function captionTranscriptionError('), source.indexOf('async function explainCaptionTimingFailure('));
const cueValidation = source.slice(source.indexOf('function captionLocalCanonicalCue('), source.indexOf('function captionLocalReconcileText('));
const { createCaptionTranscriptionCoordinator: coordinator, captionGroqRetryMessage: retryMessage, validateCaptionTranscriptionCues: validateCues } = vm.runInNewContext(
  helpers + '\n' + cueValidation + '\n({createCaptionTranscriptionCoordinator, captionGroqRetryMessage, validateCaptionTranscriptionCues})', { Date });
const groq = { videoPath: 'lesson.mp4', languageHint: 'auto', engine: 'groq', contentMode: 'speech',
  audioMode: 'vocal-focus', transcriptionHints: 'Ria, InfoKids', autoRecoverMissingSpeech: true, apiKey: 'session-key' };
const valid = { ok: true, language: 'en', text: 'Hello.', words: [{ word: 'Hello.', start: .5, end: 1 }], timingSource: 'word' };
const limit = { ok: false, engine: 'groq', code: 'CAPTION_GROQ_RATE_LIMIT', providerHttpStatus: 429,
  retryAfterMs: 60000, retryAt: 61000, retryAfterEstimated: false, error: 'Quota reached.' };
const optionalLimitResult = { ...valid, engine: 'groq',
  warnings: ['Optional recognition check was limited. Review words and synchronization.'],
  rateLimit: { code: limit.code, engine: 'groq', providerHttpStatus: 429,
    retryAfterMs: limit.retryAfterMs, retryAt: limit.retryAt, retryAfterEstimated: false } };

for (const allowLocalRecovery of [false, true]) {
  test(`usable Groq captions survive optional quota without current-clip Local recovery (${allowLocalRecovery})`, async () => {
    const requests = [], phases = [], pauses = [];
    const route = coordinator({ getNow: () => 1000, transcribe: async options => {
      requests.push(options); return optionalLimitResult;
    }, validate: result => assert.equal(result, optionalLimitResult), onPause: error => pauses.push(error) });
    const result = await route.run({ ...groq, allowLocalRecovery }, phase => phases.push(phase));
    assert.equal(result, optionalLimitResult, 'Keep the actual Groq words, timing source and review warning unchanged.');
    assert.equal(result.engine, 'groq');
    assert.equal(result.recoveredFromEngine, undefined);
    assert.equal(result.verified, undefined, 'A skipped optional check must not be relabeled as verified.');
    assert.deepEqual(phases, []);
    assert.equal(requests.length, 1);
    assert.equal(pauses.length, 1);
    assert.equal(route.getCooldown().retryAt, 61000);
    assert.equal(route.getCooldown().providerHttpStatus, 429);
  });
}

test('optional-check quota pauses subsequent single or queued Groq requests until its deadline', async () => {
  let now = 1000;
  const requests = [];
  const route = coordinator({ getNow: () => now, transcribe: async options => {
    requests.push(options); return requests.length === 1 ? optionalLimitResult : { ...valid, engine: 'groq' };
  } });
  assert.equal((await route.run(groq)).ok, true);
  for (let index = 0; index < 8; index++) {
    await assert.rejects(route.run({ ...groq, videoPath: `next-${index}.mp4` }),
      error => error.name === 'Error' && error.code === limit.code && error.retryAt === 61000);
  }
  assert.equal(requests.length, 1, 'A retained successful clip cannot trigger more Groq calls during cooldown.');
  now = 61000;
  assert.equal(route.getCooldown(), null);
  assert.equal((await route.run({ ...groq, videoPath: 'after-cooldown.mp4' })).engine, 'groq');
  assert.equal(requests.length, 2);
});

test('optional quota uses Local only for later clips with explicit recovery and true provenance', async () => {
  const requests = [], phases = [];
  const route = coordinator({ getNow: () => 1000, transcribe: async options => {
    requests.push(options); return options.engine === 'groq' ? optionalLimitResult : { ...valid, engine: 'local' };
  } });
  const first = await route.run({ ...groq, allowLocalRecovery: true }, phase => phases.push(phase));
  assert.equal(first.engine, 'groq');
  for (let index = 0; index < 6; index++) {
    const result = await route.run({ ...groq, videoPath: `next-${index}.mp4`, allowLocalRecovery: true }, phase => phases.push(phase));
    assert.equal(result.engine, 'local');
    assert.equal(result.recoveredFromEngine, 'groq');
    assert.match(result.warnings.at(-1), /Local recovery.*Groq.*Review/);
  }
  assert.deepEqual(requests.map(request => request.engine), ['groq', ...Array(6).fill('local')]);
  assert.deepEqual(phases, Array(6).fill('Local recovery'));
  assert.equal(requests.slice(1).every(request => !('apiKey' in request)), true);
});

test('invalid successful Groq timings are rejected while known provider quota blocks later requests', async () => {
  let requests = 0;
  let reviewedCaptions = valid;
  const invalid = { ...optionalLimitResult, words: [{ word: 'Hello.', start: 4, end: 6 }] };
  const route = coordinator({ getNow: () => 1000, transcribe: async () => { requests++; return invalid; },
    validate: result => validateCues(result, 5, value => value.words.map(word => ({
      text: word.word, timestamp: [word.start, word.end], words: [{ text: word.word, timestamp: [word.start, word.end] }],
    }))) });
  await assert.rejects(route.run(groq).then(result => { reviewedCaptions = result; }),
    error => error.captionTimingFailure === true && /within the video/.test(error.message));
  assert.equal(reviewedCaptions, valid, 'Invalid cues cannot replace the reviewed captions.');
  assert.equal(route.getCooldown().retryAt, 61000);
  await assert.rejects(route.run(groq), error => error.code === limit.code && error.retryAt === 61000);
  assert.equal(requests, 1, 'A known quota must block another Groq request even when the current cues were rejected.');
});

test('cancellation during throwing validation outranks optional quota and cannot start Local recovery', async () => {
  let cancelled = false;
  const requests = [], phases = [], pauses = [];
  const route = coordinator({ getNow: () => 1000, isCancelled: () => cancelled,
    transcribe: async options => { requests.push(options); return optionalLimitResult; },
    validate: () => { cancelled = true; throw new Error('Invalid timestamps after cancellation.'); },
    onPause: error => pauses.push(error) });
  const result = await route.run({ ...groq, allowLocalRecovery: true }, phase => phases.push(phase));
  assert.equal(result.cancelled, true);
  assert.equal(route.getCooldown(), null);
  assert.equal(requests.length, 1);
  assert.deepEqual(phases, []);
  assert.deepEqual(pauses, []);
});

test('cancelled successful Groq responses never publish optional quota or trigger Local recovery', async () => {
  for (const cancelAt of ['response', 'after-request', 'validation']) {
    let cancelled = false;
    const requests = [], pauses = [];
    const route = coordinator({ getNow: () => 1000, isCancelled: () => cancelled,
      transcribe: async options => {
        requests.push(options);
        if (cancelAt === 'after-request') cancelled = true;
        return { ...optionalLimitResult, ...(cancelAt === 'response' ? { cancelled: true } : {}) };
      }, validate: () => { if (cancelAt === 'validation') cancelled = true; }, onPause: error => pauses.push(error) });
    const result = await route.run({ ...groq, allowLocalRecovery: true });
    assert.equal(result.cancelled, true, cancelAt);
    assert.equal(route.getCooldown(), null, cancelAt);
    assert.equal(requests.length, 1, cancelAt);
    assert.deepEqual(pauses, [], cancelAt);
  }
});

test('Local results cannot set a Groq cooldown through unrelated result metadata', async () => {
  const route = coordinator({ getNow: () => 1000, transcribe: async () => ({ ...optionalLimitResult, engine: 'local' }) });
  assert.equal((await route.run({ ...groq, engine: 'local' })).engine, 'local');
  assert.equal(route.getCooldown(), null);
});

test('terminal Groq quota preserves the structured deadline and prevents all requests before it', async () => {
  let now = 1000;
  const requests = [];
  const route = coordinator({ getNow: () => now, transcribe: async options => { requests.push(options); return requests.length === 1 ? limit : valid; } });
  await assert.rejects(route.run(groq), error => error.code === limit.code && error.retryAt === 61000 && error.providerHttpStatus === 429);
  for (let index = 0; index < 8; index++) await assert.rejects(route.run(groq), error => error.code === limit.code);
  assert.equal(requests.length, 1);
  assert.match(retryMessage(route.getCooldown(), now), /Wait 60 seconds.*Local.*preserved/);
  now = 61000;
  assert.equal(route.getCooldown(), null);
  assert.equal((await route.run(groq)).ok, true);
  assert.equal(requests.length, 2);
});

for (const contentMode of ['speech', 'song']) {
  test(`${contentMode}: explicit Local recovery preserves source/options and labels engine provenance`, async () => {
    const requests = [];
    const phases = [];
    const route = coordinator({ getNow: () => 1000, transcribe: async options => {
      requests.push(options);
      return options.engine === 'groq' ? { ok: false, code: 'CAPTION_GROQ_TIMING_UNCERTAIN', error: 'Uncertain boundaries.' } : valid;
    } });
    const result = await route.run({ ...groq, contentMode, allowLocalRecovery: true }, phase => phases.push(phase));
    assert.equal(result.engine, 'local');
    assert.equal(result.recoveredFromEngine, 'groq');
    assert.match(result.warnings.at(-1), /Local recovery.*Groq.*Review/);
    assert.deepEqual(phases, ['Local recovery']);
    assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), {
      videoPath: groq.videoPath, languageHint: groq.languageHint, engine: 'local', contentMode,
      audioMode: groq.audioMode, transcriptionHints: groq.transcriptionHints, autoRecoverMissingSpeech: true,
    });
    assert.equal('allowLocalRecovery' in requests[0], false);
    assert.equal('apiKey' in requests[1], false);
  });
}

test('recovery during Groq cooldown sends eight Local requests and no additional paid Groq requests', async () => {
  const requests = [];
  const route = coordinator({ getNow: () => 1000, transcribe: async options => {
    requests.push(options); return options.engine === 'groq' ? limit : valid;
  } });
  for (let index = 0; index < 8; index++) {
    const result = await route.run({ ...groq, videoPath: `clip-${index}.mp4`, allowLocalRecovery: true });
    assert.equal(result.engine, 'local');
  }
  assert.equal(requests.filter(item => item.engine === 'groq').length, 1);
  assert.equal(requests.filter(item => item.engine === 'local').length, 8);
});

for (const failure of [
  { ok: false, code: 'CAPTION_GROQ_TIMING_UNCERTAIN', error: 'Timing uncertain.' }, limit,
]) {
  test(`recovery is off by default for ${failure.code}`, async () => {
    let requests = 0;
    const route = coordinator({ getNow: () => 1000, transcribe: async () => { requests++; return failure; } });
    await assert.rejects(route.run(groq), error => error.code === failure.code);
    assert.equal(requests, 1);
  });
}

for (const code of ['CAPTION_RESOURCE_BUSY', 'CAPTION_TRANSCRIPTION_BUSY', 'CAPTION_GROQ_AUTH', 'CAPTION_NETWORK_ERROR']) {
  test(`opt-in recovery does not bypass ${code}`, async () => {
    let requests = 0;
    const route = coordinator({ transcribe: async () => { requests++; return { ok: false, code, error: 'Original failure.' }; } });
    await assert.rejects(route.run({ ...groq, allowLocalRecovery: true }), error => error.code === code);
    assert.equal(requests, 1);
  });
}

test('cancellation before request and during Groq request never starts Local recovery', async () => {
  for (const alreadyCancelled of [true, false]) {
    let cancelled = alreadyCancelled;
    let requests = 0;
    const route = coordinator({ isCancelled: () => cancelled, transcribe: async () => {
      requests++; cancelled = true; return limit;
    } });
    const result = await route.run({ ...groq, allowLocalRecovery: true });
    assert.equal(result.cancelled, true);
    assert.equal(requests, alreadyCancelled ? 0 : 1);
  }
});

test('cancelled Local recovery cannot be mistaken for successfully captioned audio', async () => {
  const requests = [];
  const route = coordinator({ transcribe: async options => {
    requests.push(options.engine);
    return options.engine === 'groq' ? limit : { ok: false, cancelled: true };
  } });
  const result = await route.run({ ...groq, allowLocalRecovery: true });
  assert.equal(result.cancelled, true);
  assert.equal(result.engine, undefined);
  assert.deepEqual(requests, ['groq', 'local']);
});

test('frontend timing validation can recover, while an invalid Local result is never accepted', async () => {
  const engines = [];
  const route = coordinator({ transcribe: async options => { engines.push(options.engine); return valid; },
    validate: () => { const error = new Error('Invalid timestamps.'); error.captionTimingFailure = true; throw error; } });
  await assert.rejects(route.run({ ...groq, allowLocalRecovery: true }), /Invalid timestamps/);
  assert.deepEqual(engines, ['groq', 'local']);
});

test('Local recovery with complete but out-of-video timestamps cannot pass cue validation', async () => {
  const requests = [];
  const route = coordinator({ transcribe: async options => {
    requests.push(options.engine);
    return options.engine === 'groq' ? { ok: false, code: 'CAPTION_GROQ_TIMING_UNCERTAIN', error: 'Uncertain timing.' }
      : { ...valid, words: [{ word: 'Hello.', start: 4, end: 6 }] };
  }, validate: result => validateCues(result, 5, value => value.words.map(word => ({
    text: word.word, timestamp: [word.start, word.end], words: [{ text: word.word, timestamp: [word.start, word.end] }],
  }))) });
  await assert.rejects(route.run({ ...groq, allowLocalRecovery: true }), error => error.captionTimingFailure === true && /within the video/.test(error.message));
  assert.deepEqual(requests, ['groq', 'local']);
});

test('cue validation uses each queued file duration and does not invent bounds before metadata is ready', () => {
  const build = value => [{ text: value.text, timestamp: [1, 6], words: [] }];
  for (const unknownDuration of [undefined, NaN, 0]) assert.equal(validateCues(valid, unknownDuration, build).length, 1);
  assert.equal(validateCues(valid, 8, build).length, 1);
  assert.throws(() => validateCues(valid, 5, build), error => error.captionTimingFailure === true && /within the video/.test(error.message));
  assert.equal(validateCues(valid, 8, build).length, 1, 'The previous shorter video must not constrain the next queued file.');
});

test('recognition controls expose default-off recovery without changing engine selection', () => {
  const jsx = fs.readFileSync(path.join(__dirname, '../src/components/LocalCaptionPanel.jsx'), 'utf8');
  assert.match(jsx, /<CaptionToggle id="captionGroqLocalRecovery">/);
  assert.doesNotMatch(jsx, /<CaptionToggle id="captionGroqLocalRecovery"[^>]*defaultChecked/);
  assert.match(source, /captionTranscriptionCoordinator\.run\(activeCaptionTranscription/g);
  assert.equal((source.match(/captionTranscriptionCoordinator\.run\(activeCaptionTranscription/g) || []).length, 2);
});
