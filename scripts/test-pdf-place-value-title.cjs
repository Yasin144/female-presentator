const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
const match = source.match(/function drawPdfPlaceValueScene\([^]*?\r?\n\}/m);
assert.ok(match, "Production place-value renderer must exist");

test("place-value introduction is a clean title card without an early duplicated number", () => {
  const texts = [];
  const gradient = { addColorStop() {} };
  const ctx = {
    save() {}, restore() {}, fillRect() {}, createLinearGradient: () => gradient,
    fillText(text) { texts.push(String(text)); }
  };
  const context = vm.createContext({
    ctx,
    canvas: { width: 1920, height: 1080 },
    state: { pdf: { currentTimeMs: 0, narration: { pdfTiming: [{ pageIndex: 60, placeValueSteps: [] }] } } },
    getPdfCountingDisplayMode: () => "reveal",
  });
  vm.runInContext(`${match[0]}\nthis.draw = drawPdfPlaceValueScene;`, context);
  const drawn = context.draw({
    index: 60,
    placeValueActivity: { title: "Numbers 61 to 70", numbers: [61, 62], style: "ten-frames" }
  });
  assert.equal(drawn, true);
  assert.deepEqual(texts, [
    "NUMBERS 61 TO 70",
    "Get ready to build each number with tens and ones."
  ]);
  assert.ok(!texts.includes("61"));
  assert.ok(!texts.includes("Sixty-One"));
});
