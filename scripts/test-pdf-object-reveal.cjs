const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
function functionSource(name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\r?\\n\\}`, "m"));
  assert.ok(match, `Production function ${name} must exist`);
  return match[0];
}
const documentData = source.slice(source.indexOf("const PDF_COUNTING_DOCUMENT_ID ="), source.indexOf("function getPdfCountingActivity("));
const countingWordsData = source.match(/const PDF_COUNTING_WORDS = \[[^]*?\];/)[0];
const objectHelpers = source.slice(source.indexOf("const pdfCountingManifestPromises ="), source.indexOf("function drawPdfCountingMarkers("));
const fingerprint = source.match(/const PDF_COUNTING_DOCUMENT_ID = "([^"]+)"/)[1];
const numberSpellings = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(options = {}) {
  const images = [], texts = [], textDraws = [], transforms = [], requestedUrls = [], decodedUrls = [];
  const count = options.count || 13;
  const pageNumber = count + 15;
  const noun = ({ 11: "dogs", 12: "books", 13: "candies", 14: "birds", 15: "bananas", 16: "butterflies", 17: "gifts", 18: "ants", 19: "leaves", 20: "stars" })[count];
  const objects = Array.from({ length: count }, (_, index) => ({
    number: index + 1, width: 90 + index * 3, height: 70,
    src: `page-${pageNumber}/${index + 1}.png`, image: { id: index + 1, naturalWidth: 90 + index * 3, naturalHeight: 70 }
  }));
  const page = { index: pageNumber - 1, pageNumber,
    countingActivity: { count, noun, title: `${numberSpellings[count]} ${noun}`, objectDocumentId: fingerprint, objectPageNumber: pageNumber },
    countingObjectImages: options.unloaded ? null : objects,
    renderImage: { id: "original-PDF-with-all-objects" }
  };
  const manifestObjects = Array.from({ length: count }, (_, index) => ({
    number: index + 1, width: 1024, height: 1024, contentBounds: [140, 80, 720, 800],
    src: `../realistic-v2/${noun}.png`
  }));
  const manifest = { schemaVersion: 2, assetStyle: "photorealistic", fingerprint,
    pages: { [pageNumber]: { verified: true, noun, count, objects: manifestObjects } }
  };
  const state = { speaking: false, pdf: { requestId: 1, totalDurationMs: 9000, countingDisplayMode: "reveal", currentTimeMs: 0,
    narration: { url: "blob:fixture-narration", pdfTiming: [{ pageIndex: pageNumber - 1, countStarts: Array.from({ length: count }, (_, index) => 1000 + index * 500) }] }
  } };
  const audioEvents = [];
  const audioInstances = [];
  const musicStarted = deferred();
  const firstDecode = deferred();
  class FakeImage {
    constructor() { this.naturalWidth = options.imageWidth ?? 1024; this.naturalHeight = options.imageHeight ?? 1024; }
    set src(value) {
      this.url = value;
      requestedUrls.push(value);
      const fail = options.failFirstImage && requestedUrls.length === 1;
      queueMicrotask(() => fail ? this.onerror() : this.onload());
    }
    async decode() {
      decodedUrls.push(this.url);
      firstDecode.resolve();
      if (options.decodeGate) await options.decodeGate.promise;
    }
  }
  let fetches = 0;
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    drawImage: (image, ...args) => images.push({
      id: image.id ?? image.url, box: args.slice(-4), sourceBounds: args.length === 8 ? args.slice(0, 4) : null
    }),
    fillText: (text, x, y, maxWidth) => {
      texts.push(text);
      textDraws.push({ text, x, y, maxWidth, font: ctx.font, textAlign: ctx.textAlign, textBaseline: ctx.textBaseline });
    },
    translate: (...args) => transforms.push(["translate", ...args]),
    scale: (...args) => transforms.push(["scale", ...args])
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const context = vm.createContext({
    URL, AbortController, Image: FakeImage, state, ctx, canvas: { width: 1280, height: 720 },
    document: { currentScript: { src: "app://voice/script.js" }, baseURI: "app://voice/" },
    fetch: async url => {
      fetches++;
      assert.match(String(url), /assets\/pdf-counting\/[^/]+\/manifest-realistic-v2.json$/);
      if (options.failFirstFetch && fetches === 1) throw new Error("Temporary artwork connection failure");
      return { ok: !options.missingManifest, json: async () => options.manifest || manifest };
    },
    performance: { now() { throw new Error("Counting reveal must not use the wall clock"); } },
    clamp: (value, low, high) => Math.max(low, Math.min(value, high)),
    getPdfRenderMode: () => "exact",
    getPdfPlaybackRate: () => 1,
    getPdfPresentationPages: () => [page],
    assertPdfNarrationRequestActive: options => { if (options.isCurrent && !options.isCurrent()) throw new Error("cancelled"); },
    isPdfPresentationMode: () => true,
    markSceneDirty() {}, drawScene() {},
    stopPlayback: (restore = true) => {
      state.playbackAbortController?.abort();
      state.speaking = false;
      if (restore) state.pdf.currentTimeMs = 0;
      if (state.activeAudio) state.activeAudio.pause();
      state.activeAudio = null;
    },
    stopActiveAudio: () => { state.playbackAbortController?.abort(); if (state.activeAudio) state.activeAudio.pause(); state.activeAudio = null; },
    cancelVisualLoop() {}, updateStageViewUi() {}, updateStageTimelineUi() {}, rebuildPdfPresentationSchedule() {},
    formatDurationMs: value => String(value), syncPdfPlaybackPosition: () => state.pdf.currentTimeMs,
    resetTaskProgressUi() {}, syncPdfPreviewPageFromTime() {}, updatePlaybackProgressUi() {},
    createLoadedAudio: async () => {
      audioEvents.push("created");
      const audio = { removeAttribute() {}, load() {}, pause: () => { audioEvents.push("paused"); }, play: async () => {
        assert.equal(page.countingObjectImages.length, count, "Audio cannot start with missing object images");
        assert.equal(decodedUrls.length, 1, "Audio waits for the shared complete image to decode once");
        if (options.failPlay) throw new Error("Synthetic audio play failure");
        audioEvents.push("played");
      } };
      audioInstances.push(audio);
      return audio;
    },
    applyNaturalVoicePlayback() {}, teardownAudioGraph() {}, setStatus() {}, setPdfStatus() {},
    updateStageModeUi() {}, startBackgroundMusicPlayback: async () => {
      musicStarted.resolve();
      if (options.musicGate) await options.musicGate.promise;
    }, startPdfPlaybackLoop() {}, finishPlayback() {}
  });
  vm.runInContext([
    countingWordsData, documentData, functionSource("getPdfCountingDisplayMode"),
    functionSource("getPdfCountingStarts"), functionSource("getPdfCountingVisibleCount"), objectHelpers,
    functionSource("getPlaybackSignal"), functionSource("disposeRuntimeAudio"),
    functionSource("startPdfNarrationPlayback"), functionSource("pausePdfPresentation"),
    functionSource("seekPdfPresentation"), functionSource("invalidatePdfPresentationRequest")
  ].join("\n"), context);
  const stopHandler = source.match(/stopStageBtn\.addEventListener\("click", (\(\) => \{[^]*?\r?\n\})\);/m);
  assert.ok(stopHandler, "Production Stop click handler must exist");
  context.handleStop = vm.runInContext(`(${stopHandler[1]})`, context);
  return { context, state, page, manifest, images, texts, textDraws, transforms, requestedUrls, decodedUrls,
    firstDecode, audioEvents, audioInstances, musicStarted, fetches: () => fetches,
    draw(timeMs) { images.length = 0; texts.length = 0; textDraws.length = 0; transforms.length = 0; state.pdf.currentTimeMs = timeMs; return context.drawPdfCountingObjectScene(page, 0); }
  };
}

test("clean counting stage reveals exactly the next original object at each measured number start", () => {
  const f = fixture();
  assert.equal(f.draw(0), true);
  assert.equal(f.images.length, 0);
  assert.equal(f.draw(999.99), true);
  assert.equal(f.images.length, 0);
  for (let count = 1; count <= 13; count++) {
    f.draw(1000 + (count - 1) * 500);
    assert.deepEqual(f.images.map(image => image.id), Array.from({ length: count }, (_, index) => index + 1));
    assert.ok(f.images.every(image => image.id !== "original-PDF-with-all-objects"));
    assert.deepEqual(f.texts.filter(text => /^\d+$/.test(text)), Array.from({ length: count }, (_, index) => String(index + 1)));
    assert.deepEqual(f.texts.filter(text => numberSpellings.includes(text.toLowerCase())).map(text => text.toLowerCase()), numberSpellings.slice(1, count + 1));
  }
});

test("each revealed object has its numeral above and its correctly spelled number below", () => {
  for (const count of [11, 13, 18, 20]) {
    const f = fixture({ count });
    const finalCue = 1000 + (count - 1) * 500;
    f.draw(0);
    assert.equal(f.images.length, 0);
    assert.equal(f.texts.filter(text => /^\d+$/.test(text) || numberSpellings.includes(text.toLowerCase())).length, 0);
    f.draw(finalCue - 0.01);
    assert.ok(!f.texts.includes(String(count)));
    assert.ok(!f.texts.some(text => text.toLowerCase() === numberSpellings[count]), `${numberSpellings[count]} cannot appear before its spoken cue`);
    f.draw(finalCue);
    assert.equal(f.images.length, count);
    f.images.forEach(image => {
      const numeral = f.textDraws.find(item => item.text === String(image.id));
      const spelling = f.textDraws.find(item => item.text.toLowerCase() === numberSpellings[image.id]);
      assert.ok(numeral && spelling, `Missing labels for ${image.id}`);
      const [x, y, width, height] = image.box;
      const numeralSize = Number(numeral.font.match(/([\d.]+)px/)[1]);
      const wordSize = Number(spelling.font.match(/([\d.]+)px/)[1]);
      assert.ok(numeral.y + numeralSize * .5 < y, `Numeral ${image.id} must be above its artwork`);
      assert.ok(spelling.y - wordSize * .5 > y + height, `${numberSpellings[image.id]} must be below its artwork`);
      assert.ok(Math.abs(numeral.x - (x + width / 2)) < .001);
      assert.ok(Math.abs(spelling.x - (x + width / 2)) < .001);
      assert.ok(Number.isFinite(spelling.maxWidth) && spelling.maxWidth > 0);
    });
    f.state.speaking = false;
    const pausedLabels = structuredClone(f.textDraws);
    f.draw(finalCue);
    assert.deepEqual(f.textDraws, pausedLabels);
    f.draw(1000);
    assert.deepEqual(f.texts.filter(text => numberSpellings.includes(text.toLowerCase())).map(text => text.toLowerCase()), ["one"]);
  }
});

test("pause does not advance reveals and seeking backwards removes later objects", () => {
  const f = fixture();
  f.draw(4250);
  const pausedFrame = { images: structuredClone(f.images), transforms: structuredClone(f.transforms) };
  f.state.speaking = false;
  f.draw(4250);
  assert.deepEqual(f.images, pausedFrame.images);
  assert.deepEqual(f.transforms, pausedFrame.transforms);
  f.draw(1500);
  assert.deepEqual(f.images.map(image => image.id), [1, 2]);
  f.draw(0);
  assert.equal(f.images.length, 0);
  f.state.pdf.narration.pdfTiming = [];
  f.draw(10000);
  assert.equal(f.images.length, 0, "Unknown timings cannot invent reveals");
});

test("numeral, artwork and spelling bands remain inside non-overlapping slots for counts 2 through 20", () => {
  const { context } = fixture();
  for (const [width, height] of [[1920, 1080], [1280, 720], [1080, 1920], [720, 720], [960, 400]]) {
    for (let count = 2; count <= 20; count++) {
      const sizes = Array.from({ length: count }, (_, index) => [{ width: 200, height: 30 }, { width: 30, height: 200 }, { width: 100, height: 100 }][index % 3]);
      const slots = context.getPdfCountingObjectSlots(count, width, height, sizes);
      assert.equal(slots.length, count);
      slots.forEach((slot, index) => {
        assert.ok(Object.values(slot).every(Number.isFinite));
        assert.ok(slot.x >= 0 && slot.y >= 0 && slot.x + slot.width <= width && slot.y + slot.height <= height);
        assert.ok(slot.imageX >= slot.x && slot.imageY >= slot.y);
        assert.ok(slot.imageX + slot.imageWidth <= slot.x + slot.width + 0.001);
        assert.ok(slot.imageY + slot.imageHeight <= slot.y + slot.height + 0.001);
        assert.ok(slot.badgeX - slot.badgeRadius >= slot.x && slot.badgeX + slot.badgeRadius <= slot.x + slot.width);
        assert.ok(slot.badgeY - slot.badgeRadius >= slot.y && slot.badgeY + slot.badgeRadius <= slot.y + slot.height);
        assert.ok(slot.badgeY + slot.badgeRadius <= slot.imageY + 0.001, "Top numeral badge must not cover the artwork");
        assert.ok(slot.wordFontSize > 0 && slot.wordMaxWidth > 0);
        assert.ok(slot.wordX - slot.wordMaxWidth / 2 >= slot.x && slot.wordX + slot.wordMaxWidth / 2 <= slot.x + slot.width);
        assert.ok(slot.wordY + slot.wordFontSize * .6 <= slot.y + slot.height, "Spelling must remain inside its card");
        assert.ok(slot.imageY + slot.imageHeight <= slot.wordY - slot.wordFontSize * .6, "Spelling band must not overlap the artwork");
        assert.ok(Math.abs(slot.imageWidth / slot.imageHeight - sizes[index].width / sizes[index].height) < 0.001);
        slots.slice(index + 1).forEach(other => assert.ok(
          slot.x + slot.width <= other.x || other.x + other.width <= slot.x
          || slot.y + slot.height <= other.y || other.y + other.height <= slot.y,
          `Count ${count} on ${width}x${height} has overlapping cells`
        ));
      });
    }
  }
});

test("original mode and unrelated documents keep the existing PDF renderer", () => {
  const f = fixture();
  f.state.pdf.countingDisplayMode = "original";
  assert.equal(f.draw(4000), false);
  assert.equal(f.images.length, 0);
  f.state.pdf.countingDisplayMode = "reveal";
  f.page.countingActivity.objectDocumentId = "different-book";
  assert.equal(f.draw(4000), false);
  f.page.countingActivity.objectDocumentId = fingerprint;
  f.page.countingActivity.objectPageNumber = 27;
  assert.equal(f.draw(4000), false);
  f.page.countingActivity.objectPageNumber = 28;
  f.state.exportingVideo = true;
  f.state.pdf.exportCountingDisplayMode = "original";
  assert.equal(f.draw(4000), false, "Export retains its snapshotted counting mode");
});

test("missing cutouts show only a clean placeholder, never all original objects", () => {
  const f = fixture({ unloaded: true });
  f.page.countingObjectError = "Unavailable fixture artwork";
  assert.equal(f.draw(4000), true);
  assert.equal(f.images.length, 0);
  assert.ok(f.texts.some(text => /Artwork unavailable/.test(text)));
});

test("v2 manifest validation rejects wrong style, document, noun, count, order, dimensions, crop bounds and paths", () => {
  const f = fixture();
  assert.equal(f.context.validatePdfCountingObjectManifest(f.manifest, f.page).length, 13);
  for (const mutate of [
    manifest => { delete manifest.schemaVersion; },
    manifest => { manifest.schemaVersion = 1; },
    manifest => { manifest.assetStyle = "old-cutouts"; },
    manifest => { manifest.fingerprint = "different-book"; },
    manifest => { manifest.pages[28].verified = false; },
    manifest => { manifest.pages[28].noun = "dogs"; },
    manifest => { manifest.pages[28].count = 12; },
    manifest => { manifest.pages[28].objects.pop(); },
    manifest => { manifest.pages[28].objects[1].number = 1; },
    manifest => { manifest.pages[28].objects[0].width = 0; },
    manifest => { delete manifest.pages[28].objects[0].contentBounds; },
    manifest => { manifest.pages[28].objects[0].contentBounds = [-1, 0, 700, 800]; },
    manifest => { manifest.pages[28].objects[0].contentBounds = [0, 0, 0, 800]; },
    manifest => { manifest.pages[28].objects[0].contentBounds = [400, 0, 700, 800]; },
    manifest => { manifest.pages[28].objects[0].contentBounds = [0, 400, 700, 800]; },
    manifest => { manifest.pages[28].objects[0].contentBounds = [0, 0, NaN, 800]; },
    manifest => { manifest.pages[28].objects[0].src = "../unrelated.png"; }
  ]) {
    const manifest = structuredClone(f.manifest);
    mutate(manifest);
    assert.throws(() => f.context.validatePdfCountingObjectManifest(manifest, f.page), /Verified object artwork is unavailable/);
  }
});

test("asset readiness waits for one shared image decode and preserves all ordered object instances", async () => {
  const decodeGate = deferred();
  const f = fixture({ unloaded: true, decodeGate });
  const first = f.context.ensurePdfCountingObjectsLoaded(f.page);
  const second = f.context.ensurePdfCountingObjectsLoaded(f.page);
  await f.firstDecode.promise;
  assert.equal(f.page.countingObjectImages, null, "Partly decoded objects cannot become render-ready");
  assert.equal(f.fetches(), 1);
  decodeGate.resolve();
  const [objects, sameObjects] = await Promise.all([first, second]);
  assert.equal(objects, sameObjects);
  assert.equal(objects.length, 13);
  assert.equal(f.decodedUrls.length, 1);
  assert.deepEqual(f.requestedUrls, ["app://voice/assets/pdf-counting/realistic-v2/candies.png"]);
  assert.deepEqual(Array.from(objects, object => object.number), Array.from({ length: 13 }, (_, index) => index + 1));
  assert.equal(new Set(Array.from(objects, object => object.image)).size, 1);
  assert.ok(objects.every(object => object.width === 720 && object.height === 800), "Layout uses reviewed content bounds, not outer PNG padding");
  await f.context.ensurePdfCountingObjectsLoaded(f.page);
  assert.equal(f.fetches(), 1);
  assert.equal(f.requestedUrls.length, 1);
});

test("different page instances share the decoded category image and draw its reviewed crop", async () => {
  const decodeGate = deferred();
  const f = fixture({ unloaded: true, decodeGate });
  const secondPage = { ...f.page, countingObjectImages: null, countingObjectPromise: null };
  const first = f.context.ensurePdfCountingObjectsLoaded(f.page);
  const second = f.context.ensurePdfCountingObjectsLoaded(secondPage);
  await f.firstDecode.promise;
  assert.equal(f.requestedUrls.length, 1);
  decodeGate.resolve();
  const [firstObjects, secondObjects] = await Promise.all([first, second]);
  assert.equal(firstObjects[0].image, secondObjects[0].image);
  assert.equal(f.decodedUrls.length, 1);
  f.draw(1500);
  assert.equal(f.images.length, 2);
  assert.ok(f.images.every(image => image.id === f.requestedUrls[0]));
  assert.ok(f.images.every(image => JSON.stringify(image.sourceBounds) === JSON.stringify([140, 80, 720, 800])));
  assert.ok(f.images.every(image => Math.abs(image.box[2] / image.box[3] - 720 / 800) < .001));
  assert.deepEqual(f.texts.filter(text => /^\d+$/.test(text)), ["1", "2"]);
  assert.deepEqual(f.texts.filter(text => numberSpellings.includes(text.toLowerCase())), ["one", "two"]);
});

test("missing v2 manifests and unexpected image dimensions stop before any partial artwork becomes ready", async () => {
  const missing = fixture({ unloaded: true, missingManifest: true });
  await assert.rejects(missing.context.ensurePdfCountingObjectsLoaded(missing.page), /Counting artwork could not be loaded/);
  assert.equal(missing.requestedUrls.length, 0);
  assert.equal(missing.page.countingObjectImages, null);
  const mismatch = fixture({ unloaded: true, imageWidth: 1023 });
  await assert.rejects(mismatch.context.ensurePdfCountingObjectsLoaded(mismatch.page), /dimensions do not match/);
  assert.equal(mismatch.page.countingObjectImages, null);
  assert.equal(mismatch.page.countingObjectPromise, null);
});

test("a failed shared image load can explicitly retry without retaining a rejected cache entry", async () => {
  const f = fixture({ unloaded: true, failFirstImage: true });
  await assert.rejects(f.context.ensurePdfCountingObjectsLoaded(f.page), /complete candies picture could not be loaded/);
  assert.equal(f.page.countingObjectPromise, null);
  assert.equal(f.page.countingObjectImages, null);
  f.draw(1500);
  assert.equal(f.requestedUrls.length, 1, "An error placeholder cannot retry by itself");
  assert.equal(f.images.length, 0);
  const objects = await f.context.ensurePdfCountingObjectsLoaded(f.page);
  assert.equal(objects.length, 13);
  assert.equal(f.fetches(), 1, "The successful manifest remains cached while only its failed image retries");
  assert.equal(f.requestedUrls.length, 2);
  assert.equal(f.decodedUrls.length, 1);
  assert.equal(new Set(Array.from(objects, object => object.image)).size, 1);
  assert.equal(f.page.countingObjectError, "");
});

test("live narration waits for all decoded counting artwork before playing", async () => {
  const decodeGate = deferred();
  const f = fixture({ unloaded: true, decodeGate });
  const playback = f.context.startPdfNarrationPlayback("Playing test");
  await f.firstDecode.promise;
  assert.deepEqual(f.audioEvents, []);
  assert.equal(f.state.speaking, false);
  decodeGate.resolve();
  await playback;
  assert.deepEqual(f.audioEvents, ["created", "played"]);
  assert.equal(f.state.speaking, true);
});

test("a transient artwork load failure can be retried without an automatic draw loop", async () => {
  const f = fixture({ unloaded: true, failFirstFetch: true });
  await assert.rejects(f.context.ensurePdfCountingObjectsLoaded(f.page), /Temporary artwork connection failure/);
  assert.equal(f.page.countingObjectPromise, null);
  assert.match(f.page.countingObjectError, /Temporary artwork connection failure/);
  assert.equal(f.draw(4000), true);
  assert.equal(f.fetches(), 1, "Error placeholder cannot trigger repeated background retries");
  assert.equal(f.images.length, 0);
  const objects = await f.context.ensurePdfCountingObjectsLoaded(f.page);
  assert.equal(objects.length, 13);
  assert.equal(f.fetches(), 2);
  assert.equal(f.page.countingObjectError, "");
  assert.equal(f.decodedUrls.length, 1);
});

test("changing counting mode while artwork loads prevents stale narration from starting", async () => {
  const decodeGate = deferred();
  const f = fixture({ unloaded: true, decodeGate });
  const playback = f.context.startPdfNarrationPlayback("Playing test");
  const rejected = assert.rejects(playback, /cancelled/);
  await f.firstDecode.promise;
  f.state.pdf.countingDisplayMode = "original";
  decodeGate.resolve();
  await rejected;
  assert.deepEqual(f.audioEvents, []);
  assert.equal(f.state.speaking, false);
});

test("the real Stop action cancels narration while counting artwork is still preparing", async () => {
  const decodeGate = deferred();
  const f = fixture({ unloaded: true, decodeGate });
  const playback = f.context.startPdfNarrationPlayback("Playing test");
  const rejected = assert.rejects(playback, /cancelled/);
  await f.firstDecode.promise;
  f.context.handleStop();
  decodeGate.resolve();
  await rejected;
  assert.deepEqual(f.audioEvents, []);
  assert.equal(f.state.speaking, false);
});

test("seeking while artwork prepares uses the newly chosen position when audio starts", async () => {
  const decodeGate = deferred();
  const f = fixture({ unloaded: true, decodeGate });
  const playback = f.context.startPdfNarrationPlayback("Playing test");
  await f.firstDecode.promise;
  f.context.seekPdfPresentation(4250);
  decodeGate.resolve();
  await playback;
  assert.equal(f.audioInstances[0].currentTime, 4.25);
  assert.equal(f.state.pdf.timelineStartOffsetMs, 4250);
  assert.deepEqual(f.audioEvents, ["created", "played"]);
});

test("Pause during background music preparation cannot restart the detached narration audio", async () => {
  const musicGate = deferred();
  const f = fixture({ unloaded: true, musicGate });
  const playback = f.context.startPdfNarrationPlayback("Playing test");
  const rejected = assert.rejects(playback, /cancelled/);
  await f.musicStarted.promise;
  f.context.pausePdfPresentation();
  musicGate.resolve();
  await rejected;
  assert.ok(!f.audioEvents.includes("played"));
  assert.equal(f.state.activeAudio, null);
  assert.equal(f.state.speaking, false);
});

test("a rejected audio play releases ownership so the next Play is not stuck as already playing", async () => {
  const f = fixture({ unloaded: true, failPlay: true });
  await assert.rejects(f.context.startPdfNarrationPlayback("Playing test"), /Synthetic audio play failure/);
  assert.equal(f.state.activeAudio, null);
  assert.equal(f.state.speaking, false);
  assert.equal(f.state.pdf.audioDriven, false);
  assert.equal(f.state.pdf.paused, true);
  assert.ok(f.audioEvents.includes("paused"));
});
