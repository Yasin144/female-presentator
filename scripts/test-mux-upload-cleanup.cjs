const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
function functionSource(name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\r?\\n\\}`, 'm'));
  assert.ok(match, `Production function ${name} must exist`);
  return match[0];
}

function fixture(options = {}) {
  const requests = [], cleanups = [], warnings = [];
  const uploadError = new Error('Synthetic chunk connection failure');
  const state = { videoExportServerUrl: 'http://offline.invalid:8430', music: { enabled: false }, narration: { fileName: 'test.wav' } };
  const context = vm.createContext({
    Blob, URL, state, MUX_CHUNK_UPLOAD_SIZE_BYTES: 3, STRICT_BACKGROUND_MUSIC_VOLUME: 0.1, proDuckingEnabled: null,
    console: { warn: (...args) => warnings.push(args) },
    getMuxVideoFileName: () => 'offline.webm', getMuxOutputFileName: () => 'offline.mp4',
    getEffectiveExportQuality: () => 'hd', getElectronOutputPath: () => '',
    measureNarrationBlobDurationMs: async () => 1000, updateTaskProgressUi() {},
    clamp: (value, low, high) => Math.max(low, Math.min(high, value)),
    fetchVideoExportEndpoint: async (url, request) => {
      const parsed = new URL(url);
      requests.push({ path: parsed.pathname, target: parsed.searchParams.get('target') });
      if (parsed.pathname.endsWith('/mux-upload-session')) {
        if (options.failSession) throw uploadError;
        return { ok: true, json: async () => ({ sessionId: 'owned-session' }) };
      }
      if (parsed.pathname.endsWith('/mux-upload-chunk') && parsed.searchParams.get('target') === options.failTarget) {
        if (options.httpFailure) return { ok: false, json: async () => ({ error: 'Synthetic chunk HTTP rejection' }) };
        throw uploadError;
      }
      return { ok: true, json: async () => ({ ok: true }) };
    },
    fetchWithTimeout: async (url, request, timeoutMs) => {
      cleanups.push({ url, method: request.method, body: JSON.parse(request.body), timeoutMs });
      if (options.cleanupFailure) throw new Error('Synthetic cleanup connection failure');
      return { ok: !options.cleanupHttpFailure };
    },
    readMuxServerResponse: async () => ({ complete: true })
  });
  vm.runInContext(['uploadBlobToMuxSession', 'discardMuxUploadSession', 'muxVideoAndAudioChunked', 'muxVideoSegmentsAndAudioChunked'].map(functionSource).join('\n'), context);
  const run = () => options.segmented
    ? context.muxVideoSegmentsAndAudioChunked([new Blob(['video-a']), new Blob(['video-b'])], new Blob(['audio']), null)
    : context.muxVideoAndAudioChunked(new Blob(['video']), new Blob(['audio']), null);
  return { run, requests, cleanups, warnings, uploadError };
}

test('failed single and segmented uploads discard only their partial session before rethrowing', async () => {
  for (const segmented of [false, true]) {
    const f = fixture({ segmented, failTarget: 'audio' });
    await assert.rejects(f.run(), error => error === f.uploadError);
    assert.ok(f.requests.some(request => request.path.endsWith('/mux-upload-chunk')));
    assert.ok(!f.requests.some(request => request.path.endsWith('/mux-upload-complete')));
    assert.deepEqual(f.cleanups, [{
      url: 'http://offline.invalid:8430/api/mux-upload-cancel', method: 'POST',
      body: { sessionId: 'owned-session' }, timeoutMs: 1500
    }]);
  }
});

test('HTTP upload rejection also cleans up; cleanup failure never hides the original error', async () => {
  const http = fixture({ failTarget: 'video', httpFailure: true, cleanupHttpFailure: true });
  await assert.rejects(http.run(), /Synthetic chunk HTTP rejection/);
  assert.equal(http.cleanups.length, 1);
  assert.equal(http.warnings.length, 1);
  const network = fixture({ segmented: true, failTarget: 'video-1', cleanupFailure: true });
  await assert.rejects(network.run(), error => error === network.uploadError);
  assert.equal(network.cleanups.length, 1);
  assert.equal(network.warnings.length, 1);
});

test('successful uploads reach completion without canceling or restarting the server', async () => {
  for (const segmented of [false, true]) {
    const f = fixture({ segmented });
    assert.deepEqual(await f.run(), { complete: true });
    assert.equal(f.cleanups.length, 0);
    assert.equal(f.requests.filter(request => request.path.endsWith('/mux-upload-complete')).length, 1);
    assert.ok(f.requests.every(request => !/restart/.test(request.path)));
  }
});

test('a failed session creation cannot discard any unrelated or unknown session', async () => {
  const f = fixture({ failSession: true });
  await assert.rejects(f.run(), error => error === f.uploadError);
  assert.equal(f.cleanups.length, 0);
});
