const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
function functionSource(name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\r?\\n\\}`, "m"));
  assert.ok(match, `Production function ${name} must exist`);
  return match[0];
}

test("large PDF exact-word alignment remains linear", async () => {
  const unitCount = 30000;
  const units = Array.from({ length: unitCount }, (_, index) => ({
    spokenText: index % 3 === 1 ? "" : `word${index}`,
    speechStartMs: 0,
    speechEndMs: 0,
    pauseEndMs: 0,
  }));
  const context = vm.createContext({
    Blob,
    Uint8Array,
    btoa,
    state: { transcribeServerUrl: "http://local.test" },
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    analyzeSpeechSyncUnits: () => units,
    fetch: async () => ({
      ok: true,
      async json() {
        return { words: Array.from({ length: 20000 }, (_, index) => ({ start: index * 0.01, end: index * 0.01 + 0.008 })) };
      }
    })
  });
  vm.runInContext(`${functionSource("buildExactWhisperSyncProfile")}\nthis.run = buildExactWhisperSyncProfile;`, context);
  const started = performance.now();
  const profile = await context.run(new Blob(["audio"]), "large pdf", 240000);
  const elapsedMs = performance.now() - started;
  assert.equal(profile.units.length, unitCount);
  assert.ok(profile.units[0].pauseEndMs >= profile.units[0].speechEndMs);
  assert.ok(elapsedMs < 1500, `30,000 units should align quickly; took ${Math.round(elapsedMs)}ms`);
  assert.doesNotMatch(functionSource("buildExactWhisperSyncProfile"), /slice\(index \+ 1\)\.find/);
});
