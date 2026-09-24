const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

// Read production logic, but do not launch Electron, load a PDF, or request a
// voice. These checks complement (and do not replace) the rendered-page audit.
const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
const start = source.indexOf("const PDF_COUNTING_WORDS =");
const end = source.indexOf("async function renderPdfPageAssets", start);
assert.ok(start >= 0 && end > start, "Production counting block must exist");
const block = source.slice(start, end);
const normalizer = source.match(/function normalizePdfLine\([^]*?\r?\n\}/)[0];
const fingerprint = "dd93e8325ce5eb4987e70ff85fc82bc9";

// Independently visually checked object centers in the original 886 x 1170
// page renders. A tolerance allows fine visual refinements while preventing
// regressions back to the old generic rows/grid or a person's clothing.
const artwork = {
  26: { noun: "dogs", points: [[.275,.625],[.407,.610],[.531,.633],[.636,.633],[.737,.618],[.189,.708],[.310,.727],[.436,.790],[.575,.711],[.711,.704],[.839,.704]] },
  27: { noun: "books", points: [[.47,.344],[.47,.376],[.47,.404],[.47,.430],[.47,.454],[.47,.479],[.47,.504],[.47,.529],[.47,.553],[.47,.579],[.47,.604],[.47,.631]] },
  28: { noun: "candies", points: [[.314,.459],[.186,.496],[.436,.483],[.256,.518],[.376,.512],[.181,.568],[.301,.555],[.475,.556],[.411,.577],[.203,.633],[.316,.611],[.433,.630],[.313,.661]] },
  29: { noun: "birds", points: [[.73815,.39231],[.61964,.44444],[.30248,.50684],[.77991,.55897],[.26749,.73846],[.38375,.74786],[.71783,.76410],[.19187,.78803],[.32167,.78974],[.84086,.78547],[.23815,.84615],[.80474,.82991],[.38036,.86581],[.68623,.86581]] },
  30: { noun: "bananas", points: [[.47178,.38462],[.50451,.38803],[.56546,.40427],[.60948,.40769],[.48081,.48547],[.51580,.49402],[.55079,.49487],[.58804,.50256],[.45372,.56667],[.48871,.57009],[.52596,.57521],[.57449,.57778],[.44244,.61624],[.43679,.64017],[.57336,.64103]] },
  31: { noun: "butterflies", points: [[.63544,.30256],[.17381,.38462],[.83296,.37607],[.39729,.46239],[.61851,.43077],[.17156,.52650],[.82957,.52137],[.38826,.60256],[.61738,.57949],[.17494,.66667],[.82957,.66239],[.39616,.73504],[.61174,.70513],[.18284,.80513],[.60948,.84615],[.82844,.80513]] },
  32: { noun: "gifts", points: [[.70203,.34530],[.64334,.42564],[.76524,.42564],[.60045,.50513],[.69639,.50769],[.80361,.50598],[.57788,.60171],[.68736,.60342],[.81490,.60427],[.53950,.69829],[.63995,.69658],[.74492,.69915],[.85440,.69915],[.51129,.78974],[.68962,.80598],[.87359,.79658],[.80700,.82650]] },
  33: { noun: "ants", points: [[.40971,.36923],[.68736,.36923],[.86569,.37863],[.27201,.44701],[.67043,.45128],[.89391,.46325],[.15124,.52051],[.60497,.49487],[.53950,.54274],[.43454,.59145],[.81038,.56496],[.34424,.63932],[.25282,.68462],[.66591,.69658],[.19752,.75812],[.34763,.80940],[.61174,.82821],[.85214,.78376]] },
  34: { noun: "leaves", points: [[.52596,.32650],[.44357,.35214],[.60271,.35726],[.26862,.41880],[.44357,.42051],[.60835,.42137],[.34312,.45641],[.72348,.44957],[.80587,.45641],[.22799,.48547],[.67607,.51368],[.80587,.52308],[.21332,.55556],[.83409,.59060],[.21219,.61197],[.80023,.64872],[.26072,.65556],[.32957,.67179],[.72460,.67607]] },
  35: { noun: "stars", points: [[.51129,.14530],[.64447,.13675],[.65237,.19402],[.56208,.24701],[.69977,.26325],[.79233,.26581],[.88826,.28462],[.58126,.30427],[.68736,.31795],[.49774,.33419],[.77540,.33590],[.63431,.36667],[.72686,.38889],[.86343,.40171],[.53612,.43162],[.65124,.42821],[.74492,.44359],[.63318,.48547],[.74718,.51368],[.87472,.51368]] }
};

function harness() {
  const texts = [], arcs = [], lines = [];
  const stack = [];
  const ctx = {
    save() { stack.push({ fillStyle: this.fillStyle, font: this.font }); },
    restore() { Object.assign(this, stack.pop()); },
    beginPath() {}, moveTo(x, y) { lines.push({ type: "move", x, y }); },
    lineTo(x, y) { lines.push({ type: "line", x, y }); },
    stroke() {}, fill() {},
    arc(x, y, radius) { arcs.push({ x, y, radius }); },
    fillText(text, x, y, maxWidth) { texts.push({ text, x, y, maxWidth, font: this.font, color: this.fillStyle }); }
  };
  const state = { speaking: false, paused: false, pdf: { currentTimeMs: 0, narration: { pdfTiming: [] } } };
  const context = vm.createContext({ state, ctx, canvas: { width: 2200, height: 1440 }, clamp: (v, min, max) => Math.min(max, Math.max(min, v)) });
  vm.runInContext(`${normalizer}\n${block}\nglobalThis.api = { PDF_COUNTING_WORDS, PDF_COUNTING_DOCUMENT_ID, PDF_COUNTING_LAYOUTS, getPdfCountingActivity, getPdfCountingStarts, getPdfCountingVisibleCount, getPdfCountingMarkerGeometry, drawPdfCountingMarkers };`, context);
  const api = context.api;
  const page = pageNumber => ({
    index: pageNumber - 1,
    countingActivity: api.getPdfCountingActivity(`${api.PDF_COUNTING_WORDS[pageNumber - 15]} ${artwork[pageNumber].noun}`, { fingerprint, pageNumber })
  });
  const measured = (value, offset = 1000) => {
    const starts = Array.from({ length: value.countingActivity.count }, (_, index) => offset + index * 500);
    state.pdf.narration.pdfTiming = [{ pageIndex: value.index, startMs: 0, endMs: starts.at(-1) + 1000, countStarts: starts }];
    return starts;
  };
  return { api, state, texts, arcs, lines, page, measured, clear: () => { texts.length = arcs.length = lines.length = 0; } };
}

test("the exact nursery document and pages 26-35 bind all 155 independently reviewed anchors", () => {
  const h = harness();
  assert.equal(h.api.PDF_COUNTING_DOCUMENT_ID, fingerprint);
  let total = 0;
  for (const [pageNumber, expected] of Object.entries(artwork)) {
    const activity = h.page(Number(pageNumber)).countingActivity;
    assert.equal(activity.count, Number(pageNumber) - 15);
    assert.equal(activity.noun, expected.noun);
    assert.equal(activity.markersVerified, true);
    assert.equal(activity.markerPoints.length, activity.count);
    assert.equal(new Set(activity.markerPoints.map(point => point.join(","))).size, activity.count, `${expected.noun}: distinct anchors`);
    activity.markerPoints.forEach((point, index) => {
      assert.ok(Math.abs(point[0] - expected.points[index][0]) <= .003 && Math.abs(point[1] - expected.points[index][1]) <= .003,
        `${expected.noun} ${index + 1} must remain on its reviewed object`);
    });
    total += activity.count;
  }
  assert.equal(total, 155);
});

test("a different PDF, missing fingerprint or wrong page cannot borrow verified anchors", () => {
  const h = harness();
  for (const sourceInfo of [{ fingerprint: "another-document", pageNumber: 27 }, { pageNumber: 27 }, { fingerprint, pageNumber: 99 }]) {
    const activity = h.api.getPdfCountingActivity("12 TWELVE BOOKS", sourceInfo);
    assert.equal(activity, null, "Unknown PDFs need a conservative preparation result before narration is replaced");
    assert.equal(h.api.getPdfCountingMarkerGeometry(activity, 0, 0, 886, 1170).length, 0);
  }
  assert.equal(h.api.getPdfCountingActivity("ELEVEN DOGS", { fingerprint, pageNumber: 27 }), null);
});

test("instruction numbers and duplicated numeral/word headings cannot change the reviewed count", () => {
  const h = harness();
  for (const text of ["Count one by one. 13 THIRTEEN CANDIES", "two hands. 13 THIRTEEN CANDIES. Nursery 28", "13\nTHIRTEEN\nCANDIES"]) {
    const activity = h.api.getPdfCountingActivity(text, { fingerprint, pageNumber: 28 });
    assert.equal(activity.count, 13);
    assert.equal(activity.noun, "candies");
  }
  const dogs = h.api.getPdfCountingActivity("11 ELEVEN DOGS. Count one by one.", { fingerprint, pageNumber: 26 });
  assert.equal(dogs.count, 11);
  assert.equal(dogs.noun, "dogs");
  assert.equal(h.api.getPdfCountingActivity("Maths - Nursery 26", { fingerprint, pageNumber: 26 }), null);
});

test("book 12 points at the bottom golden book, not the child's shorts; all labels stay beside the spines", () => {
  const h = harness();
  const activity = h.page(27).countingActivity;
  const markers = h.api.getPdfCountingMarkerGeometry(activity, 0, 0, 886, 1170);
  assert.ok(Math.abs(markers[11].anchorY / 1170 - .631) < .003);
  assert.ok(markers[11].anchorY < 1170 * .65, "Shorts are beneath the book stack");
  markers.forEach(marker => {
    assert.ok(marker.x + marker.radius < .35 * 886, "Badge stays left of the book spine edge");
    assert.ok(marker.x < marker.anchorX && Math.abs(marker.y - marker.anchorY) < .001);
  });
});

for (const width of [220, 516, 886, 1550]) {
  test(`all 155 badge geometries are bounded and nonoverlapping at page width ${width}`, () => {
    const h = harness();
    const height = width * 1170 / 886, left = 23, top = 31;
    for (const pageNumber of Object.keys(artwork)) {
      const page = h.page(Number(pageNumber));
      const markers = h.api.getPdfCountingMarkerGeometry(page.countingActivity, left, top, width, height);
      assert.equal(markers.length, page.countingActivity.count);
      markers.forEach((marker, index) => {
        // Include the white outline, which extends by half the stroke width.
        const outerRadius = marker.radius + Math.max(1, marker.radius * .12) / 2;
        assert.ok(marker.radius >= 1, `${pageNumber}/${index + 1}: badge must be drawable`);
        assert.ok(marker.x - outerRadius >= left && marker.x + outerRadius <= left + width);
        assert.ok(marker.y - outerRadius >= top && marker.y + outerRadius <= top + height);
        assert.ok(marker.anchorX >= left && marker.anchorX <= left + width);
        assert.ok(marker.anchorY >= top && marker.anchorY <= top + height);
        markers.slice(index + 1).forEach(other => {
          const otherOuterRadius = other.radius + Math.max(1, other.radius * .12) / 2;
          assert.ok(Math.hypot(marker.x - other.x, marker.y - other.y) > outerRadius + otherOuterRadius,
            `${pageNumber}/${index + 1}: visible badge outlines must not overlap`);
        });
      });
    }
  });
}

test("unknown, malformed, wrong-page or incomplete timings show zero labels, never proportional estimates", () => {
  const h = harness();
  const page = h.page(28);
  h.state.speaking = true;
  h.state.pdf.currentTimeMs = 100000;
  for (const timing of [
    [], [{ pageIndex: page.index, countStarts: [] }],
    [{ pageIndex: page.index, countStarts: [1, 2, 3] }],
    [{ pageIndex: 999, countStarts: Array.from({ length: 13 }, (_, i) => i + 1) }],
    [{ pageIndex: page.index, countStarts: Array(13).fill(1000) }],
    [{ pageIndex: page.index, countStarts: Array.from({ length: 13 }, (_, i) => i ? i * 500 : -1) }],
    [{ pageIndex: page.index, countStarts: Array.from({ length: 13 }, (_, i) => i === 12 ? NaN : i * 500) }]
  ]) {
    h.state.pdf.narration.pdfTiming = timing;
    assert.equal(h.api.getPdfCountingStarts(page, 0).length, 0);
    assert.equal(h.api.getPdfCountingVisibleCount(page, 0), 0);
    h.clear();
    h.api.drawPdfCountingMarkers(page, 23, 31, 886, 1170, 0);
    assert.equal(h.texts.length, 0);
  }
});

test("each badge is revealed precisely at its measured word onset, across every lesson", () => {
  const h = harness();
  for (const pageNumber of Object.keys(artwork)) {
    const page = h.page(Number(pageNumber));
    const starts = h.measured(page);
    const markers = h.api.getPdfCountingMarkerGeometry(page.countingActivity, 23, 31, 886, 1170);
    starts.forEach((time, index) => {
      h.state.pdf.currentTimeMs = time - .01;
      assert.equal(h.api.getPdfCountingVisibleCount(page, 0), index);
      h.state.pdf.currentTimeMs = time;
      assert.equal(h.api.getPdfCountingVisibleCount(page, 0), index + 1);
      h.clear();
      h.api.drawPdfCountingMarkers(page, 23, 31, 886, 1170, 0);
      assert.deepEqual(h.texts.map(item => item.text), Array.from({ length: index + 1 }, (_, i) => String(i + 1)));
      h.texts.forEach((item, markerIndex) => {
        assert.ok(Math.abs(item.x - markers[markerIndex].x) < .001);
        assert.ok(Math.abs(item.y - markers[markerIndex].y - 1) < .001);
      });
    });
  }
});

test("pausing narration preserves visible badges and the final count remains visible", () => {
  const h = harness();
  const page = h.page(35), starts = h.measured(page);
  h.state.speaking = false;
  h.state.paused = true;
  h.state.pdf.currentTimeMs = starts[9] + 100;
  assert.equal(h.api.getPdfCountingVisibleCount(page, 0), 10);
  h.api.drawPdfCountingMarkers(page, 23, 31, 886, 1170, 0);
  assert.equal(h.texts.length, 10);
  h.clear();
  h.state.paused = false;
  h.state.pdf.currentTimeMs = starts.at(-1) + 1000;
  h.api.drawPdfCountingMarkers(page, 23, 31, 886, 1170, 0);
  assert.equal(h.texts.length, 20);
  assert.equal(h.texts.at(-1).text, "20");
  for (const index of [2, 9, 16]) assert.equal(h.texts[index].color, "#182234", "Every yellow badge uses dark text");
});

test("an unreviewed counting page never draws a generic grid or invented object anchors", () => {
  const h = harness();
  const page = { index: 101, countingActivity: h.api.getPdfCountingActivity("twenty stars", {
    fingerprint: "different", pageNumber: 102,
    preparation: { status: "ready", count: 20, noun: "stars", assetId: "builtin:stars" }
  }) };
  assert.equal(page.countingActivity.markersVerified, false);
  const starts = h.measured(page);
  h.state.pdf.currentTimeMs = starts.at(-1) + 1000;
  h.api.drawPdfCountingMarkers(page, 23, 31, 886, 1170, 0);
  assert.equal(h.arcs.length, 0);
  assert.equal(h.lines.length, 0);
  assert.equal(h.texts.length, 0);
});

test("an unreviewed portrait page never draws a detached side-margin counter or internal warning", () => {
  const h = harness();
  const page = { index: 101, countingActivity: h.api.getPdfCountingActivity("eighteen tops", {
    fingerprint: "different", pageNumber: 29,
    preparation: { status: "ready", count: 18, noun: "tops", assetId: "builtin:tops" }
  }) };
  h.state.pdf.narration.pdfTiming = [{
    pageIndex: page.index,
    countStarts: Array.from({ length: 18 }, (_, index) => index * 500)
  }];
  h.state.pdf.currentTimeMs = 9000;
  h.api.drawPdfCountingMarkers(page, 610, 20, 820, 1400, 0);
  assert.equal(h.texts.length, 0);
  assert.equal(h.arcs.length, 0);
  assert.equal(h.lines.length, 0);
});

test("invalid or partial layout coordinates are rejected rather than silently placing labels", () => {
  const h = harness();
  const good = h.page(26).countingActivity;
  const clone = value => JSON.parse(JSON.stringify(value));
  const invalid = [clone(good), clone(good), clone(good), clone(good)];
  invalid[0].markerPoints.pop();
  invalid[1].markerPoints[0][0] = -1;
  invalid[2].markerPoints[0][1] = Infinity;
  invalid[3].markerLabels = invalid[3].markerPoints.map(point => point.slice());
  invalid[3].markerLabels[0][0] = 2;
  invalid.forEach(activity => assert.equal(h.api.getPdfCountingMarkerGeometry(activity, 0, 0, 886, 1170).length, 0));
});
