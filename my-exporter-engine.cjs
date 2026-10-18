'use strict';

// Native timeline rendering, with one owned lease across every export phase.
// Final files are replaced only after a staged MP4 passes asynchronous probing.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const EXPORT_CAPABILITIES_VERSION = 2;
const finite = (value, fallback) => value === undefined || value === null || value === '' ? fallback : Number(value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const number = value => Number(value.toFixed(6)).toString();
const even = value => Math.max(2, Math.round(value / 2) * 2);
const cancelledError = () => Object.assign(new Error('Export cancelled.'), { code: 'MY_EXPORTER_CANCELLED' });

function numeric(value, fallback, low, high, label) {
  const result = finite(value, fallback);
  if (!Number.isFinite(result) || result < low || result > high) throw new Error(`${label} must be between ${low} and ${high}.`);
  return result;
}

function resolveDimensions(options = {}) {
  const sizes = { '1080p': [1920, 1080], '1440p': [2560, 1440], '4k': [3840, 2160], vertical: [1080, 1920], square: [1080, 1080] };
  const legacy = sizes[options.resolution] || sizes['1080p'];
  if (!options.aspectRatio) return legacy;
  if (!['16:9', '9:16', '1:1', '4:3'].includes(options.aspectRatio)) throw new Error('Choose a supported export aspect ratio.');
  const edge = { '1080p': 1080, '1440p': 1440, '4k': 2160 }[options.resolution] || 1080;
  return { '16:9': [even(edge * 16 / 9), edge], '9:16': [edge, even(edge * 16 / 9)], '1:1': [edge, edge], '4:3': [even(edge * 4 / 3), edge] }[options.aspectRatio];
}

function atempoFilters(speed) {
  let remaining = numeric(speed, 1, .25, 4, 'Speed');
  const filters = [];
  while (remaining < .5) { filters.push('atempo=0.5'); remaining /= .5; }
  while (remaining > 2) { filters.push('atempo=2'); remaining /= 2; }
  if (Math.abs(remaining - 1) > 1e-9) filters.push(`atempo=${number(remaining)}`);
  return filters;
}

function normalizeScene(scene, meta, index = 0) {
  const label = scene.name || `Scene ${index + 1}`;
  const isImage = scene.kind === 'image', isGap = scene.kind === 'gap';
  if (!meta.hasVideo) throw new Error(`${label}: no usable video/image stream was found.`);
  const trimStart = numeric(scene.trimStart, 0, 0, 86400, `${label} trim start`);
  if (!isImage && !isGap && !(meta.duration > trimStart)) throw new Error(`${label}: trim start is beyond the end of the file.`);
  const requested = numeric(scene.duration, isImage || isGap ? 3 : meta.duration - trimStart, .001, 86400, `${label} duration`);
  if (!isImage && !isGap && requested > meta.duration - trimStart + .001) throw new Error(`${label}: the saved trim extends beyond the current source duration. Import the file again or shorten this clip.`);
  const duration = requested;
  const speed = isImage || isGap ? 1 : numeric(scene.speed, 1, .25, 4, `${label} speed`);
  const outputDuration = duration / speed;
  const normalized = { ...scene, isImage, isGap, meta, trimStart, duration, speed, outputDuration,
    scale: numeric(scene.scale, 1, .1, 4, `${label} scale`),
    positionX: numeric(scene.positionX, 0, -100, 100, `${label} horizontal position`),
    positionY: numeric(scene.positionY, 0, -100, 100, `${label} vertical position`),
    opacity: numeric(scene.opacity, 1, 0, 1, `${label} opacity`),
    volume: numeric(scene.volume, 1, 0, 2, `${label} volume`),
    brightness: numeric(scene.brightness, 0, -1, 1, `${label} brightness`),
    contrast: numeric(scene.contrast, 1, 0, 2, `${label} contrast`),
    saturation: numeric(scene.saturation, 1, 0, 3, `${label} saturation`),
  };
  if (scene.transition && !['none', 'fade-black'].includes(scene.transition)) throw new Error(`${label}: unsupported transition.`);
  const fade = scene.transition === 'fade-black' ? numeric(scene.transitionDuration, .4, .1, 1.5, `${label} transition duration`)
    : numeric(scene.fade, 0, 0, 1.5, `${label} fade`);
  normalized.fade = Math.min(fade, outputDuration / 2);
  if (scene.transition === 'none') normalized.fade = 0;
  normalized.keyframes = (Array.isArray(scene.keyframes) ? scene.keyframes : []).map(keyframe => {
    const item = { time: numeric(keyframe.time, 0, 0, outputDuration, `${label} keyframe time`) };
    for (const [property, low, high] of [['scale', .1, 4], ['positionX', -100, 100], ['positionY', -100, 100], ['opacity', 0, 1]]) {
      if (keyframe[property] !== undefined) item[property] = numeric(keyframe[property], normalized[property], low, high, `${label} keyframe ${property}`);
    }
    return item;
  }).sort((left, right) => left.time - right.time);
  return normalized;
}

function normalizeDisabledScene(scene, index) {
  const label = scene.name || `Scene ${index + 1}`;
  const speed = scene.kind === 'image' || scene.kind === 'gap' ? 1 : numeric(scene.speed, 1, .25, 4, `${label} speed`);
  const duration = numeric(scene.duration, Number(scene.sourceDuration) - Number(scene.trimStart || 0), .001, 86400, `${label} duration`);
  // Disabled clips retain their timeline slot without opening their source.
  return normalizeScene({ ...scene, kind: 'gap', path: '', duration: duration / speed, trimStart: 0, speed: 1,
    muted: true, volume: 0, scale: 1, positionX: 0, positionY: 0, opacity: 1, brightness: 0, contrast: 1,
    saturation: 1, rotation: 0, flipX: false, flipY: false, transition: 'none', fade: 0, keyframes: [] },
  { hasVideo: true, hasAudio: false, duration: 0 }, index);
}

function keyframeExpression(scene, property, timeVariable = 't') {
  const points = [{ time: 0, value: scene[property] }];
  for (const keyframe of scene.keyframes) {
    if (keyframe[property] === undefined) continue;
    const point = { time: keyframe.time, value: keyframe[property] };
    if (points.at(-1).time === point.time) points[points.length - 1] = point;
    else points.push(point);
  }
  let expression = number(points.at(-1).value);
  for (let index = points.length - 2; index >= 0; index--) {
    const left = points[index], right = points[index + 1];
    const interpolation = `${number(left.value)}+(${number(right.value - left.value)})*(${timeVariable}-${number(left.time)})/${number(right.time - left.time)}`;
    expression = `if(lt(${timeVariable},${number(right.time)}),${interpolation},${expression})`;
  }
  return expression;
}

function buildSceneArguments(scene, settings, outputPath) {
  const { width, height, fps, preset, crf } = settings;
  const args = ['-y', '-hide_banner', '-threads', '2', '-filter_complex_threads', '1'];
  if (scene.isGap) args.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}`);
  else if (scene.isImage) args.push('-loop', '1', '-framerate', String(fps), '-i', scene.path);
  else args.push('-ss', number(scene.trimStart), '-i', scene.path);
  const sourceAudio = !scene.isImage && !scene.isGap && scene.meta.hasAudio && scene.muted !== true;
  if (!sourceAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  const video = [`trim=duration=${number(scene.duration)}`, `setpts=(PTS-STARTPTS)/${number(scene.speed)}`];
  const rotation = Number(scene.rotation);
  if (rotation === 90) video.push('transpose=1');
  if (rotation === 270) video.push('transpose=2');
  if (rotation === 180) video.push('hflip', 'vflip');
  if (scene.flipX) video.push('hflip');
  if (scene.flipY) video.push('vflip');
  video.push(scene.fit === 'fill'
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
    : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`);
  video.push('setsar=1', `eq=brightness=${number(scene.brightness)}:contrast=${number(scene.contrast)}:saturation=${number(scene.saturation)}`, `fps=${fps}`);
  const scale = keyframeExpression(scene, 'scale');
  video.push('format=rgba');
  if (scene.keyframes.some(keyframe => keyframe.opacity !== undefined)) {
    video.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*(${keyframeExpression(scene, 'opacity', 'T')})'`);
  } else if (scene.opacity !== 1) video.push(`colorchannelmixer=aa=${number(scene.opacity)}`);
  // geq allocates its configured frame size. Apply it before dynamic scaling,
  // otherwise a changing scale is padded back to the initial geometry.
  video.push(`scale=w='max(2,trunc(${width}*(${scale})/2)*2)':h='max(2,trunc(${height}*(${scale})/2)*2)':eval=frame`);
  const chains = [`[0:v]${video.join(',')}[clip]`,
    `color=c=black:s=${width}x${height}:r=${fps}:d=${number(scene.outputDuration)}[canvas]`,
    `[canvas][clip]overlay=x='(W-w)/2+W*(${keyframeExpression(scene, 'positionX')})/100':y='(H-h)/2+H*(${keyframeExpression(scene, 'positionY')})/100':eval=frame:shortest=1:format=auto,format=yuv420p${scene.fade > 0 ? `,fade=t=in:st=0:d=${number(scene.fade)},fade=t=out:st=${number(scene.outputDuration - scene.fade)}:d=${number(scene.fade)}` : ''}[v]`];
  const audio = sourceAudio ? [`atrim=duration=${number(scene.duration)}`, 'asetpts=PTS-STARTPTS', ...atempoFilters(scene.speed), `volume=${number(scene.volume)}`] : ['asetpts=PTS-STARTPTS'];
  if (sourceAudio && scene.noiseReduction) audio.push('highpass=f=80', 'lowpass=f=14000', 'afftdn=nf=-25');
  if (sourceAudio && scene.normalizeAudio) audio.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  if (scene.fade > 0) audio.push(`afade=t=in:st=0:d=${number(scene.fade)}`, `afade=t=out:st=${number(scene.outputDuration - scene.fade)}:d=${number(scene.fade)}`);
  audio.push('apad', `atrim=duration=${number(scene.outputDuration)}`);
  chains.push(`[${sourceAudio ? 0 : 1}:a]${audio.join(',')}[a]`);
  args.push('-filter_complex', chains.join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', preset, '-crf', String(crf),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', number(scene.outputDuration), '-movflags', '+faststart', outputPath);
  return args;
}

function buildAudioMixArguments(options, input, output, totalDuration) {
  const tracks = (options.audioTracks || []).filter(track => track.muted !== true);
  if (!tracks.length && !options.musicPath) return null;
  const args = ['-y', '-hide_banner', '-filter_complex_threads', '1', '-i', input];
  const chains = ['[0:a]volume=1[base]'], labels = ['[base]'];
  let inputIndex = 1;
  for (const track of tracks) {
    const start = numeric(track.start, 0, 0, 86400, 'Audio timeline start');
    const speed = numeric(track.speed, 1, .25, 4, 'Audio speed');
    const trimStart = numeric(track.trimStart, 0, 0, 86400, 'Audio trim start');
    const duration = Math.min(numeric(track.duration, totalDuration, Number.EPSILON, 86400, 'Audio duration'), Math.max(0, totalDuration - start));
    if (duration <= 0) continue;
    args.push('-i', track.path);
    const audio = [`atrim=start=${number(trimStart)}:duration=${number(duration * speed)}`, 'asetpts=PTS-STARTPTS', ...atempoFilters(speed),
      `volume=${number(numeric(track.volume, 1, 0, 2, 'Audio volume'))}`];
    audio.push('aresample=48000');
    if (track.fadeEnvelope !== undefined) {
      const envelope = track.fadeEnvelope;
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('Audio fade envelope is invalid.');
      const originalDuration = numeric(envelope.duration, NaN, Number.EPSILON, 86400, 'Audio fade original duration');
      const offset = numeric(envelope.offset, NaN, 0, originalDuration, 'Audio fade offset');
      const fadeIn = numeric(envelope.fadeIn, NaN, 0, 86400, 'Audio fade in');
      const fadeOut = numeric(envelope.fadeOut, NaN, 0, 86400, 'Audio fade out');
      if (offset + Number(track.duration) > originalDuration + 1e-7) throw new Error('Audio fade envelope exceeds its original clip.');
      const gain = [];
      if (fadeIn) gain.push(`max(0,min(1,(t+${number(offset)})/${number(fadeIn)}))`);
      if (fadeOut) gain.push(`max(0,min(1,(${number(originalDuration)}-(t+${number(offset)}))/${number(fadeOut)}))`);
      if (gain.length) {
        // Explicit channels avoid val(ch)/layout renegotiation in some FFmpeg
        // builds. Export's mix is stereo, so use the same layout here too.
        audio.push('aformat=channel_layouts=stereo');
        audio.push(`aeval='val(0)*${gain.join('*')}|val(1)*${gain.join('*')}':c=stereo`);
      }
    } else {
      const fadeIn = Math.min(duration, numeric(track.fadeIn, 0, 0, 86400, 'Audio fade in'));
      const fadeOut = Math.min(duration, numeric(track.fadeOut, 0, 0, 86400, 'Audio fade out'));
      if (fadeIn) audio.push(`afade=t=in:st=0:d=${number(fadeIn)}`);
      if (fadeOut) audio.push(`afade=t=out:st=${number(duration - fadeOut)}:d=${number(fadeOut)}`);
    }
    audio.push('apad', `atrim=duration=${number(duration)}`, `adelay=${Math.round(start * 48000)}S:all=1`);
    chains.push(`[${inputIndex}:a]${audio.join(',')}[a${inputIndex}]`); labels.push(`[a${inputIndex++}]`);
  }
  if (options.musicPath) {
    args.push('-stream_loop', '-1', '-i', options.musicPath);
    chains.push(`[${inputIndex}:a]volume=${number(numeric(options.musicVolume, .18, 0, 1.5, 'Music volume'))},afade=t=out:st=${number(Math.max(0, totalDuration - 2))}:d=${number(Math.min(2, totalDuration))}[music]`);
    labels.push('[music]');
  }
  chains.push(`${labels.join('')}amix=inputs=${labels.length}:duration=first:dropout_transition=0:normalize=0[a]`);
  args.push('-filter_complex', chains.join(';'), '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k',
    '-t', number(totalDuration), '-movflags', '+faststart', output);
  return args;
}

function parseProbe(raw) {
  const result = JSON.parse(raw), streams = result.streams || [];
  const video = streams.find(stream => stream.codec_type === 'video');
  const audio = streams.find(stream => stream.codec_type === 'audio');
  const rate = String(video?.avg_frame_rate || video?.r_frame_rate || '0/1').split('/').map(Number);
  return { duration: Number(result.format?.duration || video?.duration) || 0, width: Number(video?.width) || 0, height: Number(video?.height) || 0,
    hasVideo: Boolean(video), hasAudio: Boolean(audio), audioChannels: Number(audio?.channels) || 0, audioCodec: String(audio?.codec_name || ''), formatName: result.format?.format_name || '',
    videoBitrate: Number(video?.bit_rate || result.format?.bit_rate) || 0, frameRate: rate[1] ? rate[0] / rate[1] : rate[0] || 0,
    videoCodec: String(video?.codec_name || ''), pixelFormat: String(video?.pix_fmt || ''), colorSpace: String(video?.color_space || ''),
    colorTransfer: String(video?.color_transfer || ''), colorPrimaries: String(video?.color_primaries || '') };
}

function createMyExporterEngine(dependencies = {}) {
  const jobs = new Map(), outputOwners = new Map(), preflights = new Map();
  const spawnProcess = dependencies.spawn || spawn;
  const findFFmpeg = dependencies.findFFmpeg || (() => 'ffmpeg');
  const ffprobeFor = executable => dependencies.ffprobePath || path.join(path.dirname(executable), path.basename(executable).replace(/^ffmpeg/i, 'ffprobe'));
  const check = job => { if (job.cancelled) throw cancelledError(); };
  const report = (job, pct, phase) => {
    check(job); job.progress = Math.max(job.progress, Math.min(99, Math.round(pct)));
    try { job.onProgress?.({ jobId: job.id, pct: job.progress, phase }); } catch (_) {}
    check(job);
  };
  const run = (job, executable, args, phase, start, span, duration, capture = false) => new Promise((resolve, reject) => {
    try { check(job); } catch (error) { reject(error); return; }
    let proc, stderr = '', stdout = '', settled = false;
    const finish = error => {
      if (settled) return; settled = true;
      if (job.process === proc) job.process = null;
      if (job.cancelled) reject(cancelledError());
      else if (error) reject(error);
      else resolve(stdout);
    };
    try { proc = spawnProcess(executable, args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'], windowsHide: true }); }
    catch (error) { finish(error); return; }
    job.process = proc;
    proc.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr?.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-12000);
      const matches = [...chunk.toString().matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
      if (matches.length && duration > 0 && !job.cancelled) {
        const match = matches.at(-1), seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        try { report(job, start + seconds / duration * span, phase); } catch (_) {}
      }
    });
    proc.once('error', finish);
    proc.once('close', code => finish(code === 0 ? null : new Error(`${phase} failed: ${stderr.slice(-1200)}`)));
    if (job.cancelled) { try { proc.kill('SIGTERM'); } catch (_) {} }
  });
  const probe = async (job, filename) => parseProbe(await run(job, ffprobeFor(job.ffmpeg), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename], 'Reading media', 0, 0, 0, true));
  async function probeMedia(filename) {
    const before = fs.statSync(filename);
    const result = await probe({ ffmpeg: findFFmpeg(), cancelled: false, process: null, progress: 0 }, filename);
    const after = fs.statSync(filename);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('The media changed while reading it. Try importing it again.');
    return { ...result, fileSize: after.size, modifiedAt: after.mtimeMs };
  }
  async function waveform(options = {}) {
    const filename = options.filePath || options.path;
    const before = fs.statSync(filename);
    if (!before.isFile()) throw new Error('Select a media file to build its waveform.');
    const bars = numeric(options.bars, 120, 1, 2000, 'Waveform bars');
    if (!Number.isInteger(bars)) throw new Error('Waveform bars must be a whole number.');
    const metadata = await probeMedia(filename);
    const trimStart = numeric(options.trimStart, 0, 0, metadata.duration, 'Waveform trim start');
    const remaining = Math.max(0, metadata.duration - trimStart);
    const duration = Math.min(remaining, numeric(options.duration, remaining, 0, 86400, 'Waveform duration'));
    const peaks = Array(bars).fill(0), sampleRate = 8000;
    if (metadata.hasAudio && duration > 0) {
      // Retain every channel: a mono/stereo downmix can attenuate or cancel real audio.
      const channels = numeric(metadata.audioChannels, 1, 1, 64, 'Audio channels'), frameBytes = channels * 4;
      const args = ['-v', 'error', '-ss', number(trimStart), '-i', filename, '-t', number(duration), '-map', '0:a:0',
        '-vn', '-sn', '-dn', '-ar', String(sampleRate), '-af', `aresample=${sampleRate}:async=1:first_pts=0`,
        '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'];
      await new Promise((resolve, reject) => {
        let process, stderr = '', carry = Buffer.alloc(0), frameIndex = 0, settled = false;
        const finish = error => { if (settled) return; settled = true; error ? reject(error) : resolve(); };
        try { process = spawnProcess(findFFmpeg(), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
        catch (error) { finish(error); return; }
        process.stdout.on('data', chunk => {
          const bytes = carry.length ? Buffer.concat([carry, chunk]) : chunk;
          const end = bytes.length - bytes.length % frameBytes;
          for (let offset = 0; offset < end; offset += frameBytes, frameIndex++) {
            let peak = 0;
            for (let channel = 0; channel < channels; channel++) peak = Math.max(peak, Math.abs(bytes.readFloatLE(offset + channel * 4)));
            peak = Math.min(1, peak);
            const bar = Math.min(bars - 1, Math.floor(frameIndex / (duration * sampleRate) * bars));
            if (Number.isFinite(peak)) peaks[bar] = Math.max(peaks[bar], peak);
          }
          carry = bytes.subarray(end);
        });
        process.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
        process.once('error', finish);
        process.once('close', code => finish(code === 0 && frameIndex > 0 ? null : new Error(`Building waveform failed: ${stderr.slice(-1200) || 'no audio samples were decoded.'}`)));
      });
    }
    const after = fs.statSync(filename);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('The media changed while building its waveform. Import it again.');
    return { peaks: peaks.map(peak => Number(peak.toFixed(6))), duration, trimStart, sourceDuration: metadata.duration,
      hasAudio: metadata.hasAudio, fileSize: after.size, modifiedAt: after.mtimeMs };
  }
  function captionCacheFiles(key) {
    if (typeof key !== 'string' || !key.trim() || key.length > 32768) throw new Error('Caption cache key is invalid.');
    const directory = dependencies.cacheDirectory || path.join(os.tmpdir(), 'pattan-caption-cache');
    const filename = path.join(directory, crypto.createHash('sha256').update(key).digest('hex') + '.json');
    let legacy;
    try {
      const encoded = encodeURIComponent(key) + '.json';
      if (encoded.length <= 240 && !/[<>:"/\\|?*\x00-\x1f]/.test(encoded) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(encoded)) legacy = path.join(directory, encoded);
    } catch (_) {}
    return { directory, filename, legacy };
  }
  function validCaptionCacheData(data) {
    const transcript = data?.transcript;
    if (!data || typeof data !== 'object' || Array.isArray(data) || !transcript || transcript.ok !== true) return false;
    const words = Array.isArray(transcript.words) ? transcript.words : [];
    const intervals = words.length ? words : Array.isArray(transcript.segments) ? transcript.segments : [];
    if (!intervals.length) return false;
    let previousEnd = 0;
    return intervals.every(interval => {
      const text = words.length ? interval.word ?? interval.text : interval.text;
      const valid = typeof text === 'string' && Boolean(text.trim()) && typeof interval.start === 'number' && typeof interval.end === 'number'
        && Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.start >= previousEnd && interval.end > interval.start;
      previousEnd = interval.end;
      return valid;
    });
  }
  function loadCaptionCache(key) {
    try {
      const { filename, legacy } = captionCacheFiles(key);
      for (const candidate of [filename, legacy].filter(Boolean)) {
        if (!fs.existsSync(candidate) || fs.statSync(candidate).size > 20 * 1024 * 1024) continue;
        try {
          const data = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          if (validCaptionCacheData(data)) return { ok: true, found: true, data };
        } catch (_) {}
      }
      return { ok: true, found: false, data: null };
    } catch (error) { return { ok: false, found: false, data: null, error: error.message }; }
  }
  function saveCaptionCache(key, data) {
    let temporary;
    try {
      const { directory, filename } = captionCacheFiles(key);
      if (!validCaptionCacheData(data)) throw new Error('Caption cache requires a successful transcript with increasing, non-overlapping timestamps.');
      const serialized = JSON.stringify(data);
      if (Buffer.byteLength(serialized) > 20 * 1024 * 1024) throw new Error('Caption cache data is too large.');
      fs.mkdirSync(directory, { recursive: true });
      temporary = filename + '.' + crypto.randomUUID() + '.tmp';
      fs.writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, filename); temporary = null;
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
    finally { if (temporary) { try { fs.unlinkSync(temporary); } catch (_) {} } }
  }
  function validate(options = {}) {
    const errors = [], warnings = [];
    const preflightId = typeof options.jobId === 'string' && options.jobId ? options.jobId : null;
    for (const [id, state] of preflights) if (Date.now() - state.createdAt > 10 * 60 * 1000) preflights.delete(id);
    if (preflightId && jobs.has(preflightId)) return { ok: false, errors: ['This export job is already running.'], warnings, exportCapabilitiesVersion: EXPORT_CAPABILITIES_VERSION, audioRangeFadeEnvelope: true };
    if (preflightId) {
      if (preflights.size >= 128 && !preflights.has(preflightId)) preflights.delete(preflights.keys().next().value);
      preflights.set(preflightId, { cancelled: preflights.get(preflightId)?.cancelled || false, createdAt: Date.now() });
    }
    try {
      resolveDimensions(options); const executable = findFFmpeg();
      if (!Array.isArray(options.scenes) || !options.scenes.length) throw new Error('Add at least one video or image scene.');
      for (const [index, scene] of options.scenes.entries()) {
        if (scene.disabled === true) { normalizeDisabledScene(scene, index); continue; }
        if (scene.kind === 'gap') { normalizeScene(scene, { hasVideo: true, hasAudio: false, duration: 0 }, index); continue; }
        if (!scene.path || !fs.existsSync(scene.path)) throw new Error(`${scene.name || 'Scene'}: source file is missing or was moved.`);
        const meta = dependencies.probe ? dependencies.probe(scene.path) : parseProbe(execFileSync(ffprobeFor(executable), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', scene.path], { encoding: 'utf8', windowsHide: true, timeout: 20000 }));
        normalizeScene(scene, meta, index);
      }
      for (const track of options.audioTracks || []) if (!track.muted && (!track.path || !fs.existsSync(track.path))) throw new Error(`${track.name || 'Audio track'}: source file is missing or was moved.`);
      for (const filename of [options.musicPath, options.watermarkPath]) if (filename && !fs.existsSync(filename)) throw new Error('Selected music or watermark file is missing or was moved.');
      buildAudioMixArguments(options, 'input.mp4', 'output.mp4', 60);
    } catch (error) { errors.push(error.message); }
    if (errors.length && preflightId) preflights.delete(preflightId);
    return { ok: !errors.length, errors, warnings, exportCapabilitiesVersion: EXPORT_CAPABILITIES_VERSION, audioRangeFadeEnvelope: true };
  }
  async function preflight(options = {}) {
    const jobId = String(options.jobId || `preflight-${crypto.randomUUID()}`), errors = [], warnings = [];
    if (jobs.has(jobId)) return { ok: false, errors: ['This export job is already running.'], warnings, exportCapabilitiesVersion: EXPORT_CAPABILITIES_VERSION, audioRangeFadeEnvelope: true };
    const job = { id: jobId, cancelled: preflights.get(jobId)?.cancelled || false, process: null, progress: 0, committed: false };
    jobs.set(jobId, job);
    try {
      check(job); resolveDimensions(options); job.ffmpeg = findFFmpeg();
      if (!Array.isArray(options.scenes) || !options.scenes.length) throw new Error('Add at least one video or image scene.');
      for (const [index, scene] of options.scenes.entries()) {
        check(job);
        if (scene.disabled === true) { normalizeDisabledScene(scene, index); continue; }
        if (scene.kind === 'gap') { normalizeScene(scene, { hasVideo: true, hasAudio: false, duration: 0 }, index); continue; }
        if (!scene.path || !fs.existsSync(scene.path)) throw new Error(`${scene.name || 'Scene'}: source file is missing or was moved.`);
        normalizeScene(scene, await probe(job, scene.path), index);
      }
      check(job);
      for (const track of options.audioTracks || []) if (!track.muted && (!track.path || !fs.existsSync(track.path))) throw new Error(`${track.name || 'Audio track'}: source file is missing or was moved.`);
      for (const filename of [options.musicPath, options.watermarkPath]) if (filename && !fs.existsSync(filename)) throw new Error('Selected music or watermark file is missing or was moved.');
      buildAudioMixArguments(options, 'input.mp4', 'output.mp4', 60);
      check(job);
    } catch (error) { errors.push(job.cancelled ? 'Export cancelled.' : error.message); }
    finally {
      if (jobs.get(jobId) === job) jobs.delete(jobId);
      for (const [id, state] of preflights) if (Date.now() - state.createdAt > 10 * 60 * 1000) preflights.delete(id);
      if (options.jobId && (!errors.length || job.cancelled)) {
        if (preflights.size >= 128 && !preflights.has(jobId)) preflights.delete(preflights.keys().next().value);
        preflights.set(jobId, { cancelled: job.cancelled, createdAt: Date.now() });
      } else preflights.delete(jobId);
    }
    return { ok: !errors.length, errors, warnings, ...(job.cancelled ? { cancelled: true } : {}), exportCapabilitiesVersion: EXPORT_CAPABILITIES_VERSION, audioRangeFadeEnvelope: true };
  }
  function cancel(jobId) {
    if (typeof jobId !== 'string' || !jobId) return { ok: false, cancelled: false, error: 'Specify the export job to cancel.' };
    const job = jobs.get(jobId);
    if (!job) {
      const pending = preflights.get(jobId);
      if (pending) { pending.cancelled = true; return { ok: true, jobId, cancelled: true }; }
      return { ok: true, jobId, cancelled: false };
    }
    if (job.committed) return { ok: true, jobId, cancelled: false };
    job.cancelled = true;
    try { job.process?.kill('SIGTERM'); } catch (_) {}
    return { ok: true, jobId, cancelled: true };
  }
  async function exportVideo(options = {}, callbacks = {}) {
    const jobId = String(options.jobId || `export-${crypto.randomUUID()}`);
    if (jobs.has(jobId)) return { ok: false, jobId, error: 'This export job is already running.' };
    const pending = preflights.get(jobId); preflights.delete(jobId);
    if (pending?.cancelled) return { ok: false, jobId, cancelled: true, error: 'Export cancelled.' };
    const job = { id: jobId, cancelled: false, process: null, progress: 0, onProgress: callbacks.onProgress, committed: false };
    jobs.set(jobId, job);
    let workDir, stagedPath;
    try {
      job.ffmpeg = findFFmpeg();
      const [width, height] = dependencies.outputDimensions || resolveDimensions(options);
      const fps = [24, 25, 30, 50, 60].includes(Number(options.fps)) ? Number(options.fps) : 30;
      const preset = options.quality === 'maximum' ? 'slow' : options.quality === 'small' ? 'veryfast' : 'medium';
      const crf = options.quality === 'maximum' ? 16 : options.quality === 'small' ? 23 : 19;
      if (!Array.isArray(options.scenes) || !options.scenes.length) throw new Error('Add at least one video or image scene.');
      report(job, 1, 'Preparing timeline');
      const scenes = [];
      for (const [index, scene] of options.scenes.entries()) {
        check(job);
        if (scene.disabled === true) { scenes.push(normalizeDisabledScene(scene, index)); continue; }
        if (scene.kind === 'gap') { scenes.push(normalizeScene(scene, { hasVideo: true, hasAudio: false, duration: 0 }, index)); continue; }
        if (!scene.path || !fs.existsSync(scene.path)) throw new Error(`${scene.name || 'Scene'}: source file is missing or was moved.`);
        scenes.push(normalizeScene(scene, await probe(job, scene.path), index));
      }
      let outputPath = options.outputPath;
      if (!outputPath) {
        const directory = dependencies.defaultOutputDirectory?.() || path.join(os.homedir(), 'Downloads');
        const base = String(options.outputName || 'My-Exporter').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
        const name = base.toLowerCase().endsWith('.mp4') ? base : base + '.mp4';
        outputPath = path.join(directory, name);
        const parsed = path.parse(outputPath); let suffix = 0;
        while (fs.existsSync(outputPath)) outputPath = path.join(directory, `${parsed.name} (${++suffix}).mp4`);
      }
      outputPath = path.resolve(outputPath);
      if (path.extname(outputPath).toLowerCase() !== '.mp4') throw new Error('Choose an MP4 output filename.');
      const protectedInputs = [...options.scenes.map(scene => scene.path), ...(options.audioTracks || []).map(track => track.path), options.musicPath, options.watermarkPath].filter(Boolean);
      if (protectedInputs.some(filename => path.resolve(filename).toLowerCase() === outputPath.toLowerCase())) throw new Error('An uploaded source cannot be overwritten. Choose another output filename.');
      const outputIdentity = outputPath.toLowerCase();
      if (outputOwners.has(outputIdentity)) throw new Error('Another export is writing this output filename. Choose another filename or wait for it to finish.');
      outputOwners.set(outputIdentity, job); job.outputIdentity = outputIdentity;
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pattan-my-exporter-'));
      stagedPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${crypto.randomUUID()}.staged.mp4`);
      const totalDuration = scenes.reduce((sum, scene) => sum + scene.outputDuration, 0);
      const segmentPaths = [];
      for (let index = 0; index < scenes.length; index++) {
        check(job); const scene = scenes[index], filename = path.join(workDir, `segment-${index}.mp4`);
        report(job, 3 + index / scenes.length * 54, `Rendering scene ${index + 1} of ${scenes.length}`);
        await run(job, job.ffmpeg, buildSceneArguments(scene, { width, height, fps, preset, crf }, filename), `Rendering scene ${index + 1}`, 3 + index / scenes.length * 54, 54 / scenes.length, scene.outputDuration);
        segmentPaths.push(filename);
      }
      check(job);
      const list = path.join(workDir, 'timeline.txt'), joined = path.join(workDir, 'joined.mp4');
      fs.writeFileSync(list, segmentPaths.map(filename => `file '${filename.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
      report(job, 58, 'Joining scenes');
      await run(job, job.ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', joined], 'Joining scenes', 58, 8, totalDuration);
      let mixed = joined;
      for (const track of options.audioTracks || []) if (!track.muted && (!track.path || !fs.existsSync(track.path))) throw new Error('An audio track source is missing or was moved.');
      if (options.musicPath && !fs.existsSync(options.musicPath)) throw new Error('Background music is missing or was moved.');
      const mixArgs = buildAudioMixArguments(options, joined, path.join(workDir, 'mixed.mp4'), totalDuration);
      if (mixArgs) {
        mixed = path.join(workDir, 'mixed.mp4'); report(job, 67, 'Mixing audio tracks');
        await run(job, job.ffmpeg, mixArgs, 'Mixing audio tracks', 67, 10, totalDuration);
      }
      const context = { inputPath: mixed, stagedPath, outputPath, workDir, width, height, fps, preset, crf, totalDuration, jobId,
        run: (args, phase, start = 78, span = 20, duration = totalDuration) => run(job, job.ffmpeg, args, phase, start, span, duration) };
      check(job); report(job, 78, 'Finishing MP4');
      if (callbacks.finish) await callbacks.finish(context);
      else await context.run(['-y', '-i', mixed, '-c', 'copy', '-t', number(totalDuration), '-movflags', '+faststart', stagedPath], 'Finishing MP4');
      check(job); report(job, 99, 'Verifying MP4');
      const actual = await probe(job, stagedPath);
      if (!actual.hasVideo || !actual.hasAudio || actual.width !== width || actual.height !== height || !actual.formatName.includes('mp4')
          || Math.abs(actual.duration - totalDuration) > Math.max(.2, scenes.length * 2 / fps)) throw new Error('Export verification failed: MP4 streams, dimensions or duration do not match the timeline.');
      check(job);
      fs.renameSync(stagedPath, outputPath); stagedPath = null; job.committed = true;
      try { job.onProgress?.({ jobId, pct: 100, phase: 'Export complete', outputPath }); } catch (_) {}
      return { ok: true, jobId, outputPath, fileName: path.basename(outputPath), width, height, duration: totalDuration, exportCapabilitiesVersion: EXPORT_CAPABILITIES_VERSION };
    } catch (error) {
      return { ok: false, jobId, ...(job.cancelled || error.code === 'MY_EXPORTER_CANCELLED' ? { cancelled: true } : {}), error: job.cancelled ? 'Export cancelled.' : error.message };
    } finally {
      if (stagedPath) { try { fs.unlinkSync(stagedPath); } catch (_) {} }
      if (workDir) {
        const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(workDir));
        if (relative && !path.isAbsolute(relative) && !relative.startsWith('..') && path.basename(workDir).startsWith('pattan-my-exporter-')) {
          try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
        }
      }
      if (job.outputIdentity && outputOwners.get(job.outputIdentity) === job) outputOwners.delete(job.outputIdentity);
      if (jobs.get(jobId) === job) jobs.delete(jobId);
    }
  }
  async function exportCrop(options = {}, callbacks = {}) {
    const jobId = String(options.jobId || `crop-${crypto.randomUUID()}`);
    if (jobs.has(jobId)) return { ok: false, jobId, error: 'This export job is already running.' };
    const job = { id: jobId, cancelled: false, process: null, progress: 0, onProgress: callbacks.onProgress, committed: false };
    jobs.set(jobId, job);
    let stagedPath;
    try {
      const inputPath = path.resolve(String(options.inputPath || ''));
      if (!options.inputPath || !fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) throw new Error('Select an existing source video to crop.');
      if (!options.outputPath) throw new Error('Choose an MP4 output filename.');
      const outputPath = path.resolve(String(options.outputPath));
      if (path.extname(outputPath).toLowerCase() !== '.mp4') throw new Error('Choose an MP4 output filename.');
      if (inputPath.toLowerCase() === outputPath.toLowerCase()) throw new Error('The original uploaded video cannot be overwritten. Choose another output filename.');
      job.ffmpeg = findFFmpeg(); report(job, 1, 'Reading crop source');
      const before = fs.statSync(inputPath), metadata = await probe(job, inputPath);
      if (!metadata.hasVideo || !(metadata.width >= 2 && metadata.height >= 2 && metadata.duration > 0)) throw new Error('The selected source has no usable video stream.');
      const start = numeric(options.start, 0, 0, metadata.duration, 'Crop start');
      const end = numeric(options.end, metadata.duration, 0, metadata.duration + .001, 'Crop end');
      if (end <= start) throw new Error('Crop end must be after its start.');
      const duration = Math.min(end, metadata.duration) - start;
      const rect = options.crop || { x: 0, y: 0, width: 100, height: 100 };
      const x = numeric(rect.x, 0, 0, 100, 'Crop left'), y = numeric(rect.y, 0, 0, 100, 'Crop top');
      const percentageWidth = numeric(rect.width, 100, .001, 100, 'Crop width'), percentageHeight = numeric(rect.height, 100, .001, 100, 'Crop height');
      if (x + percentageWidth > 100 + 1e-7 || y + percentageHeight > 100 + 1e-7) throw new Error('The crop rectangle extends beyond the source picture.');
      const left = Math.floor(metadata.width * x / 200) * 2, top = Math.floor(metadata.height * y / 200) * 2;
      const width = Math.floor((Math.min(metadata.width, Math.floor(metadata.width * (x + percentageWidth) / 100)) - left) / 2) * 2;
      const height = Math.floor((Math.min(metadata.height, Math.floor(metadata.height * (y + percentageHeight) / 100)) - top) / 2) * 2;
      if (width < 2 || height < 2) throw new Error('Choose a crop of at least two pixels in each dimension.');
      const outputIdentity = outputPath.toLowerCase();
      if (outputOwners.has(outputIdentity)) throw new Error('Another export is writing this output filename. Choose another filename or wait for it to finish.');
      outputOwners.set(outputIdentity, job); job.outputIdentity = outputIdentity;
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      stagedPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${crypto.randomUUID()}.staged.mp4`);
      const args = ['-y', '-hide_banner', '-threads', '2', '-ss', number(start), '-i', inputPath, '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', `crop=${width}:${height}:${left}:${top},setsar=1`, '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p'];
      if (metadata.frameRate > 0) args.push('-r', metadata.frameRate.toFixed(9));
      if (metadata.videoBitrate > 0) args.push('-b:v', String(Math.round(metadata.videoBitrate)));
      else args.push('-crf', '19');
      if (['aac', 'mp3', 'ac3', 'eac3', 'alac'].includes(metadata.audioCodec)) args.push('-c:a', 'copy');
      else args.push('-c:a', 'aac', '-b:a', '192k');
      args.push('-t', number(duration), '-movflags', '+faststart', stagedPath);
      report(job, 3, 'Saving cropped video');
      await run(job, job.ffmpeg, args, 'Saving cropped video', 3, 95, duration);
      check(job); report(job, 99, 'Verifying cropped MP4');
      const actual = await probe(job, stagedPath), after = fs.statSync(inputPath);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('The source changed during crop export. Try again with the current file.');
      if (!actual.hasVideo || actual.hasAudio !== metadata.hasAudio || !actual.formatName.includes('mp4') || actual.width !== width || actual.height !== height
        || Math.abs(actual.duration - duration) > Math.max(.2, 2 / (metadata.frameRate || 30))) throw new Error('Crop verification failed: streams, dimensions or duration do not match.');
      check(job); fs.renameSync(stagedPath, outputPath); stagedPath = null; job.committed = true;
      try { job.onProgress?.({ jobId, pct: 100, phase: 'Cropped video ready', outputPath }); } catch (_) {}
      return { ok: true, jobId, outputPath, fileName: path.basename(outputPath), width, height, duration,
        frameRate: actual.frameRate, videoBitrate: actual.videoBitrate, sourceBitrate: metadata.videoBitrate,
        hasAudio: actual.hasAudio, cropPixels: { x: left, y: top, width, height }, exportCapabilitiesVersion: EXPORT_CAPABILITIES_VERSION };
    } catch (error) {
      return { ok: false, jobId, ...(job.cancelled || error.code === 'MY_EXPORTER_CANCELLED' ? { cancelled: true } : {}), error: job.cancelled ? 'Export cancelled.' : error.message };
    } finally {
      if (stagedPath) { try { fs.unlinkSync(stagedPath); } catch (_) {} }
      if (job.outputIdentity && outputOwners.get(job.outputIdentity) === job) outputOwners.delete(job.outputIdentity);
      if (jobs.get(jobId) === job) jobs.delete(jobId);
    }
  }
  return { validate, preflight, exportVideo, exportCrop, cancel, probeMedia, waveform, loadCaptionCache, saveCaptionCache };
}

module.exports = { EXPORT_CAPABILITIES_VERSION, resolveDimensions, atempoFilters, normalizeScene, keyframeExpression, buildSceneArguments, buildAudioMixArguments, createMyExporterEngine };
