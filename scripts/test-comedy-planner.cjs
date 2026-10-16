const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSceneWindows, chooseComedySlot, normalizeComedyReply } = require('../comedy-planner.cjs');

test('scene windows cover the full video without exceeding sixty analysis calls', () => {
  const windows = buildSceneWindows(300);
  assert.equal(windows[0].start, 0);
  assert.equal(windows.at(-1).end, 300);
  assert.ok(windows.length <= 60);
  assert.ok(windows.every((window, index) => index === 0 || window.start === windows[index - 1].end));
});

test('comedy slot chooses a free gap rather than speaking over an uploaded SRT', () => {
  const slot = chooseComedySlot(0, 5, [{ start: 0, end: 2 }, { start: 3.5, end: 5 }]);
  assert.ok(slot.start >= 2);
  assert.ok(slot.end <= 3.5);
  assert.equal(chooseComedySlot(0, 2, [{ start: 0, end: 2 }]), null);
});

test('scene replies are bounded and stripped of subtitle markup', () => {
  assert.deepEqual(normalizeComedyReply({ action: '  jumps  ', dialogue: '<i>Oops!</i>', confidence: 2 }), {
    action: 'jumps', dialogue: 'Oops!', confidence: 1,
  });
});
