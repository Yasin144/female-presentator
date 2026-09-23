const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

// Exercise the production PDF generator and audio merger without starting
// Electron or making paid/network voice requests.
const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
function functionSource(name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\r?\\n\\}`, "m"));
  assert.ok(match, `Production function ${name} must exist`);
  return match[0];
}
const generatorStart = source.indexOf("const pdfNarrationClipCache =");
const generatorEnd = source.indexOf("async function ensurePdfNarrationReadyForPresentation", generatorStart);
assert.ok(generatorStart >= 0 && generatorEnd > generatorStart);
const generatorSource = source.slice(generatorStart, generatorEnd);
const wordsSource = source.match(/const PDF_COUNTING_WORDS = \[[^]*?\];/)[0];

const countingPage = (index, count, noun = "birds") => ({
  index,
  countingActivity: { count, noun, title: `${count} ${noun}` }
});

function pcmBuffer({ duration = 0.7, sampleRate = 24000, channelCount = 1, voiceChannel = 0,
  onsetMs = 0, signalMs = Infinity, amplitude = 0.16, noiseAmplitude = 0, clickMs = -1 } = {}) {
  const length = Math.max(0, Math.round(duration * sampleRate));
  const channels = Array.from({ length: channelCount }, (_, channelIndex) => {
    const samples = new Float32Array(length);
    for (let index = 0; index < length; index++) {
      const timeMs = index * 1000 / sampleRate;
      const noise = noiseAmplitude * (index % 2 ? 1 : -1);
      const voice = channelIndex === voiceChannel && timeMs >= onsetMs && timeMs < onsetMs + signalMs
        ? amplitude * Math.sin(index * 2 * Math.PI * 340 / sampleRate)
        : 0;
      samples[index] = noise + voice;
    }
    if (clickMs >= 0 && channelIndex === voiceChannel && Math.round(clickMs * sampleRate / 1000) < length) {
      samples[Math.round(clickMs * sampleRate / 1000)] = 0.9;
    }
    return samples;
  });
  return { duration, sampleRate, length, numberOfChannels: channelCount, getChannelData: index => channels[index] };
}

function harness(pages, settings = {}) {
  const calls = [], schedules = [], contexts = [], progress = [];
  const state = { preferredNarrationVoice: "edge", pdf: { requestId: 1, narration: {} } };
  const urlBlobs = new Map(), revokedUrls = [];
  let nextUrlId = 0;
  let active = 0, maximumActive = 0, profile = null;
  class AudioContext {
    constructor() { this.closed = false; contexts.push(this); }
    async decodeAudioData(bytes) {
      assert.equal(this.closed, false, "Cannot decode using a closed context");
      const data = JSON.parse(new TextDecoder().decode(bytes));
      return { ...data, ...pcmBuffer({ duration: data.duration, ...settings.pcmOptions?.(data) }) };
    }
    async close() { this.closed = true; }
  }
  class OfflineAudioContext {
    constructor(channels, length, sampleRate) {
      this.duration = length / sampleRate;
      this.schedule = [];
      schedules.push(this.schedule);
    }
    createBufferSource() {
      const schedule = this.schedule;
      return {
        connect() {},
        start(time) { schedule.push({ text: this.buffer.text, time, duration: this.buffer.duration }); }
      };
    }
    createGain() {
      return { connect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {} } };
    }
    async startRendering() { return { duration: this.duration }; }
  }
  const context = vm.createContext({
    Blob, DOMException,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    state,
    URL: {
      createObjectURL: blob => {
        const url = `blob:test-${++nextUrlId}`;
        urlBlobs.set(url, blob);
        return url;
      },
      revokeObjectURL: url => { revokedUrls.push(url); urlBlobs.delete(url); }
    },
    createLoadedAudio: async url => {
      const decoded = JSON.parse(await urlBlobs.get(url).text());
      settings.onLoaded?.(state);
      return { duration: decoded.duration };
    },
    scaleSpeechSyncProfile: profile => profile,
    rebuildPdfPresentationSchedule() {},
    updatePdfPageSelectionSummary() {},
    updateStageTimelineUi() {},
    syncExportVoiceSelection() {},
    getLongNarrationRequestTimeoutMs: () => 5000,
    getPdfPresentationText: () => "PDF counting text",
    normalizeNarrationVoiceId: voice => voice,
    window: { AudioContext, OfflineAudioContext },
    EDGE_NARRATION_VOICE: "edge",
    PDF_HIGHLIGHT_TIMING_VERSION: 2,
    buildExactWhisperSyncProfile: async () => null,
    NARRATION_CHUNK_JOIN_GAP_MS: 250,
    NARRATION_CHUNK_FADE_MS: 18,
    getPdfSelectedPages: () => pages,
    getPdfReadingLineGeometry: page => (page.visualLines || []).map(text => ({ text })),
    getPdfReadingNarrationLines: page => page.visualLines || [],
    getNarrationVoiceLabel: voice => voice,
    requireNarrationVoiceId: voice => voice,
    getSpeechSyncProfile: (text, durationMs) => ({ text, totalDurationMs: durationMs, units: [{ speechStartMs: 0, speechEndMs: durationMs, pauseEndMs: durationMs }] }),
    audioBufferToWavBlob: buffer => new Blob([JSON.stringify(buffer)]),
    requestNarrationBlob: async (text, voice) => {
      calls.push({ text, voice, generic: true });
      return new Blob([text]);
    },
    generateNarrationChunkWithFallback: async (text, voice) => {
      calls.push({ text, voice });
      active++;
      maximumActive = Math.max(maximumActive, active);
      try {
        // Complete out of order so a parallel generator must preserve page order.
        await new Promise(resolve => setTimeout(resolve, settings.delayMs ?? (text === "one" ? 8 : 2)));
        settings.onGenerate?.({ text, voice });
        const duration = ({ one: 0.25, two: 0.41, three: 0.68 })[text] || 1.43;
        const blob = new Blob([JSON.stringify({ text, duration })]);
        return { chunks: [text], blobs: [blob], durations: [Math.max(1000, duration * 1000)] };
      } finally { active--; }
    }
  });
  vm.runInContext([
    wordsSource,
    functionSource("createWhatsAppBrowserJob"),
    functionSource("finishWhatsAppBrowserJob"),
    functionSource("getWhatsAppOutputName"),
    functionSource("normalizeNarrationChunkEntries"),
    functionSource("combineNarrationBlobs"),
    functionSource("getPdfReadingSpokenText"),
    generatorSource,
    functionSource("ensurePdfNarrationReadyForPresentation"),
    functionSource("hasMatchingPdfNarration"),
    functionSource("ensureAnjaliPdfNarrationReadyForExport"),
    functionSource("getSelectedEdgeExportVoice"),
    functionSource("scalePdfNarrationTiming"),
    functionSource("setPdfNarrationFromBlob"),
    functionSource("resetPdfNarrationState"),
    "globalThis.cacheSizes = () => [pdfNarrationClipCache.size, pdfNarrationClipsInFlight.size];"
  ].join("\n"), context);
  return {
    context, calls, schedules, contexts, progress, state, revokedUrls, urlBlobs,
    get active() { return active; },
    get maximumActive() { return maximumActive; },
    get profile() { return profile; },
    run: (voice = "edge", options = {}) => context.requestPdfNarrationBlob("PDF counting text", voice, {
      onProgress: value => progress.push(value),
      onSyncProfile: value => { profile = value; },
      ...options
    })
  };
}

test("count labels use the real merger start times, including subsecond clips", async () => {
  const h = harness([countingPage(25, 2), countingPage(26, 3)]);
  await h.run();
  assert.equal(h.maximumActive, 3);
  assert.equal(h.calls.length, 7, "Shared number words are generated only once");
  assert.deepEqual(h.schedules[0].map(item => item.text), [
    "2 birds. Let us count the birds.", "one", "two", "There are two birds.",
    "3 birds. Let us count the birds.", "one", "two", "three", "There are three birds."
  ]);
  const spokenCounts = h.schedules[0].filter(item => ["one", "two", "three"].includes(item.text));
  const markerStarts = Array.from(h.profile.pdfTiming, page => Array.from(page.countStarts)).flat();
  assert.equal(markerStarts.length, spokenCounts.length);
  markerStarts.forEach((startMs, index) => {
    assert.ok(Math.abs(startMs - spokenCounts[index].time * 1000) < 0.01,
      `${spokenCounts[index].text} label must begin with the actual scheduled clip`);
  });
  assert.ok(h.contexts.every(context => context.closed));
  assert.equal(h.progress.at(-1).progress, 1);
});

test("PCM onset finds padded speech, quiet attacks and stereo speech while ignoring isolated clicks", () => {
  const detect = harness([]).context.getPdfNarrationAudibleOnsetMs;
  for (const options of [
    { onsetMs: 110 },
    { onsetMs: 185, sampleRate: 48000, channelCount: 2, voiceChannel: 1 },
    { onsetMs: 90, amplitude: 0.003, noiseAmplitude: 0.0002 },
    { onsetMs: 160, clickMs: 25, noiseAmplitude: 0.0002 }
  ]) {
    const onset = detect(pcmBuffer(options));
    assert.ok(Math.abs(onset - options.onsetMs) <= 5, `${JSON.stringify(options)} returned ${onset}ms`);
  }
  const quietAttack = pcmBuffer({ onsetMs: 145 });
  const samples = quietAttack.getChannelData(0);
  for (let index = 120 * 24; index < 145 * 24; index++) {
    samples[index] = 0.0006 * Math.sin(index * 2 * Math.PI * 340 / 24000);
  }
  assert.ok(Math.abs(detect(quietAttack) - 120) <= 5, "Includes the quiet start before the sustained word");
});

test("PCM onset remains finite and bounded for silence, tiny clips and unusable audio", () => {
  const detect = harness([]).context.getPdfNarrationAudibleOnsetMs;
  assert.equal(detect(pcmBuffer({ amplitude: 0 })), 0);
  assert.equal(detect(pcmBuffer({ amplitude: 0, noiseAmplitude: 0.0002 })), 0);
  assert.equal(detect(pcmBuffer({ amplitude: 0, clickMs: 40 })), 0);
  assert.equal(detect(pcmBuffer({ duration: 0 })), 0);
  assert.equal(detect({ duration: NaN, sampleRate: 24000 }), 0);
  assert.equal(detect(null), 0);
  for (const duration of [1 / 24000, 0.003, 0.009, 0.02]) {
    const onset = detect(pcmBuffer({ duration, onsetMs: duration * 500 }));
    assert.ok(Number.isFinite(onset) && onset >= 0 && onset <= duration * 1000);
  }
  const longClip = pcmBuffer({ duration: 4, onsetMs: 3500 });
  assert.equal(detect(longClip), 0, "Audio scanning is capped at three seconds");
});

test("PDF narration removes only excessive TTS tail padding and keeps a natural pause", () => {
  const trimmingSource = functionSource("trimPdfNarrationTrailingSilence");
  assert.match(trimmingSource, /durationMs - audibleEndMs < 650/);
  assert.match(trimmingSource, /audibleEndMs \+ 180/);
  const clipSource = functionSource("getPdfNarrationClip");
  assert.match(clipSource, /trimPdfNarrationTrailingSilence\(decoded, blob\)/);
  assert.match(clipSource, /blobs: preparedBlobs/);
});

test("only count labels receive PCM onset offsets; assembled audio and page durations stay unchanged", async () => {
  const pages = [countingPage(25, 2), countingPage(26, 3)];
  const baseline = harness(pages);
  const padded = harness(pages, {
    pcmOptions: ({ text }) => ({ onsetMs: ({ one: 80, two: 115, three: 165 })[text] || 40 })
  });
  await baseline.run();
  await padded.run();
  assert.deepEqual(padded.schedules[0], baseline.schedules[0], "Narration bytes/durations and merger starts are untouched");
  const wordOnsets = [80, 115, 80, 115, 165];
  const oldStarts = Array.from(baseline.profile.pdfTiming, page => Array.from(page.countStarts)).flat();
  const newStarts = Array.from(padded.profile.pdfTiming, page => Array.from(page.countStarts)).flat();
  newStarts.forEach((start, index) => assert.ok(Math.abs(start - oldStarts[index] - wordOnsets[index]) <= 5));
  for (let index = 0; index < pages.length; index++) {
    assert.equal(padded.profile.pdfTiming[index].startMs, baseline.profile.pdfTiming[index].startMs);
    assert.equal(padded.profile.pdfTiming[index].endMs, baseline.profile.pdfTiming[index].endMs);
  }
  const cachedStarts = JSON.stringify(padded.profile.pdfTiming);
  const calls = padded.calls.length;
  await padded.run();
  assert.equal(padded.calls.length, calls, "Onsets are cached together with the selected voice clips");
  assert.equal(JSON.stringify(padded.profile.pdfTiming), cachedStarts);
});

test("repeat playback reuses clips while a different chosen voice gets its own audio", async () => {
  const h = harness([countingPage(27, 3, "candies")]);
  await h.run("edge");
  const initialCalls = h.calls.length;
  const initialTiming = JSON.stringify(h.profile.pdfTiming);
  await h.run("edge");
  assert.equal(h.calls.length, initialCalls);
  assert.equal(JSON.stringify(h.profile.pdfTiming), initialTiming);
  await h.run("pattan");
  assert.equal(h.calls.length, initialCalls * 2);
  assert.ok(h.calls.slice(initialCalls).every(call => call.voice === "pattan"));
  await h.run("edge");
  assert.equal(h.calls.length, initialCalls * 2);
});

test("local voice preparation remains sequential", async () => {
  const h = harness([countingPage(27, 3, "candies")]);
  await h.run("sc3");
  assert.equal(h.maximumActive, 1);
  assert.ok(h.calls.every(call => call.voice === "sc3"));
});

test("cancelled generation drains workers and does not publish an old timeline", async () => {
  let current = true;
  const h = harness([countingPage(27, 3, "candies")], {
    onGenerate: () => { current = false; }
  });
  await assert.rejects(h.run("edge", { isCurrent: () => current }), { name: "AbortError" });
  assert.equal(h.active, 0);
  assert.equal(h.profile, null);
  assert.equal(h.schedules.length, 0);
  assert.ok(h.contexts.every(context => context.closed));
  assert.equal(h.context.cacheSizes()[1], 0);
});

test("failed clips are retryable and pending workers finish before context cleanup", async () => {
  let failOnce = true;
  const h = harness([countingPage(27, 3, "candies")], {
    onGenerate: ({ text }) => {
      if (text === "two" && failOnce) { failOnce = false; throw new Error("Voice unavailable"); }
    }
  });
  await assert.rejects(h.run(), /Voice unavailable/);
  assert.equal(h.active, 0);
  assert.equal(h.context.cacheSizes()[1], 0);
  assert.ok(h.contexts.every(context => context.closed));
  await h.run();
  assert.equal(h.calls.filter(call => call.text === "two").length, 2);
  assert.equal(h.schedules.length, 1);
  assert.ok(h.profile.pdfTiming.length);
});

test("non-counting PDFs prepare line-level narration timing with the selected voice", async () => {
  const h = harness([{ index: 0, text: "A lesson without counting." }]);
  await h.run("pattan");
  assert.deepEqual(h.calls, [{ text: "A lesson without counting.", voice: "pattan" }]);
  assert.equal(h.contexts.length, 1);
  assert.deepEqual(Array.from(h.profile.pdfTiming[0].readingSegments, segment => segment.text), ["A", "lesson", "without", "counting"]);
});

test("ordinary PDF narration follows visual title-to-body order and times one word at a time", async () => {
  const h = harness([{
    index: 0,
    text: "Body sentence. Big - Small",
    visualLines: ["Big - Small", "Body sentence."]
  }]);
  await h.run("edge");
  assert.deepEqual(h.calls.map(call => call.text), ["Big - Small", "Body sentence."]);
  const segments = Array.from(h.profile.pdfTiming[0].readingSegments);
  assert.deepEqual(segments.map(segment => segment.text), ["Big", "Small", "Body", "sentence"]);
  assert.deepEqual(segments.map(segment => segment.lineText), ["Big - Small", "Big - Small", "Body sentence.", "Body sentence."]);
  assert.ok(segments.every((segment, index) => !index || segment.startMs >= segments[index - 1].endMs));
});

test("same-height exercise columns remain separate so short numeral answers are not swallowed", () => {
  const context = vm.createContext({});
  vm.runInContext(`${functionSource('repairPdfReadingLineGeometry')}; ${functionSource('getPdfReadingLineGeometry')}; globalThis.lines = getPdfReadingLineGeometry;`, context);
  const item = (str, x, width) => ({ str, width, height: 12, transform: [12, 0, 0, 12, x, 300] });
  const lines = context.lines({ countingTextItems: [
    item('3 comes before', 50, 88), item('4.', 143, 12),
    item('3 comes after', 350, 82), item('2.', 437, 12)
  ] });
  assert.deepEqual(Array.from(lines, line => line.text), ['3 comes before 4.', '3 comes after 2.']);
  assert.deepEqual(Array.from(lines[0].words, word => word.text), ['3', 'comes', 'before', '4']);
});

test("headless ones and missing four glyphs are recovered only in proven maths context", () => {
  const context = vm.createContext({});
  vm.runInContext(`${functionSource('repairPdfReadingLineGeometry')}; globalThis.repair = repairPdfReadingLineGeometry;`, context);
  const word = (text, x) => ({ text, x, y: 200, width: 8, height: 16 });
  const repairedOne = context.repair({ text: 'I comes before 2.', words: [word('I', 10), word('comes', 22), word('before', 65), word('2', 120)], items: [], x: 10, y: 200, width: 120, height: 16 });
  assert.equal(repairedOne.text, '1 comes before 2.');
  assert.equal(repairedOne.words[0].text, '1');
  const repairedFour = context.repair({ text: '3 comes before .', words: [word('3', 10), word('comes', 22), word('before', 65)], items: [{ text: '.', x: 130 }], x: 10, y: 200, width: 125, height: 16 });
  assert.equal(repairedFour.text, '3 comes before 4.');
  assert.equal(repairedFour.words.at(-1).text, '4');
  const numberLine = context.repair({ text: '0 I 2 3 5 6 7 8 9 I0', words: ['0','I','2','3','5','6','7','8','9','I0'].map((text,index)=>word(text,10+index*20)), items: [], x: 10, y: 200, width: 200, height: 16 });
  assert.deepEqual(Array.from(numberLine.words, value => value.text), ['0','1','2','3','4','5','6','7','8','9','10']);
  assert.equal(context.repair({ text: 'I am happy.', words: [word('I', 10)], items: [], x: 10, y: 200, width: 80, height: 16 }).text, 'I am happy.');
});

test("page narration uses repaired maths text so actions can follow 1 and inferred 4", () => {
  const context = vm.createContext({});
  vm.runInContext(`${functionSource('repairPdfReadingLineGeometry')}; ${functionSource('getPdfReadingLineGeometry')}; ${functionSource('getPdfReadingNarrationLines')}; globalThis.lines = getPdfReadingNarrationLines;`, context);
  const item = (str, x, width, y = 300) => ({ str, width, height: 12, transform: [12, 0, 0, 12, x, y] });
  const lines = context.lines({ sourceHeight: 600, countingTextItems: [
    item('I comes before', 50, 88), item('2.', 143, 12),
    item('3 comes before', 50, 88, 270), item('.', 143, 4, 270)
  ] });
  assert.deepEqual(Array.from(lines), ['1 comes before 2.', '3 comes before 4.']);
});

test("standalone PDF numerals are spoken explicitly while printed digits remain available for highlighting", () => {
  const h = harness([]);
  assert.equal(h.context.getPdfReadingSpokenText('3 comes before 4.'), 'three comes before four.');
  assert.equal(h.context.getPdfReadingSpokenText('100 comes after 99.'), 'one hundred comes after ninety-nine.');
});

test("PDF line highlights scale to the final loaded narration duration", () => {
  const h = harness([]);
  const scaled = h.context.scalePdfNarrationTiming([{
    pageIndex: 4, startMs: 0, endMs: 1000, countStarts: [], placeValueSteps: [],
    readingSegments: [{ text: "The green car is between the red and blue car.", startMs: 200, endMs: 900 }]
  }], 1000, 1500);
  assert.equal(scaled[0].endMs, 1500);
  assert.equal(scaled[0].readingSegments[0].startMs, 300);
  assert.equal(scaled[0].readingSegments[0].endMs, 1350);
});

test("PDF playback and export both honor the chosen voice and reuse matching narration", async () => {
  const pages = [countingPage(27, 3, "candies")];
  const h = harness(pages);
  h.state.preferredNarrationVoice = "pattan";
  await h.context.ensurePdfNarrationReadyForPresentation();
  assert.equal(h.state.pdf.narration.voice, "pattan");
  assert.ok(h.calls.every(call => call.voice === "pattan"));
  assert.equal(h.context.hasMatchingPdfNarration("pattan"), true);
  assert.equal(h.context.hasMatchingPdfNarration("edge"), false);
  const saved = h.state.pdf.narration.blob;
  assert.equal(await h.context.ensureAnjaliPdfNarrationReadyForExport(), saved);
  await h.context.ensurePdfNarrationReadyForPresentation();
  assert.equal(h.schedules.length, 1, "Matching audio is reused without merging again");

  h.state.preferredNarrationVoice = "edge";
  await h.context.ensureAnjaliPdfNarrationReadyForExport();
  assert.equal(h.state.pdf.narration.voice, "edge");
  assert.equal(h.schedules.length, 2);
  assert.equal(h.revokedUrls.length, 1, "Replaced voice audio releases its URL");
  pages[0].index = 28;
  assert.equal(h.context.hasMatchingPdfNarration("edge"), false, "Different page selection invalidates timing");
});

test("changing the voice during preparation cancels old audio before publication", async () => {
  let h;
  h = harness([countingPage(27, 3, "candies")], {
    onGenerate: () => { h.state.preferredNarrationVoice = "pattan"; }
  });
  await assert.rejects(h.context.ensurePdfNarrationReadyForPresentation(), { name: "AbortError" });
  assert.equal(h.state.pdf.narration.url, undefined);
  assert.equal(h.schedules.length, 0);
  assert.equal(h.active, 0);
});

test("a selection change during audio loading cannot replace the current narration", async () => {
  const h = harness([countingPage(27, 3, "candies")], {
    onLoaded: state => { state.pdf.requestId++; }
  });
  const existingNarration = { url: "blob:existing", voice: "pattan", blob: new Blob(["existing"]) };
  h.state.pdf.narration = existingNarration;
  await assert.rejects(h.context.ensureAnjaliPdfNarrationReadyForExport(), { name: "AbortError" });
  assert.equal(h.state.pdf.narration, existingNarration);
  assert.equal(h.revokedUrls.length, 1);
  assert.equal(h.revokedUrls[0], "blob:test-1");
  assert.equal(h.urlBlobs.size, 0);
});
