'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'caption', 'caption-tools.ts'), 'utf8');
const names = ['parseSubtitleFile', 'serializeSubtitles', 'inspectCaptionQuality', 'shiftCaptionTiming',
  'scaleCaptionTiming', 'replaceCaptionText', 'fitLyricsToCaptions', 'splitCaption', 'mergeCaptionWithNext'];
const production = stripTypeScriptTypes(source).replace(/^export\s+/gm, '');
const tools = vm.runInNewContext(production + `\n({${names.join(',')}})`, {});
const plain = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function timedCue(texts, start = 1, wordLength = 0.4, gap = 0.1) {
  const words = texts.map((text, index) => ({ text, start: start + index * (wordLength + gap), end: start + index * (wordLength + gap) + wordLength }));
  return { start: words[0].start, end: words.at(-1).end, text: texts.join(' '), words };
}

test('SRT imports CRLF, BOM, numbered cues, multiline Unicode and literal markup', () => {
  const input = '\uFEFF1\r\n00:00:01,250 --> 00:00:03,000\r\nతెలుగు జింగిల్\r\nहिन्दी bells ♪\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\n<script>alert(1)</script>\r\n';
  const captions = tools.parseSubtitleFile(input, 'srt');
  assert.deepEqual(plain(captions), [
    { start: 1.25, end: 3, text: 'తెలుగు జింగిల్\nहिन्दी bells ♪' },
    { start: 4, end: 5, text: '<script>alert(1)</script>' },
  ]);
  assert.deepEqual(plain(tools.parseSubtitleFile(tools.serializeSubtitles(captions, 'srt'), 'srt')), plain(captions));
});

test('VTT imports cue IDs and settings, ignores metadata, and preserves multiple lines', () => {
  const input = 'WEBVTT generated subtitles\n\nNOTE this is metadata\nnot a cue\n\nSTYLE\n::cue { color: yellow; }\n\nREGION\nid:region1\n\nchorus-1\n00:01.200 --> 00:03.400 line:90% position:50% align:center\nJingle bells\nజింగిల్ బెల్స్\n\n00:00:05.000 --> 00:00:06.000\nAgain\n';
  const captions = tools.parseSubtitleFile(input, 'vtt');
  assert.deepEqual(plain(captions), [{ start: 1.2, end: 3.4, text: 'Jingle bells\nజింగిల్ బెల్స్' }, { start: 5, end: 6, text: 'Again' }]);
  assert.deepEqual(plain(tools.parseSubtitleFile(tools.serializeSubtitles(captions, 'vtt'), 'vtt')), plain(captions));
});

test('VTT accepts common exported header metadata and keeps local cue times', () => {
  const input = 'WEBVTT\nKind: captions\nLanguage: en\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0\n\nchorus\n00:01.000 --> 00:02.000\nJingle bells';
  assert.deepEqual(plain(tools.parseSubtitleFile(input, 'vtt')), [{ start: 1, end: 2, text: 'Jingle bells' }]);
});

test('JSON round-trip keeps exact cue/word timing and blank multiline Unicode', () => {
  const captions = freeze([{ ...timedCue(['హాయ్', 'Hello']), text: 'హాయ్\n\nHello' }]);
  const serialized = tools.serializeSubtitles(captions, 'json');
  assert.deepEqual(plain(tools.parseSubtitleFile(serialized, 'json')), plain(captions));
  assert.deepEqual(plain(tools.parseSubtitleFile(JSON.stringify(captions), 'json')), plain(captions));
  assert.deepEqual(Object.keys(JSON.parse(serialized)), ['version', 'captions']);
  assert.throws(() => tools.serializeSubtitles(captions, 'srt'), /blank lines/);
});

test('JSON import copies only caption data and does not retain unknown object fields', () => {
  const captions = tools.parseSubtitleFile('[{"start":0,"end":1,"text":"safe","__proto__":{"polluted":true},"html":"<script>"}]', 'json');
  assert.deepEqual(plain(captions), [{ start: 0, end: 1, text: 'safe' }]);
  assert.equal({}.polluted, undefined);
});

test('JSON drafts preserve valid cue colors while unsafe or unsupported color values are ignored', () => {
  const captions = freeze([{ ...timedCue(['One', 'two']), colorOverride: '#12AbEf' }]);
  assert.deepEqual(plain(tools.parseSubtitleFile(tools.serializeSubtitles(captions, 'json'), 'json')), plain(captions));
  for (const colorOverride of ['red', '#fff', '#123456" onmouseover="alert(1)', { html: 'unsafe' }, 123]) {
    const parsed = tools.parseSubtitleFile(JSON.stringify([{ start: 0, end: 1, text: 'Safe', colorOverride }]), 'json');
    assert.equal(parsed[0].colorOverride, undefined);
  }
});

test('bad imports reject the entire file, including invalid later cues and word times', () => {
  for (const input of [
    '1\n00:00:02,000 --> 00:00:01,000\nBackwards',
    '1\n00:60:00,000 --> 01:00:01,000\nInvalid minute',
    '1\n00:00:01,000 --> 00:00:02,000\nGood\n\n2\nnot a time\nBad',
    '1\n00:00:01,000 --> 00:00:02,000',
    'bad number\n00:00:01,000 --> 00:00:02,000\nHello',
    '1\n00:00:01,000 --> 00:00:02,000 settings:bad\nHello',
  ]) assert.throws(() => tools.parseSubtitleFile(input, 'srt'));
  assert.throws(() => tools.parseSubtitleFile('00:01.000 --> 00:02.000\nHello', 'vtt'), /WEBVTT/);
  assert.throws(() => tools.parseSubtitleFile('WEBVTT\n\n00:01.000 --> 00:02.000 nonsense\nHello', 'vtt'), /settings/);
  for (const cues of [
    [{ start: -1, end: 1, text: 'Negative' }], [{ start: 1, end: 1, text: 'Collapsed' }],
    [{ start: '1', end: 2, text: 'String' }], [{ start: 1, end: 2, text: ' ' }],
    [{ start: 1, end: 2, text: 'Hello', words: [{ start: 0, end: 1.5, text: 'Hello' }] }],
    [{ start: 1, end: 2, text: 'Hello', words: [{ start: 1, end: 1, text: 'Hello' }] }],
    [{ start: 1, end: 2, text: 'Hello', words: {} }],
  ]) assert.throws(() => tools.parseSubtitleFile(JSON.stringify(cues), 'json'));
  assert.throws(() => tools.parseSubtitleFile('{oops}', 'json'), /valid JSON/);
  assert.throws(() => tools.parseSubtitleFile('x'.repeat(2_000_001), 'srt'), /smaller/);
  assert.throws(() => tools.parseSubtitleFile('', 'srt'), /empty/);
});

test('serialization rejects nonfinite/collapsed input and millisecond collapse', () => {
  for (const time of [NaN, Infinity, -1]) assert.throws(() => tools.serializeSubtitles([{ start: time, end: 2, text: 'Hello' }], 'srt'));
  assert.throws(() => tools.serializeSubtitles([{ start: 1, end: 1.0001, text: 'Hello' }], 'srt'), /millisecond/);
  assert.match(tools.serializeSubtitles([{ start: 59.9996, end: 61, text: 'Carry' }], 'srt'), /00:01:00,000 --> 00:01:01,000/);
});

test('shift and anchored scale copy caption and word timing without mutating inputs', () => {
  const captions = freeze([timedCue(['Jingle', 'bells'], 2)]);
  const before = JSON.stringify(captions);
  const shifted = tools.shiftCaptionTiming(captions, 0.25, 10);
  assert.equal(shifted[0].start, 2.25);
  assert.equal(shifted[0].words[1].start, 2.75);
  const scaled = tools.scaleCaptionTiming(captions, 2, 2, 10);
  assert.equal(scaled[0].start, 2);
  assert.equal(scaled[0].words[1].start, 3);
  assert.equal(scaled[0].end, 3.8);
  assert.notEqual(shifted[0], captions[0]);
  assert.notEqual(shifted[0].words[0], captions[0].words[0]);
  assert.equal(JSON.stringify(captions), before);
});

test('timing edits reject atomically when a cue leaves zero or video end', () => {
  const captions = freeze([timedCue(['One', 'two'], 0), timedCue(['Three', 'four'], 8)]);
  const before = JSON.stringify(captions);
  assert.throws(() => tools.shiftCaptionTiming(captions, -0.1, 10), /nonnegative/);
  assert.throws(() => tools.shiftCaptionTiming(captions, 2, 10), /beyond/);
  assert.throws(() => tools.scaleCaptionTiming(captions, 2, 0, 10), /beyond/);
  assert.throws(() => tools.scaleCaptionTiming(captions, 2, 1, 10), /nonnegative/);
  for (const factor of [0, -1, NaN, Infinity]) assert.throws(() => tools.scaleCaptionTiming(captions, factor));
  assert.throws(() => tools.shiftCaptionTiming(captions, Infinity));
  assert.throws(() => tools.shiftCaptionTiming(captions, 0, 0));
  assert.equal(JSON.stringify(captions), before);
});

test('shift, scale, replacement and split retain supported cue colors; merge inherits the first cue color', () => {
  const captions = freeze([{ ...timedCue(['One', 'two'], 1), colorOverride: '#112233' }]);
  assert.equal(tools.shiftCaptionTiming(captions, 1, 10)[0].colorOverride, '#112233');
  assert.equal(tools.scaleCaptionTiming(captions, 2, 0, 10)[0].colorOverride, '#112233');
  assert.equal(tools.replaceCaptionText(captions, 'two', 'three')[0].colorOverride, '#112233');
  assert.equal(tools.replaceCaptionText(captions, 'two', 'three four')[0].colorOverride, '#112233');
  const split = tools.splitCaption(captions, 0, 1.4);
  assert.ok(split.every(cue => cue.colorOverride === '#112233'));
  const recolored = split.map((cue, index) => ({ ...cue, colorOverride: index ? '#aabbcc' : cue.colorOverride }));
  assert.equal(tools.mergeCaptionWithNext(recolored, 0)[0].colorOverride, '#112233');
});

test('literal find/replace handles regex characters, case and dollar replacements', () => {
  const captions = freeze([{ start: 0, end: 2, text: 'Jingle JINGLE [bells] $1' }]);
  assert.equal(tools.replaceCaptionText(captions, 'jingle', 'Bells')[0].text, 'Bells Bells [bells] $1');
  assert.equal(tools.replaceCaptionText(captions, 'Jingle', 'Bells', true)[0].text, 'Bells JINGLE [bells] $1');
  assert.equal(tools.replaceCaptionText(captions, '[bells]', '$&')[0].text, 'Jingle JINGLE $& $1');
  assert.throws(() => tools.replaceCaptionText(captions, '', 'anything'), /nonempty/);
});

test('replace retains one-for-one word timing and removes stale timing for changed word counts', () => {
  const captions = freeze([timedCue(['Jingle', 'bells'])]);
  const original = JSON.stringify(captions);
  const one = tools.replaceCaptionText(captions, 'bells', 'Bells!');
  assert.deepEqual(plain(one[0].words[1]), { text: 'Bells!', start: 1.5, end: 1.9 });
  const two = tools.replaceCaptionText(captions, 'bells', 'bells ring');
  assert.equal(two[0].text, 'Jingle bells ring');
  assert.equal(two[0].words, undefined);
  assert.equal(two[0].start, captions[0].start);
  assert.equal(JSON.stringify(captions), original);
  assert.throws(() => tools.replaceCaptionText([{ start: 0, end: 1, text: 'Only' }], 'Only', ''), /no caption text/);
});

test('quality scan reports timing, word errors, readability, gaps and duration without claiming missing speech', () => {
  const captions = [
    { start: 3, end: 3.1, text: 'Extremely fast caption with lots of words', words: [{ start: 3, end: 3, text: 'Extremely' }] },
    { start: 3.05, end: 4, text: 'Overlap' },
    { start: 8, end: 12, text: 'Beyond', words: [{ start: 7, end: 13, text: 'Different' }] },
  ];
  const issues = tools.inspectCaptionQuality(captions, 10);
  for (const kind of ['gap', 'too-fast', 'invalid-word-timing', 'overlap', 'beyond-duration', 'word-outside-cue', 'word-text-mismatch']) assert.ok(issues.some(issue => issue.kind === kind), kind);
  for (const issue of issues.filter(issue => issue.kind === 'gap')) assert.match(issue.message, /may be music or silence/);
  assert.ok(issues.every(issue => ['warning', 'error'].includes(issue.severity) && Number.isFinite(issue.start)));
});

test('quality scan tolerates malformed word data so the editor can explain it', () => {
  assert.ok(tools.inspectCaptionQuality([{ start: 0, end: 2, text: 'Hello', words: [null, { start: 0, end: 1 }] }]).some(issue => issue.kind === 'invalid-word-timing'));
  assert.ok(tools.inspectCaptionQuality([{ start: NaN, end: 1, text: '' }]).some(issue => issue.kind === 'invalid-timing'));
  assert.ok(tools.inspectCaptionQuality([{ start: 0, end: 1, text: 'Hello' }], NaN).some(issue => issue.kind === 'invalid-duration'));
});

test('split snaps to a real word boundary and merge preserves words and intentional gaps', () => {
  const cue = timedCue(['Jingle', 'bells', 'jingle', 'bells'], 1, 0.2, 0.8);
  const captions = freeze([cue]);
  const before = JSON.stringify(captions);
  const split = tools.splitCaption(captions, 0, 2.9);
  assert.equal(split.length, 2);
  assert.equal(split[0].end, 3);
  assert.equal(split[1].start, 3);
  assert.equal(split[0].text, 'Jingle bells');
  assert.deepEqual(plain([...split[0].words, ...split[1].words]), plain(cue.words));
  assert.equal(split[0].words[1].end, 2.2);
  const merged = tools.mergeCaptionWithNext(split, 0);
  assert.deepEqual(plain(merged[0].words), plain(cue.words));
  assert.equal(merged[0].text, 'Jingle bells\njingle bells');
  assert.equal(JSON.stringify(captions), before);
});

test('split estimated cues uses proportional token boundaries and preserves multiline text', () => {
  const captions = freeze([{ start: 0, end: 8, text: 'One two\nమూడు four' }]);
  const split = tools.splitCaption(captions, 0, 4.1);
  assert.deepEqual(plain(split), [{ start: 0, end: 4, text: 'One two' }, { start: 4, end: 8, text: 'మూడు four' }]);
  assert.throws(() => tools.splitCaption(captions, 0, 0), /inside/);
  assert.throws(() => tools.splitCaption([{ start: 0, end: 1, text: 'One' }], 0, 0.5), /two words/);
  assert.throws(() => tools.splitCaption([{ ...timedCue(['One', 'two']), text: 'Edited' }], 0, 1.2));
  assert.throws(() => tools.mergeCaptionWithNext([{ start: 0, end: 2, text: 'One' }, { start: 1, end: 3, text: 'two' }], 0), /overlapping/);
  assert.throws(() => tools.mergeCaptionWithNext(captions, 0), /following/);
});

test('lyric fit keeps exact matched timing and estimates missing lyrics between anchors', () => {
  const captions = freeze([{ start: 0, end: 6, text: 'Jingle sings', words: [{ text: 'Jingle', start: 1, end: 1.4 }, { text: 'sings', start: 4, end: 4.5 }] }]);
  const before = JSON.stringify(captions);
  const result = tools.fitLyricsToCaptions(captions, 'Oh Jingle bells sings now', 6);
  assert.equal(result.matchedWords, 2);
  assert.equal(result.totalWords, 5);
  assert.equal(result.estimatedWords, 3);
  const words = result.captions.flatMap(cue => cue.words);
  assert.deepEqual(plain(words[1]), { text: 'Jingle', start: 1, end: 1.4 });
  assert.deepEqual(plain(words[3]), { text: 'sings', start: 4, end: 4.5 });
  assert.equal(words[0].start, 0);
  assert.equal(words.at(-1).end, 6);
  assert.ok(words.every((word, index) => word.end > word.start && (!index || word.start >= words[index - 1].end)));
  assert.match(result.warnings.join(' '), /does not listen.*acoustic forced alignment/);
  assert.equal(JSON.stringify(captions), before);
});

test('repeated choruses align monotonically and warn about ambiguity', () => {
  const captions = freeze([timedCue(['Jingle', 'bells'], 1), timedCue(['Jingle', 'bells'], 8)]);
  const result = tools.fitLyricsToCaptions(captions, 'Jingle bells\nJingle bells', 10);
  assert.equal(result.matchedWords, 4);
  assert.equal(result.estimatedWords, 0);
  assert.equal(result.captions.length, 2);
  assert.equal(result.captions[1].words[0].start, 8);
  assert.equal(result.captions[1].words[1].start, 8.5);
  assert.match(result.warnings.join(' '), /wrong chorus/);
});

test('Indic marks and punctuation normalize while supplied lyric text stays intact', () => {
  const captions = freeze([timedCue(['జింగిల్', 'బెల్స్'], 1), timedCue(['नमस्ते', 'दोस्त'], 4)]);
  const result = tools.fitLyricsToCaptions(captions, 'జింగిల్, బెల్స్!\nनमस्ते दोस्त।', 6);
  assert.equal(result.matchedWords, 4);
  assert.equal(result.estimatedWords, 0);
  assert.equal(result.captions[0].text, 'జింగిల్, బెల్స్!');
  assert.equal(result.captions[1].text, 'नमस्ते दोस्त।');
});

test('fitted lyric cues inherit the color of their source cue at the new start time', () => {
  const captions = freeze([{ ...timedCue(['Jingle', 'bells'], 1), colorOverride: '#112233' },
    { ...timedCue(['Ringing', 'loudly'], 5), colorOverride: '#aabbcc' }]);
  const fitted = tools.fitLyricsToCaptions(captions, 'Jingle bells\nRinging loudly', 7);
  assert.deepEqual(plain(fitted.captions.map(cue => cue.colorOverride)), ['#112233', '#aabbcc']);
});

test('caption-only or unreliable matches remain explicitly estimated, never verified word timings', () => {
  const result = tools.fitLyricsToCaptions([{ start: 1, end: 9, text: 'Jingle bells' }], 'Jingle bells\nRinging all the way', 10);
  assert.equal(result.matchedWords, 2);
  assert.equal(result.estimatedWords, result.totalWords);
  assert.match(result.warnings.join(' '), /No reliable word timing anchors/);
  const unmatched = tools.fitLyricsToCaptions([timedCue(['Hello', 'world'], 1)], 'Completely different lyrics');
  assert.equal(unmatched.matchedWords, 0);
  assert.equal(unmatched.estimatedWords, 3);
  const weak = tools.fitLyricsToCaptions([timedCue(['la', 'la', 'la'], 1)], 'la la la');
  assert.equal(weak.estimatedWords, 3);
  assert.match(weak.warnings.join(' '), /No reliable/);
});

test('lyric fitter salvages positive ASR word anchors and estimates collapsed words without mutating source', () => {
  const captions = freeze([{ start: 0, end: 5, text: 'Jingle bells ringing', words: [
    { text: 'Jingle', start: 1, end: 1.4 }, { text: 'bells', start: 1.4, end: 1.4 }, { text: 'ringing', start: 3, end: 3.8 },
  ] }]);
  const before = JSON.stringify(captions);
  const result = tools.fitLyricsToCaptions(captions, 'Jingle bells ringing', 5);
  const words = result.captions.flatMap(cue => cue.words);
  assert.deepEqual(plain(words[0]), { text: 'Jingle', start: 1, end: 1.4 });
  assert.deepEqual(plain(words[2]), { text: 'ringing', start: 3, end: 3.8 });
  assert.equal(words[1].start, 1.4);
  assert.equal(words[1].end, 3);
  assert.equal(result.matchedWords, 3);
  assert.equal(result.estimatedWords, 1);
  assert.match(result.warnings.join(' '), /invalid.*anchors were ignored/);
  assert.equal(JSON.stringify(captions), before);
  assert.throws(() => tools.shiftCaptionTiming(captions, 0), /collapsed timing/);
  assert.throws(() => tools.serializeSubtitles(captions, 'json'), /collapsed timing/);
});

test('lyric fit splits long lyric lines into eight-word cues and bounds every word', () => {
  const lyrics = Array.from({ length: 25 }, (_, index) => `word${index}`).join(' ');
  const result = tools.fitLyricsToCaptions([{ start: 0, end: 25, text: 'Unknown audio' }], lyrics, 25);
  assert.equal(result.captions.length, 4);
  assert.ok(result.captions.every(cue => cue.words.length <= 8 && cue.start >= 0 && cue.end <= 25));
  assert.equal(result.captions.at(-1).words.at(-1).end, 25);
});

test('lyric fit rejects absent times, invalid spans, overlap, excessive work and impossible missing-word timing', () => {
  assert.throws(() => tools.fitLyricsToCaptions([], 'Jingle bells'), /timed captions/);
  assert.throws(() => tools.fitLyricsToCaptions([{ start: 0, end: 1, text: 'Hello' }], '♪ ♪'), /lyric words/);
  assert.throws(() => tools.fitLyricsToCaptions([{ start: 0, end: 1, text: 'Hello' }], 'word '.repeat(4001)), /4000|4,000/);
  assert.throws(() => tools.fitLyricsToCaptions([{ start: 0, end: 2, text: 'Hello' }, { start: 1, end: 3, text: 'World' }], 'Hello World'), /overlapping/);
  assert.throws(() => tools.fitLyricsToCaptions([timedCue(['Jingle', 'bells'], 0)], 'Oh Jingle bells'), /not enough time/);
  assert.throws(() => tools.fitLyricsToCaptions([timedCue(['Jingle', 'bells'], 1)], 'Jingle bells', 1), /beyond/);
  assert.throws(() => tools.fitLyricsToCaptions([{ start: 0, end: 0.001, text: 'Unrecognized' }], 'one two three'), /not enough time/);
});
