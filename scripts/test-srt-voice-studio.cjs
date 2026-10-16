const test = require('node:test');
const assert = require('node:assert/strict');

test('SRT parser keeps spoken text and millisecond timing across multiple tracks', async () => {
  const { parseSrt, parseSrtTime } = await import('../src/components/SrtVoiceStudio/srtUtils.mjs');
  assert.equal(parseSrtTime('00:01:02,345'), 62.345);
  assert.equal(parseSrtTime('01:02:03.5'), 3723.5);
  const cues = parseSrt('\uFEFF1\r\n00:00:02,000 --> 00:00:03,500\r\nHello <i>world</i>\r\n\r\n2\r\n00:00:00,100 --> 00:00:01,100\r\n{\\an8}Good morning\r\n');
  assert.deepEqual(cues, [
    { start: 0.1, end: 1.1, text: 'Good morning' },
    { start: 2, end: 3.5, text: 'Hello world' },
  ]);
});

test('SRT parser rejects empty and invalid time ranges', async () => {
  const { parseSrt } = await import('../src/components/SrtVoiceStudio/srtUtils.mjs');
  assert.throws(() => parseSrt('1\n00:00:01,000 --> 00:00:00,900\nWrong'), /valid start and end/);
  assert.throws(() => parseSrt('not an SRT'), /No spoken subtitle cues/);
});
