'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
function load(name, globals = {}) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0);
  const end = source.indexOf('\n}', start) + 2;
  return vm.runInNewContext(`${source.slice(start, end)}\n${name}`, globals);
}

test('PDF lesson uses only selected pages and preserves their order', () => {
  const state = { pdf: { pages: [{text:'First'}, {text:'Second'}, {text:'Third'}], selectedPageIndexes: [2, 0, 2, 99] } };
  const getPdfSelectedPageIndexes = load('getPdfSelectedPageIndexes', {state});
  const getPdfSelectedPages = load('getPdfSelectedPages', {state, getPdfSelectedPageIndexes});
  const text = load('getDynamicPdfLessonText', {getPdfSelectedPages});
  assert.equal(text(), 'First\n\nThird');
  state.pdf.selectedPageIndexes = [1];
  assert.equal(text(), 'Second');
  state.pdf.selectedPageIndexes = [];
  assert.equal(text(), '');
});

test('Edge pool bounds active jobs and preserves output order for 1099 parts', async () => {
  const pool = load('mapNarrationWithConcurrency');
  let active = 0, peak = 0;
  const parts = Array.from({length:1099}, (_, i) => i);
  const result = await pool(parts, 3, async value => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    --active;
    return value;
  });
  assert.equal(peak, 3);
  assert.deepEqual(Array.from(result), parts);
  assert.equal(active, 0);
});

test('failure stops scheduling and drains active jobs before retry is possible', async () => {
  const pool = load('mapNarrationWithConcurrency');
  let active = 0, started = 0;
  await assert.rejects(pool([0,1,2,3,4,5], 3, async value => {
    ++started; ++active;
    try {
      if (value === 0) throw new Error('unavailable');
      await new Promise(resolve => setTimeout(resolve, 10));
    } finally { --active; }
  }), /unavailable/);
  assert.equal(started, 3);
  assert.equal(active, 0);
});

for (const duration of [1.25, NaN]) {
  test(`duration measurement releases its audio player (${duration})`, async () => {
    const audio = {duration};
    const disposed = [], revoked = [];
    const measure = load('measureNarrationBlobDurationMs', {
      URL: {createObjectURL: () => 'blob:test', revokeObjectURL: url => revoked.push(url)},
      createLoadedAudio: async () => audio,
      disposeRuntimeAudio: element => disposed.push(element)
    });
    if (Number.isFinite(duration)) assert.equal(await measure({size:1}), 1250);
    else await assert.rejects(measure({size:1}), /duration could not/);
    assert.deepEqual(disposed, [audio]);
    assert.deepEqual(revoked, ['blob:test']);
  });
}

test('failed audio load still revokes its URL', async () => {
  let revoked = false;
  const measure = load('measureNarrationBlobDurationMs', {
    URL: {createObjectURL: () => 'blob:test', revokeObjectURL: () => {revoked = true;}},
    createLoadedAudio: async () => {throw new Error('load failed');},
    disposeRuntimeAudio: () => {}
  });
  await assert.rejects(measure({size:1}), /load failed/);
  assert.ok(revoked);
});
