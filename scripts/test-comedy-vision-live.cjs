const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFile, execFileSync, spawnSync } = require('node:child_process');
const parser = require('@babel/parser');
const { jsonrepair } = require('jsonrepair');
const { buildSceneWindows, chooseComedySlot, normalizeComedyReply } = require('../comedy-planner.cjs');

test('installed local vision model analyzes a short silent video without cloud calls', { skip: process.env.RUN_LIVE_VISION_TEST !== '1', timeout: 600000 }, async () => {
  const ffmpeg = process.platform === 'win32' ? spawnSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/)[0] : 'ffmpeg';
  const ffprobe = path.join(path.dirname(ffmpeg), path.basename(ffmpeg).replace(/^ffmpeg/i, 'ffprobe'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pattan-comedy-vision-test-'));
  try {
    const videoPath = path.join(dir, 'moving-test.mp4');
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath], { stdio: 'ignore' });
    const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
    const ast = parser.parse(source, { sourceType: 'script', allowReturnOutsideFunction: true });
    const registration = ast.program.body.find(node => node.expression?.callee?.object?.name === 'ipcMain'
      && node.expression?.callee?.property?.name === 'handle'
      && node.expression.arguments?.[0]?.value === 'analyze-srt-comedy-video');
    assert.ok(registration);
    const handlerSource = source.slice(registration.expression.arguments[1].start, registration.expression.arguments[1].end);
    const handler = vm.runInNewContext(`(${handlerSource})`, {
      fs, path, execFile, fetch, AbortController, jsonrepair,
      activeComedyAnalysis: new Map(),
      PRESENTATOR_LOCAL_MODEL: 'qwen3.5:4b', OLLAMA_PORT: 11434,
      ensureLocalAgentBrain: async () => {},
      findMyExporterFFmpeg: () => ffmpeg,
      myExporterProbePath: filePath => {
        const parsed = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath], { encoding: 'utf8' }));
        return { duration: Number(parsed.format.duration), hasVideo: parsed.streams.some(stream => stream.codec_type === 'video') };
      },
      buildSceneWindows, chooseComedySlot, normalizeComedyReply,
    });
    const phases = [];
    const result = await handler({ sender: { id: 1, send: (_channel, data) => phases.push(data) } }, { videoPath, language: 'English', blockedCues: [] });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.analyzedWindows, 1);
    assert.ok(Array.isArray(result.cues));
    assert.ok(phases.some(phase => phase.pct === 100));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
