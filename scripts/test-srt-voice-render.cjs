const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const parser = require('@babel/parser');

const ffmpeg = process.platform === 'win32' ? spawnSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0] : spawnSync('which', ['ffmpeg'], { encoding: 'utf8' }).stdout?.trim();
const ffprobe = ffmpeg && path.join(path.dirname(ffmpeg), path.basename(ffmpeg).replace(/^ffmpeg/i, 'ffprobe'));
const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
const ast = parser.parse(source, { sourceType: 'script', allowReturnOutsideFunction: true });
const registration = ast.program.body.find(node => node.expression?.callee?.object?.name === 'ipcMain'
  && node.expression?.callee?.property?.name === 'handle'
  && node.expression.arguments?.[0]?.value === 'render-srt-voice-video');
assert.ok(registration, 'Desktop app must register the SRT voice renderer');
const handlerSource = source.slice(registration.expression.arguments[1].start, registration.expression.arguments[1].end);

test('two overlapping SRT tracks render a playable MP4 on a silent video', { skip: !ffmpeg || !fs.existsSync(ffprobe), timeout: 60000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pattan-srt-test-'));
  try {
    const videoPath = path.join(directory, 'source.mp4');
    const outputPath = path.join(directory, 'dubbed.mp4');
    const clipPath = path.join(directory, 'voice.mp3');
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath], { stdio: 'ignore' });
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.7', '-c:a', 'libmp3lame', clipPath], { stdio: 'ignore' });
    const clipBytes = fs.readFileSync(clipPath);
    const probe = filePath => {
      const data = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath], { encoding: 'utf8' }));
      return { duration: Number(data.format.duration), hasVideo: data.streams.some(stream => stream.codec_type === 'video'), hasAudio: data.streams.some(stream => stream.codec_type === 'audio') };
    };
    const progress = [];
    const handler = vm.runInNewContext(`(${handlerSource})`, {
      fs, os, path, spawn,
      myExporterProbePath: probe,
      findMyExporterFFmpeg: () => ffmpeg,
      generateSyncedEdgeTtsClip: async () => ({ response: { buffer: clipBytes } }),
      buildAtempoChain: tempo => tempo > 1.005 ? `atempo=${tempo.toFixed(6)},` : '',
      srtNaturalProsody: () => '',
    });
    const result = await handler({ sender: { send: (_channel, value) => progress.push(value) } }, {
      videoPath, outputPath, removeOriginalAudio: true,
      tracks: [
        { voice: 'en-IN-NeerjaNeural', gender: 'female', cues: [{ start: 0.3, end: 1.3, text: 'Hello' }] },
        { voice: 'en-IN-PrabhatNeural', gender: 'male', cues: [{ start: 0.8, end: 1.8, text: 'World' }] },
      ],
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.cueCount, 2);
    assert.ok(fs.statSync(outputPath).size > 1000);
    assert.equal(probe(outputPath).hasAudio, true);
    assert.ok(progress.some(item => item.pct === 100));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('an approved comedy-only script renders without requiring SRT tracks', { skip: !ffmpeg || !fs.existsSync(ffprobe), timeout: 60000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pattan-comedy-only-test-'));
  try {
    const videoPath = path.join(directory, 'source.mp4');
    const outputPath = path.join(directory, 'comedy-only.mp4');
    const clipPath = path.join(directory, 'voice.mp3');
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath], { stdio: 'ignore' });
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.7', '-c:a', 'libmp3lame', clipPath], { stdio: 'ignore' });
    const clipBytes = fs.readFileSync(clipPath);
    const probe = filePath => {
      const data = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath], { encoding: 'utf8' }));
      return { duration: Number(data.format.duration), hasVideo: data.streams.some(stream => stream.codec_type === 'video'), hasAudio: data.streams.some(stream => stream.codec_type === 'audio') };
    };
    const generatedVoices = [];
    const handler = vm.runInNewContext(`(${handlerSource})`, {
      fs, os, path, spawn,
      myExporterProbePath: probe,
      findMyExporterFFmpeg: () => ffmpeg,
      generateSyncedEdgeTtsClip: async (_text, voice) => { generatedVoices.push(voice); return { response: { buffer: clipBytes } }; },
      buildAtempoChain: tempo => tempo > 1.005 ? `atempo=${tempo.toFixed(6)},` : '',
      srtNaturalProsody: () => '',
    });
    const result = await handler({ sender: { send() {} } }, {
      videoPath, outputPath, removeOriginalAudio: true, comedyApproved: true,
      tracks: [{ kind: 'comedy', voice: 'te-IN-ShrutiNeural', gender: 'female', cues: [
        { start: 0.3, end: 0.9, text: 'నా జోక్‌కి సిగ్నల్ వస్తుందా?', voice: 'te-IN-ShrutiNeural', gender: 'female' },
        { start: 1.1, end: 1.8, text: 'రూటర్‌ను అడిగి చెబుతా!', voice: 'te-IN-MohanNeural', gender: 'male' },
      ] }],
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.cueCount, 2);
    assert.deepEqual(generatedVoices, ['te-IN-ShrutiNeural', 'te-IN-MohanNeural']);
    assert.ok(fs.statSync(outputPath).size > 1000);
    assert.equal(probe(outputPath).hasAudio, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
