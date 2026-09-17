const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const parser = require('@babel/parser');
const code = fs.readFileSync(require('node:path').join(__dirname, '..', 'script.js'), 'utf8');
const ast = parser.parse(code, { sourceType: 'script' });
function load(name, globals = {}) {
  const node = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  return vm.runInNewContext(`(${code.slice(node.start, node.end)})`, { Blob, console: {error(){}}, ...globals });
}
test('empty narration parts cannot be silently dropped', async () => {
  await assert.rejects(load('combineNarrationBlobs')([new Blob(['valid']), new Blob()]), /empty or missing/);
});
test('short narration cannot escape validation at the retry limit', async () => {
  const fn = load('generateNarrationChunkWithFallback', {
    requestNarrationBlobSingle: async () => new Blob(['audio']),
    measureNarrationBlobDurationMs: async () => 100,
    isNarrationDurationTooShortForText: () => true,
    splitNarrationChunkForRetry: () => ['same'],
  });
  await assert.rejects(fn('lesson', 'anjali', {}, 4), /shorter than expected/);
  await assert.rejects(fn('lesson', 'anjali'), /cannot be split/);
});
test('valid narration is retained', async () => {
  const fn = load('generateNarrationChunkWithFallback', {
    requestNarrationBlobSingle: async () => new Blob(['audio']),
    measureNarrationBlobDurationMs: async () => 6000,
    isNarrationDurationTooShortForText: () => false,
  });
  const result = await fn('complete lesson', 'anjali');
  assert.equal(result.chunks[0], 'complete lesson');
  assert.equal(result.durations[0], 6000);
});
test('unreadable duration fails instead of inventing lesson timing', async () => {
  let revoked = false;
  const fn = load('measureNarrationBlobDurationMs', {
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => { revoked = true; } },
    createLoadedAudio: async () => ({ duration: Infinity }),
  });
  await assert.rejects(fn(new Blob(['audio'])), /could not be verified/);
  assert.equal(revoked, true);
  await assert.rejects(fn(new Blob()), /empty/);
});
test('chunk upload sends complete bounded bytes with timeout and no duplicate retry', async () => {
  const uploads = [];
  const fn = load('uploadBlobToMuxSession', {
    state: { videoExportServerUrl: 'http://localhost' }, MUX_CHUNK_UPLOAD_SIZE_BYTES: 3,
    fetchVideoExportEndpoint: async (url, options, label, settings) => {
      uploads.push({ bytes: Buffer.from(options.body).toString(), settings });
      return { ok: true };
    },
  });
  await fn('session', 'video', new Blob(['abcdefg']));
  assert.equal(uploads.map(x => x.bytes).join(''), 'abcdefg');
  assert.ok(uploads.every(x => x.settings.timeoutMs === 120000 && x.settings.attempts === 1));
});
test('timed out upload fails promptly without restarting a shared service', async () => {
  const fn = load('fetchVideoExportEndpoint', {
    fetchWithTimeout: async () => { throw new Error('Request timed out'); },
  });
  await assert.rejects(fn('local', {}, 'Upload', { attempts: 1, timeoutMs: 10 }), /timed out/);
});

for (const mode of ['story', 'raw', 'alphabet']) {
  test(`multi-part ${mode} narration finishes with optional alphabet timing`, async () => {
    const chunks = [{ text: 'First sentence.', gapAfterMs: 250 }, { text: 'Second sentence.', gapAfterMs: 0 }];
    let profile;
    let ended = 0;
    let joined = 0;
    const fn = load('requestNarrationBlob', {
      requireNarrationVoiceId: v => v, buildNarrationText: t => t,
      getNarrationChunkConfig: () => ({ threshold: 1, maxChunkLength: 20 }),
      getGlossaryNarrationChunkEntries: () => null,
      getNumberTableNarrationChunkEntries: () => null,
      getAlphabetNarrationChunkEntries: () => mode === 'alphabet' ? chunks : null,
      splitNarrationTextIntoChunks: () => chunks.map(c => c.text),
      normalizeNarrationChunkEntries: c => c,
      EDGE_NARRATION_VOICE: 'edge', NARRATION_CHUNK_JOIN_GAP_MS: 250, ALPHABET_ITEM_DURATION_MS: 5000,
      beginAnjaliGenerationActivity() {}, endAnjaliGenerationActivity() { ended++; },
      updateTaskProgressUi() {}, window: { setInterval: () => 1, clearInterval() {} },
      generateNarrationChunkWithFallback: async text => ({ chunks: [text], blobs: [new Blob([text])], durations: [2000] }),
      combineNarrationBlobs: async blobs => { joined = blobs.length; return new Blob(blobs); },
      buildSpeechSyncProfileFromChunkDurations: () => ({ totalDurationMs: 4000 }),
    });
    const audio = await fn('First sentence. Second sentence.', 'anjali', {
      rawNarrationText: mode === 'raw', onSyncProfile: p => { profile = p; },
    });
    assert.ok(audio.size > 0);
    assert.equal(joined, 2);
    assert.equal(ended, 1);
    assert.equal(Array.isArray(profile.alphabetSlideStartsMs), mode === 'alphabet');
  });
}

test('voice recovery clears old outage before the preload early return', () => {
  const events = [];
  const state = { anjaliMonitor: { lastKnownReady: false }, localServerStartup: { active: false }, runtimeErrorMessage: 'Anjali clone server stopped. Click Start Servers.' };
  const fn = load('handleAnjaliCloneServerTransition', {
    state, clearRuntimeDisplayError: () => { state.runtimeErrorMessage = ''; },
    window: { dispatchEvent: e => events.push(e) }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    fetch: async () => ({}), setServerControlsStatus() {},
    console: { log() {} },
  });
  fn(true);
  assert.equal(state.runtimeErrorMessage, '');
  assert.equal(events[0].detail.category, 'voice-server');
});
test('warming voice server is not reported as stopped', () => {
  let status = '';
  const fn = load('handleAnjaliCloneServerTransition', {
    state: { anjaliMonitor: { lastKnownReady: true, warming: true }, localServerStartup: { active: false } },
    setServerControlsStatus: text => { status = text; },
    showRuntimeDisplayError: () => { throw new Error('Unexpected outage warning'); },
  });
  fn(false);
  assert.match(status, /starting/);
});
test('informational server status explicitly bypasses keyword error guessing', () => {
  let warning = false;
  const fn = load('setServerControlsStatus', {
    serverControlsStatus: {},
    applyStatusMessage: (_el, text, options) => ({ text, isError: options.error }),
    showRuntimeDisplayError: () => { warning = true; },
  });
  fn('Some local servers are running. Start the missing one.', { error: false });
  assert.equal(warning, false);
});
