const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { retry, duration, muxArgs } = require('../sc3-recovery.cjs');
const { checkpoint, checkpointDirectory, transcriptionWindows } = require('../sc3-recovery.cjs');
const { timedSections, fitAudioFilter } = require('../sc3-recovery.cjs');

test('source pauses and section offsets survive narration planning', () => {
  const sections = timedSections([{offset:0,words:[{word:'Hello',start:3.85,end:4.95},{word:'world',start:17.75,end:18.91}]},{offset:300,words:[{word:'Again',start:2,end:3}]}],340);
  assert.deepEqual(sections.map(s=>[s.start,s.end]),[[3.85,4.95],[17.75,18.91],[302,303]]);
  assert.equal(sections.map(s=>s.text).join(' '),'Hello world Again');
});

test('speech duration fitting decomposes rates supported by FFmpeg', () => {
  for (const ratio of [.1,.5,1,2,8]) {
    const filters=fitAudioFilter(ratio,1).split(',').filter(f=>f.startsWith('atempo='));
    const rates=filters.map(f=>Number(f.split('=')[1]));
    assert.ok(rates.every(rate=>rate>=.5 && rate<=2));
    assert.ok(Math.abs(rates.reduce((a,b)=>a*b,1)-ratio)<.0001);
  }
});

test('hour-long input covers every second with bounded transcription requests', () => {
  for (const seconds of [3600, 3601.25, 7200]) {
    const parts = transcriptionWindows(seconds);
    let cursor = 0;
    for (const part of parts) { assert.equal(part.start, cursor); assert.ok(part.duration <= 300); cursor += part.duration; }
    assert.equal(cursor, seconds);
  }
});

test('completed work resumes and interrupted writes are not treated as completed', async () => {
  const dir = fs.mkdtempSync(path.join(__dirname, '../tmp/sc3-resume-test-'));
  const source = path.join(dir, 'source.txt'); fs.writeFileSync(source, 'example source');
  const cache = checkpointDirectory(dir, source, 'sc3');
  let calls = 0;
  const generate = async () => { calls++; return 'saved transcript'; };
  assert.equal((await checkpoint(cache, 'section-0', generate)).toString(), 'saved transcript');
  assert.equal((await checkpoint(checkpointDirectory(dir, source, 'sc3'), 'section-0', generate)).toString(), 'saved transcript');
  assert.equal(calls, 1);
  await assert.rejects(checkpoint(cache, 'section-1', async () => { throw new Error('interrupted'); }));
  assert.equal((await checkpoint(cache, 'section-1', generate)).toString(), 'saved transcript');
  assert.equal(calls, 2);
  assert.notEqual(checkpointDirectory(dir, source, 'pattan'), cache);
  fs.appendFileSync(source, ' changed');
  assert.notEqual(checkpointDirectory(dir, source, 'sc3'), cache);
});

test('temporary failures retry only failed operation and stop after three attempts', async () => {
  let calls = 0; const delays = [];
  assert.equal(await retry(async () => { if (++calls < 3) throw new Error('ECONNRESET'); return 'audio'; }, () => {}, async ms => delays.push(ms)), 'audio');
  assert.equal(calls, 3); assert.deepEqual(delays, [5000, 10000]);
  calls = 0;
  await assert.rejects(retry(async () => { calls++; throw new Error('HTTP 503'); }, () => {}, async () => {}));
  assert.equal(calls, 3);
});
test('permanent errors and cancellation are not retried', async () => {
  for (const message of ['cancelled', 'file not found', 'Invalid voice audio returned']) {
    let calls = 0;
    await assert.rejects(retry(async () => { calls++; throw new Error(message); }, () => {}, async () => {}));
    assert.equal(calls, 1);
  }
});
test('real FFmpeg export retains longer video or longer narration', async () => {
  const dir = fs.mkdtempSync(path.join(__dirname, '../tmp/sc3-duration-test-'));
  const run = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide:true });
  const video = path.join(dir, 'video.mp4');
  run(['-f','lavfi','-i','color=c=blue:s=160x120:r=10:d=2','-c:v','libx264','-y',video]);
  for (const seconds of [1, 3]) {
    const audio = path.join(dir, `audio-${seconds}.wav`), output = path.join(dir, `result-${seconds}.mp4`);
    run(['-f','lavfi','-i',`sine=frequency=440:duration=${seconds}`,'-y',audio]);
    const fitted = path.join(dir, `fitted-${seconds}.wav`);
    run(['-y','-i',audio,'-af',fitAudioFilter(seconds,1.25),'-t','1.25',fitted]);
    assert.ok(Math.abs(await duration('ffmpeg',fitted)-1.25)<.03);
    run(muxArgs(video,audio,output,2,seconds));
    assert.ok(Math.abs(await duration('ffmpeg',output)-Math.max(2,seconds)) < .2);
    const probe = JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',output],{encoding:'utf8'}));
    for (const kind of ['audio','video']) {
      const stream = probe.streams.find(s=>s.codec_type===kind);
      assert.ok(stream, kind); assert.ok(Number(stream.duration) >= Math.max(2,seconds)-.2);
    }
  }
});
