const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const helpers = source.slice(source.indexOf('function buildPdfExactExportFramePlan('), source.indexOf('async function renderPdfTimelineForExport('));
function functionSource(name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\r?\\n\\}`, 'm'));
  assert.ok(match, `Production function ${name} must exist`);
  return match[0];
}
const documentData = source.slice(source.indexOf('const PDF_COUNTING_DOCUMENT_ID ='), source.indexOf('function getPdfCountingActivity('));
const countingWordsData = source.match(/const PDF_COUNTING_WORDS = \[[^]*?\];/)[0];
const fingerprint = source.match(/const PDF_COUNTING_DOCUMENT_ID = "([^"]+)"/)[1];
function fixture(options = {}) {
  const captures = [];
  const drawnObjects = [], objectLoads = [], readyPages = new Set();
  let originalPageLoads = 0;
  let pending = [];
  let maximumQueue = 0;
  let closedFrames = 0;
  class FakeFrame {
    constructor(canvas, timing) {
      Object.assign(this, timing);
      this.sourceTime = context.state.pdf.currentTimeMs;
      this.objects = drawnObjects.slice();
    }
    close() { closedFrames++; }
  }
  class FakeEncoder {
    static async isConfigSupported(config) { return { supported: options.supported !== false, config }; }
    constructor(callbacks) { this.callbacks = callbacks; this.encodeQueueSize = 0; this.state = 'unconfigured'; }
    configure() { this.state = 'configured'; }
    encode(frame) {
      captures.push({ timestamp: frame.timestamp, duration: frame.duration, sourceTime: frame.sourceTime, objects: frame.objects });
      this.encodeQueueSize++;
      maximumQueue = Math.max(maximumQueue, this.encodeQueueSize);
      pending.push(new Promise(resolve => setTimeout(() => {
        this.encodeQueueSize--;
        if (options.encoderError) this.callbacks.error(new Error('synthetic encoder failure'));
        else if (!options.dropFrames) this.callbacks.output({ timestamp: frame.timestamp, byteLength: 1, copyTo: bytes => { bytes[0] = 1; } });
        resolve();
      }, 3)));
    }
    async flush() { await Promise.all(pending); }
    close() { this.state = 'closed'; }
  }
  const pages = [26, 27].map((pageNumber, index) => ({
    pageNumber, index: pageNumber - 1,
    countingActivity: options.reveal ? {
      count: 11 + index, title: index ? 'twelve books' : 'eleven dogs', noun: index ? 'books' : 'dogs',
      objectDocumentId: fingerprint, objectPageNumber: pageNumber
    } : null
  }));
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    drawImage: image => drawnObjects.push(image.id)
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const context = vm.createContext({
    Blob, ArrayBuffer, DataView, Uint8Array, VideoEncoder: FakeEncoder, VideoFrame: FakeFrame, setTimeout,
    canvas: { width: 1280, height: 720 },
    state: { pdf: { countingDisplayMode: options.reveal ? 'reveal' : 'original', narration: { pdfTiming: pages.map((page, index) => ({
      pageIndex: page.index, countStarts: Array.from({ length: 11 + index }, (_, number) => 100 + index * 500 + number * 20)
    })) } }, exportCapture: {} },
    ctx,
    clamp: (value, low, high) => Math.max(low, Math.min(value, high)),
    getPdfExportBitrate: () => 1000000,
    getEffectiveExportQuality: () => 'hd',
    syncPdfPreviewPageFromTime: () => {},
    getPdfSelectionIndexForTime: time => time < 500 ? 0 : 1,
    getPdfPresentationPages: () => pages,
    ensurePdfPageRenderImageLoaded: async page => {
      originalPageLoads++;
      await new Promise(resolve => setTimeout(resolve, 7));
      return options.missingPage && page.pageNumber === 27 ? null : {};
    },
    shouldRevealPdfCountingObjects: () => false,
    ensurePdfCountingObjectsLoaded: async page => {
      objectLoads.push(page.pageNumber);
      await new Promise(resolve => setTimeout(resolve, page.pageNumber === 26 ? 9 : 17));
      if (options.missingObjects && page.pageNumber === 27) throw new Error('Verified object artwork is unavailable');
      page.countingObjectImages = Array.from({ length: page.countingActivity.count }, (_, index) => ({
        number: index + 1, width: 100, height: 70, image: { id: `${page.pageNumber}:${index + 1}` }
      }));
      readyPages.add(page.pageNumber);
      return page.countingObjectImages;
    },
    drawScene: () => {
      if (!options.reveal) return;
      const index = context.getPdfSelectionIndexForTime(context.state.pdf.currentTimeMs);
      const page = pages[index];
      assert.ok(readyPages.has(page.pageNumber), 'Drawing must wait for every object on the current page');
      drawnObjects.length = 0;
      assert.equal(context.drawPdfCountingObjectScene(page, index), true);
    }, updatePlaybackProgressUi: () => {}, updateTaskProgressUi: () => {}
  });
  if (options.reveal) {
    vm.runInContext([
      countingWordsData, documentData, functionSource('getPdfCountingDisplayMode'), functionSource('shouldRevealPdfCountingObjects'),
      functionSource('getPdfCountingStarts'), functionSource('getPdfCountingVisibleCount'),
      functionSource('getPdfCountingObjectSlots'), functionSource('drawPdfCountingObjectScene')
    ].join('\n'), context);
  }
  vm.runInContext(helpers, context);
  return { context, captures, stats: () => ({ maximumQueue, closedFrames, originalPageLoads, objectLoads }) };
}

test('frame plans retain complete duration for all supported PDF speeds', () => {
  const { context } = fixture();
  for (const rate of [.5, .75, 1, 1.25, 1.5, 2, 2.5]) {
    const plan = context.buildPdfExactExportFramePlan(192128, rate, 30);
    assert(plan.durationMs >= 192128 / rate);
    assert(plan.durationMs - 192128 / rate < 1000 / 30);
  }
  assert.throws(() => context.buildPdfExactExportFramePlan(0, 1, 30), /invalid/);
});

test('page decoding and queue delays never enter encoded timestamps; all frames close', async () => {
  const f = fixture();
  const result = await f.context.encodePdfExactTimelineForExport({ durationMs: 1000, playbackRate: 1, frameRate: 30 });
  assert.equal(result.frameCount, 30);
  assert.equal(result.durationMs, 1000);
  assert.equal(f.captures[15].sourceTime, 500);
  assert.equal(f.captures[15].timestamp, 500000);
  assert.equal(f.captures[29].timestamp, 966667);
  assert.equal(f.stats().closedFrames, 30);
  assert(f.stats().maximumQueue <= 4);
  const data = new DataView(await result.blob.arrayBuffer());
  assert.equal(data.getUint32(24, true), 30);
  assert.equal(data.getUint32(16, true), 30);
  assert.equal(data.getUint32(32 + 15 * 13 + 4, true), 15);
});

test('2.5x exports advance source time and keep 30fps output', async () => {
  const f = fixture();
  const result = await f.context.encodePdfExactTimelineForExport({ durationMs: 1000, playbackRate: 2.5, frameRate: 30 });
  assert.equal(result.frameCount, 12);
  assert.equal(result.durationMs, 400);
  assert.equal(f.captures[6].sourceTime, 500);
  assert.equal(f.captures[6].timestamp, 200000);
});

test('reveal export awaits decoded cutouts and captures the real renderer at exact narration times', async () => {
  const f = fixture({ reveal: true });
  const result = await f.context.encodePdfExactTimelineForExport({ durationMs: 1000, playbackRate: 1, frameRate: 30 });
  assert.equal(result.frameCount, 30);
  assert.equal(f.stats().originalPageLoads, 0, 'Reveal export does not fall back to the complete original PDF');
  assert.deepEqual(f.stats().objectLoads, [26, 27]);
  assert.deepEqual(f.captures[0].objects, []);
  assert.deepEqual(f.captures[3].objects, ['26:1']);
  assert.equal(f.captures[9].objects.length, 11);
  assert.deepEqual(f.captures[15].objects, []);
  assert.equal(f.captures[15].timestamp, 500000);
  assert.deepEqual(f.captures[18].objects, ['27:1']);
  assert.equal(f.captures[29].objects.length, 12);
  assert.equal(f.captures[29].timestamp, 966667);
  assert.equal(f.stats().closedFrames, 30);
});

test('missing cutouts stop before encoding incomplete reveal frames', async () => {
  const f = fixture({ reveal: true, missingObjects: true });
  await assert.rejects(f.context.encodePdfExactTimelineForExport({ durationMs: 1000, playbackRate: 1, frameRate: 30 }), /Verified object artwork is unavailable/);
  assert.equal(f.captures.length, 15);
  assert.equal(f.stats().originalPageLoads, 0);
});

test('missing pages, encoder errors, dropped frames and unsupported encoding fail closed', async () => {
  for (const [options, message] of [
    [{ missingPage: true }, /page 27 could not be rendered/],
    [{ encoderError: true }, /synthetic encoder failure/],
    [{ dropFrames: true }, /ended early/],
    [{ supported: false }, /cannot encode/]
  ]) {
    const f = fixture(options);
    await assert.rejects(f.context.encodePdfExactTimelineForExport({ durationMs: 1000, playbackRate: 1, frameRate: 30 }), message);
  }
});
