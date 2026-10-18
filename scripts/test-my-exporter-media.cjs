'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let media, model;
before(async () => {
  media = await import('../src/components/MyExporter/editor-media.mjs');
  model = await import('../src/components/MyExporter/editor-model.mjs');
});
const video = (id, name = `Scene ${id}.mp4`, extra = {}) => ({ id, name, path: `D:/media/${name}`, kind: 'video',
  duration: 6, sourceDuration: 6, trimStart: 0, speed: 1, width: 640, height: 360, hasAudio: true, probeError: '', ...extra });
const image = (id, name = `Scene ${id}.png`, extra = {}) => ({ id, name, path: `D:/media/${name}`, kind: 'image',
  duration: 4, sourceDuration: 4, trimStart: 0, speed: 1, probeError: '', ...extra });
const make = patch => model.normalizeProject({ scenes: [], audioTracks: [], captions: [], textOverlays: [], mediaLibrary: [], ...patch });
const ids = () => { let count = 0; return prefix => `${prefix || 'clip'}-new-${++count}`; };
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }

test('explicit scene tokens ignore preceding lesson/year/resolution numbers and support common scene forms', () => {
  for (const [name, expected] of [
    ['Lesson21 2026 1080p Scene1.mp4', 1], ['UKG L21 Scene No 02.mp4', 2], ['Scene_02.mp4', 2], ['scene-10.mp4', 10],
    ['SceneNo.2.mp4', 2], ['Scene(2).mp4', 2], ['SCENE NUMBER 12.png', 12], ['Scene #4.mp4', 4],
    ['Lesson9Scene2.mp4', 2], ['Lesson1Scene10.mp4', 10], ['lesson9scene02.mp4', 2],
    ['D:\\2026\\L21\\Scene02.mp4', 2], ['2026 Lesson 21.mp4', null], ['Lesson 21 1080p.mp4', null],
    ['1080p.mp4', null], ['Scenery 21.mp4', null], ['Scene2B.mp4', null],
  ]) assert.equal(media.getSceneNumber(name), expected, name);
});

test('numeric explicit metadata outranks names and invalid metadata never invents a scene number', () => {
  assert.equal(media.getSceneNumber({ name: 'Scene99.mp4', sceneNumber: 2, sceneNo: 3 }), 2);
  assert.equal(media.getSceneNumber({ name: 'Scene99.mp4', sceneNumber: NaN, sceneNo: 10 }), 10);
  assert.equal(media.getSceneNumber({ name: 'Scene99.mp4', sceneNumber: '2', sceneNo: -1 }), 99);
  assert.equal(media.getSceneNumber({ name: 'Intro.mp4', sceneNumber: 0 }), 0);
  assert.equal(media.getSceneNumber({ name: 'Intro.mp4', sceneNumber: 1.5 }), null);
});

test('plain leading numbered files and numeric stems use numeric ordering', () => {
  for (const [name, expected] of [['01 Welcome.mp4', 1], ['2-Lion.mp4', 2], ['010_Fox.png', 10], ['10.mp4', 10], ['001.png', 1], ['1920.mp4', 1920]]) {
    assert.equal(media.getSceneNumber(name), expected, name);
  }
  const source = [{ name: '10.mp4' }, { name: '2.mp4' }, { name: '01 Intro.mp4' }];
  assert.deepEqual(media.sortMediaBySceneNumber(source).map(item => item.name), ['01 Intro.mp4', '2.mp4', '10.mp4']);
});

test('Scene1/2/10 ordering is stable on ties with unnumbered natural names afterward', () => {
  const source = freeze([{ name: 'Alpha10.mp4' }, { name: 'Scene10.mp4' }, { name: 'Scene2 Z.mp4' }, { name: 'Alpha2.mp4' }, { name: 'Scene1.mp4' }, { name: 'Scene2 A.mp4' }]);
  const before = JSON.stringify(source);
  assert.deepEqual(media.sortMediaBySceneNumber(source).map(item => item.name), ['Scene1.mp4', 'Scene2 Z.mp4', 'Scene2 A.mp4', 'Scene10.mp4', 'Alpha2.mp4', 'Alpha10.mp4']);
  assert.equal(JSON.stringify(source), before);
});

test('Add Auto All adds every relevant media once, ignores audio, and is idempotent on repeated clicks', () => {
  const library = [video('ten', 'Scene10.mp4'), image('two', 'Scene2.png'), { id: 'music', kind: 'audio', probeError: 'audio unavailable' }, video('one', 'Scene1.mp4')];
  const original = freeze(make({ mediaLibrary: library })), before = JSON.stringify(original), idFactory = ids();
  const first = media.addAllMediaToTimeline(original, library, { idFactory });
  assert.equal(first.addedCount, 3); assert.equal(first.addedIds.length, 3);
  assert.deepEqual(first.project.scenes.map(scene => scene.libraryId), ['one', 'two', 'ten']);
  assert.equal(first.selectedId, first.project.scenes[0].id); assert.equal(first.project.scenes[1].kind, 'image');
  const repeated = media.addAllMediaToTimeline(first.project, library, { idFactory, selectedId: first.project.scenes[1].id });
  assert.equal(repeated.addedCount, 0); assert.equal(repeated.reordered, false); assert.equal(repeated.selectedId, first.project.scenes[1].id);
  assert.equal(model.snapshotProjectKey(repeated.project), model.snapshotProjectKey(first.project)); assert.equal(JSON.stringify(original), before);
});

test('distinct library records sharing one path stay distinct while matching IDs are skipped', () => {
  const path = 'D:/media/shared.mp4', library = [video('a', 'Scene1.mp4', { path }), video('b', 'Scene2.mp4', { path })];
  const original = make({ scenes: [{ ...library[0], id: 'placed-a', libraryId: 'a', trimStart: 1, duration: 2, speed: 2 }] });
  const next = media.addAllMediaToTimeline(original, library, { idFactory: ids() });
  assert.equal(next.addedCount, 1); assert.deepEqual(next.project.scenes.map(scene => scene.libraryId), ['a', 'b']);
  assert.deepEqual(next.project.scenes[0], original.scenes[0]);
  assert.equal(media.addAllMediaToTimeline(next.project, library, { idFactory: ids() }).addedCount, 0);
  const alias = video('alias', 'Scene1.mp4', { libraryId: 'a', path });
  assert.equal(media.addAllMediaToTimeline(original, [alias], { idFactory: ids() }).addedCount, 0);
});

test('legacy paths match case/slash variants only without library IDs and consume one record per placed clip', () => {
  const library = [video('a', 'Scene1.mp4', { path: 'D:/media/shared.mp4' }), video('b', 'Scene2.mp4', { path: 'D:/media/shared.mp4' })];
  const legacy = make({ scenes: [video('legacy', 'Scene1.mp4', { path: 'd:\\MEDIA\\SHARED.mp4', trimStart: 1, duration: 2 })] });
  const next = media.addAllMediaToTimeline(legacy, library, { idFactory: ids() });
  assert.equal(next.addedCount, 1); assert.equal(next.project.scenes.length, 2); assert.equal(next.project.scenes[0].id, 'legacy');
  assert.equal(media.addAllMediaToTimeline(next.project, library, { idFactory: ids() }).addedCount, 0);
  const differentRecord = make({ scenes: [{ ...legacy.scenes[0], libraryId: 'different' }] });
  assert.equal(media.addAllMediaToTimeline(differentRecord, library, { idFactory: ids() }).addedCount, 2);
});

test('failed or pending relevant probes reject the entire batch before IDs or edits, including already placed media', () => {
  const ready = video('ready', 'Scene1.mp4'), original = freeze(make({ scenes: [{ ...ready, id: 'placed', libraryId: 'ready' }] })), before = JSON.stringify(original);
  const failures = [{ probeError: 'Reading media details...' }, { probeError: 'Probe failed' }, { probePending: true }, { probeLoading: true }, { probeStatus: 'loading' }, { width: 0 }, { height: 0 }, { duration: 5, sourceDuration: NaN }];
  for (const patch of failures) {
    let calls = 0;
    assert.throws(() => media.addAllMediaToTimeline(original, [video('next', 'Scene2.mp4'), { ...ready, ...patch }], { idFactory: () => { calls++; return 'new'; } }), /pending or failed/);
    assert.equal(calls, 0); assert.equal(JSON.stringify(original), before);
  }
  assert.throws(() => media.addAllMediaToTimeline(original, [image('image', 'Scene2.png', { probeStatus: 'failed' })], { idFactory: ids() }), /pending or failed/);
});

test('invalid media/model/IDs remain atomic and never accept a five-second placeholder', () => {
  const original = freeze(make()), before = JSON.stringify(original);
  for (const asset of [video('v', 'Scene1.mp4', { path: '' }), image('i', 'Scene1.png', { duration: 0 }), video('v', 'Scene1.mp4', { duration: 5, sourceDuration: 5, width: 0, height: 0 })]) {
    assert.throws(() => media.addAllMediaToTimeline(original, [asset], { idFactory: ids() }));
  }
  assert.throws(() => media.addAllMediaToTimeline(original, [video('v')]));
  assert.throws(() => media.addAllMediaToTimeline(original, [video('a'), video('b')], { idFactory: () => 'same' }), /unique/);
  assert.throws(() => media.addAllMediaToTimeline({ ...original, captions: [{ id: 'bad', start: 1, end: 0, text: 'bad' }] }, [], { idFactory: ids() }));
  assert.equal(JSON.stringify(original), before);
});

test('batch reorder preserves trims/speeds/transforms and retimes exact word bounds, linked audio and titles', () => {
  const ten = video('lib10', 'Lesson21 Scene10.mp4', { sourceDuration: 40, duration: 40 });
  const two = video('lib2', 'Lesson99 Scene2.mp4', { sourceDuration: 30, duration: 30 });
  const library = [ten, two, video('lib1', 'Scene1.mp4', { duration: 3, sourceDuration: 3 }), image('lib3', 'Scene3.png')];
  const original = freeze(make({ mediaLibrary: library,
    scenes: [{ ...ten, id: 'ten', libraryId: 'lib10', trimStart: 4, duration: 8, speed: 2, scale: 1.4, rotation: 90, keyframes: [{ time: 0, opacity: .2 }, { time: 4, opacity: .8 }] },
      { ...two, id: 'two', libraryId: 'lib2', trimStart: 2, duration: 6, speed: .5 }],
    captions: [{ id: 'c10', start: .5, end: 1.5, text: 'Tiger', words: [{ text: 'Tiger', start: .7, end: 1.1 }] }, { id: 'c2', start: 5, end: 6, text: 'Fox', words: [{ text: 'Fox', start: 5.1, end: 5.5 }] }],
    textOverlays: [{ id: 'title', start: .5, end: 1.5, text: 'Title', fontSize: 32 }],
    audioTracks: [{ id: 'linked', path: 'voice.wav', start: 1, duration: 2, trimStart: 4, sourceDuration: 60, speed: 2, originSceneId: 'ten' },
      { id: 'music', path: 'music.wav', start: 16, duration: 10, trimStart: 0, sourceDuration: 60, speed: 1, volume: .3 }],
    settings: { aspectRatio: '9:16', captionFontSize: 53 }, music: { path: 'bed.mp3' }, custom: { preserve: true } }));
  const before = JSON.stringify(original), result = media.addAllMediaToTimeline(original, library, { idFactory: ids() }), next = result.project;
  assert.equal(result.addedCount, 2); assert.equal(result.reordered, true);
  assert.deepEqual(next.scenes.map(scene => scene.libraryId), ['lib1', 'lib2', 'lib3', 'lib10']);
  assert.deepEqual(next.scenes.find(scene => scene.id === 'ten'), original.scenes[0]);
  assert.deepEqual(next.scenes.find(scene => scene.id === 'two'), original.scenes[1]);
  assert.deepEqual(next.captions.find(cue => cue.id === 'c10').words, [{ text: 'Tiger', start: 19.7, end: 20.1 }]);
  assert.deepEqual(next.captions.find(cue => cue.id === 'c2').words, [{ text: 'Fox', start: 4.1, end: 4.5 }]);
  const linked = next.audioTracks.find(track => track.id === 'linked'); assert.equal(linked.start, 20); assert.equal(linked.trimStart, 4); assert.equal(linked.speed, 2); assert.equal(linked.duration, 2);
  assert.deepEqual(next.audioTracks.find(track => track.id === 'music'), original.audioTracks[1]);
  assert.deepEqual([next.textOverlays[0].start, next.textOverlays[0].end], [19.5, 20.5]);
  assert.equal(next.settings.aspectRatio, '9:16'); assert.equal(next.settings.captionFontSize, 53); assert.deepEqual(next.music, original.music); assert.deepEqual(next.custom, original.custom);
  assert.equal(model.projectDuration(next), 23); assert.equal(JSON.stringify(original), before);
});

test('library number metadata wins for placed clips without replacing their edited scene fields', () => {
  const first = video('a', 'Scene10.mp4', { sceneNumber: 1 }), second = video('b', 'Scene1.mp4', { sceneNo: 2 });
  const original = make({ scenes: [{ ...second, id: 'b-placed', libraryId: 'b', sceneNo: undefined, trimStart: 2, duration: 2 },
    { ...first, id: 'a-placed', libraryId: 'a', sceneNumber: undefined, trimStart: 1, duration: 3, speed: 2 }] });
  const result = media.addAllMediaToTimeline(original, [first, second], { idFactory: ids() });
  assert.equal(result.addedCount, 0); assert.equal(result.reordered, true); assert.deepEqual(result.project.scenes.map(scene => scene.id), ['a-placed', 'b-placed']);
  assert.deepEqual(result.project.scenes[0], original.scenes[1]); assert.deepEqual(result.project.scenes[1], original.scenes[0]);
});

test('the full add/reorder operation commits as one undo step and repeated clicks do not create another', () => {
  const original = make({ mediaLibrary: [video('ten', 'Scene10.mp4'), video('one', 'Scene1.mp4')] });
  const result = media.addAllMediaToTimeline(original, original.mediaLibrary, { idFactory: ids() });
  const history = model.commitProjectHistory(model.createProjectHistory(original), result.project);
  assert.equal(history.snapshots.length, 2);
  assert.deepEqual(model.travelProjectHistory(history, -1).project, original);
  assert.deepEqual(model.travelProjectHistory(model.travelProjectHistory(history, -1).history, 1).project, result.project);
  const repeated = media.addAllMediaToTimeline(result.project, original.mediaLibrary, { idFactory: ids() });
  assert.equal(model.commitProjectHistory(history, repeated.project), history);
});
