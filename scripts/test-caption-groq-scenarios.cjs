'use strict';

// Exercise the real Groq helpers with mocked HTTP and in-memory PCM only.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture, plain } = require('./test-caption-groq-ipc.cjs');

const reply = words => ({ text: words.map(item => item?.word || item?.text || '').join(' '), words, segments: [] });
const word = (text, start, end) => ({ word: text, start, end });
const conflict = () => reply([word('Alpha', 10, 10.6), word('Beta', 10.5, 11.1)]);
const narrow = () => reply([word('Alpha', 2.1, 2.4), word('Beta', 2.5, 2.8)]);

test('compact core repair ignores unrelated invalid context and preserves its accepted timestamps', async () => {
  const words = [word('Before', 8, 8.5), word('Alpha', 10, 10.6), word('Beta', 10.5, 11.1), word('After', 12, 12.5)];
  const f = fixture({ response: reply([word('unrelated', 0, 0), word('Alpha', 1.1, 1.4), word('Beta', 1.5, 1.8)]) });
  const result = plain(await f.context.verifyGroqCaptionSpeechTimings({ words, pcm: Buffer.alloc(15 * 32000),
    sampleRate: 16000, duration: 15, apiKey: 'fixture-token', compact: true }));
  assert.deepEqual(result.words, [words[0], word('Alpha', 10.1, 10.4), word('Beta', 10.5, 10.8), words[3]]);
  assert.equal(f.calls.fetch.length, 1);
  f.assertReleased();
});

test('a repeated compact core cannot use an ambiguous occurrence as verified timing', async () => {
  const ambiguous = reply([word('Alpha', 1.1, 1.4), word('Beta', 1.5, 1.8), word('Alpha', 2.1, 2.4), word('Beta', 2.5, 2.8)]);
  const f = fixture({ response: ambiguous });
  await assert.rejects(f.context.verifyGroqCaptionSpeechTimings({ words: conflict().words,
    pcm: Buffer.alloc(15 * 32000), sampleRate: 16000, duration: 15, apiKey: 'fixture-token', compact: true }), /could not verify/);
  assert.equal(f.calls.fetch.length, 3);
  f.assertReleased();
});

const recordedContextRepairs = [
  {
    name: 'Listen-1', offset: 8.1,
    original: [word("Today's", 7.72, 8.1), word('activity', 8.1, 8.52), word('is', 8.52, 9),
      word('Pear', 9, 9.24), word('Talk.', 9.24, 10.1), word('My', 9.5, 10.52), word('favorite', 10.52, 10.92)],
    decoded: [word('activity', 0, .38), word('is', .38, .8), word('pear', .8, 1.08),
      word('talk.', 1.08, 2.3), word('My', 2.3, 2.38), word('favorite', 2.38, 2.76)],
    first: 1, last: 5,
  },
  {
    name: 'Grammar', offset: 18.04,
    original: [word('direction.', 16.52, 17.46), word('Example', 18.04, 18.54), word('from', 18.54, 18.72),
      word('the', 18.72, 18.84), word('poem', 18.84, 19.14), word('context.', 19.14, 19.86),
      word('The', 19.5, 20.32), word('robin', 20.32, 20.74)],
    decoded: [word('Example', 0, .46), word('from', .46, .66), word('the', .66, .76),
      word('poem', .76, 1.04), word('context,', 1.04, 2.02), word('the', 2.02, 2.24), word('robin', 2.24, 2.68)],
    first: 1, last: 6,
  },
  {
    name: 'Teachers', offset: 9.78,
    original: [word('bird', 9.48, 9.78), word('song', 9.78, 10.1), word('audio', 10.1, 10.56),
      word('before', 10.56, 11.08), word('reciting.', 11.08, 12), word('Let', 11.5, 12.78), word('children', 12.78, 13.2)],
    decoded: [word('song', .02, .26), word('audio', .26, .68), word('before', .68, 1.2),
      word('reciting.', 1.2, 2.04), word('Let', 2.82, 2.98), word('children', 2.98, 3.32)],
    first: 1, last: 5,
  },
];

for (const scenario of recordedContextRepairs) {
  test(`recorded ${scenario.name} boundaries move their minimal identical context block together`, async () => {
    const f = fixture({ response: reply(scenario.decoded) });
    const windows = plain(f.context.groqCaptionTimingWindows(scenario.original, 30, true));
    assert.equal(windows.length, 1);
    assert.equal(Math.floor(windows[0].start * 16000) / 16000, scenario.offset);
    const result = plain(await f.context.verifyGroqCaptionSpeechTimings({ words: scenario.original,
      pcm: Buffer.alloc(30 * 32000), sampleRate: 16000, duration: 30, apiKey: 'fixture-token', compact: true }));
    const expected = scenario.original.map((item, index) => index < scenario.first || index > scenario.last ? item
      : word(item.word, scenario.offset + scenario.decoded[index - scenario.first].start,
        scenario.offset + scenario.decoded[index - scenario.first].end));
    assert.deepEqual(result.words, expected);
    assert.equal(result.words.map(item => item.word).join(' '), scenario.original.map(item => item.word).join(' '));
    assert.equal(f.calls.fetch.length, 1);
    f.assertReleased();
  });
}

const contextConflict = () => [word('Before', 8, 8.5), word('Context', 9.2, 9.8),
  word('Alpha', 10, 10.6), word('Beta', 10.5, 11.1), word('After', 12, 12.5)];
const contextRecognition = () => [word('Context', .2, .7), word('Alpha', .7, 1.2), word('Beta', 1.2, 1.6)];
async function verifyCompactContext(words, response) {
  const f = fixture({ response });
  try {
    const result = plain(await f.context.verifyGroqCaptionSpeechTimings({ words, pcm: Buffer.alloc(15 * 32000),
      sampleRate: 16000, duration: 15, apiKey: 'fixture-token', compact: true }));
    return { f, result };
  } finally { f.assertReleased(); }
}

test('compact context ownership ignores invalid unrelated decoded words but keeps them outside the repair', async () => {
  const original = contextConflict();
  const { f, result } = await verifyCompactContext(original, reply([word('unrelated', 0, 0), ...contextRecognition()]));
  assert.deepEqual(result.words, [original[0], word('Context', 9.2, 9.7), word('Alpha', 9.7, 10.2),
    word('Beta', 10.2, 10.6), original[4]]);
  assert.equal(f.calls.fetch.length, 1);
});

test('compact repair expands through identical right context when the core crosses a stale next boundary', async () => {
  const original = [word('Before', 8, 8.5), word('Alpha', 10, 10.6), word('Beta', 10.5, 11.1),
    word('Context', 11.2, 11.6), word('After', 13, 13.5)];
  const { result } = await verifyCompactContext(original, reply([word('Alpha', 1.1, 1.4), word('Beta', 1.4, 2.3),
    word('Context', 2.3, 2.6)]));
  assert.deepEqual(result.words, [original[0], word('Alpha', 10.1, 10.4), word('Beta', 10.4, 11.3),
    word('Context', 11.3, 11.6), original[4]]);
});

test('context token merging preserves every original repeated token at actual shared ASR bounds', async () => {
  const original = [word('Before', 8, 8.5), word('go', 9.2, 9.5), word('go', 9.5, 9.8),
    word('Alpha', 10, 10.6), word('Beta', 10.5, 11.1), word('After', 12, 12.5)];
  const { result } = await verifyCompactContext(original, reply([word('gogo', .2, .7),
    word('Alpha', .7, 1.2), word('Beta', 1.2, 1.6)]));
  assert.deepEqual(result.words, [original[0], word('go go Alpha Beta', 9.2, 10.6), original[5]]);
  assert.equal(result.words.map(item => item.word).join(' '), 'Before go go Alpha Beta After');
});

const invalidRequiredContexts = [
  ['missing required neighbor', words => words.slice(1)],
  ['changed required neighbor', words => [word('Different', .2, .7), ...words.slice(1)]],
  ['zero duration required neighbor', words => [word('Context', .2, .2), ...words.slice(1)]],
  ['negative required neighbor', words => [word('Context', -.1, .7), ...words.slice(1)]],
  ['required neighbor overlaps the core substantially', words => [word('Context', .2, 1.1), ...words.slice(1)]],
  ['required context extends beyond its clip', words => [word('Context', .2, 7), ...words.slice(1)]],
  ['core is outside the clip', words => [words[0], word('Alpha', -.1, .2), word('Beta', .2, 1.6)]],
];
for (const [name, change] of invalidRequiredContexts) {
  test(`compact ownership rejects ${name} without inventing neighbor boundaries`, async () => {
    await assert.rejects(verifyCompactContext(contextConflict(), reply(change(contextRecognition()))), /could not verify/);
  });
}

test('expanded ownership requires complete recognition transcript-to-word coverage', async () => {
  await assert.rejects(verifyCompactContext(contextConflict(), { ...reply(contextRecognition()),
    text: 'Context Alpha Beta missing' }), /could not verify/);
});

test('expanded context cannot choose between repeated compact core occurrences', async () => {
  const ambiguous = reply([word('Context', .2, .7), word('Alpha', .7, 1.2), word('Beta', 1.2, 1.6),
    word('Alpha', 1.8, 2), word('Beta', 2, 2.2)]);
  await assert.rejects(verifyCompactContext(contextConflict(), ambiguous), /could not verify/);
});

const recordedUnverifiableCores = [
  {
    name: 'Grammar Examples/The', range: [56.04, 62.36], duration: 70,
    reason: 'recognition returned missing, overlapping or invalid timestamps',
    original: [['before,', 55.22, 56.04], ['after,', 56.04, 56.8], ['during.', 56.8, 57.58],
      ['Examples.', 57.66, 58.48], ['The', 58, 58.46], ['robin', 58.46, 58.82], ['sings', 58.82, 59.12],
      ['in', 59.12, 59.34], ['the', 59.34, 59.44], ['morning.', 59.44, 60.24], ['We', 60.24, 60.32],
      ['listen', 60.32, 60.64], ['to', 60.64, 60.82], ['birds', 60.82, 61.1], ['at', 61.1, 61.28],
      ['dawn.', 61.28, 62.36], ['Flowers', 62.36, 62.62]],
    first: [['after,', 0, .7], ['during.', .7, 1.32], ['Examples.', 1.52, 2.3], ['The', 1.86, 2.48],
      ['robin', 2.48, 2.84], ['sings', 2.84, 3.14], ['in', 3.14, 3.32], ['the', 3.32, 3.42],
      ['morning.', 3.42, 4.66], ['We', 3.68, 4.34], ['listen', 4.34, 4.62], ['to', 4.62, 4.82],
      ['birds', 4.82, 5.1], ['at', 5.1, 5.28], ['dawn.', 5.28, 6.26]],
    turbo: [['after,', 0, .6], ['during.', .6, 1.26], ['Examples.', 1.46, 2.36], ['The', 1.94, 2.48],
      ['robin', 2.48, 2.82], ['sings', 2.82, 3.14], ['in', 3.14, 3.34], ['the', 3.34, 3.38],
      ['morning.', 3.38, 3.92], ['We', 3.74, 4.32], ['listen', 4.32, 4.6], ['to', 4.6, 4.78],
      ['birds', 4.78, 5.06], ['at', 5.06, 5.28], ['dawn.', 5.28, 5.94]],
  },
  {
    name: 'Teachers EVS/Protecting', range: [28.56, 33.22], duration: 40,
    reason: 'recognition returned different words',
    original: [['cat.', 26.8, 28.2], ['Link', 29.14, 29.3], ['with', 29.3, 29.56], ['EVS.', 29.56, 30.56],
      ['Protecting', 29.58, 30.24], ['birds.', 30.24, 31.02], ['Not', 31.14, 31.34], ['throwing', 31.34, 31.64],
      ['stones.', 31.64, 32.64], ['Avoiding', 32.64, 32.88], ['loud', 32.88, 33.22], ['crackers', 33.22, 33.6]],
    first: [['Link', .58, .74], ['with', .74, .98], ['EVS.', .98, 1.98], ['Tecting', 1, 1.58],
      ['birds.', 1.58, 2.46], ['Not', 2.58, 2.76], ['throwing', 2.76, 3.08], ['stones.', 3.08, 4.08],
      ['Avoiding', 4.04, 4.32], ['loud', 4.32, 4.74]],
    turbo: [['Link', .56, .7], ['with', .7, .98], ['EVS.', .98, 1.74], ['Tecting', .76, 1.52],
      ['birds.', 1.52, 2.18], ['Not', 2.54, 2.76], ['throwing', 2.76, 3.04], ['stones,', 3.04, 3.8],
      ['avoiding', 3.8, 4.2], ['loud', 4.2, 4.64]],
  },
];

for (const scenario of recordedUnverifiableCores) {
  test(`recorded ${scenario.name} rejects genuinely conflicting core recognitions after all bounded passes`, async () => {
    const original = scenario.original.map(args => word(...args));
    const first = reply(scenario.first.map(args => word(...args))), turbo = reply(scenario.turbo.map(args => word(...args)));
    const f = fixture({ responses: [first, turbo, turbo] });
    const windows = plain(f.context.groqCaptionTimingWindows(original, scenario.duration, true));
    assert.equal(windows.length, 1);
    assert.deepEqual([windows[0].start, windows[0].end], scenario.range);
    await assert.rejects(f.context.verifyGroqCaptionSpeechTimings({ words: original,
      pcm: Buffer.alloc(scenario.duration * 32000), sampleRate: 16000, duration: scenario.duration,
      apiKey: 'fixture-token', compact: true }), error => {
      assert.equal(error.code, 'CAPTION_GROQ_TIMING_UNCERTAIN');
      assert.deepEqual(plain(error.timingIssue), { start: scenario.range[0], end: scenario.range[1], reason: scenario.reason });
      return true;
    });
    assert.equal(f.calls.fetch.length, 3);
    assert.deepEqual(original, scenario.original.map(args => word(...args)), 'Rejected repairs cannot mutate source captions');
    f.assertReleased();
  });
}

async function run(options, overrides = {}, legacy = false) {
  const f = fixture(options);
  const result = plain(await f.invoke(overrides, legacy));
  f.assertReleased();
  return { f, result };
}

function assertTimeline(result) {
  assert.equal(result.ok, true, result.error);
  assert.equal(result.timingSource, 'word');
  for (let index = 0; index < result.words.length; index += 1) {
    const current = result.words[index];
    assert.ok(Number.isFinite(current.start) && Number.isFinite(current.end));
    assert.ok(current.start >= 0 && current.end > current.start && current.end <= result.duration);
    if (index) assert.ok(current.start >= result.words[index - 1].end);
  }
  assert.equal(result.text, result.words.map(item => item.word).join(' '));
}

test('an exact 0.2-second verification overlap shares its boundary at a nonzero source offset', async () => {
  const verified = reply([word('Alpha', 1.8, 2.2), word('Beta', 2, 2.6)]);
  const { f, result } = await run({ duration: 14, responses: [conflict(), verified] });
  assertTimeline(result);
  assert.equal(f.calls.fetch.length, 2);
  assert.ok(Math.abs(result.words[0].end - 10.1) < 1e-9);
  assert.equal(result.words[0].end, result.words[1].start);
});

test('an overlap above the 0.2-second allowance remains invalid through every bounded pass', async () => {
  const invalid = reply([word('Alpha', 1.8, 2.20001), word('Beta', 2, 2.6)]);
  const { f, result } = await run({ duration: 14, responses: [conflict(), invalid, invalid, invalid] });
  assert.equal(result.ok, false);
  assert.match(result.error, /could not verify/);
  assert.equal(f.calls.fetch.length, 4);
  assert.equal(f.calls.progress.some(item => item.value === 100), false);
});

test('an exact 0.35-second final overrun clips to physical audio at a nonzero source offset', async () => {
  const original = reply([word('Alpha', 10, 10.5), word('Beta', 10.2, 10.6)]);
  const verified = reply([word('Alpha', 2.1, 2.7), word('Beta', 2.8, 3.35)]);
  const { f, result } = await run({ duration: 11, responses: [original, verified] });
  assertTimeline(result);
  assert.equal(f.calls.fetch.length, 2);
  assert.equal(result.words[1].end, 11);
});

test('a final overrun above 0.35 seconds is never clipped into verified timing', async () => {
  const original = reply([word('Alpha', 10, 10.5), word('Beta', 10.2, 10.6)]);
  const invalid = reply([word('Alpha', 2.1, 2.7), word('Beta', 2.8, 3.35001)]);
  const { f, result } = await run({ duration: 11, responses: [original, invalid, invalid, invalid] });
  assert.equal(result.ok, false);
  assert.equal(f.calls.fetch.length, 4);
  assert.equal(result.words, undefined);
});

test('word duration at 1.5 seconds stays unchanged while a wider isolated word is checked', async () => {
  for (const [duration, expectedCalls] of [[1.5, 1], [1.50001, 2]]) {
    const original = reply([word('Label', 2, 2 + duration)]);
    const { f, result } = await run({ duration: 8, responses: [original, reply([word('Label', .7, 1.1)])] });
    assertTimeline(result);
    assert.equal(f.calls.fetch.length, expectedCalls);
    if (expectedCalls === 1) assert.deepEqual(result.words, original.words);
  }
});

test('mandatory conflicting timing recovers after each possible transient rejection count', async () => {
  for (let rejectedPasses = 0; rejectedPasses <= 2; rejectedPasses += 1) {
    const responses = [conflict(), ...Array.from({ length: rejectedPasses }, conflict), narrow()];
    const { f, result } = await run({ duration: 14, responses });
    assertTimeline(result);
    assert.equal(f.calls.fetch.length, rejectedPasses + 2);
    assert.deepEqual(result.words, [word('Alpha', 10.1, 10.4), word('Beta', 10.5, 10.8)]);
  }
});

const malformedReplies = [
  ['missing word array', { text: 'Alpha Beta' }],
  ['non-array words', { text: 'Alpha Beta', words: 'Alpha Beta' }],
  ['empty words', { text: 'Alpha Beta', words: [] }],
  ['missing start', reply([{ word: 'Alpha', end: 2.4 }, word('Beta', 2.5, 2.8)])],
  ['missing end', reply([{ word: 'Alpha', start: 2.1 }, word('Beta', 2.5, 2.8)])],
  ['null start', reply([word('Alpha', null, 2.4), word('Beta', 2.5, 2.8)])],
  ['string start', reply([word('Alpha', '2.1', 2.4), word('Beta', 2.5, 2.8)])],
  ['boolean end', reply([word('Alpha', 2.1, true), word('Beta', 2.5, 2.8)])],
  ['negative start', reply([word('Alpha', -.00001, .4), word('Beta', .5, .8)])],
  ['zero duration', reply([word('Alpha', 2.1, 2.1), word('Beta', 2.5, 2.8)])],
  ['reversed duration', reply([word('Alpha', 2.4, 2.1), word('Beta', 2.5, 2.8)])],
  ['backwards words', reply([word('Alpha', 2.5, 2.8), word('Beta', 2.1, 2.4)])],
  ['missing spoken word', reply([word('Alpha', 2.1, 2.4)])],
  ['extra spoken word', reply([word('Alpha', 2.1, 2.4), word('Beta', 2.5, 2.8), word('Extra', 3, 3.2)])],
  ['top-level text disagreement', { ...narrow(), text: 'Alpha Beta Extra' }],
  ['only null word entries', { text: 'Alpha Beta', words: [null, null] }],
  ['only primitive word entries', { text: 'Alpha Beta', words: [42, false, 'Alpha'] }],
];

for (const [label, malformed] of malformedReplies) {
  test(`transient ${label} permits a later complete verified response`, async () => {
    const { f, result } = await run({ duration: 14, responses: [conflict(), malformed, narrow()] });
    assertTimeline(result);
    assert.equal(f.calls.fetch.length, 3);
    assert.equal(result.words.length, 2);
  });
  test(`repeated ${label} fails without exporting partial or original conflicting words`, async () => {
    const { f, result } = await run({ duration: 14, responses: [conflict(), malformed, malformed, malformed] });
    assert.equal(result.ok, false);
    assert.match(result.error, /verify/);
    assert.equal(result.words, undefined);
    assert.equal(f.calls.fetch.length, 4);
    assert.equal(f.calls.progress.some(item => item.value === 100), false);
  });
}

test('empty ASR entries are ignored without losing complete actual word coverage', async () => {
  const verified = { text: 'Alpha Beta', words: [null, word('', .1, .2), ...narrow().words, {}] };
  const { result } = await run({ duration: 14, responses: [conflict(), verified] });
  assertTimeline(result);
  assert.deepEqual(result.words.map(item => item.word), ['Alpha', 'Beta']);
});

test('case, punctuation and compatibility Unicode preserve the original caption spelling', async () => {
  const pairs = [
    ['HELLO!', 'hello'], ['Caf\u00e9', 'Cafe\u0301'], ['\uff21\uff22\uff23', 'ABC'],
    ['InfoKids', 'Info Kids'], ['123', '\uff11\uff12\uff13'], ['Don\u2019t', "don't"],
    ['\u0915\u093f\u0924\u093e\u092c', '\u0915\u093f\u0924\u093e\u092c'],
    ['\u0c15\u0c24\u0c32\u0c41', '\u0c15\u0c24\u0c32\u0c41'],
    ['\u0643\u064e\u062a\u064e\u0628\u064e', '\u0643\u064e\u062a\u064e\u0628\u064e'],
  ];
  for (const [originalText, freshText] of pairs) {
    const original = reply([word(originalText, 2, 4)]);
    const pieces = freshText.split(' ');
    const verified = reply(pieces.map((piece, index) => word(piece, .5 + index * .3, .8 + index * .3)));
    const { f, result } = await run({ duration: 10, responses: [original, verified] });
    assertTimeline(result);
    assert.equal(f.calls.fetch.length, 2);
    assert.equal(result.words[0].word, originalText);
  }
});

test('different Indic or Arabic combining marks are different recognized words', async () => {
  for (const [originalText, changedText] of [
    ['\u0915\u0932', '\u0915\u093e\u0932'],
    ['\u0c15\u0c24', '\u0c15\u0c3e\u0c24'],
    ['\u0643\u064e\u062a\u064e\u0628\u064e', '\u0643\u064f\u062a\u064f\u0628'],
  ]) {
    const original = reply([word(originalText, 2, 4)]);
    const changed = reply([word(changedText, .5, 1)]);
    const { f, result } = await run({ duration: 10, responses: [original, changed, changed] });
    assertTimeline(result);
    assert.equal(f.calls.fetch.length, 3);
    assert.deepEqual(result.words, original.words);
    assert.match(result.warnings.join(' '), /optional/);
    assert.equal(result.timingVerification, undefined);
  }
});

test('ASR token merging groups original caption words into the actual recognized interval', async () => {
  const original = reply([word('Info', 2, 3), word('Kids', 2.5, 4)]);
  const merged = reply([word('InfoKids', .5, 1.5)]);
  const { f, result } = await run({ duration: 10, responses: [original, merged, merged, merged] });
  assertTimeline(result);
  assert.equal(f.calls.fetch.length, 2);
  assert.deepEqual(result.words, [word('Info Kids', .5, 1.5)]);
  assert.equal(result.text, 'Info Kids');
});

test('equal token counts with shifted text boundaries preserve original spelling and real grouped timing', async () => {
  const original = reply([word('InfoKids', 2, 3), word('Time', 2.5, 4), word('Now', 4, 4.4)]);
  const shifted = reply([word('Info', .5, .8), word('KidsTime', .9, 1.5), word('Now', 1.6, 2)]);
  const { f, result } = await run({ duration: 10, responses: [original, shifted] });
  assertTimeline(result);
  assert.equal(f.calls.fetch.length, 2);
  assert.deepEqual(result.words, [word('InfoKids Time', .5, 1.5), word('Now', 1.6, 2)]);
  assert.equal(result.text, 'InfoKids Time Now');
});

const correctionOriginal = () => reply([word('Alpha', 10, 10.6), word('foc', 10.5, 11), word('Omega', 11, 11.4)]);
const correction = shift => reply([word('Alpha', .5 + shift, .8 + shift), word('fox', .9 + shift, 1.35 + shift), word('Omega', 1.4 + shift, 1.9 + shift)]);

test('a one-word correction requires two valid agreeing recognitions with stable surrounding words', async () => {
  const { f, result } = await run({ duration: 14, responses: [correctionOriginal(), correction(0), correction(.1)] });
  assertTimeline(result);
  assert.equal(f.calls.fetch.length, 3);
  assert.deepEqual(result.words.map(item => item.word), ['Alpha', 'fox', 'Omega']);
  assert.match(result.warnings.join(' '), /Two short audio passes confirmed text corrections/);
});

test('an exact 0.25-second correction agreement is inclusive at nonzero audio offsets', async () => {
  const { f, result } = await run({ duration: 14, responses: [correctionOriginal(), correction(0), correction(.25)] });
  assertTimeline(result);
  assert.equal(f.calls.fetch.length, 3);
  assert.equal(result.words[1].word, 'fox');
});

test('a correction beyond 0.25 seconds is accepted only after the third pass agrees with the preceding pass', async () => {
  const { f, result } = await run({ duration: 14, responses: [correctionOriginal(), correction(0), correction(.25001), correction(.25001)] });
  assertTimeline(result);
  assert.equal(f.calls.fetch.length, 4);
  assert.equal(result.words[1].word, 'fox');
});

test('a malformed recognition resets a pending text-correction confirmation', async () => {
  const { f, result } = await run({ duration: 14, responses: [correctionOriginal(), correction(0), { text: 'Alpha fox Omega', words: [] }, correction(0)] });
  assert.equal(result.ok, false);
  assert.equal(f.calls.fetch.length, 4);
  assert.equal(result.words, undefined);
});

test('conflicting corrected words cannot be confirmed by repeated overlapping recognition', async () => {
  const malformed = reply([word('Alpha', .5, 1), word('fox', .7, 1.2), word('Omega', 1.4, 1.9)]);
  const { f, result } = await run({ duration: 14, responses: [correctionOriginal(), malformed, malformed, malformed] });
  assert.equal(result.ok, false);
  assert.equal(f.calls.fetch.length, 4);
});

test('correction allowance cannot rewrite two of three words or a short two-word utterance', async () => {
  for (const [original, changed] of [
    [correctionOriginal(), reply([word('Other', .5, .8), word('fox', .9, 1.35), word('Omega', 1.4, 1.9)])],
    [conflict(), reply([word('Alpha', 2.1, 2.4), word('Other', 2.5, 2.8)])],
  ]) {
    const { result } = await run({ duration: 14, responses: [original, changed, changed, changed] });
    assert.equal(result.ok, false);
    assert.equal(result.words, undefined);
  }
});

test('a broad opening in a conflict must still be narrowed before it is marked verified', async () => {
  const original = reply([word('InfoKids', 0, 6.2), word('Time', 6.1, 6.5)]);
  const stillBroad = reply([word('InfoKids', 0, 6.2), word('Time', 6.2, 6.5)]);
  const { f, result } = await run({ duration: 10, responses: [original, stillBroad, stillBroad, stillBroad] });
  assert.equal(result.ok, false);
  assert.match(result.error, /verify/);
  assert.equal(f.calls.fetch.length, 4);
  assert.equal(result.words, undefined);
});

test('a broad opening conflict recovers when the target word is actually narrow', async () => {
  const original = reply([word('InfoKids', 0, 6.2), word('Time', 6.1, 6.5)]);
  const verified = reply([word('InfoKids', 4.8, 6), word('Time', 6.2, 6.5)]);
  const { result } = await run({ duration: 10, responses: [original, verified] });
  assertTimeline(result);
  assert.equal(result.words[0].start, 4.8);
  assert.equal(result.timingVerification, 'short-audio');
});

test('a merged focused-opening and conflict window retains all targets and three conflict attempts', async () => {
  const original = reply([word('InfoKids', 0, 6.2), word('Time', 6.5, 7), word('Next', 8, 8.6), word('Last', 8.5, 9)]);
  const valid = reply([word('InfoKids', 4.7, 5.7), word('Time', 6.5, 7), word('Next', 8, 8.5), word('Last', 8.6, 9)]);
  const { f, result } = await run({ duration: 12, responses: [original, { words: [] }, { words: [] }, valid] });
  assertTimeline(result);
  assert.equal(f.calls.fetch.length, 4);
  assert.equal(result.verifiedTimingWindows, 1);
  assert.deepEqual(result.words.map(item => item.word), original.words.map(item => item.word));
});

test('conflict windows extend around whole neighboring words and upload exact physical PCM samples', async () => {
  const original = reply([word('Before', 8.9, 9.3), word('Alpha', 11.1, 11.8), word('Beta', 11.7, 12.2), word('After', 14.5, 14.9)]);
  const valid = reply([word('Before', .2, .6), word('Alpha', 2.4, 3), word('Beta', 3.1, 3.5), word('After', 5.8, 6.2)]);
  const options = { duration: 16, responses: [original, valid] };
  const f = fixture(options);
  const pcm = Buffer.alloc(16 * 32000);
  for (let sample = 0; sample < pcm.length / 2; sample += 1) pcm.writeInt16LE((sample * 17) % 32767, sample * 2);
  options.wav = f.context.buildWavChunkBuffer(pcm);
  const result = plain(await f.invoke());
  f.assertReleased();
  assertTimeline(result);
  const windows = plain(f.context.groqCaptionTimingWindows(original.words, 16));
  assert.equal(windows.length, 1);
  const upload = Buffer.from(await f.calls.fetch[1].init.body.get('file').arrayBuffer());
  assert.deepEqual(upload.subarray(44), pcm.subarray(Math.floor(windows[0].start * 16000) * 2, Math.ceil(windows[0].end * 16000) * 2));
  assert.ok(result.words.every(item => item.end <= 16));
});

test('invalid response on the third conflict recognition still supports real IPC cancellation', async () => {
  const f = fixture({ duration: 14, responses: [conflict(), conflict(), conflict()], pendingRequestAt: 4 });
  const pending = f.invoke();
  await f.requested;
  for (let attempt = 0; attempt < 8 && f.calls.fetch.length < 4; attempt += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.fetch.length, 4);
  const busy = plain(await f.invoke({}, true));
  assert.equal(busy.code, 'CAPTION_TRANSCRIPTION_BUSY');
  await f.cancel();
  const result = plain(await pending);
  f.assertReleased();
  assert.equal(result.cancelled, true);
  assert.equal(f.calls.fetch[3].init.signal.aborted, true);
  assert.equal(f.calls.fetch.length, 4);
  assert.equal(f.calls.progress.some(item => item.value === 100), false);
});

test('cancellation during the final confirming correction JSON cannot publish captions', async () => {
  const { f, result } = await run({ duration: 14, responses: [correctionOriginal(), correction(0), correction(0)], cancelAtJsonRequest: 3 });
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal(f.calls.fetch.length, 3);
  assert.equal(f.calls.progress.some(item => item.value === 100), false);
});

test('cancellation during the additional focused-opening pass keeps the job guard and request bound', async () => {
  const original = reply([word('InfoKids', 0, 6.26)]);
  const broad = reply([word('InfoKids', .02, 6.18)]);
  const first = reply([word('InfoKids', .54, 1.92)]);
  const second = reply([word('InfoKids', 1.1, 2.4)]);
  const f = fixture({ duration: 10, responses: [original, broad, broad, first, second], pendingRequestAt: 6 });
  const pending = f.invoke();
  await f.requested;
  for (let attempt = 0; attempt < 8 && f.calls.fetch.length < 6; attempt += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.fetch.length, 6);
  assert.equal((await f.invoke()).code, 'CAPTION_TRANSCRIPTION_BUSY');
  await f.cancel();
  const result = plain(await pending);
  f.assertReleased();
  assert.equal(result.cancelled, true);
  assert.equal(f.calls.fetch[5].init.signal.aborted, true);
  assert.equal(f.calls.fetch.length, 6);
});

test('exact 0.25-second focused agreement is measured on absolute audio timing', async () => {
  const original = reply([word('InfoKids', 0, 6.26)]);
  const broad = reply([word('InfoKids', .02, 6.18)]);
  const first = reply([word('InfoKids', .54, 1.92)]);
  const shiftedCrop = reply([word('InfoKids', 1.04, 2.42)]);
  const { f, result } = await run({ duration: 10, responses: [original, broad, broad, first, shiftedCrop] });
  assertTimeline(result);
  assert.equal(f.calls.fetch.length, 5);
  assert.ok(Math.abs(result.words[0].start - 5.05) < 1e-9);
  assert.ok(Math.abs(result.words[0].end - 6.43) < 1e-9);
});

test('eight independent focused windows may use all sixteen verification requests successfully', async () => {
  const words = Array.from({ length: 8 }, (_, index) => word('Label' + index, 5 + index * 6, 7 + index * 6));
  const responses = [reply(words)];
  for (let index = 0; index < 8; index += 1) responses.push(reply([word('Wrong', .7, 1.1)]), reply([word('Label' + index, .7, 1.1)]));
  const { f, result } = await run({ duration: 60, responses });
  assertTimeline(result);
  assert.equal(result.verifiedTimingWindows, 8);
  assert.equal(f.calls.fetch.length, 17);
  assert.equal(result.words.length, 8);
});

test('mixed conflict retries stop at sixteen verification requests before a seventeenth paid request', async () => {
  const words = [], responses = [];
  for (let index = 0; index < 6; index += 1) {
    const origin = 5 + index * 35;
    words.push(word('Alpha' + index, origin, origin + .8), word('Beta' + index, origin + .6, origin + 1.2));
    if (index < 5) words.push(word('Spacer' + index, origin + 32, origin + 32.2));
    responses.push({ words: [] }, { words: [] }, reply([word('Alpha' + index, 2.1, 2.4), word('Beta' + index, 2.5, 2.8)]));
  }
  const { f, result } = await run({ duration: 210, responses: [reply(words), ...responses] });
  assert.equal(result.ok, false);
  assert.match(result.error, /request limit/);
  assert.equal(f.calls.fetch.length, 17);
  assert.equal(result.words, undefined);
  assert.equal(f.calls.progress.some(item => item.value === 100), false);
});

test('separate adjacent conflict pairs retain their independent bounded audio contexts', () => {
  const f = fixture();
  const words = [];
  for (let index = 0; index < 6; index += 1) {
    const origin = 5 + index * 35;
    words.push(word('Alpha' + index, origin, origin + .8), word('Beta' + index, origin + .6, origin + 1.2));
  }
  const windows = plain(f.context.groqCaptionTimingWindows(words, 210));
  assert.equal(windows.length, 6);
  for (let index = 0; index < windows.length; index += 1) {
    assert.deepEqual(windows[index].core, [index * 2, index * 2 + 1]);
    assert.ok(windows[index].end - windows[index].start <= 60);
  }
  assert.equal(f.calls.fetch.length, 0);
  f.assertReleased();
});

test('a broad conflict window can recover through a compact source-audio check after three rejected passes', async () => {
  const invalid = { text: 'Alpha Beta', words: [] };
  const original = conflict();
  const options = { duration: 40, responses: [original, invalid, invalid, invalid] };
  const f = fixture(options);
  const broad = plain(f.context.groqCaptionTimingWindows(original.words, 40))[0];
  const compact = plain(f.context.groqCaptionTimingWindows(original.words, 40, true))[0];
  const offset = Math.floor(compact.start * 16000) / 16000;
  options.responses.push(reply([word('Alpha', 10.1 - offset, 10.4 - offset), word('Beta', 10.5 - offset, 10.8 - offset)]));
  const pcm = Buffer.alloc(40 * 32000);
  for (let sample = 0; sample < pcm.length / 2; sample += 1) pcm.writeInt16LE((sample * 31) % 32767, sample * 2);
  options.wav = f.context.buildWavChunkBuffer(pcm);
  const result = plain(await f.invoke());
  f.assertReleased();
  assertTimeline(result);
  assert.equal(f.calls.fetch.length, 5);
  assert.deepEqual(result.words, [word('Alpha', 10.1, 10.4), word('Beta', 10.5, 10.8)]);
  for (const [index, window] of [[1, broad], [2, broad], [3, broad], [4, compact]]) {
    const upload = Buffer.from(await f.calls.fetch[index].init.body.get('file').arrayBuffer());
    assert.deepEqual(upload.subarray(44), pcm.subarray(Math.floor(window.start * 16000) * 2, Math.ceil(window.end * 16000) * 2));
  }
  assert.equal(compact.end - compact.start, 4.5);
  assert.equal(result.timingVerification, 'short-audio');
  assert.equal(f.calls.progress.at(-1).value, 100);
});

test('persistently malformed broad and compact recognition remains a bounded explicit failure', async () => {
  const invalid = { text: 'Alpha Beta', words: [] };
  const { f, result } = await run({ duration: 40, responses: [conflict()], response: invalid });
  assert.equal(result.ok, false);
  assert.match(result.error, /could not verify/);
  assert.equal(result.words, undefined);
  assert.equal(f.calls.fetch.length, 7);
  assert.equal(f.calls.progress.some(item => item.value === 100), false);
  const compact = plain(f.context.groqCaptionTimingWindows(conflict().words, 40, true))[0];
  const final = Buffer.from(await f.calls.fetch.at(-1).init.body.get('file').arrayBuffer());
  assert.equal(final.length - 44, (Math.ceil(compact.end * 16000) - Math.floor(compact.start * 16000)) * 2);
  assert.equal(compact.end - compact.start, 4.5);
});

test('compact fallback preserves already grouped tokens and keeps progress monotonic', async () => {
  const original = reply([word('Info', 2, 3), word('Kids', 2.5, 4), word('Alpha', 45, 45.8), word('Beta', 45.6, 46.2)]);
  const merged = reply([word('InfoKids', .5, 1.5)]);
  const invalid = { words: [] };
  const compact = reply([word('Alpha', 1.1, 1.4), word('Beta', 1.5, 1.8)]);
  const { f, result } = await run({ duration: 80, responses: [original, merged, invalid, invalid, invalid, compact] });
  assertTimeline(result);
  assert.equal(f.calls.fetch.length, 6);
  assert.deepEqual(result.words, [word('Info Kids', .5, 1.5), word('Alpha', 45.1, 45.4), word('Beta', 45.5, 45.8)]);
  assert.equal(result.text, 'Info Kids Alpha Beta');
  const progress = f.calls.progress.map(item => item.value);
  assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]));
  assert.ok(progress.includes(89), 'Earlier completed verification reports progress before fallback');
  assert.equal(progress.at(-1), 100);
});

test('overlapping compact contexts cannot resurrect a token already grouped by earlier recognition', async () => {
  const words = [word('A', 1, 2), word('B', 1.8, 2.5), word('C', 3, 3.5), word('D', 4, 4.4), word('E', 4.2, 4.7)];
  const first = reply([word('A', 1, 1.8), word('BC', 1.8, 2.9)]);
  const duplicate = reply([word('C', .2, .5), word('D', 1, 1.3), word('E', 1.3, 1.7)]);
  const f = fixture({ responses: [first, duplicate, duplicate, duplicate] });
  await assert.rejects(f.context.verifyGroqCaptionSpeechTimings({ words, pcm: Buffer.alloc(8 * 32000), sampleRate: 16000,
    duration: 8, apiKey: 'fixture-token', compact: true }), /could not verify/);
  assert.ok(f.calls.fetch.length >= 3 && f.calls.fetch.length <= 16);
  const firstWindow = plain(f.context.groqCaptionTimingWindows(words, 8, true))[0];
  const upload = Buffer.from(await f.calls.fetch[0].init.body.get('file').arrayBuffer());
  assert.equal(upload.length - 44, (Math.ceil(firstWindow.end * 16000) - Math.floor(firstWindow.start * 16000)) * 2);
  f.assertReleased();
});

test('compact repair preserves previously grouped context while repairing its owned words', async () => {
  const words = [word('A', 1, 2), word('B', 1.8, 2.5), word('C', 3, 3.5), word('D', 4, 4.4), word('E', 4.2, 4.7)];
  const merged = reply([word('A', 1, 1.8), word('BC', 3, 3.4), word('D', 4, 4.2), word('E', 4.4, 4.7)]);
  const corrected = reply([word('B X', .1, .5), word('D', 1, 1.3), word('E', 1.4, 1.7)]);
  const f = fixture({ responses: [merged, corrected, corrected] });
  const result = plain(await f.context.verifyGroqCaptionSpeechTimings({ words, pcm: Buffer.alloc(8 * 32000), sampleRate: 16000,
    duration: 8, apiKey: 'fixture-token', compact: true }));
  assert.equal(result.words.map(item => item.word).join(' '), 'A B C D E');
  assert.deepEqual(result.words.find(item => item.word === 'B C'), word('B C', 3, 3.4));
  assert.ok(f.calls.fetch.length <= 3);
  f.assertReleased();
});

test('thirteen independent compact conflict windows share the sixteen-request budget successfully', async () => {
  const words = [], responses = [];
  for (let index = 0; index < 13; index += 1) {
    const origin = 5 + index * 5;
    words.push(word('Alpha' + index, origin, origin + .8), word('Beta' + index, origin + .6, origin + 1.2));
    responses.push(reply([word('Alpha' + index, 1.1, 1.4), word('Beta' + index, 1.5, 1.8)]));
  }
  const invalid = { words: [] };
  const { f, result } = await run({ duration: 80, responses: [reply(words), invalid, invalid, invalid, ...responses] });
  assertTimeline(result);
  assert.equal(f.calls.fetch.length, 17);
  assert.equal(result.verifiedTimingWindows, 13);
  assert.equal(result.words.length, 26);
  assert.equal(f.context.groqCaptionTimingWindows(words, 80, true).length, 13);
});

test('a fourteenth compact window cannot exceed the shared sixteen-request verification budget', async () => {
  const words = [], responses = [];
  for (let index = 0; index < 14; index += 1) {
    const origin = 5 + index * 5;
    words.push(word('Alpha' + index, origin, origin + .8), word('Beta' + index, origin + .6, origin + 1.2));
    responses.push(reply([word('Alpha' + index, 1.1, 1.4), word('Beta' + index, 1.5, 1.8)]));
  }
  const invalid = { words: [] };
  const { f, result } = await run({ duration: 80, responses: [reply(words), invalid, invalid, invalid, ...responses] });
  assert.equal(result.ok, false);
  assert.match(result.error, /request limit/);
  assert.equal(f.calls.fetch.length, 17);
  assert.equal(result.words, undefined);
  assert.equal(f.calls.progress.some(item => item.value === 100), false);
});

test('real IPC cancellation aborts compact fallback while preserving its shared job guard', async () => {
  const invalid = { words: [] };
  const f = fixture({ duration: 40, responses: [conflict(), invalid, invalid, invalid], pendingRequestAt: 5 });
  const pending = f.invoke();
  await f.requested;
  for (let attempt = 0; attempt < 8 && f.calls.fetch.length < 5; attempt += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.fetch.length, 5);
  assert.equal((await f.invoke({}, true)).code, 'CAPTION_TRANSCRIPTION_BUSY');
  await f.cancel();
  const result = plain(await pending);
  f.assertReleased();
  assert.equal(result.cancelled, true);
  assert.equal(f.calls.fetch[4].init.signal.aborted, true);
  assert.equal(f.calls.fetch.length, 5);
  assert.equal(f.calls.progress.some(item => item.value === 100), false);
});

test('compact window count permits sixteen independent cores and rejects seventeen before any request', () => {
  const f = fixture();
  const independent = count => Array.from({ length: count }, (_, index) => {
    const origin = 5 + index * 5;
    return [word('Alpha' + index, origin, origin + .8), word('Beta' + index, origin + .6, origin + 1.2)];
  }).flat();
  assert.equal(f.context.groqCaptionTimingWindows(independent(16), 90, true).length, 16);
  assert.throws(() => f.context.groqCaptionTimingWindows(independent(17), 95, true), /too many uncertain/);
  assert.equal(f.calls.fetch.length, 0);
  f.assertReleased();
});

test('compact end context is added once and closes whole neighbors without chaining more padding', () => {
  const f = fixture();
  const words = [word('Alpha', 10, 10.8), word('Beta', 10.6, 11.2), word('FirstNeighbor', 12.9, 13.3),
    word('SecondNeighbor', 13.7, 14.1), word('Following', 14.1, 14.5)];
  const windows = plain(f.context.groqCaptionTimingWindows(words, 18, true));
  assert.equal(windows.length, 1);
  assert.equal(windows[0].start, 9);
  assert.equal(windows[0].end, 14.1);
  assert.deepEqual(windows[0].core, [0, 1]);
  assert.equal(f.calls.fetch.length, 0);
  f.assertReleased();
});

test('window-count and sixty-second bounds are checked before any repair request', () => {
  const f = fixture();
  const isolated = count => Array.from({ length: count }, (_, index) => word('Label' + index, 5 + index * 6, 7 + index * 6));
  assert.equal(f.context.groqCaptionTimingWindows(isolated(8), 60).length, 8);
  assert.throws(() => f.context.groqCaptionTimingWindows(isolated(9), 65), /too many uncertain/);
  const boundary = [word('Alpha', 2, 55), word('Beta', 54, 56)];
  assert.equal(f.context.groqCaptionTimingWindows(boundary, 90)[0].end, 60);
  assert.throws(() => f.context.groqCaptionTimingWindows([word('Alpha', 2, 55), word('Beta', 54, 56.00001)], 90), /short audio window/);
  assert.equal(f.calls.fetch.length, 0);
  f.assertReleased();
});

test('sequential failed, successful, cancelled and legacy jobs release the shared IPC state', async () => {
  const options = { duration: 14, responses: [conflict(), conflict(), conflict(), conflict(), reply([word('Clean', 1, 1.2)])] };
  const f = fixture(options);
  assert.equal((await f.invoke()).ok, false);
  f.assertReleased();
  assert.equal((await f.invoke()).ok, true);
  f.assertReleased();
  options.cancelAtJsonRequest = 6;
  const cancelled = await f.invoke();
  assert.equal(cancelled.cancelled, true);
  f.assertReleased();
  options.cancelAtJsonRequest = undefined;
  const result = plain(await f.invoke({}, true));
  assertTimeline(result);
  f.assertReleased();
  assert.equal(f.calls.spawn.length, 4);
});

test('deterministic stress covers 120 varied offsets, token spellings and transient rejection paths', async () => {
  let seed = 0x51c0ffee;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let scenario = 0; scenario < 120; scenario += 1) {
    const origin = 4 + Math.floor(random() * 20);
    const duration = origin + 4 + Math.floor(random() * 8);
    const original = reply([word('ALPHA!', origin, origin + .8), word('Beta', origin + .6, origin + 1.2)]);
    const rejected = Math.floor(random() * 3);
    const localStart = 1.5 + Math.floor(random() * 5) / 10;
    const valid = reply([word('alpha', localStart, localStart + .3), word('BETA.', localStart + .4, localStart + .8)]);
    const invalid = scenario % 3 === 0 ? { text: 'alpha beta', words: [] }
      : scenario % 3 === 1 ? reply([word('other', localStart, localStart + .3), word('Beta', localStart + .4, localStart + .8)])
        : reply([word('alpha', localStart, localStart + .3), word('Beta', localStart + .05, localStart + .8)]);
    const { f, result } = await run({ duration, responses: [original, ...Array.from({ length: rejected }, () => invalid), valid] });
    assertTimeline(result);
    assert.equal(f.calls.fetch.length, rejected + 2, 'scenario ' + scenario);
    assert.deepEqual(result.words.map(item => item.word), ['ALPHA!', 'Beta']);
    assert.ok(Math.abs(result.words[0].start - (origin - 2 + localStart)) < 1e-8);
    assert.equal(result.verifiedTimingWindows, 1);
  }
});
