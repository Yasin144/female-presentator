'use strict';

// Actual small FFmpeg exports. No Electron, native app, API or lesson footage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { test } = require('node:test');
const { createMyExporterEngine, resolveDimensions, atempoFilters, normalizeScene } = require('../my-exporter-engine.cjs');

const ffmpeg = process.platform === 'win32' ? execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0] : 'ffmpeg';
const ffprobe = process.platform === 'win32' ? path.join(path.dirname(ffmpeg), 'ffprobe.exe') : 'ffprobe';
const directory = path.resolve(__dirname, '..', 'generated-media', `my-exporter-native-qa-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true });
const source = path.join(directory, 'source.mp4'), audio = path.join(directory, 'tone.wav');
execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=24:d=3',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3',
  '-vf', "drawbox=x=80:y=0:w=80:h=90:color=blue:t=fill,drawbox=x=0:y=0:w=160:h=45:color=green:t=fill:enable='gte(t,1)'",
  '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-crf', '15', '-c:a', 'aac', '-t', '3', source], { windowsHide: true });
execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=4', audio], { windowsHide: true });
const results = [];
const probe = filename => JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename], { encoding: 'utf8', windowsHide: true }));
const engine = extra => createMyExporterEngine({ findFFmpeg: () => ffmpeg, ffprobePath: ffprobe, outputDimensions: [160, 90], ...extra });
const scene = extra => ({ kind: 'video', path: source, trimStart: 0, duration: 2, speed: 1, muted: true, ...extra });
const output = name => path.join(directory, name + '.mp4');
const frame = (filename, time) => execFileSync(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', filename, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true, maxBuffer: 12 * 1024 * 1024 });
const pixel = (data, x, y, width = 160) => [...data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
const samples = filename => {
  const data = execFileSync(ffmpeg, ['-v', 'error', '-i', filename, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return Array.from({ length: data.length / 4 }, (_, index) => data.readFloatLE(index * 4));
};
const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / Math.max(1, data.length));
const run = async (renderer, name, options) => {
  const result = await renderer.exportVideo({ jobId: name, outputPath: output(name), resolution: '1080p', fps: 24, quality: 'small', ...options });
  results.push({ name, result });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
};

test('export dimensions and complete supported speed range have explicit contracts', () => {
  assert.deepEqual(resolveDimensions({ aspectRatio: '16:9', resolution: '1080p' }), [1920, 1080]);
  assert.deepEqual(resolveDimensions({ aspectRatio: '9:16', resolution: '1440p' }), [1440, 2560]);
  assert.deepEqual(resolveDimensions({ aspectRatio: '1:1', resolution: '4k' }), [2160, 2160]);
  assert.deepEqual(resolveDimensions({ aspectRatio: '4:3', resolution: '1080p' }), [1440, 1080]);
  assert.deepEqual(atempoFilters(.25), ['atempo=0.5', 'atempo=0.5']);
  assert.deepEqual(atempoFilters(4), ['atempo=2', 'atempo=2']);
  for (const kind of ['image', 'gap']) {
    const normalized = normalizeScene({ kind, duration: 2, speed: .25 }, { hasVideo: true, duration: 0 });
    assert.equal(normalized.speed, 1); assert.equal(normalized.outputDuration, 2);
  }
});

test('native trims, quarter/four-times speed, fades and black gaps preserve timeline length', async () => {
  const result = await run(engine(), 'speed-trims-gaps', { scenes: [scene({ trimStart: 1.2, duration: 1, speed: 4, muted: false }),
    { kind: 'gap', duration: .75, speed: 4 }, scene({ trimStart: 0, duration: .5, speed: .25, transition: 'fade-black', transitionDuration: .3, muted: false })] });
  assert.equal(result.duration, 3);
  const meta = probe(result.outputPath);
  assert.ok(Math.abs(Number(meta.format.duration) - 3) < .12);
  assert.equal(meta.streams.find(item => item.codec_type === 'video').width, 160);
  const trimmed = pixel(frame(result.outputPath, .12), 20, 15);
  assert.ok(trimmed[1] > trimmed[0] + 40, `Trim did not select the later green source frame: ${trimmed}`);
  assert.ok(pixel(frame(result.outputPath, .5), 40, 40).every(value => value < 8), 'Gap is not black');
  assert.ok(pixel(frame(result.outputPath, 2), 20, 60)[0] > 150);
  assert.ok(pixel(frame(result.outputPath, 2.95), 20, 60)[0] < 90, 'Fade-out did not darken the end without shortening it');
});

test('actual portrait aspect output replaces a preexisting file only after successful MP4 verification', async () => {
  const filename = output('portrait'); fs.copyFileSync(source, filename);
  const before = fs.readFileSync(filename);
  const renderer = createMyExporterEngine({ findFFmpeg: () => ffmpeg, ffprobePath: ffprobe });
  const result = await run(renderer, 'portrait', { aspectRatio: '9:16', scenes: [scene({ duration: .5 })] });
  const meta = probe(result.outputPath), video = meta.streams.find(item => item.codec_type === 'video');
  assert.deepEqual([video.width, video.height], [1080, 1920]);
  assert.notDeepEqual(fs.readFileSync(filename), before);
  assert.equal(fs.readdirSync(directory).filter(name => name.includes('.staged.mp4')).length, 0);
});

test('scale, horizontal position and flip render actual scene pixels', async () => {
  const result = await run(engine(), 'static-transform', { scenes: [scene({ trimStart: 1.2, duration: .5, scale: .5, positionX: 25, flipX: true, flipY: true })] });
  const data = frame(result.outputPath, .2);
  assert.ok(pixel(data, 10, 45).every(value => value < 8));
  const left = pixel(data, 100, 30), right = pixel(data, 140, 30);
  assert.ok(left[2] > left[0] + 100, `Horizontal flip did not put blue on the left: ${left}`);
  assert.ok(right[0] > right[2] + 100, `Horizontal flip did not put red on the right: ${right}`);
  const bottom = pixel(data, 120, 60);
  assert.ok(bottom[1] > bottom[0] + 40, `Vertical flip did not put green on the bottom: ${bottom}`);
});

test('keyframed position, scale and opacity interpolate in output seconds', async () => {
  const moved = await run(engine(), 'position-keyframes', { scenes: [scene({ scale: .5, positionX: -25,
    keyframes: [{ time: 2, positionX: 25 }] })] });
  assert.ok(pixel(frame(moved.outputPath, .1), 20, 45)[0] > 150);
  assert.ok(pixel(frame(moved.outputPath, 1.85), 20, 45).every(value => value < 8));
  const faded = await run(engine(), 'opacity-scale-keyframes', { scenes: [scene({ opacity: 0,
    keyframes: [{ time: 2, opacity: 1, scale: .5 }] })] });
  assert.ok(pixel(frame(faded.outputPath, .1), 80, 65).every(value => value < 40));
  assert.ok(pixel(frame(faded.outputPath, 1.85), 100, 55).some(value => value > 130));
  assert.ok(pixel(frame(faded.outputPath, 1.85), 5, 45).every(value => value < 8));
});

test('zero scene, music and track volumes remain silent and mixed tracks honor speed/start/fades', async () => {
  const silent = await run(engine(), 'zero-volumes', { scenes: [scene({ muted: false, volume: 0 })], musicPath: audio, musicVolume: 0,
    audioTracks: [{ path: audio, start: 0, duration: 2, volume: 0 }] });
  assert.ok(rms(samples(silent.outputPath)) < .00001, 'A zero volume was replaced by a default');
  const mixed = await run(engine(), 'track-fades-speed', { scenes: [scene()], audioTracks: [
    { path: audio, start: .5, duration: 1, speed: 4, volume: .5, fadeIn: .2, fadeOut: .2 },
    { path: audio, start: 0, duration: 2, speed: .25, volume: 0 },
  ] });
  const data = samples(mixed.outputPath);
  assert.ok(rms(data.slice(0, 6000)) < .0001);
  assert.ok(rms(data.slice(12800, 16000)) > .01);
  assert.ok(rms(data.slice(26000, 30000)) < .001);
  assert.ok(rms(data.slice(8320, 8640)) < rms(data.slice(12800, 14400)) * .5, 'Audio fade-in did not ramp');
});

test('cancellation owns the job across all phases and never replaces existing output', async () => {
  for (const phase of ['Rendering scene', 'Joining scenes', 'Mixing audio tracks', 'Finishing MP4', 'Verifying MP4']) {
    const name = 'cancel-' + phase.replace(/\W/g, '-'), filename = output(name); fs.copyFileSync(source, filename);
    const before = fs.readFileSync(filename), renderer = engine();
    let requested = false; const progress = [];
    const result = await renderer.exportVideo({ jobId: name, outputPath: filename, fps: 24, quality: 'small', scenes: [scene({ duration: .5 })],
      audioTracks: [{ path: audio, duration: .5, volume: 0 }] }, { onProgress: update => {
      progress.push(update);
      if (!requested && update.phase.startsWith(phase)) { requested = true; assert.equal(renderer.cancel(name).cancelled, true); }
    } });
    assert.equal(requested, true, phase); assert.equal(result.cancelled, true, JSON.stringify(result));
    assert.equal(result.ok, false); assert.ok(progress.every(update => update.pct < 100));
    assert.deepEqual(fs.readFileSync(filename), before);
    assert.equal(renderer.cancel(name).cancelled, false);
  }
  assert.equal(fs.readdirSync(directory).filter(name => name.includes('.staged.mp4')).length, 0);
});

test('actual running FFmpeg cancellation kills only its job and retains existing MP4', async () => {
  const filename = output('cancel-live-process'); fs.copyFileSync(source, filename);
  const before = fs.readFileSync(filename);
  let renderer, killed = false;
  renderer = engine({ spawn: (executable, args, options) => {
    const child = spawn(executable, args, options);
    if (args.at(-1).includes('segment-')) setTimeout(() => { killed = true; renderer.cancel('cancel-live-process'); }, 20);
    return child;
  } });
  const result = await renderer.exportVideo({ jobId: 'cancel-live-process', outputPath: filename, scenes: [scene()], fps: 24 });
  assert.equal(killed, true); assert.equal(result.cancelled, true); assert.equal(result.ok, false);
  assert.deepEqual(fs.readFileSync(filename), before);
  assert.equal(renderer.cancel('another-job').cancelled, false);
  assert.equal(renderer.cancel().ok, false);
});

test('native finishing failure retains existing output and releases job for retry', async () => {
  const filename = output('failed-finish'); fs.copyFileSync(source, filename);
  const before = fs.readFileSync(filename), renderer = engine();
  const options = { jobId: 'failed-finish', outputPath: filename, scenes: [scene({ duration: .5 })], fps: 24, quality: 'small' };
  const result = await renderer.exportVideo(options, { finish: context => context.run(['-y', '-i', path.join(directory, 'missing-input.mp4'), context.stagedPath], 'Injected native failure') });
  assert.equal(result.ok, false); assert.match(result.error, /Injected native failure/);
  assert.deepEqual(fs.readFileSync(filename), before);
  assert.equal((await renderer.exportVideo(options)).ok, true);
});

test('capability preflight validates gaps and rejects unsupported keyframes without rendering', () => {
  const renderer = engine();
  assert.equal(renderer.validate({ scenes: [{ kind: 'gap', duration: 1 }] }).exportCapabilitiesVersion, 2);
  assert.equal(renderer.validate({ scenes: [{ kind: 'gap', duration: 1 }] }).ok, true);
  assert.equal(renderer.validate({ scenes: [scene({ keyframes: [{ time: 3, scale: 2 }] })] }).ok, false);
});

test('asynchronous native metadata includes an unchanged source fingerprint and compatibility fields', async () => {
  const renderer = engine(), before = fs.statSync(source), result = await renderer.probeMedia(source);
  assert.equal(result.fileSize, before.size); assert.equal(result.modifiedAt, before.mtimeMs);
  assert.equal(result.videoCodec, 'h264'); assert.equal(result.frameRate, 24); assert.equal(result.hasAudio, true);
});

test('native right-angle rotation and still-image scenes remain playable', async () => {
  const rotated = await run(engine(), 'right-angle-rotation', { scenes: [scene({ duration: .5, rotation: 90 })] });
  const data = frame(rotated.outputPath, .2);
  assert.ok(pixel(data, 80, 20)[0] > 150);
  assert.ok(pixel(data, 80, 70)[2] > 150);
  const image = path.join(directory, 'still.png');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', source, '-frames:v', '1', image], { windowsHide: true });
  const still = await run(engine(), 'still-image', { scenes: [{ kind: 'image', path: image, duration: 1, speed: .5 }] });
  assert.equal(still.duration, 1);
  assert.ok(pixel(frame(still.outputPath, .8), 20, 60)[0] > 150);
});

test('disabled scenes reserve black and silent slots without opening their source', async () => {
  const renderer = engine(), missing = path.join(directory, 'disabled-source-was-moved.mp4');
  const disabled = scene({ disabled: true, path: missing, duration: 1, speed: 2, opacity: 0, brightness: 1, muted: false });
  assert.equal(renderer.validate({ scenes: [disabled] }).ok, true);
  const result = await run(renderer, 'disabled-timeline-slot', { scenes: [disabled, scene({ duration: .5, muted: false })] });
  assert.equal(result.duration, 1);
  assert.ok(pixel(frame(result.outputPath, .25), 20, 60).every(value => value < 8), 'Disabled scene is not black');
  assert.ok(pixel(frame(result.outputPath, .75), 20, 60)[0] > 150, 'The downstream clip no longer starts at its original offset');
  const data = samples(result.outputPath);
  assert.ok(rms(data.slice(0, 6000)) < .00001, 'Disabled scene audio was not silent');
  assert.ok(rms(data.slice(11000, 14000)) > .01, 'Downstream audio did not keep its original timeline slot');
  assert.equal(renderer.validate({ scenes: [scene({ path: missing })] }).ok, false, 'Enabled missing-source validation was weakened');
});

test('native waveform measures silence, absolute amplitude, trim and opposite-phase stereo', async () => {
  const gated = path.join(directory, 'waveform-gated.wav');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000:duration=2',
    '-af', "volume=0:enable='lt(t,1)'", '-c:a', 'pcm_s16le', gated], { windowsHide: true });
  const renderer = engine(), full = await renderer.waveform({ filePath: gated, bars: 20 });
  assert.equal(full.peaks.length, 20); assert.equal(full.duration, 2); assert.equal(full.hasAudio, true);
  assert.ok(full.peaks.slice(0, 9).every(peak => peak === 0), 'Silent bars should be zero');
  assert.ok(full.peaks.slice(11).every(peak => peak > .1 && peak < .14), 'Audio peaks should retain their real amplitude');
  assert.deepEqual((await renderer.waveform({ filePath: gated, bars: 20 })).peaks, full.peaks, 'Waveform must be deterministic');
  const silent = await renderer.waveform({ filePath: gated, bars: 10, trimStart: 0, duration: .8 });
  assert.ok(silent.peaks.every(peak => peak === 0)); assert.equal(silent.sourceDuration, 2);
  const trimmed = await renderer.waveform({ filePath: gated, bars: 10, trimStart: 1.2, duration: .6 });
  assert.equal(trimmed.trimStart, 1.2); assert.equal(trimmed.duration, .6);
  assert.ok(trimmed.peaks.every(peak => peak > .1 && peak < .14));
  const stereo = path.join(directory, 'waveform-stereo.wav');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000:duration=0.5',
    '-af', 'pan=stereo|c0=c0|c1=-1*c0', '-c:a', 'pcm_s16le', stereo], { windowsHide: true });
  assert.ok((await renderer.waveform({ filePath: stereo, bars: 10 })).peaks.every(peak => peak > .1), 'Opposite-phase channels disappeared');
  const silentVideo = path.join(directory, 'waveform-no-audio.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', source, '-an', '-c:v', 'copy', silentVideo], { windowsHide: true });
  const noAudio = await renderer.waveform({ filePath: silentVideo, bars: 12 });
  assert.equal(noAudio.hasAudio, false); assert.deepEqual(noAudio.peaks, Array(12).fill(0));
  await assert.rejects(renderer.waveform({ filePath: gated, bars: 20.5 }), /whole number/);
  await assert.rejects(renderer.waveform({ filePath: gated, trimStart: 3 }), /trim start/);
  await assert.rejects(renderer.waveform({ filePath: path.join(directory, 'missing.wav') }));
});

test('cancel after preflight prevents a late export from starting', async () => {
  const renderer = engine(), options = { jobId: 'cancel-preflight', outputPath: output('cancel-preflight'), scenes: [{ kind: 'gap', duration: 1 }] };
  assert.equal(renderer.validate(options).ok, true);
  assert.equal(renderer.cancel(options.jobId).cancelled, true);
  const result = await renderer.exportVideo(options);
  assert.equal(result.ok, false); assert.equal(result.cancelled, true);
  assert.equal(fs.existsSync(options.outputPath), false);
});

test('asynchronous IPC preflight can cancel its actual running metadata process and refuses late export', async () => {
  let renderer, requested = false;
  renderer = engine({ spawn: (executable, args, options) => {
    const child = spawn(executable, args, options);
    if (path.basename(executable).startsWith('ffprobe')) setTimeout(() => {
      requested = true; assert.equal(renderer.cancel('cancel-async-preflight').cancelled, true);
    }, 1);
    return child;
  } });
  const options = { jobId: 'cancel-async-preflight', outputPath: output('cancel-async-preflight'), scenes: [scene()] };
  const checked = await renderer.preflight(options);
  assert.equal(requested, true); assert.equal(checked.ok, false); assert.equal(checked.cancelled, true);
  const result = await renderer.exportVideo(options);
  assert.equal(result.cancelled, true); assert.equal(result.ok, false); assert.equal(fs.existsSync(options.outputPath), false);
  assert.equal(renderer.cancel(options.jobId).cancelled, false);
});

test('two job IDs cannot compete to replace the same output', async () => {
  const renderer = engine(), filename = output('owned-output');
  let release, ready;
  const waiting = new Promise(resolve => { ready = resolve; });
  const first = renderer.exportVideo({ jobId: 'owner-one', outputPath: filename, fps: 24, quality: 'small', scenes: [scene({ duration: .5 })] }, {
    finish: async context => {
      await new Promise(resolve => { release = resolve; ready(); });
      await context.run(['-y', '-i', context.inputPath, '-c', 'copy', context.stagedPath], 'Finishing owner one');
    },
  });
  await waiting;
  try {
    const second = await renderer.exportVideo({ jobId: 'owner-two', outputPath: filename, scenes: [scene({ duration: .5 })] });
    assert.equal(second.ok, false); assert.match(second.error, /Another export/);
  } finally { release(); }
  assert.equal((await first).ok, true);
});

test('source metadata changes cannot silently shorten the timeline during export', async () => {
  const renderer = engine(), options = { jobId: 'stale-source-duration', scenes: [scene({ duration: 4 })], outputPath: output('stale-source-duration') };
  fs.copyFileSync(source, options.outputPath); const before = fs.readFileSync(options.outputPath);
  const checked = await renderer.preflight(options);
  assert.equal(checked.ok, false); assert.match(checked.errors.join(' '), /saved trim extends/);
  const result = await renderer.exportVideo(options);
  assert.equal(result.ok, false); assert.match(result.error, /saved trim extends/);
  assert.deepEqual(fs.readFileSync(options.outputPath), before);
});

test('native percent crop preserves source rate, audio and selected trim while atomically replacing output', async () => {
  const cropSource = path.join(directory, 'crop-source.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', source, '-vf', 'scale=320:180', '-r', '30000/1001', '-c:v', 'libx264', '-b:v', '100k', '-c:a', 'copy', cropSource], { windowsHide: true });
  const filename = output('percent-crop'); fs.copyFileSync(source, filename); const before = fs.readFileSync(filename);
  const renderer = engine(), result = await renderer.exportCrop({ jobId: 'percent-crop', inputPath: cropSource, outputPath: filename,
    crop: { x: 0, y: 0, width: 50, height: 50 }, start: 1.2, end: 2.2 });
  results.push({ name: 'percent-crop', result }); assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual([result.width, result.height], [160, 90]); assert.ok(Math.abs(result.duration - 1) < 1e-9);
  assert.deepEqual(result.cropPixels, { x: 0, y: 0, width: 160, height: 90 });
  assert.ok(Math.abs(result.frameRate - 30000 / 1001) < .001); assert.ok(result.videoBitrate > 0 && result.sourceBitrate > 0);
  assert.equal(result.hasAudio, true); assert.ok(rms(samples(result.outputPath)) > .01);
  const selected = pixel(frame(result.outputPath, .5), 80, 45); assert.ok(selected[1] > selected[0] + 40, `Crop/trim missed the green source: ${selected}`);
  assert.notDeepEqual(fs.readFileSync(filename), before);
  assert.equal(fs.readdirSync(directory).some(name => name.includes('.staged.mp4')), false);
});

test('native crop refuses invalid bounds, source overwrite and encoding failure without damaging existing output', async () => {
  const filename = output('failed-crop'); fs.copyFileSync(source, filename); const before = fs.readFileSync(filename), renderer = engine();
  for (const options of [{ crop: { x: 90, y: 0, width: 50, height: 100 } }, { start: 2, end: 1 }, { end: 4 }]) {
    const result = await renderer.exportCrop({ inputPath: source, outputPath: filename, ...options });
    assert.equal(result.ok, false); assert.deepEqual(fs.readFileSync(filename), before);
  }
  const original = fs.readFileSync(source);
  assert.equal((await renderer.exportCrop({ inputPath: source, outputPath: source })).ok, false);
  assert.deepEqual(fs.readFileSync(source), original);
  const failing = engine({ spawn: (executable, args, options) => {
    if (path.basename(executable).startsWith('ffmpeg') && args.includes('-vf')) {
      args = [...args]; args[args.indexOf('-i') + 1] = path.join(directory, 'missing-crop-input.mp4');
    }
    return spawn(executable, args, options);
  } });
  const failed = await failing.exportCrop({ inputPath: source, outputPath: filename, start: 0, end: 1 });
  assert.equal(failed.ok, false); assert.match(failed.error, /Saving cropped video failed/);
  assert.deepEqual(fs.readFileSync(filename), before);
  assert.equal(fs.readdirSync(directory).some(name => name.includes('.staged.mp4')), false);
});

test.after(() => {
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
  console.log('Native export QA artifacts:', directory);
});
