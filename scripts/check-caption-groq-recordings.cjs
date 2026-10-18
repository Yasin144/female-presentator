'use strict';

// Replay local WAVs through the production Groq implementation without loading
// Electron. Network requests require --live; credentials never enter reports.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const ROOT = path.resolve(__dirname, '..');
const HELPER_NAMES = new Set([
  'buildWavChunkBuffer', 'throwIfCaptionTranscriptionCancelled',
  'waitForGroqCaptionRetry', 'callGroqWhisperForBuffer', 'groqCaptionRateLimitDetails', 'readGroqCaptionWav',
  'assertGroqCaptionWordTimeline', 'groqCaptionTimingWithin', 'groqCaptionTimingWindows',
  'verifyGroqCaptionSpeechTimings', 'recoverGroqCaptionGaps',
  'verifyGroqCaptionOpeningSegment', 'transcribeCaptionWavWithGroq',
]);

function parseArgs(args) {
  const options = { live: false, language: 'auto', contentMode: 'speech', recoverMissing: false, files: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') { options.files.push(...args.slice(index + 1)); break; }
    if (arg === '--live') options.live = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--song') options.contentMode = 'song';
    else if (arg === '--recover-missing') options.recoverMissing = true;
    else if (['--report', '--raw-dir', '--language'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value.`);
      options[{ '--report': 'report', '--raw-dir': 'rawDir', '--language': 'language' }[arg]] = value;
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else options.files.push(arg);
  }
  if (!options.help && !options.files.length) throw new Error('Provide at least one explicit WAV path. Use --help for options.');
  if (!options.live && options.rawDir) throw new Error('--raw-dir requires --live. Offline validation creates no API response files.');
  return options;
}

function loadHelpers(context) {
  const source = fs.readFileSync(path.join(ROOT, 'main.cjs'), 'utf8');
  const ast = acorn.parse(source, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
  const helpers = new Map();
  (function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && HELPER_NAMES.has(node.id?.name)) {
      helpers.set(node.id.name, source.slice(node.start, node.end));
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  })(ast);
  const missing = [...HELPER_NAMES].filter(name => !helpers.has(name));
  if (missing.length) throw new Error(`Production Groq helpers could not be extracted: ${missing.join(', ')}`);
  vm.runInContext([...helpers.values()].join('\n'), context, { filename: 'production-groq-caption-helpers.cjs' });
}

const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
const elapsedSeconds = start => Math.round((performance.now() - start) / 10) / 100;
const timingBounds = items => items.length ? { start: items[0].start, end: items.at(-1).end } : null;

function validateCaptions(result, duration) {
  const issues = [];
  const words = Array.isArray(result.words) ? result.words : [];
  const segments = Array.isArray(result.segments) ? result.segments : [];
  function timeline(items, label, textKey) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!String(item?.[textKey] || '').trim()) issues.push(`${label} ${index} has empty text.`);
      if (!Number.isFinite(item?.start) || !Number.isFinite(item?.end)
          || item.start < 0 || item.end <= item.start || item.end > duration + 1e-7) {
        issues.push(`${label} ${index} is outside the audio bounds or has invalid timing.`);
      }
      if (index && item.start < items[index - 1].end - 1e-7) issues.push(`${label} ${index} overlaps the preceding interval.`);
    }
  }
  timeline(words, 'Word', 'word');
  timeline(segments, 'Segment', 'text');
  if (!String(result.text || '').trim()) issues.push('Transcript text is empty.');
  if (!words.length && !segments.length) issues.push('No timed captions were returned.');
  const expected = normalize(result.text);
  if (words.length && normalize(words.map(item => item.word).join(' ')) !== expected) issues.push('Word text does not cover the transcript.');
  if (segments.length && normalize(segments.map(item => item.text).join(' ')) !== expected) issues.push('Segment text does not cover the transcript.');
  if (words.length && !segments.length) issues.push('Word captions have no phrase segments.');
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!segments.some(segment => word.start >= segment.start - 0.02 && word.end <= segment.end + 0.02)) {
      issues.push(`Word ${index} is not covered by a phrase segment.`);
    }
  }
  if (result.timingSource === 'word' && !words.length) issues.push('Word timing provenance has no words.');
  if (result.timingSource === 'estimated' && words.length) issues.push('Estimated timing provenance contains word timestamps.');
  return issues;
}

async function run(options) {
  if (options.live) {
    let debuggerInfo;
    try {
      const response = await fetch('http://127.0.0.1:9228/json/version', { signal: AbortSignal.timeout(1500) });
      if (response.ok) debuggerInfo = await response.json();
    } catch (_) {}
    if (debuggerInfo?.webSocketDebuggerUrl) {
      const browser = await require('puppeteer').connect({ browserWSEndpoint: debuggerInfo.webSocketDebuggerUrl });
      try {
        const pages = (await browser.pages()).filter(page => page.url().startsWith('app://voice/'));
        for (const page of pages) {
          const state = await page.evaluate(() => window.captionLocalWorkbenchAPI?.getState?.());
          if (state?.disabled) throw new Error('The desktop caption queue is busy. Wait for it to finish before running a live Groq replay.');
        }
      } finally { await browser.disconnect(); }
    }
  }
  let apiKey = '';
  if (options.live) {
    apiKey = String(process.env.GROQ_API_KEY || '').trim();
    if (!apiKey) {
      const keyPath = path.join(ROOT, '.groq_api_key');
      if (fs.existsSync(keyPath)) apiKey = fs.readFileSync(keyPath, 'utf8').trim();
    }
    if (!apiKey) throw new Error('Live replay requires GROQ_API_KEY or the local saved Groq key.');
  }
  const redact = value => apiKey ? String(value).split(apiKey).join('[redacted]') : String(value);
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const rawDir = options.rawDir ? path.resolve(options.rawDir, runId) : null;
  if (rawDir) fs.mkdirSync(rawDir, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(), mode: options.live ? 'live' : 'offline',
    languageHint: options.language, contentMode: options.contentMode,
    autoRecoverMissingSpeech: options.recoverMissing, status: 'running',
    recordings: options.files.map((file, index) => ({
      index, file: path.resolve(file), status: 'pending',
      requests: [], requestCount: 0, diagnostics: [], warnings: [],
    })),
  };
  const reportPath = options.report ? path.resolve(options.report) : null;
  const saveReport = () => {
    report.updatedAt = new Date().toISOString();
    report.summary = {
      recordings: report.recordings.length,
      passed: report.recordings.filter(item => item.status === 'passed').length,
      validatedOffline: report.recordings.filter(item => item.status === 'validated').length,
      failed: report.recordings.filter(item => item.status === 'failed').length,
      cancelled: report.recordings.filter(item => item.status === 'cancelled').length,
      pending: report.recordings.filter(item => item.status === 'pending').length,
      requests: report.recordings.reduce((sum, item) => sum + item.requests.length, 0),
    };
    if (reportPath) {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      const temporaryPath = reportPath + '.tmp';
      fs.writeFileSync(temporaryPath, redact(JSON.stringify(report, null, 2)) + '\n');
      fs.renameSync(temporaryPath, reportPath);
    }
  };
  const pauseForQuota = (quota, index) => {
    report.status = 'paused';
    report.pausedAt = new Date().toISOString();
    report.rateLimit = {};
    for (const field of ['code', 'providerHttpStatus', 'retryAfterMs', 'retryAt', 'retryAfterEstimated']) {
      if (quota[field] !== undefined) report.rateLimit[field] = quota[field];
    }
    for (const pending of report.recordings.slice(index + 1)) {
      Object.assign(pending, report.rateLimit, { pendingReason: 'CAPTION_GROQ_RATE_LIMIT' });
    }
  };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  let current;
  const context = vm.createContext({
    Buffer, AbortController, AbortSignal, FormData, Blob, setTimeout, clearTimeout,
    console: {
      log() {}, error() {},
      warn: (...args) => {
        if (current) current.diagnostics.push(redact(args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ')));
      },
    },
    fetch: async (url, init) => {
      if (!options.live) throw new Error('Network requests are disabled. Pass --live to replay through Groq.');
      if (url !== 'https://api.groq.com/openai/v1/audio/transcriptions') throw new Error('Unexpected replay endpoint.');
      const request = { number: current.requests.length + 1, audioDuration: null, model: init.body.get('model'), status: null };
      current.requests.push(request);
      const start = performance.now();
      try {
        const file = init.body.get('file');
        if (file) request.audioDuration = context.readGroqCaptionWav(Buffer.from(await file.arrayBuffer())).duration;
        const response = await fetch(url, init);
        request.status = response.status;
        return {
          ok: response.ok, status: response.status, headers: response.headers, body: response.body,
          json: async () => {
            const json = await response.json();
            if (rawDir && response.ok) {
              const name = `recording-${String(current.index + 1).padStart(3, '0')}-request-${String(request.number).padStart(2, '0')}.json`;
              fs.writeFileSync(path.join(rawDir, name), redact(JSON.stringify(json, null, 2)) + '\n');
              request.rawResponsePath = path.join(rawDir, name);
            }
            request.elapsedSeconds = elapsedSeconds(start);
            return json;
          },
        };
      } catch (error) {
        request.error = init.signal?.aborted ? 'Request aborted.' : 'Request failed.';
        throw error;
      } finally {
        request.elapsedSeconds = elapsedSeconds(start);
        current.requestCount = current.requests.length;
        saveReport();
      }
    },
  });
  try {
    saveReport();
    loadHelpers(context);
    for (let index = 0; index < options.files.length; index += 1) {
      current = report.recordings[index];
      current.status = 'running';
      const start = performance.now();
      try {
        if (controller.signal.aborted) throw Object.assign(new Error('Replay cancelled.'), { name: 'AbortError' });
        const audioBuffer = fs.readFileSync(current.file);
        const audio = context.readGroqCaptionWav(audioBuffer);
        current.audio = { bytes: audioBuffer.length, sampleRate: audio.sampleRate, channels: 1, bitsPerSample: 16, duration: audio.duration };
        if (!options.live) {
          current.status = 'validated';
        } else {
          const result = await context.transcribeCaptionWavWithGroq({
            audioBuffer, apiKey, languageHint: options.language, contentMode: options.contentMode,
            autoRecoverMissingSpeech: options.recoverMissing, signal: controller.signal,
          });
          const words = Array.isArray(result.words) ? result.words : [];
          const segments = Array.isArray(result.segments) ? result.segments : [];
          current.captionCounts = { words: words.length, segments: segments.length, textCharacters: String(result.text || '').length };
          current.timingBounds = { words: timingBounds(words), segments: timingBounds(segments) };
          current.provenance = {
            engine: result.engine, language: result.language, contentMode: result.contentMode,
            timingSource: result.timingSource, timingVerification: result.timingVerification || null,
            verifiedTimingWindows: result.verifiedTimingWindows || 0,
          };
          current.warnings = Array.isArray(result.warnings) ? result.warnings.map(redact) : [];
          current.validationIssues = validateCaptions(result, audio.duration);
          if (current.validationIssues.length) throw new Error(`Caption validation failed: ${current.validationIssues.join(' ')}`);
          if (rawDir) {
            current.resultPath = path.join(rawDir, `recording-${String(index + 1).padStart(3, '0')}-captions.json`);
            fs.writeFileSync(current.resultPath, redact(JSON.stringify(result, null, 2)) + '\n');
          }
          current.status = 'passed';
          if (result.rateLimit?.code === 'CAPTION_GROQ_RATE_LIMIT') {
            current.rateLimit = context.groqCaptionRateLimitDetails(result.rateLimit);
            pauseForQuota(current.rateLimit, index);
          }
        }
      } catch (error) {
        current.status = error.name === 'AbortError' ? 'cancelled' : 'failed';
        current.error = redact(error.message || 'Unknown replay error.');
        for (const field of ['code', 'providerHttpStatus', 'retryAfterMs', 'retryAt', 'retryAfterEstimated']) {
          if (error[field] !== undefined) current[field] = error[field];
        }
        if (error.code === 'CAPTION_GROQ_RATE_LIMIT') {
          pauseForQuota(current, index);
        }
      } finally {
        current.elapsedSeconds = elapsedSeconds(start);
        current.requestCount = current.requests.length;
        console.log(`${current.status.toUpperCase()} ${path.basename(current.file)}: ${current.audio ? current.audio.duration.toFixed(2) + 's, ' : ''}${current.requestCount} requests, ${current.elapsedSeconds.toFixed(2)}s${current.error ? '; ' + current.error : ''}`);
        saveReport();
      }
      if (report.status === 'paused') break;
    }
  } finally {
    process.removeListener('SIGINT', cancel);
  }
  report.finishedAt = new Date().toISOString();
  if (report.status !== 'paused') report.status = controller.signal.aborted ? 'cancelled' : 'finished';
  saveReport();
  if (reportPath) console.log(`Report: ${reportPath}`);
  console.log(`${report.summary.passed + report.summary.validatedOffline}/${report.summary.recordings} passed; ${report.summary.requests} API requests${options.live ? '' : ' (offline metadata validation only)'}.`);
  process.exitCode = report.summary.failed || report.summary.cancelled || report.summary.pending ? 1 : 0;
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/check-caption-groq-recordings.cjs [options] WAV [WAV ...]\n\n'
      + '  --live             Send recordings to Groq using production caption logic\n'
      + '  --report PATH      Write a JSON summary with timing and request diagnostics\n'
      + '  --raw-dir PATH     Save successful Groq response JSON locally (requires --live)\n'
      + '  --language CODE    Recognition language (default: auto)\n'
      + '  --song             Use production song caption mode\n'
      + '  --recover-missing  Enable production missing-speech recovery\n'
      + '  --                 End options before explicit WAV paths\n\n'
      + 'Without --live, only local WAV metadata is validated and no key is read.');
    return;
  }
  await run(options);
}

if (require.main === module) main().catch(error => { console.error(error.message || 'Recording replay failed.'); process.exitCode = 1; });

module.exports = { parseArgs, validateCaptions, run, loadHelpers };
