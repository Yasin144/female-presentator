'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createMyExporterEngine } = require('../my-exporter-engine.cjs');
let audio, model;
const track = extra => ({ id: 'voice', path: 'source.wav', name: 'Narration', start: 2, duration: 4, trimStart: 1,
  speed: 2, sourceDuration: 12, volume: .7, waveform: [.1, .2, .3], waveformLoading: true, waveformError: 'old cache', ...extra });
const make = (patch = {}) => model.normalizeProject({ scenes: [{ id: 'scene', kind: 'video', path: 'source.wav', start: 0, trimStart: 1, duration: 8, sourceDuration: 12, speed: 2 },
  { id: 'later', kind: 'gap', duration: 4 }], audioTracks: [track()],
  captions: [{ id: 'caption', start: 2.5, end: 3.5, text: 'Keep words', words: [{ text: 'Keep', start: 2.5, end: 2.8 }, { text: 'words', start: 3.1, end: 3.5 }] }],
  textOverlays: [{ id: 'title', start: 1, end: 7, text: 'Unchanged title' }], ...patch });
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
const near = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
before(async () => {
  audio = await import('../src/components/MyExporter/editor-audio.mjs');
  model = await import('../src/components/MyExporter/editor-model.mjs');
});

test('selection validation preserves exact project/source bounds and rejects invalid values without clamping', () => {
  const project = freeze(make()), before = JSON.stringify(project);
  const selection = audio.validateAudioSelection(project, 'voice', 2.125, 3.375);
  assert.equal(selection.sourceStart, 1.25); assert.equal(selection.sourceEnd, 3.75); assert.equal(selection.duration, 1.25);
  for (const [start, end] of [[NaN, 4], [2, Infinity], ['2', 4], [-1, 4], [1.999, 4], [3, 3], [5, 4], [3, 6.001]]) {
    assert.throws(() => audio.editAudioSelection(project, 'voice', start, end));
  }
  assert.throws(() => audio.editAudioSelection(project, 'missing', 2, 3), /no longer exists/);
  assert.equal(JSON.stringify(project), before);
});

test('one-millisecond default and one-sample explicit ranges retain precision without snapping', () => {
  const project = make();
  near(audio.validateAudioSelection(project, 'voice', 3, 3.001).duration, .001);
  assert.throws(() => audio.validateAudioSelection(project, 'voice', 3, 3.0009), /millisecond/);
  const range = audio.validateAudioSelection(project, 'voice', 3 + 1 / 44100, 3 + 2 / 44100, { sampleRate: 44100 });
  near(range.duration, 1 / 44100); near(range.sourceStart, 3 + 2 / 44100);
  assert.throws(() => audio.validateAudioSelection(project, 'voice', 3, 3 + .5 / 44100, { sampleRate: 44100 }), /sample/);
  assert.throws(() => audio.validateAudioSelection(project, 'voice', 3, 4, { sampleRate: '44100' }));
  assert.throws(() => audio.validateAudioSelection(project, 'voice', 3, 4, { sampleRate: 44100.5 }));
});

test('default delete leaves an exact gap and moves no video, captions, titles or other audio', () => {
  const other = track({ id: 'other', path: 'music.wav', start: 5, duration: 2, speed: 1, trimStart: 0 });
  const project = freeze(make({ audioTracks: [track(), other] })), before = JSON.stringify(project);
  const result = audio.editAudioSelection(project, 'voice', 3.125, 4.375, { rightId: 'right' }), next = result.project;
  assert.deepEqual(next.audioTracks.filter(item => item.id !== 'other').map(item => [item.id, item.start, item.duration, item.trimStart, item.speed]),
    [['voice', 2, 1.125, 1, 2], ['right', 4.375, 1.625, 5.75, 2]]);
  assert.equal(result.removedDuration, 1.25); assert.deepEqual(result.pieceIds, ['voice', 'right']); assert.equal(result.selectedId, 'voice');
  for (const field of ['scenes', 'captions', 'textOverlays']) assert.deepEqual(next[field], project[field]);
  assert.deepEqual(next.audioTracks.find(item => item.id === 'other'), project.audioTracks[1]);
  assert.equal(JSON.stringify(project), before);
});

test('keep retains selected samples at their original position with speed-aware source trim', () => {
  const project = freeze(make()), result = audio.editAudioSelection(project, 'voice', 3.25, 4.5, { action: 'keep' });
  assert.equal(result.project.audioTracks.length, 1);
  assert.deepEqual([result.project.audioTracks[0].start, result.project.audioTracks[0].trimStart, result.project.audioTracks[0].duration, result.project.audioTracks[0].speed], [3.25, 3.5, 1.25, 2]);
  assert.equal(result.project.audioTracks[0].id, 'voice'); assert.equal(result.removedDuration, 2.75);
  const full = audio.editAudioSelection(project, 'voice', 2, 6, { action: 'keep' }); assert.deepEqual(full.project, project);
});

test('explicit close-gap moves only the selected right piece and clears false scene linkage', () => {
  const linked = track({ start: 0, originSceneId: 'scene', detachedFromSceneId: 'scene', timelineOffsetWithinScene: 0, detachedOffset: 0 });
  const other = track({ id: 'other', start: 4, duration: 2, speed: 1, trimStart: 0 });
  const project = make({ audioTracks: [linked, other] });
  const result = audio.editAudioSelection(project, 'voice', 1, 2, { ripple: true, rightId: 'right' });
  const right = result.project.audioTracks.find(item => item.id === 'right');
  assert.equal(right.start, 1); assert.equal(right.trimStart, 5); assert.equal(right.duration, 2);
  for (const key of ['originSceneId', 'detachedFromSceneId', 'reattachedToSceneId']) assert.equal(right[key], '');
  assert.equal(right.pastedAudio, true); assert.equal(right.timelineOffsetWithinScene, undefined);
  assert.equal(result.project.audioTracks[0].originSceneId, 'scene');
  assert.deepEqual(result.project.audioTracks.find(item => item.id === 'other'), project.audioTracks[1]);
  for (const field of ['scenes', 'captions', 'textOverlays']) assert.deepEqual(result.project[field], project[field]);
});

test('valid detached source mapping stays linked on both sides and recomputes offset metadata', () => {
  const project = make({ audioTracks: [track({ start: 0, originSceneId: 'scene', detachedFromSceneId: 'scene', detachedOffset: 0, timelineOffsetWithinScene: 0 })] });
  const next = audio.editAudioSelection(project, 'voice', 1.125, 2.375, { rightId: 'right' }).project;
  assert.equal(next.audioTracks[0].originSceneId, 'scene'); assert.equal(next.audioTracks[1].originSceneId, 'scene');
  assert.equal(next.audioTracks[1].detachedFromSceneId, 'scene'); assert.equal(next.audioTracks[1].detachedOffset, 2.375);
  assert.equal(next.audioTracks[1].timelineOffsetWithinScene, 2.375); assert.equal(next.audioTracks[1].sourceSceneDuration, 4);
  assert.equal(next.audioTracks[1].trimStart, 5.75);
  const kept = audio.editAudioSelection(project, 'voice', .5, 2, { action: 'keep' }).project.audioTracks[0];
  assert.equal(kept.originSceneId, 'scene'); assert.equal(kept.detachedOffset, .5); assert.equal(kept.trimStart, 2);
});

test('stale source, rate or path linkage is removed instead of implying audiovisual sync', () => {
  for (const patch of [{ trimStart: 2 }, { speed: 1 }, { path: 'different.wav' }, { start: 5 }]) {
    const project = make({ audioTracks: [track({ start: 0, originSceneId: 'scene', detachedFromSceneId: 'scene', ...patch })] });
    const start = project.audioTracks[0].start;
    const kept = audio.editAudioSelection(project, 'voice', start + .5, start + 1.5, { action: 'keep' }).project.audioTracks[0];
    assert.equal(kept.originSceneId, ''); assert.equal(kept.detachedFromSceneId, ''); assert.equal(kept.pastedAudio, true);
  }
});

test('left/right boundaries and full deletion preserve surviving IDs and remove exactly the requested range', () => {
  const project = make();
  const left = audio.editAudioSelection(project, 'voice', 2, 3).project.audioTracks;
  assert.deepEqual(left.map(item => [item.id, item.start, item.duration, item.trimStart]), [['voice', 3, 3, 3]]);
  const right = audio.editAudioSelection(project, 'voice', 5, 6).project.audioTracks;
  assert.deepEqual(right.map(item => [item.id, item.start, item.duration, item.trimStart]), [['voice', 2, 3, 1]]);
  const full = audio.editAudioSelection(project, 'voice', 2, 6);
  assert.equal(full.project.audioTracks.length, 0); assert.equal(full.selectedId, ''); assert.equal(full.removedDuration, 4);
});

test('new IDs are globally unique and tiny retained fragments are never silently discarded', () => {
  const project = make({ audioTracks: [track(), track({ id: 'voice-right', duration: 1 }), track({ id: 'voice-right-2', duration: 1 })] });
  const result = audio.editAudioSelection(project, 'voice', 2.0001, 4);
  assert.equal(result.project.audioTracks[0].id, 'voice'); near(result.project.audioTracks[0].duration, .0001);
  assert.equal(result.pieceIds[1], 'voice-right-3');
  assert.throws(() => audio.editAudioSelection(project, 'voice', 3, 4, { rightId: 'scene' }), /unique/);
  assert.throws(() => audio.editAudioSelection(project, 'voice', 3, 4, { idFactory: () => 'voice' }), /unique/);
});

test('source overflow, malformed speed, invalid actions and malformed fade envelopes are atomic', () => {
  const project = freeze(make()), before = JSON.stringify(project);
  assert.throws(() => audio.editAudioSelection(project, 'voice', 3, 4, { ripple: 'yes' }));
  assert.throws(() => audio.editAudioSelection(project, 'voice', 3, 4, { action: 'sort' }));
  assert.throws(() => audio.editAudioSelection({ ...project, audioTracks: [track({ sourceDuration: 2 })] }, 'voice', 3, 4));
  assert.throws(() => audio.editAudioSelection({ ...project, audioTracks: [track({ speed: 0 })] }, 'voice', 3, 4));
  assert.throws(() => audio.editAudioSelection({ ...project, audioTracks: [track({ fadeEnvelope: { offset: 4, duration: 4, fadeIn: 1, fadeOut: 1 } })] }, 'voice', 3, 4), /envelope/);
  assert.equal(JSON.stringify(project), before);
});

test('original fades keep their gain phase through cuts, crops and repeated edits without internal resets', () => {
  const project = make({ audioTracks: [track({ start: 0, duration: 4, speed: 1, fadeIn: 2, fadeOut: 2 })] });
  const result = audio.editAudioSelection(project, 'voice', 1, 2, { rightId: 'right' }), [left, right] = result.project.audioTracks;
  assert.deepEqual(left.fadeEnvelope, { offset: 0, duration: 4, fadeIn: 2, fadeOut: 2 });
  assert.deepEqual(right.fadeEnvelope, { offset: 2, duration: 4, fadeIn: 2, fadeOut: 2 });
  near(audio.audioFadeGain(left, .5), .25); near(audio.audioFadeGain(right, 0), 1); near(audio.audioFadeGain(right, 1), .5);
  const repeated = audio.editAudioSelection(result.project, 'right', 2.5, 3.5, { action: 'keep' }).project.audioTracks[1];
  near(repeated.fadeEnvelope.offset, 2.5); near(audio.audioFadeGain(repeated, 0), .75);
  for (const piece of [left, right, repeated]) for (const field of ['waveform', 'waveformLoading', 'waveformError']) assert.equal(piece[field], undefined);
});

test('one audio edit is one undo step with complete project/source restoration', () => {
  const project = make(), next = audio.editAudioSelection(project, 'voice', 3, 4).project;
  const history = model.commitProjectHistory(model.createProjectHistory(project), next);
  assert.equal(history.snapshots.length, 2); assert.deepEqual(model.travelProjectHistory(history, -1).project, project);
  const back = model.travelProjectHistory(history, -1); assert.deepEqual(model.travelProjectHistory(back.history, 1).project, next);
});

test('project import rejects malformed envelopes before preview and preserves valid saved envelopes and custom fields', () => {
  const valid = { offset: .5, duration: 5, fadeIn: 2, fadeOut: 1, customFuture: { shape: 'linear' } };
  const project = make({ audioTracks: [track({ fadeEnvelope: valid })] });
  const restored = model.normalizeProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.audioTracks[0].fadeEnvelope, valid);
  assert.deepEqual(model.createProjectSnapshot(restored).audioTracks[0].fadeEnvelope, valid);
  near(audio.audioFadeGain(restored.audioTracks[0], 0), .25);
  const invalid = [null, [], 'fade', {}, { ...valid, offset: undefined }, { ...valid, duration: undefined }, { ...valid, fadeIn: undefined }, { ...valid, fadeOut: undefined },
    { ...valid, offset: -1 }, { ...valid, offset: '0.5' }, { ...valid, duration: 0 }, { ...valid, duration: Infinity },
    { ...valid, fadeIn: NaN }, { ...valid, fadeOut: -1 }, { ...valid, offset: 1.00000001 }, { ...valid, offset: 2 }];
  for (const fadeEnvelope of invalid) {
    const input = { ...project, audioTracks: [track({ fadeEnvelope })] };
    assert.throws(() => model.normalizeProject(input), /fade envelope/);
    assert.ok(model.validateProject(input).length > 0);
  }
});

test('import and runtime fade validation share machine precision rather than accepting visibly out-of-bounds phases', () => {
  const envelope = { offset: .1, duration: 4.1, fadeIn: 1, fadeOut: 1 };
  const project = make({ audioTracks: [track({ fadeEnvelope: envelope })] });
  const restored = model.normalizeProject(project);
  assert.doesNotThrow(() => audio.audioFadeGain(restored.audioTracks[0], 0));
  const changed = { ...project, audioTracks: [track({ fadeEnvelope: { ...envelope, duration: 4.1 - 1e-9 } })] };
  assert.throws(() => model.normalizeProject(changed), /exceeds its original clip/);
});

const fadedLinkedCut = () => {
  const project = make({ audioTracks: [track({ start: 0, originSceneId: 'scene', detachedFromSceneId: 'scene', detachedOffset: 0, timelineOffsetWithinScene: 0, fadeIn: 2, fadeOut: 2 })] });
  return audio.editAudioSelection(project, 'voice', 1, 2, { rightId: 'right' }).project;
};

test('audio cut followed by a scene split retains the fade phase on each source-related fragment', () => {
  const project = freeze(fadedLinkedCut()), before = JSON.stringify(project);
  const split = model.splitScene(project, 'scene', 3, { rightId: 'scene-right' });
  const parts = split.audioTracks.filter(track => track.id !== 'voice');
  assert.deepEqual(parts.map(track => [track.start, track.duration, track.trimStart]), [[2, 1, 5], [3, 1, 7]]);
  assert.deepEqual(parts.map(track => track.fadeEnvelope.offset), [2, 3]);
  assert.equal(parts[0].originSceneId, 'scene'); assert.equal(parts[1].originSceneId, 'scene-right');
  near(audio.audioFadeGain(parts[0], 0), 1); near(audio.audioFadeGain(parts[1], 0), .5);
  assert.equal(JSON.stringify(project), before);
});

test('audio cut followed by linked scene rate changes scales all envelope seconds with the audio', () => {
  const project = freeze(fadedLinkedCut());
  for (const [speed, ratio] of [[1, 2], [4, .5]]) {
    const changed = model.trimScene(project, 'scene', { speed });
    const right = changed.audioTracks.find(track => track.id === 'right');
    near(right.start, 2 * ratio); near(right.duration, 2 * ratio); assert.equal(right.speed, speed);
    near(right.fadeEnvelope.offset, 2 * ratio); near(right.fadeEnvelope.duration, 4 * ratio);
    near(right.fadeEnvelope.fadeIn, 2 * ratio); near(right.fadeEnvelope.fadeOut, 2 * ratio);
    near(right.fadeIn, 2 * ratio); near(right.fadeOut, 2 * ratio);
    near(audio.audioFadeGain(right, 0), 1); near(audio.audioFadeGain(right, ratio), .5);
    assert.equal(right.trimStart, 5); assert.equal(right.originSceneId, 'scene');
  }
});

test('scene source trim retains original fade phase at both kept boundaries without restarting fades', () => {
  const project = make({ audioTracks: [track({ start: 0, originSceneId: 'scene', fadeIn: 2, fadeOut: 2 })] });
  const cropped = model.trimScene(project, 'scene', { trimStart: 3, duration: 4 });
  const piece = cropped.audioTracks[0];
  assert.deepEqual([piece.start, piece.duration, piece.trimStart, piece.speed], [0, 2, 3, 2]);
  assert.deepEqual(piece.fadeEnvelope, { offset: 1, duration: 4, fadeIn: 2, fadeOut: 2 });
  near(audio.audioFadeGain(piece, 0), .5); near(audio.audioFadeGain(piece, piece.duration), .5);
});

test('duplicating a scene after a faded audio cut preserves copied source offsets, gain and independent audio', () => {
  const cut = fadedLinkedCut(), music = track({ id: 'music', path: 'music.wav', start: 0, duration: 8, speed: 1, trimStart: 0, fadeIn: 1, fadeOut: 1 });
  const project = freeze(model.normalizeProject({ ...cut, audioTracks: [...cut.audioTracks, music] }));
  const duplicated = model.duplicateScene(project, 'scene', 'copy');
  const copied = duplicated.audioTracks.filter(track => track.originSceneId === 'copy');
  assert.deepEqual(copied.map(track => [track.start, track.duration, track.trimStart, track.fadeEnvelope.offset]), [[4, 1, 1, 0], [6, 2, 5, 2]]);
  near(audio.audioFadeGain(copied[1], 0), 1); near(audio.audioFadeGain(copied[1], 1), .5);
  assert.deepEqual(duplicated.audioTracks.find(track => track.id === 'music'), project.audioTracks.find(track => track.id === 'music'));
});

test('scene ripple/gap deletion rebases the retained right envelope and reorder/insert hold the same gain', () => {
  const project = make({ audioTracks: [track({ start: 0, originSceneId: 'scene', fadeIn: 2, fadeOut: 2 })] });
  for (const ripple of [true, false]) {
    const deleted = model.deleteTimeRange(project, 1, 2, { ripple });
    const right = deleted.audioTracks.find(track => track.trimStart === 5);
    assert.equal(right.start, ripple ? 1 : 2); assert.equal(right.fadeEnvelope.offset, 2); near(audio.audioFadeGain(right, 0), 1);
  }
  const cut = fadedLinkedCut(), reordered = model.reorderScenes(cut, ['later', 'scene']);
  const right = reordered.audioTracks.find(track => track.id === 'right'); assert.equal(right.start, 6); assert.equal(right.fadeEnvelope.offset, 2);
  const inserted = model.insertScene(cut, { id: 'new', kind: 'gap', duration: 1 }, 0);
  const shifted = inserted.audioTracks.find(track => track.id === 'right'); assert.equal(shifted.start, 3); assert.equal(shifted.fadeEnvelope.offset, 2);
});

test('moving an intact fractional fade envelope does not lose phase through large timeline subtraction', () => {
  const project = make({ scenes: [{ id: 'prefix', kind: 'gap', duration: 10000 }, { id: 'scene', kind: 'video', path: 'source.wav', trimStart: 1, duration: 8, sourceDuration: 12, speed: 2 }],
    audioTracks: [track({ start: 10000, originSceneId: 'scene', fadeIn: 2, fadeOut: 2, fadeEnvelope: { offset: .1, duration: 4.1, fadeIn: 2, fadeOut: 2 } })] });
  const inserted = model.insertScene(project, { id: 'new', kind: 'gap', duration: .125 }, 0);
  assert.equal(inserted.audioTracks[0].fadeEnvelope.offset, .1); assert.equal(inserted.audioTracks[0].duration, 4);
  assert.doesNotThrow(() => audio.audioFadeGain(inserted.audioTracks[0], 0));
});

test('actual PreviewAudioMixer effect seeks paused/resuming pieces below the drift threshold and retains fade phase', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/MyExporter/PreviewAudioMixer.jsx'), 'utf8');
  const start = source.indexOf('useEffect(() => {') + 'useEffect('.length, end = source.indexOf('}, [tracks, music, musicVolume, time, playing, muted, active, duration]');
  assert.ok(start > 10 && end > start);
  const track = { id: 'short', path: 'audio.wav', start: 1, duration: 1, trimStart: .025, speed: 2, volume: .8, fadeEnvelope: { offset: 1, duration: 4, fadeIn: 2, fadeOut: 0 } };
  const element = { currentTime: 0, paused: true, readyState: 1, duration: 10, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } };
  const context = vm.createContext({ audio: [track], elements: { current: new Map([['short', element]]) }, active: true, muted: false, time: 1.02, playing: true, audioFadeGain: audio.audioFadeGain });
  const effect = vm.runInContext('(' + source.slice(start, end + 1) + ')', context);
  effect(); near(element.currentTime, .065); near(element.volume, .408); assert.equal(element.playbackRate, 2); assert.equal(element.paused, false);
  context.time = 1.04; context.playing = false; effect(); near(element.currentTime, .105); assert.equal(element.paused, true);
  context.time = 1.05; context.playing = true; effect(); near(element.currentTime, .125); assert.equal(element.paused, false);
});

const directory = path.resolve(__dirname, '..', 'generated-media', `my-exporter-audio-qa-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true });
const ffmpeg = process.platform === 'win32' ? execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0] : 'ffmpeg';
const ffprobe = process.platform === 'win32' ? path.join(path.dirname(ffmpeg), 'ffprobe.exe') : 'ffprobe';
const rate = 48000, sourcePath = path.join(directory, 'numbered-tone-source.wav'), measurements = [];
function wav(filename, frequency) {
  const count = rate * 8, bytes = Buffer.alloc(count * 2), header = Buffer.alloc(44);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(.2 * 32767 * Math.sin(2 * Math.PI * frequency(i / rate) * i / rate)), i * 2);
  header.write('RIFF'); header.writeUInt32LE(bytes.length + 36, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(bytes.length, 40);
  fs.writeFileSync(filename, Buffer.concat([header, bytes]));
}
wav(sourcePath, time => 110 * (1 + Math.floor(time)));
const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
const sourceTrack = extra => ({ id: 'voice', name: 'Tone', path: sourcePath, sourceDuration: 8, start: 1.2, trimStart: 1, duration: 3, speed: 2, volume: 1, ...extra });
const nativeProject = extra => make({ scenes: [{ id: 'gap', kind: 'gap', duration: 6 }], captions: [], textOverlays: [], audioTracks: [sourceTrack(extra)] });
const samples = filename => {
  const bytes = execFileSync(ffmpeg, ['-v', 'error', '-i', filename, '-map', '0:a:0', '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return Array.from({ length: bytes.length / 4 }, (_, index) => bytes.readFloatLE(index * 4));
};
const rms = (values, start, end) => {
  const part = values.slice(Math.round(start * rate), Math.round(end * rate));
  return Math.sqrt(part.reduce((sum, value) => sum + value * value, 0) / Math.max(1, part.length));
};
function frequency(values, start, end) {
  const part = values.slice(Math.round(start * rate), Math.round(end * rate));
  const candidates = Array.from({ length: 8 }, (_, index) => (index + 1) * 110);
  return candidates.map(hz => {
    let real = 0, imaginary = 0;
    for (let index = 0; index < part.length; index++) { const phase = 2 * Math.PI * hz * index / rate; real += part[index] * Math.cos(phase); imaginary += part[index] * Math.sin(phase); }
    return { hz, energy: real * real + imaginary * imaginary };
  }).sort((left, right) => right.energy - left.energy)[0].hz;
}
async function render(name, project) {
  const renderer = createMyExporterEngine({ findFFmpeg: () => ffmpeg, ffprobePath: ffprobe, outputDimensions: [160, 90] });
  const options = { jobId: name, outputPath: path.join(directory, name + '.mp4'), scenes: project.scenes, audioTracks: project.audioTracks, fps: 24, quality: 'small' };
  const preflight = await renderer.preflight(options); assert.equal(preflight.ok, true, JSON.stringify(preflight)); assert.equal(preflight.audioRangeFadeEnvelope, true);
  const result = await renderer.exportVideo(options); assert.equal(result.ok, true, JSON.stringify(result));
  return { result, values: samples(result.outputPath) };
}

test('actual crop export keeps the selected source sounds at their original timeline position and playback speed', async () => {
  const project = audio.editAudioSelection(nativeProject(), 'voice', 2, 2.75, { action: 'keep' }).project;
  const { result, values } = await render('keep-exact-sounds', project);
  assert.equal(frequency(values, 2.06, 2.16), 330); assert.equal(frequency(values, 2.38, 2.48), 440);
  assert.ok(rms(values, 1.3, 1.8) < .0001); assert.ok(rms(values, 2.85, 3.1) < .0001);
  assert.ok(rms(values, 2.02, 2.08) > .05);
  measurements.push({ operation: 'keep', result, frequencyEarly: frequency(values, 2.06, 2.16), frequencyLater: frequency(values, 2.38, 2.48) });
});

test('actual non-ripple cut exports silence only in the selected gap and retains both surrounding source ranges', async () => {
  const project = audio.editAudioSelection(nativeProject(), 'voice', 2, 2.75, { rightId: 'right' }).project;
  const { result, values } = await render('delete-leave-gap', project);
  assert.equal(frequency(values, 1.45, 1.55), 220); assert.equal(frequency(values, 2.85, 2.95), 550);
  assert.ok(rms(values, 2.1, 2.6) < .0001); assert.ok(rms(values, 2.77, 2.84) > .05);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'), sourceHash);
  measurements.push({ operation: 'delete-gap', result, gapRms: rms(values, 2.1, 2.6), laterFrequency: frequency(values, 2.85, 2.95) });
});

test('actual cut export preserves original fade gain at the right-piece onset instead of fading from zero again', async () => {
  const tone = path.join(directory, 'constant-tone.wav'); wav(tone, () => 660);
  const project = nativeProject({ path: tone, start: 1, trimStart: 1, duration: 4, speed: 1, fadeIn: 2, fadeOut: 2 });
  const next = audio.editAudioSelection(project, 'voice', 2, 3, { rightId: 'right' }).project;
  const { result, values } = await render('preserved-fade-phase', next);
  const leftRms = rms(values, 1.45, 1.55), rightRms = rms(values, 3.05, 3.15), laterRms = rms(values, 4.45, 4.55);
  assert.ok(rightRms > .08, 'Right fade restarted at zero'); assert.ok(rightRms > leftRms * 3); near(laterRms / leftRms, 1, .12);
  assert.ok(rms(values, 2.1, 2.9) < .0001);
  measurements.push({ operation: 'fade-phase', result, leftRms, rightRms, laterRms });
});

test('native fade capability validates malformed envelopes and accepts truthful positive sub-ms fragments', async () => {
  const renderer = createMyExporterEngine({ findFFmpeg: () => ffmpeg, ffprobePath: ffprobe });
  const base = { scenes: [{ kind: 'gap', duration: 1 }], audioTracks: [sourceTrack({ start: 0, duration: .0001, speed: 1 })] };
  assert.equal((await renderer.preflight(base)).ok, true);
  const bad = await renderer.preflight({ ...base, audioTracks: [sourceTrack({ fadeEnvelope: { duration: 1, offset: 0, fadeIn: 1, fadeOut: 0 } })] });
  assert.equal(bad.ok, false); assert.equal(bad.audioRangeFadeEnvelope, true); assert.match(bad.errors.join(' '), /envelope/);
});

after(() => {
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ directory, measurements }, null, 2));
  console.log(`Audio-range QA artifacts: ${directory}`);
});
