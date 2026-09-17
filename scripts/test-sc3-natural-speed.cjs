'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { naturalSpeechSeconds, naturalVideoTimeline, naturalVideoFilter, naturalMuxArgs, duration } = require('../sc3-recovery.cjs');

test('speech never accelerates or truncates to fit a short source slot', () => {
  assert.equal(naturalSpeechSeconds(2, 1), 2);
  assert.equal(naturalSpeechSeconds(8, 1), 8);
  assert.equal(naturalSpeechSeconds(1, 2), 2);
  assert.throws(() => naturalSpeechSeconds(0, 1));
});
test('visual timeline preserves pauses and shifts following scenes by exact extra speech duration', () => {
  const result = naturalVideoTimeline([{start:1,end:2,outputSeconds:3},{start:3,end:4,outputSeconds:1}], 5);
  assert.equal(result.seconds, 7);
  assert.deepEqual(result.intervals.map(r => [r.start,r.end,r.outputStart,r.outputEnd]),
    [[0,1,0,1],[1,2,1,4],[2,3,4,5],[3,4,5,6],[4,5,6,7]]);
  assert.ok(result.intervals.every(r => r.scale >= 1));
  assert.throws(() => naturalVideoTimeline([{start:1,end:2,outputSeconds:.5}], 5));
});
test('hour-long timelines stay ordered and use balanced filter expressions', () => {
  const sections = Array.from({ length: 1200 }, (_, i) => ({ start:i*3, end:i*3+1, outputSeconds:1.5 }));
  const result = naturalVideoTimeline(sections, 3600);
  assert.equal(result.seconds, 4200);
  assert.ok(naturalVideoFilter(result).length < 200000);
});
test('Sing Song uses new natural cache and never calls speed-fitting for voice export', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const start = main.indexOf("ipcMain.handle('sc3-replace-video-audio'");
  const body = main.slice(start, main.indexOf("ipcMain.handle('sc3-narrate-audio'", start));
  assert.match(body, /verified-natural-v2/);
  assert.doesNotMatch(body, /verified-v1|fitAudioFilter\(/);
  assert.match(body, /naturalMuxArgs/);
});
test('real export length and colored scenes follow natural narration timing', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sc3-natural-speed-'));
  t.after(() => fs.rmSync(directory, {recursive:true,force:true}));
  const run = args => execFileSync('ffmpeg', ['-hide_banner','-loglevel','error',...args], {windowsHide:true});
  const video=path.join(directory,'source.mp4'), audio=path.join(directory,'voice.wav'), output=path.join(directory,'output.mp4'), filter=path.join(directory,'filter.txt');
  run(['-f','lavfi','-i','color=red:s=160x120:r=30:d=1','-f','lavfi','-i','color=blue:s=160x120:r=30:d=1','-f','lavfi','-i','color=green:s=160x120:r=30:d=1',
    '-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-c:v','libx264','-y',video]);
  run(['-f','lavfi','-i','sine=frequency=440:duration=5','-ar','24000','-y',audio]);
  const timeline = naturalVideoTimeline([{start:1,end:2,outputSeconds:3}],3);
  fs.writeFileSync(filter, naturalVideoFilter(timeline));
  run(naturalMuxArgs(video,audio,output,filter,timeline.seconds));
  assert.ok(Math.abs(await duration('ffmpeg',output)-5)<.1);
  const pixel = time => [...run(['-ss',String(time),'-i',output,'-vf','scale=1:1','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])];
  const blue = pixel(2.5), green = pixel(4.5);
  assert.ok(blue[2] > blue[0] + 100 && blue[2] > blue[1] + 100, 'Blue speech scene lasts until four seconds');
  assert.ok(green[1] > green[0] + 50 && green[1] > green[2] + 50, 'Following green scene stays aligned');
  const probe = JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',output],{encoding:'utf8'}));
  for (const kind of ['audio','video']) assert.ok(Number(probe.streams.find(s=>s.codec_type===kind).duration)>=4.9);
});
