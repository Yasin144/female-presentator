const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/components/MyExporter/editor-captions.mjs');

test('Groq Fox cannot cover Tiger and malformed speech never hides behind broad segments', async () => {
  const { transcriptCues } = await load();
  assert.throws(() => transcriptCues({ ok: true, words: [{ word: 'Tiger.', start: 38.6, end: 38.94 }, { word: 'Fox.', start: 38.48, end: 40.46 }], segments: [{ text: 'Tiger Fox', start: 0, end: 60 }] }), /word 2/);
});
test('speech gaps and punctuation retain the exact original source bounds', async () => {
  const { transcriptCues } = await load();
  const cues = transcriptCues({ ok: true, words: [{ word: 'Tiger.', start: 38.64, end: 39.06 }, { word: 'Fox.', start: 42.18, end: 43.24 }] });
  assert.deepEqual(cues.map(cue => [cue.start, cue.end]), [[38.64, 39.06], [42.18, 43.24]]);
});
test('source trims and speed changes crop words before converting into output seconds', async () => {
  const { cuesForScene } = await load();
  const result = cuesForScene([{ start: 1, end: 4, text: 'old included end', words: [{ text: 'old', start: 1, end: 1.5 }, { text: 'included', start: 2, end: 2.5 }, { text: 'end', start: 3.5, end: 4 }] }], { id: 'clip', trimStart: 2, duration: 1, speed: 2 }, 10);
  assert.equal(result[0].text, 'included');
  assert.deepEqual(result[0].words, [{ text: 'included', start: 10, end: 10.25 }]);
  assert.equal(result[0].end, 10.25);
});
test('translation preserves cue bounds and clears source-language karaoke words', async () => {
  const { translateCueTexts } = await load();
  const original = [{ start: 38.64, end: 39.06, text: 'Tiger.', words: [{ text: 'Tiger.', start: 38.64, end: 39.06 }] }];
  const result = await translateCueTexts(original, 'te', 'en', { fetcher: async () => ({ ok: true, json: async () => ({ target: 'te', results: ['పులి.'] }) }) });
  assert.deepEqual([result[0].start, result[0].end], [38.64, 39.06]);
  assert.deepEqual(result[0].words, []);
  assert.equal(result[0].text, 'పులి.');
  assert.equal(original[0].text, 'Tiger.');
});
test('partial, wrong-language and cancelled translations cannot publish replacement cues', async () => {
  const { translateCueTexts } = await load();
  const cues = [{ start: 1, end: 2, text: 'Tiger.', words: [] }];
  for (const payload of [{ results: [] }, { target: 'hi', results: ['पुलि'] }, { results: [''] }]) await assert.rejects(translateCueTexts(cues, 'te', 'en', { fetcher: async () => ({ ok: true, json: async () => payload }) }), /incomplete captions/);
  const controller = new AbortController();
  await assert.rejects(translateCueTexts(cues, 'te', 'en', { signal: controller.signal, fetcher: async () => { controller.abort(new Error('Cancelled')); return { ok: true, json: async () => ({ results: ['పులి.'] }) }; } }), /Cancelled/);
  assert.equal(cues[0].text, 'Tiger.');
});
