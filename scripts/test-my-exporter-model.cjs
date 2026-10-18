const test = require('node:test');
const assert = require('node:assert/strict');
let model;
test.before(async () => { model = await import('../src/components/MyExporter/editor-model.mjs'); });

const video = (id, duration = 10, extra = {}) => ({ id, kind: 'video', path: `${id}.mp4`, name: id,
  trimStart: 0, duration, sourceDuration: 30, speed: 1, fit: 'contain', ...extra });
const cue = (id, start, end, text = id, words) => ({ id, start, end, text, ...(words ? { words } : {}) });
const track = (id, start, duration, extra = {}) => ({ id, start, duration, trimStart: 0,
  speed: 1, sourceDuration: 60, path: `${id}.wav`, ...extra });
const make = (patch = {}) => model.normalizeProject({ scenes: [video('a'), video('b', 5)], audioTracks: [],
  captions: [], textOverlays: [], ...patch });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }

test('timeline uses source duration/speed, image speed one, and non-overlapping transitions', () => {
  const p = make({ scenes: [video('a', 8, { speed: 2, transition: 'fade-black', transitionDuration: 1 }),
    { id: 'image', kind: 'image', duration: 3, speed: 4 }, video('c', 2, { speed: .25 })] });
  assert.deepEqual(model.timelineEntries(p.scenes).map(({ start, end, outputDuration }) => ({ start, end, outputDuration })),
    [{ start: 0, end: 4, outputDuration: 4 }, { start: 4, end: 7, outputDuration: 3 }, { start: 7, end: 15, outputDuration: 8 }]);
  assert.equal(p.scenes[1].speed, 1);
  assert.equal(model.projectDuration(p), 15);
});

test('visual duration and maximum overlay end are deliberately separate', () => {
  const p = make({ audioTracks: [track('music', 0, 20)], captions: [cue('caption', 20, 22)], textOverlays: [cue('title', 5, 25)] });
  assert.equal(model.projectDuration(p), 15);
  assert.equal(model.projectMaxEnd(p), 25);
});

for (const version of [1, 2, 3]) test(`v${version} normalization preserves fit, font, settings, music, watermark, and custom fields`, () => {
  const p = model.normalizeProject({ version, scenes: [video('a', 5, { fit: 'cover' })], settings: { framing: 'contain', captionFontSize: 53, captionFontFamily: 'Nunito', aspectRatio: '9:16' },
    music: { path: 'bed.mp3', fadeIn: 2 }, watermark: { path: 'logo.png', opacity: .4 }, captionLanguage: 'auto', custom: { future: true } });
  assert.equal(p.version, 3); assert.equal(p.scenes[0].fit, 'fill'); assert.equal(p.settings.captionFontSize, 53);
  assert.equal(p.settings.captionFontFamily, 'Nunito'); assert.equal(p.settings.aspectRatio, '9:16');
  assert.equal(p.captionLanguage, 'auto'); assert.deepEqual(p.custom, { future: true }); assert.equal(p.music.fadeIn, 2); assert.equal(p.watermark.opacity, .4);
});

test('new defaults retain caption size 42 and safe speed normalization', () => {
  const p = make({ scenes: [video('fast', 4, { speed: 20 }), video('slow', 4, { speed: .1 })] });
  assert.equal(p.settings.captionFontSize, 42); assert.equal(p.captionLanguage, 'en');
  assert.equal(p.scenes[0].speed, 4); assert.equal(p.scenes[1].speed, .25);
});

test('legacy vertical/square resolutions migrate canvas shape without overriding explicit aspect ratio', () => {
  assert.equal(model.normalizeProject({ settings: { resolution: 'vertical' } }).settings.aspectRatio, '9:16');
  assert.equal(model.normalizeProject({ settings: { resolution: 'square' } }).settings.aspectRatio, '1:1');
  assert.equal(model.normalizeProject({ settings: { resolution: 'vertical', aspectRatio: '4:3' } }).settings.aspectRatio, '4:3');
  assert.equal(model.normalizeProject({ scenes: [video('a', 4, { fit: 'fill' })] }).scenes[0].fit, 'fill');
  assert.equal(model.normalizeProject({ settings: { resolution: 'vertical' } }, { defaultSettings: { aspectRatio: '16:9' } }).settings.aspectRatio, '9:16');
  assert.equal(model.normalizeProject({ scenes: [{ id: 'a', kind: 'video', sourceDuration: 10, trimStart: 4 }] }).scenes[0].duration, 6);
});

test('legacy fades migrate without changing sequence duration and explicit none wins', () => {
  const p = make({ scenes: [video('a', 4, { fade: .7 }), video('b', 3, { fade: 1, transition: 'none' })] });
  assert.deepEqual(p.scenes.map(s => [s.transition, s.transitionDuration]), [['fade-black', .7], ['none', 0]]);
  assert.equal(model.projectDuration(p), 7);
});

test('normalization rejects malformed/negative times, source overflow, words, settings, and unsupported versions', () => {
  for (const invalid of [
    { scenes: [video('a', -1)] }, { scenes: [video('a', 10, { trimStart: 25 })] },
    { scenes: [video('a', 5, { speed: '2' })] }, { scenes: [video('a', NaN)] },
    { audioTracks: [track('audio', -1, 2)] }, { audioTracks: [track('audio', 0, 0)] },
    { captions: [cue('c', 0, 1, 'bad', [{ text: 'bad', start: 0, end: 2 }])] },
    { captions: [cue('c', 0, 1, 'bad', [{ text: 'bad', start: 0, end: .8 }, { text: 'bad', start: .5, end: 1 }])] },
    { captions: [cue('c', null, 1)] }, { settings: { captionFontSize: -1 } }, { settings: 'bad' }, { version: 4 },
    { scenes: [video('a', 5, { volume: -1 })] }, { audioTracks: [track('audio', 0, 2, { fadeIn: -1 })] },
    { textOverlays: [cue('t', 0, 1, 'title', undefined), { ...cue('t2', 1, 2), opacity: -1 }] },
  ]) assert.throws(() => model.normalizeProject(invalid));
  assert.ok(model.validateProject({ scenes: [video('a', 4, { speed: 8 })] }).length);
  assert.throws(() => model.normalizeProject({ scenes: [video('same')], captions: [cue('same', 0, 1)] }), /unique/);
});

test('razor maps source offsets at speed and splits linked audio atomically', () => {
  const p = freeze(make({ scenes: [video('a', 8, { trimStart: 4, speed: 2 })],
    audioTracks: [track('sound', 0, 4, { trimStart: 4, speed: 2, originSceneId: 'a', detachedFromSceneId: 'a' })],
    captions: [cue('c', 1, 3, 'one\ntwo', [{ text: 'one', start: 1, end: 1.5 }, { text: 'two', start: 2.5, end: 3 }])],
    textOverlays: [cue('title', .5, 3.5, 'Keep this title')] }));
  const next = model.splitScene(p, 'a', 2, { rightId: 'a2' });
  assert.deepEqual(next.scenes.map(s => [s.id, s.trimStart, s.duration, s.speed]), [['a', 4, 4, 2], ['a2', 8, 4, 2]]);
  assert.deepEqual(next.audioTracks.map(t => [t.start, t.duration, t.trimStart, t.speed, t.originSceneId, t.detachedFromSceneId]),
    [[0, 2, 4, 2, 'a', 'a'], [2, 2, 8, 2, 'a2', 'a2']]);
  assert.equal(next.audioTracks[1].detachedOffset, 0);
  assert.deepEqual(next.captions, p.captions); assert.deepEqual(next.textOverlays, p.textOverlays);
  assert.equal(model.projectDuration(next), 4); assert.equal(p.scenes.length, 1);
});

test('razor remaps right-only linked audio and keeps unrelated sound intact', () => {
  const p = make({ audioTracks: [track('late', 7, 2, { originSceneId: 'a', detachedFromSceneId: 'a', detachedOffset: 7 }), track('music', 0, 15)] });
  const next = model.splitScene(p, 'a', 5, { rightId: 'a2' });
  assert.equal(next.audioTracks[0].originSceneId, 'a2'); assert.equal(next.audioTracks[0].detachedOffset, 2);
  assert.equal(next.audioTracks[0].start, 7); assert.deepEqual(next.audioTracks[1], p.audioTracks[1]);
});

test('razor IDs stay unique even when a later audio clip uses the derived name', () => {
  const p = make({ audioTracks: [track('sound', 0, 10, { originSceneId: 'a' }), track('sound-right', 0, 1)] });
  const next = model.splitScene(p, 'a', 5);
  assert.equal(new Set(next.audioTracks.map(t => t.id)).size, 3);
});

test('invalid razor/trim requests are atomic and do not mutate project', () => {
  const p = freeze(make()); const before = JSON.stringify(p);
  assert.throws(() => model.splitScene(p, 'a', 0), /inside/);
  assert.throws(() => model.splitScene(p, 'a', 4, { rightId: 'b' }), /unique/);
  assert.throws(() => model.trimScene(p, 'a', { trimStart: 29, duration: 4 }), /original media/);
  assert.throws(() => model.trimScene(p, 'a', { speed: 0 }), /finite/);
  assert.equal(JSON.stringify(p), before);
});

test('source trim removes only lost speech, clips words, and ripples following cues/audio/text', () => {
  const p = make({ audioTracks: [track('sound', 0, 10, { originSceneId: 'a', detachedFromSceneId: 'a' }), track('later', 10, 4)],
    captions: [cue('c', 1, 5, 'one two three', [{ text: 'one', start: 1, end: 2 }, { text: 'two', start: 2, end: 3 }, { text: 'three', start: 4, end: 5 }]), cue('latercue', 11, 12)],
    textOverlays: [cue('title', 10, 15)] });
  const next = model.trimScene(p, 'a', { trimStart: 2, duration: 6 });
  assert.equal(next.captions[0].text, 'two three');
  assert.deepEqual(next.captions[0].words.map(w => [w.start, w.end]), [[0, 1], [2, 3]]);
  assert.deepEqual([next.captions[1].start, next.captions[1].end], [7, 8]);
  assert.deepEqual([next.audioTracks[0].start, next.audioTracks[0].trimStart, next.audioTracks[0].duration], [0, 2, 6]);
  assert.equal(next.audioTracks[1].start, 6); assert.equal(next.textOverlays[0].start, 6); assert.equal(model.projectDuration(next), 11);
});

test('speed edit retimes speech/linked sound, leaves independent music speed intact', () => {
  const p = make({ audioTracks: [track('sound', 0, 10, { originSceneId: 'a' }), track('music', 0, 20), track('later', 10, 4)],
    captions: [cue('c', 2, 4, 'word', [{ text: 'word', start: 2, end: 4 }])], textOverlays: [cue('t', 4, 6)] });
  const next = model.trimScene(p, 'a', { speed: 2 });
  assert.deepEqual(next.captions[0].words.map(w => [w.start, w.end]), [[1, 2]]);
  assert.deepEqual([next.audioTracks[0].speed, next.audioTracks[0].duration], [2, 5]);
  assert.deepEqual([next.audioTracks[1].start, next.audioTracks[1].speed, next.audioTracks[1].duration], [0, 1, 20]);
  assert.equal(next.audioTracks[2].start, 5); assert.deepEqual([next.textOverlays[0].start, next.textOverlays[0].end], [2, 3]);
});

test('extending a source trim does not invent captions over previously unseen footage', () => {
  const p = make({ scenes: [video('a', 4, { trimStart: 4 })], captions: [cue('c', 1, 3)] });
  const next = model.trimScene(p, 'a', { trimStart: 2, duration: 8 });
  assert.deepEqual([next.captions[0].start, next.captions[0].end], [3, 5]);
  assert.equal(model.projectDuration(next), 8);
});

test('ripple deletion retains partial cues and retimes each timed word', () => {
  const p = make({ captions: [cue('c', 1, 9, 'before deleted after', [
    { text: 'before', start: 1, end: 3 }, { text: 'deleted', start: 4, end: 5 }, { text: 'after', start: 7, end: 9 }]), cue('later', 11, 12)],
    textOverlays: [cue('title', 2, 12)], audioTracks: [track('audio', 2, 10)] });
  const next = model.deleteTimeRange(p, 3, 6);
  assert.equal(next.captions[0].text, 'before after');
  assert.deepEqual(next.captions[0].words.map(w => [w.start, w.end]), [[1, 3], [4, 6]]);
  assert.deepEqual([next.captions[1].start, next.captions[1].end], [8, 9]);
  assert.deepEqual(next.audioTracks.map(t => [t.start, t.duration, t.trimStart]), [[2, 1, 0], [3, 6, 4]]);
  assert.equal(next.textOverlays[0].end, 9); assert.equal(model.projectDuration(next), 12);
});

test('ripple deletion remaps the remaining right source/audio and preserves audio speed', () => {
  const p = make({ scenes: [video('a', 12, { speed: 2 })], audioTracks: [track('sound', 0, 6, { speed: 2, originSceneId: 'a', detachedFromSceneId: 'a' })] });
  const next = model.deleteTimeRange(p, 2, 4);
  assert.deepEqual(next.scenes.map(s => [s.trimStart, s.duration]), [[0, 4], [8, 4]]);
  assert.deepEqual(next.audioTracks.map(t => [t.start, t.duration, t.trimStart, t.speed]), [[0, 2, 0, 2], [2, 2, 8, 2]]);
  assert.equal(next.audioTracks[1].originSceneId, next.scenes[1].id);
  assert.equal(next.audioTracks[1].detachedOffset, 0);
});

test('non-ripple deletion creates silent gap, clips captions, leaves independent audio/text unchanged', () => {
  const p = make({ audioTracks: [track('sound', 0, 10, { originSceneId: 'a' }), track('music', 0, 20)],
    captions: [cue('a-c', 2, 4), cue('b-c', 11, 12)], textOverlays: [cue('title', 0, 15)] });
  const next = model.deleteScene(p, 'a', { ripple: false });
  assert.equal(next.scenes[0].kind, 'gap'); assert.equal(next.scenes[0].path, ''); assert.equal(next.scenes[0].hasAudio, false);
  assert.equal(model.projectDuration(next), 15); assert.deepEqual(next.captions, [p.captions[1]]);
  assert.deepEqual(next.audioTracks, [p.audioTracks[1]]); assert.deepEqual(next.textOverlays, p.textOverlays);
});

test('deleting a whole scene removes its linked audio even if that audio extends past the clip', () => {
  const p = make({ audioTracks: [track('sound', 0, 12, { originSceneId: 'a' }), track('free', 11, 3)] });
  const next = model.deleteScene(p, 'a');
  assert.deepEqual(next.audioTracks.map(t => [t.id, t.start, t.duration]), [['free', 1, 3]]);
});

test('partial non-ripple deletion creates exactly one gap and clips linked audio only', () => {
  const p = make({ audioTracks: [track('sound', 0, 10, { originSceneId: 'a' }), track('music', 0, 15)] });
  const next = model.deleteTimeRange(p, 3, 7, { ripple: false });
  assert.deepEqual(next.scenes.map(s => [s.kind, s.duration]), [['video', 3], ['gap', 4], ['video', 3], ['video', 5]]);
  assert.deepEqual(next.audioTracks.map(t => [t.start, t.duration, t.trimStart]), [[0, 3, 0], [7, 3, 7], [0, 15, 0]]);
});

test('non-ripple delete splits a spanning subtitle instead of showing it over the gap', () => {
  const p = make({ captions: [cue('c', 1, 9)] });
  const next = model.deleteTimeRange(p, 3, 7, { ripple: false });
  assert.deepEqual(next.captions.map(c => [c.start, c.end]), [[1, 3], [7, 9]]);
});

test('multi-scene deletion is atomic, handles disjoint positions, and preserves intervening speech', () => {
  const p = make({ scenes: [video('a', 4), video('b', 3), video('c', 2), video('d', 5)],
    captions: [cue('b-speech', 4.5, 6), cue('d-speech', 10, 12)] });
  const next = model.deleteScenes(p, ['a', 'c']);
  assert.deepEqual(next.scenes.map(s => s.id), ['b', 'd']);
  assert.deepEqual(next.captions.map(c => [c.start, c.end]), [[.5, 2], [4, 6]]);
  assert.throws(() => model.deleteScenes(p, ['a', 'missing']), /invalid scene/); assert.equal(p.scenes.length, 4);
});

test('keyframes interpolate independently in output seconds and hold endpoints', () => {
  const scene = video('a', 10, { scale: 1, positionX: 0, opacity: .8, keyframes: [
    { time: 2, scale: 2 }, { time: 6, scale: 4, positionX: 60, opacity: .2 }] });
  const sampled = model.sampleSceneTransform(scene, 4);
  close(sampled.scale, 3); close(sampled.positionX, 40); close(sampled.opacity, .4);
  assert.equal(model.sampleSceneTransform(scene, 20).scale, 4); assert.equal(model.sampleSceneTransform(scene, 0).scale, 1);
  assert.throws(() => model.sampleSceneTransform(scene, NaN));
});

test('razor and source trim retain sampled transform at boundaries without animation jumps', () => {
  const p = make({ scenes: [video('a', 10, { keyframes: [{ time: 0, scale: 1 }, { time: 10, scale: 3 }] })] });
  const split = model.splitScene(p, 'a', 4);
  close(model.sampleSceneTransform(split.scenes[0], 4).scale, 1.8);
  close(model.sampleSceneTransform(split.scenes[1], 0).scale, 1.8);
  close(model.sampleSceneTransform(split.scenes[1], 6).scale, 3);
  const trimmed = model.trimScene(p, 'a', { trimStart: 2, duration: 6, speed: 2 });
  close(model.sampleSceneTransform(trimmed.scenes[0], 0).scale, 1.4);
  close(model.sampleSceneTransform(trimmed.scenes[0], 3).scale, 2.6);
});

test('reorder moves scene speech/word bounds, text and linked audio; music stays fixed', () => {
  const p = make({ audioTracks: [track('sound', 1, 3, { originSceneId: 'a', detachedFromSceneId: 'a' }), track('music', 0, 20)],
    captions: [cue('c', 1, 3, 'spoken', [{ text: 'spoken', start: 1, end: 3 }]), cue('b-c', 11, 12)], textOverlays: [cue('t', 2, 4)] });
  const next = model.reorderScenes(p, ['b', 'a']);
  assert.deepEqual(next.captions.map(c => [c.id, c.start, c.end]), [['b-c', 1, 2], ['c', 6, 8]]);
  assert.deepEqual(next.captions[1].words.map(w => [w.start, w.end]), [[6, 8]]);
  assert.equal(next.audioTracks[0].start, 6); assert.equal(next.audioTracks[0].detachedOffset, 1);
  assert.deepEqual(next.audioTracks[1], p.audioTracks[1]); assert.equal(next.textOverlays[0].start, 7);
});

test('reorder splits cross-boundary speech instead of stretching across unrelated footage', () => {
  const p = make({ captions: [cue('c', 9, 12, 'last next', [{ text: 'last', start: 9, end: 10 }, { text: 'next', start: 11, end: 12 }])] });
  const next = model.reorderScenes(p, ['b', 'a']);
  assert.deepEqual(next.captions.map(c => [c.text, c.start, c.end]), [['next', 1, 2], ['last', 14, 15]]);
  assert.equal(new Set(next.captions.map(c => c.id)).size, 2);
});

test('reordering to the existing order preserves unsplit cues and exact word boundaries', () => {
  const p = make({ captions: [cue('c', 9, 12)] });
  assert.deepEqual(model.reorderScenes(p, ['a', 'b']), p);
});

test('insert shifts downstream content and splits crossing captions at the inserted footage', () => {
  const p = make({ captions: [cue('c', 9, 12)], audioTracks: [track('sound', 10, 5, { originSceneId: 'b' })], textOverlays: [cue('t', 11, 13)] });
  const next = model.insertScene(p, { id: 'image', kind: 'image', duration: 3 }, 1);
  assert.deepEqual(next.scenes.map(s => s.id), ['a', 'image', 'b']);
  assert.deepEqual(next.captions.map(c => [c.start, c.end]), [[9, 10], [13, 15]]);
  assert.equal(next.audioTracks[0].start, 13); assert.equal(next.textOverlays[0].start, 14);
});

test('duplicate copies matching captions, words, text and linked audio without copying music', () => {
  const p = make({ captions: [{ ...cue('c', 1, 2, 'spoken', [{ text: 'spoken', start: 1, end: 2 }]), originSceneId: 'a' }, cue('b-c', 11, 12)],
    textOverlays: [cue('t', 2, 4)], audioTracks: [track('sound', 0, 10, { originSceneId: 'a', detachedFromSceneId: 'a' }), track('music', 0, 20)] });
  const next = model.duplicateScene(p, 'a', 'a-copy');
  assert.deepEqual(next.scenes.map(s => s.id), ['a', 'a-copy', 'b']);
  assert.deepEqual(next.captions.map(c => [c.text, c.start, c.end]), [['spoken', 1, 2], ['spoken', 11, 12], ['b-c', 21, 22]]);
  assert.equal(next.captions[0].originSceneId, 'a'); assert.equal(next.captions[1].originSceneId, 'a-copy');
  assert.equal(next.audioTracks.filter(t => t.path === 'music.wav').length, 1);
  const copy = next.audioTracks.find(t => t.originSceneId === 'a-copy');
  assert.deepEqual([copy.start, copy.duration, copy.trimStart, copy.detachedOffset], [10, 10, 0, 0]);
  assert.equal(next.textOverlays.length, 2); assert.equal(next.textOverlays[1].start, 12);
});

test('undo/redo restores every editable project field and owns independent snapshots', () => {
  const p = make({ projectName: 'before', music: { path: 'old.mp3' }, watermark: { path: 'logo.png' }, watermarkEnabled: true,
    textOverlays: [cue('title', 0, 3)], trackStates: { videoLocked: true }, voiceLanguage: 'te', custom: { motion: 1 } });
  const edited = model.createProjectSnapshot(p);
  edited.projectName = 'after'; edited.settings.captionFontSize = 72; edited.music.path = 'new.mp3'; edited.watermarkEnabled = false;
  edited.textOverlays[0].text = 'changed'; edited.custom.motion = 2;
  let history = model.commitProjectHistory(model.createProjectHistory(p), edited);
  edited.settings.captionFontSize = 99;
  const undo = model.travelProjectHistory(history, -1);
  assert.deepEqual(undo.project, p);
  const redo = model.travelProjectHistory(undo.history, 1);
  assert.equal(redo.project.settings.captionFontSize, 72); assert.equal(redo.project.music.path, 'new.mp3');
  assert.equal(redo.project.watermarkEnabled, false); assert.equal(redo.project.textOverlays[0].text, 'changed'); assert.equal(redo.project.custom.motion, 2);
  redo.project.custom.motion = 90; assert.equal(history.snapshots[1].custom.motion, 2);
});

test('history ignores generated cache updates, detects settings changes, and drops redo after branching', () => {
  const p = make(); let history = model.createProjectHistory(p, 3);
  const cache = model.createProjectSnapshot(p); cache.scenes[0].filmstrip = ['frame']; cache.savedAt = 'later';
  assert.equal(model.commitProjectHistory(history, cache), history);
  const second = model.createProjectSnapshot(p); second.settings.captionFontSize = 50;
  history = model.commitProjectHistory(history, second);
  const undo = model.travelProjectHistory(history, -1);
  const branch = model.createProjectSnapshot(p); branch.watermarkEnabled = true;
  const branched = model.commitProjectHistory(undo.history, branch);
  assert.equal(branched.snapshots.length, 2); assert.equal(branched.snapshots[1].watermarkEnabled, true);
});

test('normalization/property order changes do not create edits or erase the redo branch', () => {
  const p = make(); const edited = model.createProjectSnapshot(p); edited.settings.captionFontSize = 64;
  const history = model.commitProjectHistory(model.createProjectHistory(p), edited);
  const undo = model.travelProjectHistory(history, -1);
  const same = model.createProjectSnapshot(undo.project);
  same.settings = { aspectRatio: same.settings.aspectRatio, ...same.settings };
  same.scenes[0] = { duration: same.scenes[0].duration, ...same.scenes[0] };
  assert.equal(model.snapshotProjectKey(same), model.snapshotProjectKey(p));
  assert.equal(model.commitProjectHistory(undo.history, same), undo.history);
  assert.equal(model.travelProjectHistory(undo.history, 1).project.settings.captionFontSize, 64);
});
