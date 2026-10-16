'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { createVideoOutputPath } = require('./video-output-name.cjs');

function runFile(executable, args, options = {}) {
  const { onStdout, ...execOptions } = options;
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, { windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024, ...execOptions },
      (error, stdout, stderr) => error ? reject(new Error(String(stderr || error.message).slice(-2000))) : resolve(stdout));
    if (typeof onStdout === 'function') child.stdout.on('data', chunk => onStdout(String(chunk)));
  });
}

async function findCaptionPython(root, execute = runFile, quality = 'ai') {
  if (quality !== 'ai' && quality !== 'quick') throw new Error('Choose AI or Quick caption erasing quality.');
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    process.env.CAPTION_ERASER_PYTHON,
    path.join(root, '.caption-eraser-venv', 'Scripts', 'python.exe'),
    path.join(os.homedir(), '.cache', 'pattan-caption-eraser', '.caption-eraser-venv', 'Scripts', 'python.exe'),
    ...['.voiceclone-venv', '.singing-venv'].map(name => path.join(root, name, 'Scripts', 'python.exe')),
    ...['Python310', 'Python311', 'Python312', 'Python313', 'Python314'].map(name => path.join(local, 'Programs', 'Python', name, 'python.exe')),
    'python', 'python3',
  ].filter(Boolean);
  for (const executable of [...new Set(candidates)]) {
    if (path.isAbsolute(executable) && !fs.existsSync(executable)) continue;
    try {
      const imports = quality === 'ai' ? 'import cv2, numpy, torch' : 'import cv2, numpy';
      await execute(executable, ['-I', '-c', `${imports}; print("caption-eraser-ready")`], { timeout: 15000 });
      return executable;
    } catch (_) {}
  }
  if (quality === 'ai') {
    throw new Error('AI caption erasing needs a local Python runtime with PyTorch, OpenCV and NumPy. Run Setup-Caption-Eraser-AI.ps1, or set CAPTION_ERASER_PYTHON to a runtime with these packages. Quick quality remains available for OpenCV repair.');
  }
  throw new Error('Quick caption erasing needs a local Python runtime with OpenCV and NumPy. Run Setup-Caption-Eraser-AI.ps1, or set CAPTION_ERASER_PYTHON to that Python executable.');
}

function runCaptionWorker(executable, args, onProgress, options = {}) {
  const spawnProcess = options.spawnProcess || spawn;
  return new Promise((resolve, reject) => {
    let child;
    let pending = '';
    let stderr = '';
    let result;
    let ended = false;
    let idleTimer;
    let killTimer;
    let fatalError;
    const finish = (error, value) => {
      if (ended) return;
      ended = true;
      clearTimeout(idleTimer);
      clearTimeout(killTimer);
      error ? reject(error) : resolve(value);
    };
    const abort = error => {
      if (ended || fatalError) return;
      fatalError = error;
      try { child.kill(); } catch (_) {}
      killTimer = setTimeout(() => finish(error), 1500);
    };
    const refreshTimeout = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => abort(new Error('Caption erasing stopped responding.')), options.idleTimeoutMs || 600000);
    };
    function line(value) {
      if (!value.trim()) return;
      try {
        const entry = JSON.parse(value.replace(/^\uFEFF/, ''));
        if (entry.type === 'progress') onProgress(entry);
        else if (entry.type === 'result' || typeof entry.ok === 'boolean') result = entry;
      } catch (_) { /* Native library diagnostics are not protocol messages. */ }
    }
    try {
      child = spawnProcess(executable, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (ended || fatalError) return;
        refreshTimeout();
        pending += chunk;
        if (pending.length > 2 * 1024 * 1024) { abort(new Error('Caption detector returned excessive output.')); return; }
        let index;
        while ((index = pending.indexOf('\n')) >= 0) {
          line(pending.slice(0, index));
          pending = pending.slice(index + 1);
        }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); });
      child.once('error', error => finish(new Error(`Caption detector could not start: ${error.message}`)));
      child.once('close', code => {
        line(pending);
        if (fatalError) { finish(fatalError); return; }
        if (code !== 0 || !result || result.ok !== true) {
          finish(new Error(result?.error || stderr.trim() || `Caption detector exited with code ${code}.`));
        } else finish(null, result);
      });
      refreshTimeout();
    } catch (error) { finish(error); }
  });
}

function validateVideoResult(original, output) {
  const before = (original.streams || []).find(s => s.codec_type === 'video');
  const after = (output.streams || []).find(s => s.codec_type === 'video');
  if (!before || !after || !after.width || !after.height) throw new Error('The cleaned video could not be validated.');
  const displayDimensions = stream => {
    const rotated = (stream.side_data_list || []).some(s => Math.abs(Number(s.rotation)) % 180 === 90);
    return rotated ? [stream.height, stream.width] : [stream.width, stream.height];
  };
  const [expectedWidth, expectedHeight] = displayDimensions(before);
  const [actualWidth, actualHeight] = displayDimensions(after);
  if (actualWidth !== expectedWidth || actualHeight !== expectedHeight) throw new Error('Caption erasing changed the video dimensions.');
  const displayAspect = stream => {
    const parts = String(stream.sample_aspect_ratio || '1:1').split(':').map(Number);
    const sar = parts.length === 2 && parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : 1;
    const rotated = (stream.side_data_list || []).some(s => Math.abs(Number(s.rotation)) % 180 === 90);
    const ratio = stream.width * sar / stream.height;
    return rotated ? 1 / ratio : ratio;
  };
  if (Math.abs(displayAspect(before) / displayAspect(after) - 1) > .002) throw new Error('Caption erasing changed the video display aspect ratio.');
  const beforeDuration = Number(original.format?.duration || before.duration);
  const afterDuration = Number(output.format?.duration || after.duration);
  const rateParts = String(before.avg_frame_rate || '25/1').split('/').map(Number);
  const fps = rateParts.length === 2 ? rateParts[0] / rateParts[1] : rateParts[0];
  if (Number.isFinite(beforeDuration) && Number.isFinite(afterDuration)
      && Math.abs(beforeDuration - afterDuration) > Math.max(.15, 2 / (fps || 25))) {
    throw new Error('Caption erasing changed the video duration. The original file has been kept.');
  }
  const audioCount = streams => streams.filter(s => s.codec_type === 'audio').length;
  if (audioCount(original.streams || []) !== audioCount(output.streams || [])) throw new Error('Caption erasing did not preserve every audio track.');
  if ((output.streams || []).some(s => s.codec_type === 'subtitle')) throw new Error('Previous subtitle tracks remain in the cleaned video.');
}

function createCaptionEraser(options = {}) {
  const root = options.root || __dirname;
  const getFFmpeg = options.getFFmpeg || (() => 'ffmpeg');
  const execute = options.execute || runFile;
  const worker = options.runWorker || runCaptionWorker;
  const python = options.resolvePython || (quality => findCaptionPython(root, execute, quality));
  let active = false;
  const pythonExecutables = new Map();
  return async function eraseCaptions(request = {}, onProgress = () => {}) {
    if (active) return { ok: false, error: 'Caption erasing is already running. Wait for it to finish.' };
    const quality = request.quality === undefined ? 'ai' : request.quality;
    if (quality !== 'ai' && quality !== 'quick') {
      return { ok: false, error: 'Choose AI or Quick caption erasing quality.' };
    }
    const filePath = request.filePath;
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return { ok: false, error: 'Select an existing local video file to erase captions.' };
    }
    active = true;
    let directory;
    let outputPath;
    let outputOwned = false;
    let succeeded = false;
    const progress = value => {
      const pct = Math.max(0, Math.min(100, Number(value.pct ?? value.progress) || 0));
      onProgress({ ...value, filePath, jobId: request.jobId, pct, progress: pct, message: value.message || value.detail || value.phase });
    };
    try {
      const ffmpeg = getFFmpeg();
      const ffprobe = path.join(path.dirname(ffmpeg), path.basename(ffmpeg).replace(/^ffmpeg/i, 'ffprobe'));
      const probe = async file => JSON.parse(await execute(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
      progress({ pct: 1, phase: 'Checking video' });
      const original = await probe(filePath);
      if (!(original.streams || []).some(s => s.codec_type === 'video')) throw new Error('The selected file has no video stream.');
      const subtitleCount = (original.streams || []).filter(s => s.codec_type === 'subtitle').length;
      let pythonExecutable = pythonExecutables.get(quality);
      if (!pythonExecutable) {
        pythonExecutable = await python(quality);
        pythonExecutables.set(quality, pythonExecutable);
      }
      directory = await fsp.mkdtemp(path.join(options.tempPath || os.tmpdir(), 'caption-erase-'));
      const script = path.join(directory, 'caption-eraser-worker.py');
      const ocrScript = path.join(directory, 'caption-eraser-ocr.ps1');
      await fsp.copyFile(path.join(root, 'caption-eraser-worker.py'), script);
      await fsp.copyFile(path.join(root, 'scripts', 'caption-eraser-ocr.ps1'), ocrScript);
      const aiArgs = [];
      if (quality === 'ai') {
        await fsp.copyFile(path.join(root, 'caption-eraser-ai.py'), path.join(directory, 'caption-eraser-ai.py'));
        aiArgs.push('--ai-model', path.join(os.homedir(), '.cache', 'pattan-caption-eraser', 'big-lama.pt'));
      }
      const silentVideo = path.join(directory, 'cleaned.mkv');
      progress({ pct: 3, phase: 'Detecting previous captions' });
      const detected = await worker(pythonExecutable, ['-I', '-u', script,
        '--input', filePath, '--output', silentVideo, '--ffmpeg', ffmpeg, '--ffprobe', ffprobe,
        '--ocr-script', ocrScript, '--work-dir', directory, ...aiArgs], value => {
        progress({ ...value, pct: 3 + Math.min(100, Math.max(0, Number(value.pct ?? value.progress) || 0)) * .83 });
      });
      const engine = detected.engine || (quality === 'ai' ? 'Windows OCR + temporal recovery + LaMa AI' : 'Windows OCR + temporal recovery + OpenCV');
      if (!detected.changed && !subtitleCount) {
        progress({ pct: 100, phase: 'No previous captions detected' });
        return { ok: true, changed: false, noCaptionsDetected: true, detectedRegions: [], removedSubtitleTracks: 0, quality, engine };
      }
      if (detected.changed && (!fs.existsSync(silentVideo) || !fs.statSync(silentVideo).size)) throw new Error('Caption cleanup did not produce a video.');
      outputPath = (options.allocateOutput || createVideoOutputPath)(options.downloadsPath || path.join(os.homedir(), 'Downloads'), filePath);
      if (path.resolve(outputPath).toLowerCase() === path.resolve(filePath).toLowerCase()) throw new Error('The cleaned output must be separate from the original.');
      outputOwned = true;
      const audioStreams = (original.streams || []).filter(s => s.codec_type === 'audio');
      const audioCopy = audioStreams.every(s => ['aac','mp3','ac3','eac3','opus','alac'].includes(s.codec_name));
      const audioArgs = audioCopy ? ['-c:a','copy'] : ['-c:a','aac','-b:a','192k'];
      const originalVideo = original.streams.find(s => s.codec_type === 'video');
      const videoCopy = ['h264','hevc','av1','mpeg4','mjpeg','vp9'].includes(originalVideo.codec_name);
      const pixelFormat = originalVideo.width % 2 || originalVideo.height % 2 ? 'yuv444p' : 'yuv420p';
      const sarParts = String(originalVideo.sample_aspect_ratio || '1:1').split(':').map(Number);
      const validSar = sarParts.length === 2 && sarParts.every(n => Number.isSafeInteger(n) && n > 0 && n < 100000);
      const rotated = (originalVideo.side_data_list || []).some(s => Math.abs(Number(s.rotation)) % 180 === 90);
      const sar = validSar ? (rotated ? `${sarParts[1]}/${sarParts[0]}` : `${sarParts[0]}/${sarParts[1]}`) : '1/1';
      const encodeVideoArgs = ['-vf',`setsar=${sar}`,'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt',pixelFormat,
        '-fps_mode','passthrough','-enc_time_base','demux'];
      const videoOffset = Math.max(0, Number(detected.sourceVideoStartTime) - Number(detected.sourceContainerStartTime)) || 0;
      progress({ pct: 88, phase: 'Saving cleaned video and original audio' });
      const args = detected.changed
        ? ['-itsoffset',String(videoOffset),'-i',silentVideo,'-i',filePath,'-map','0:v:0','-map','1:a?','-map_metadata','1','-map_chapters','1',...encodeVideoArgs,...audioArgs,'-metadata:s:v:0','rotate=0']
        : ['-i',filePath,'-map','0:v:0','-map','0:a?','-map_metadata','0','-map_chapters','0',...(videoCopy ? ['-c:v','copy'] : encodeVideoArgs),...audioArgs];
      let encodingProgress = '';
      const originalDuration = Number(original.format?.duration) || 1;
      await execute(ffmpeg, ['-nostdin','-y','-v','error','-stats_period','1','-progress','pipe:1',...args,
        '-sn','-dn','-video_track_timescale','1000000','-movflags','+faststart',outputPath], { timeout: 0, onStdout: chunk => {
        encodingProgress += chunk;
        let index;
        while ((index = encodingProgress.indexOf('\n')) >= 0) {
          const line = encodingProgress.slice(0,index).trim();
          encodingProgress = encodingProgress.slice(index+1);
          const match = /^out_time_us=(\d+)$/.exec(line);
          if (match) progress({ pct: 88 + Math.min(1, Number(match[1]) / 1000000 / originalDuration) * 8,
            phase: 'Saving cleaned video and original audio' });
        }
      } });
      progress({ pct: 97, phase: 'Validating cleaned video' });
      validateVideoResult(original, await probe(outputPath));
      succeeded = true;
      progress({ pct: 100, phase: 'Previous captions erased' });
      return { ok: true, changed: true, noCaptionsDetected: false, outputPath, quality, engine,
        fileName: path.basename(outputPath), outputFileName: path.basename(outputPath),
        detectedRegions: detected.detectedRegions || [], removedSubtitleTracks: subtitleCount,
        cleanupMethod: detected.changed ? 'detected-text-inpainting' : 'subtitle-track-removal',
        warning: detected.warning || undefined };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      active = false;
      if (outputOwned && outputPath && !succeeded) await fsp.unlink(outputPath).catch(() => {});
      if (directory) {
        // Only the fresh, invocation-owned temporary directory can be removed.
        const parent = path.resolve(options.tempPath || os.tmpdir());
        const resolved = path.resolve(directory);
        if (path.dirname(resolved) === parent && path.basename(resolved).startsWith('caption-erase-')) {
          await fsp.rm(resolved, { recursive: true, force: true }).catch(() => {});
        }
      }
    }
  };
}

module.exports = { createCaptionEraser, findCaptionPython, runCaptionWorker, validateVideoResult };
