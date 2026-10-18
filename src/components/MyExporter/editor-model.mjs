// Times on scenes are source seconds. All other timeline times, including
// keyframe.time and audio.duration, are output seconds. Transitions do not
// overlap clips or change the timeline length.
export const PROJECT_VERSION = 3;
export const MIN_SPEED = .25;
export const MAX_SPEED = 4;
const EPS = 1e-7;
const TRANSFORM_DEFAULTS = Object.freeze({ scale: 1, positionX: 0, positionY: 0, rotation: 0, opacity: 1 });
const TRANSFORM_RANGES = { scale: [.1, 4], positionX: [-100, 100], positionY: [-100, 100], opacity: [0, 1] };
const LINK_FIELDS = ['originSceneId', 'detachedFromSceneId', 'reattachedToSceneId'];

export const DEFAULT_PROJECT_SETTINGS = Object.freeze({
  resolution: '1080p', fps: 30, quality: 'balanced', framing: 'contain', aspectRatio: '16:9',
  musicVolume: .18, burnCaptions: true, captionStyle: 'classic', captionPosition: 'bottom',
  captionFontSize: 42, captionMaxChars: 36, captionFontFamily: 'Arial', captionBold: true,
  captionColor: '#ffffff', captionWidth: 100, captionHeight: 100, watermarkPosition: 'bottom-right',
  watermarkX: 90, watermarkY: 90, watermarkScale: 16, watermarkOpacity: .85,
});

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') result[key] = clone(entry);
    }
    return result;
  }
  return value;
}
function number(value, fallback, label, min = 0, max = Infinity) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be a finite number from ${min} to ${max}.`);
  return value;
}
function speed(value, label) {
  const numeric = number(value, 1, label, 0);
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, numeric || 1));
}
function positive(value, fallback, label) {
  const result = number(value, fallback, label);
  if (!(result > 0)) throw new Error(`${label} must be greater than zero.`);
  return result;
}
function id(value, fallback, label) {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}
function uniqueId(project, prefix, requested, idFactory) {
  const used = new Set([...project.scenes, ...project.audioTracks, ...project.captions, ...project.textOverlays].map(item => item.id));
  if (requested !== undefined) {
    if (typeof requested !== 'string' || !requested || used.has(requested)) throw new Error('The new clip ID must be a unique nonempty string.');
    return requested;
  }
  if (idFactory) return uniqueId(project, prefix, idFactory(prefix));
  let candidate = prefix;
  for (let suffix = 2; used.has(candidate); suffix++) candidate = `${prefix}-${suffix}`;
  return candidate;
}
function normalizeTransform(value, label) {
  const result = clone(value);
  for (const key of Object.keys(TRANSFORM_DEFAULTS)) {
    if (value[key] !== undefined) {
      const [min, max] = TRANSFORM_RANGES[key] || [-Infinity, Infinity];
      result[key] = number(value[key], TRANSFORM_DEFAULTS[key], `${label}.${key}`, min, max);
    }
  }
  return result;
}
function normalizeScene(scene, index, framing) {
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) throw new Error(`Scene ${index + 1} is malformed.`);
  const kind = scene.kind || 'video';
  if (!['video', 'image', 'gap'].includes(kind)) throw new Error(`Scene ${index + 1} has an unsupported media kind.`);
  const trimStart = kind === 'gap' ? 0 : number(scene.trimStart, 0, 'Scene trimStart');
  const legacyDuration = typeof scene.sourceDuration === 'number' ? scene.sourceDuration - (kind === 'video' ? trimStart : 0) : (kind === 'video' ? 5 : 4);
  const duration = positive(scene.duration, legacyDuration, 'Scene duration');
  const sourceDuration = positive(scene.sourceDuration, trimStart + duration, 'Scene sourceDuration');
  if (kind === 'video' && trimStart + duration > sourceDuration + EPS) throw new Error('Scene trim exceeds its source duration.');
  const result = normalizeTransform({ ...clone(scene), id: id(scene.id, `scene-${index + 1}`, 'Scene id'), kind,
    trimStart, duration, sourceDuration, speed: kind === 'video' ? speed(scene.speed, 'Scene speed') : 1,
    fit: scene.fit === 'cover' ? 'fill' : ['contain', 'fill'].includes(scene.fit) ? scene.fit : framing,
    transition: scene.transition === undefined ? (typeof scene.fade === 'number' && scene.fade > 0 ? 'fade-black' : 'none') : scene.transition,
  }, 'Scene');
  if (!['none', 'fade-black'].includes(result.transition)) throw new Error('Unsupported scene transition.');
  if (scene.fade !== undefined) number(scene.fade, 0, 'Scene legacy fade');
  result.transitionDuration = number(scene.transitionDuration, result.transition === 'fade-black' ? scene.fade || .35 : 0, 'Scene transitionDuration');
  if (kind === 'gap') Object.assign(result, { path: '', hasAudio: false, muted: true });
  for (const [key, range] of Object.entries({ volume: [0, 2], brightness: [-1, 1], contrast: [0, 2], saturation: [0, 3] })) {
    if (scene[key] !== undefined) number(scene[key], undefined, `Scene ${key}`, ...range);
  }
  if (scene.keyframes !== undefined && !Array.isArray(scene.keyframes)) throw new Error('Scene keyframes must be an array.');
  if (scene.keyframes) {
    result.keyframes = scene.keyframes.map((frame, frameIndex) => {
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error('Scene keyframe is malformed.');
      return normalizeTransform({ ...clone(frame), time: number(frame.time, undefined, `Keyframe ${frameIndex + 1} time`, 0, sceneOutputDuration(result)) }, 'Keyframe');
    }).sort((a, b) => a.time - b.time);
    if (result.keyframes.some((frame, i) => frame.time === undefined || (i && frame.time <= result.keyframes[i - 1].time))) throw new Error('Keyframe times must be distinct finite output seconds.');
  }
  return result;
}
function normalizeTimed(item, index, kind) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${kind} ${index + 1} is malformed.`);
  const start = number(item.start, 0, `${kind} start`);
  const end = number(item.end, undefined, `${kind} end`);
  if (end === undefined || end <= start) throw new Error(`${kind} end must be after start.`);
  const result = { ...clone(item), id: id(item.id, `${kind.toLowerCase()}-${index + 1}`, `${kind} id`), start, end };
  if (typeof result.text !== 'string') throw new Error(`${kind} text must be a string.`);
  if (kind === 'Text') for (const [key, range] of Object.entries({ x: [0, 100], y: [0, 100], fontSize: [1, 1000], opacity: [0, 1], depth: [0, 100] })) {
    if (item[key] !== undefined) number(item[key], undefined, `Text ${key}`, ...range);
  }
  if (item.words !== undefined) {
    if (!Array.isArray(item.words)) throw new Error('Caption words must be an array.');
    result.words = item.words.map((word, i) => {
      if (!word || typeof word.text !== 'string') throw new Error('Timed word text must be a string.');
      const from = number(word.start, undefined, 'Word start', start, end);
      const to = number(word.end, undefined, 'Word end', start, end);
      if (from === undefined || to === undefined || to <= from || (i && from < item.words[i - 1].end - EPS)) throw new Error('Timed words must be increasing, non-overlapping intervals within their caption.');
      return { ...clone(word), start: from, end: to };
    });
  }
  return result;
}

/** Migrate v1-v3 JSON projects, preserving per-clip fit and all editable fields. */
export function normalizeProject(input = {}, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Project must be an object.');
  if (input.version !== undefined && (![1, 2, 3].includes(input.version))) throw new Error('Unsupported project version.');
  const result = clone(input);
  result.format = input.format || 'pattan-my-exporter-project';
  result.version = PROJECT_VERSION;
  if (input.settings !== undefined && (!input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings))) throw new Error('Project settings must be an object.');
  result.settings = { ...DEFAULT_PROJECT_SETTINGS, ...clone(options.defaultSettings || {}), ...clone(input.settings || {}) };
  if (result.settings.framing === 'cover') result.settings.framing = 'fill';
  if (!['contain', 'fill'].includes(result.settings.framing)) result.settings.framing = 'contain';
  if (input.settings?.aspectRatio === undefined) {
    const resolution = String(result.settings.resolution || '').toLowerCase();
    if (resolution.includes('vertical') || resolution.includes('portrait')) result.settings.aspectRatio = '9:16';
    else if (resolution.includes('square')) result.settings.aspectRatio = '1:1';
  }
  if (!['16:9', '9:16', '1:1', '4:3'].includes(result.settings.aspectRatio)) result.settings.aspectRatio = '16:9';
  for (const [key, range] of Object.entries({ fps: [1, 240], musicVolume: [0, 1], captionFontSize: [1, 400], captionMaxChars: [1, 1000],
    captionWidth: [1, 400], captionHeight: [1, 400], watermarkX: [0, 100], watermarkY: [0, 100], watermarkScale: [0, 100], watermarkOpacity: [0, 1] })) {
    number(result.settings[key], undefined, `Setting ${key}`, ...range);
  }
  for (const field of ['scenes', 'audioTracks', 'captions', 'textOverlays', 'mediaLibrary']) {
    if (input[field] !== undefined && !Array.isArray(input[field])) throw new Error(`${field} must be an array.`);
    result[field] = clone(input[field] || []);
  }
  result.scenes = result.scenes.map((scene, i) => normalizeScene(scene, i, result.settings.framing));
  result.audioTracks = result.audioTracks.map((track, i) => {
    if (!track || typeof track !== 'object' || Array.isArray(track)) throw new Error('Audio track is malformed.');
    const normalized = { ...clone(track), id: id(track.id, `audio-${i + 1}`, 'Audio id'),
      start: number(track.start, 0, 'Audio start'), trimStart: number(track.trimStart, 0, 'Audio trimStart'),
      duration: positive(track.duration, undefined, 'Audio duration'), speed: speed(track.speed, 'Audio speed') };
    if (track.sourceDuration !== undefined) {
      normalized.sourceDuration = positive(track.sourceDuration, undefined, 'Audio sourceDuration');
      if (normalized.trimStart + normalized.duration * normalized.speed > normalized.sourceDuration + EPS) throw new Error('Audio trim exceeds its source duration.');
    }
    for (const key of ['detachedOffset', 'timelineOffsetWithinScene', 'sourceSceneDuration']) if (track[key] !== undefined) normalized[key] = number(track[key], 0, `Audio ${key}`);
    for (const [key, range] of Object.entries({ volume: [0, 2], fadeIn: [0, Infinity], fadeOut: [0, Infinity] })) {
      if (track[key] !== undefined) number(track[key], undefined, `Audio ${key}`, ...range);
    }
    if (track.fadeEnvelope !== undefined) {
      const envelope = track.fadeEnvelope;
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('Audio fade envelope is malformed.');
      const duration = positive(envelope.duration, undefined, 'Audio fade envelope duration');
      const fields = {};
      for (const key of ['offset', 'fadeIn', 'fadeOut']) {
        fields[key] = number(envelope[key], undefined, `Audio fade envelope ${key}`);
        if (fields[key] === undefined) throw new Error(`Audio fade envelope ${key} is required.`);
      }
      // Match the runtime gain helper's floating-point tolerance. A wider
      // import tolerance could admit a value that later throws in preview.
      const tolerance = Number.EPSILON * 32 * Math.max(1, Math.abs(duration));
      if (fields.offset + normalized.duration > duration + tolerance) throw new Error('Audio fade envelope exceeds its original clip.');
      normalized.fadeEnvelope = { ...clone(envelope), ...fields, duration };
    }
    for (const key of LINK_FIELDS) if (track[key] !== undefined && typeof track[key] !== 'string') throw new Error(`Audio ${key} must be a scene ID string.`);
    return normalized;
  });
  result.captions = result.captions.map((item, i) => normalizeTimed(item, i, 'Caption'));
  result.textOverlays = result.textOverlays.map((item, i) => normalizeTimed(item, i, 'Text'));
  result.captionLanguage = input.captionLanguage ?? options.defaultCaptionLanguage ?? 'en';
  result.voiceLanguage = input.voiceLanguage ?? 'en';
  result.trackStates = { videoLocked: false, audioLocked: false, audioMuted: false, captionsLocked: false, captionsMuted: false, ...clone(input.trackStates || {}) };
  result.watermarkEnabled = input.watermarkEnabled ?? Boolean(input.watermark);
  result.music = clone(input.music ?? null);
  result.watermark = clone(input.watermark ?? null);
  const allIds = [...result.scenes, ...result.audioTracks, ...result.captions, ...result.textOverlays].map(item => item.id);
  if (new Set(allIds).size !== allIds.length) throw new Error('Timeline item IDs must be unique.');
  return result;
}

export function sceneOutputDuration(scene) {
  const duration = positive(scene?.duration, undefined, 'Scene duration');
  const value = scene.kind === 'video' ? number(scene.speed, 1, 'Scene speed', MIN_SPEED, MAX_SPEED) : 1;
  return duration / value;
}
export function timelineEntries(scenes = []) {
  if (!Array.isArray(scenes)) throw new Error('Scenes must be an array.');
  let start = 0;
  return scenes.map((scene, index) => {
    const outputDuration = sceneOutputDuration(scene);
    const entry = { scene, index, start, end: start + outputDuration, outputDuration };
    start = entry.end;
    return entry;
  });
}
export function projectDuration(project) {
  const entries = timelineEntries(Array.isArray(project) ? project : project.scenes || []);
  return entries.at(-1)?.end || 0;
}
export function projectMaxEnd(project) {
  return Math.max(projectDuration(project), 0, ...(project.audioTracks || []).map(track => track.start + track.duration),
    ...(project.captions || []).map(cue => cue.end), ...(project.textOverlays || []).map(text => text.end));
}
export function validateProject(project) {
  try {
    normalizeProject(project);
    for (const scene of project.scenes || []) if (scene.kind === 'video') number(scene.speed, 1, 'Scene speed', MIN_SPEED, MAX_SPEED);
    for (const track of project.audioTracks || []) number(track.speed, 1, 'Audio speed', MIN_SPEED, MAX_SPEED);
    return [];
  } catch (error) { return [error.message]; }
}
export function assertProject(project) {
  const errors = validateProject(project);
  if (errors.length) throw new Error(errors.join(' '));
  return project;
}

/** Interpolate each transform property independently, holding the end values. */
export function sampleSceneTransform(scene, localTime) {
  number(localTime, undefined, 'Transform time');
  if (localTime === undefined) throw new Error('Transform time must be a finite output second.');
  const base = { ...TRANSFORM_DEFAULTS };
  for (const key of Object.keys(base)) if (scene[key] !== undefined) base[key] = scene[key];
  const frames = Array.isArray(scene.keyframes) ? [...scene.keyframes].sort((a, b) => a.time - b.time) : [];
  const sampled = {};
  for (const key of Object.keys(base)) {
    const points = [{ time: 0, value: base[key] }];
    for (const frame of frames) if (typeof frame[key] === 'number' && Number.isFinite(frame[key])) {
      if (frame.time === 0) points[0] = { time: 0, value: frame[key] };
      else points.push({ time: frame.time, value: frame[key] });
    }
    const next = points.findIndex(point => point.time > localTime);
    if (next < 0) sampled[key] = points.at(-1).value;
    else if (next === 0) sampled[key] = points[0].value;
    else {
      const left = points[next - 1], right = points[next];
      sampled[key] = left.value + (right.value - left.value) * ((localTime - left.time) / (right.time - left.time));
    }
  }
  return sampled;
}
function rebaseKeyframes(scene, trimStart, duration, newSpeed) {
  if (!scene.keyframes?.length) return scene.keyframes ? [] : undefined;
  const oldSpeed = scene.kind === 'video' ? scene.speed : 1;
  const from = (trimStart - scene.trimStart) / oldSpeed;
  const to = from + duration / oldSpeed;
  const outputDuration = duration / newSpeed;
  const oldDuration = sceneOutputDuration(scene);
  const sample = time => sampleSceneTransform(scene, Math.max(0, Math.min(oldDuration, time)));
  const frames = [{ time: 0, ...sample(from) }];
  for (const frame of scene.keyframes) if (frame.time > from + EPS && frame.time < to - EPS) {
    frames.push({ time: (frame.time - from) * oldSpeed / newSpeed, ...sample(frame.time) });
  }
  frames.push({ time: outputDuration, ...sample(to) });
  return frames;
}
function sceneSlice(scene, sourceFrom, sourceTo, newId, extra = {}) {
  const trimStart = scene.trimStart + sourceFrom;
  const duration = sourceTo - sourceFrom;
  const result = { ...clone(scene), ...extra, id: newId, trimStart, duration };
  if (scene.kind === 'gap') Object.assign(result, { trimStart: 0, sourceDuration: duration });
  if (scene.keyframes) result.keyframes = rebaseKeyframes(scene, trimStart, duration, scene.speed);
  return result;
}
function sceneReference(track, scenes) {
  return LINK_FIELDS.map(field => track[field]).find(value => value && scenes.some(scene => scene.id === value));
}
function relink(track, oldId, newScene, newStart) {
  const result = { ...track };
  for (const field of LINK_FIELDS) if (result[field] === oldId) result[field] = newScene.id;
  const offset = Math.max(0, result.start - newStart);
  result.detachedOffset = offset;
  result.timelineOffsetWithinScene = offset;
  result.sourceSceneDuration = sceneOutputDuration(newScene);
  return result;
}
function invalidateAudioCache(track) {
  const { waveform, waveformLoading, waveformError, ...rest } = track;
  return rest;
}

// A mapped audio piece begins at `from` in the old project. Scale every fade
// time with the same output-time ratio as its audio, keeping source gain phase.
function mapAudioFadeEnvelope(track, mapped, from, rate = 1) {
  if (!track.fadeEnvelope && !track.fadeIn && !track.fadeOut) return mapped;
  const envelope = track.fadeEnvelope || { offset: 0, duration: track.duration, fadeIn: track.fadeIn || 0, fadeOut: track.fadeOut || 0 };
  const sliced = from !== track.start || mapped.duration !== track.duration || rate !== 1;
  if (!track.fadeEnvelope && !sliced) return mapped;
  mapped.fadeEnvelope = { ...clone(envelope), offset: (envelope.offset + (from - track.start)) * rate,
    duration: envelope.duration * rate, fadeIn: envelope.fadeIn * rate, fadeOut: envelope.fadeOut * rate };
  for (const field of ['fadeIn', 'fadeOut']) if (track[field] !== undefined) mapped[field] = track[field] * rate;
  return mapped;
}

/** Split the visual clip and its linked sound. Global cue/text times stay exact. */
export function splitScene(project, sceneId, cutTime, options = {}) {
  assertProject(project);
  project = normalizeProject(project);
  number(cutTime, undefined, 'Cut time');
  const entry = timelineEntries(project.scenes).find(item => item.scene.id === sceneId);
  if (!entry) throw new Error('The scene to split no longer exists.');
  if (!(cutTime > entry.start + EPS && cutTime < entry.end - EPS)) throw new Error('The cut must be inside the selected scene.');
  const next = createProjectSnapshot(project);
  const rightId = uniqueId(project, `${sceneId}-right`, options.rightId, options.idFactory);
  const sourceCut = (cutTime - entry.start) * entry.scene.speed;
  const left = sceneSlice(entry.scene, 0, sourceCut, sceneId);
  const right = sceneSlice(entry.scene, sourceCut, entry.scene.duration, rightId, { name: `${entry.scene.name || 'Clip'} (part 2)` });
  next.scenes.splice(entry.index, 1, left, right);
  next.audioTracks = [];
  for (const track of project.audioTracks) {
    if (!LINK_FIELDS.some(field => track[field] === sceneId)) { next.audioTracks.push(clone(track)); continue; }
    const end = track.start + track.duration;
    if (end <= cutTime + EPS) next.audioTracks.push(relink(clone(track), sceneId, left, entry.start));
    else if (track.start >= cutTime - EPS) next.audioTracks.push(relink(clone(track), sceneId, right, cutTime));
    else {
      const first = mapAudioFadeEnvelope(track, invalidateAudioCache({ ...clone(track), duration: cutTime - track.start }), track.start);
      const second = mapAudioFadeEnvelope(track, invalidateAudioCache({ ...clone(track), id: uniqueId({ ...next, audioTracks: [...project.audioTracks, ...next.audioTracks] }, `${track.id}-right`, undefined, options.idFactory), start: cutTime,
        trimStart: track.trimStart + (cutTime - track.start) * track.speed, duration: end - cutTime }), cutTime);
      next.audioTracks.push(relink(first, sceneId, left, entry.start), relink(second, sceneId, right, cutTime));
    }
  }
  return assertProject(next);
}

// Map only retained intervals. A gap in old time denotes deleted content; a
// gap in new time denotes newly revealed footage with no invented subtitles.
function intervalPieces(start, end, map) {
  const result = [];
  for (const part of map) {
    const from = Math.max(start, part.from), to = Math.min(end, part.to);
    if (to - from > EPS) result.push({ from, to, start: part.start + (from - part.from) * part.rate,
      end: part.start + (to - part.from) * part.rate, rate: part.rate });
  }
  return result;
}
function mapTimed(items, map) {
  return items.flatMap(item => {
    const pieces = intervalPieces(item.start, item.end, map);
    if (!pieces.length) return [];
    const result = { ...clone(item), start: pieces[0].start, end: pieces.at(-1).end };
    if (Array.isArray(item.words) && item.words.length) {
      result.words = item.words.flatMap(word => {
        const kept = intervalPieces(word.start, word.end, map);
        return kept.length ? [{ ...clone(word), start: kept[0].start, end: kept.at(-1).end }] : [];
      });
      if (!result.words.length) return [];
      if (result.words.length !== item.words.length) {
        result.text = result.words.map(word => word.text).join(' ');
        result.start = Math.max(result.start, result.words[0].start);
        result.end = Math.min(result.end, result.words.at(-1).end);
      }
    }
    return [result];
  });
}
function mapAudio(project, map, newScenes, { linkedOnly = false, shiftLooseAfter = Infinity, looseDelta = 0, idFactory } = {}) {
  const entries = timelineEntries(newScenes);
  const result = [];
  for (const track of project.audioTracks) {
    const reference = sceneReference(track, project.scenes);
    if (reference && !newScenes.some(scene => scene.id === reference || scene._editOriginId === reference)) continue;
    if (linkedOnly && !reference) {
      result.push({ ...clone(track), start: track.start >= shiftLooseAfter - EPS ? track.start + looseDelta : track.start });
      continue;
    }
    const pieces = intervalPieces(track.start, track.start + track.duration, map);
    for (const [index, piece] of pieces.entries()) {
      const mapped = mapAudioFadeEnvelope(track, invalidateAudioCache({ ...clone(track), id: index ? uniqueId({ ...project, audioTracks: [...project.audioTracks, ...result] }, `${track.id}-part-${index + 1}`, undefined, idFactory) : track.id,
        start: piece.start, duration: (piece.from === track.start && piece.to === track.start + track.duration ? track.duration : piece.to - piece.from) * piece.rate,
        trimStart: track.trimStart + (piece.from - track.start) * track.speed,
        speed: track.speed / piece.rate }), piece.from, piece.rate);
      if (reference) {
        const oldEntry = timelineEntries(project.scenes).find(entry => entry.scene.id === reference);
        const sourcePoint = oldEntry.scene.trimStart + (piece.from - oldEntry.start) * oldEntry.scene.speed;
        const newEntry = entries.find(entry => (entry.scene.id === reference || entry.scene._editOriginId === reference)
          && sourcePoint >= entry.scene.trimStart - EPS && sourcePoint < entry.scene.trimStart + entry.scene.duration - EPS);
        if (newEntry) result.push(relink(mapped, reference, newEntry.scene, newEntry.start));
        else {
          for (const field of LINK_FIELDS) if (mapped[field] === reference) delete mapped[field];
          result.push(mapped);
        }
      } else result.push(mapped);
    }
  }
  return result;
}
function dropInternalFields(scenes) {
  return scenes.map(({ _editOriginId, ...scene }) => scene);
}

/** Source-aware trim/speed edit with scene-linked audio and subtitles in sync. */
export function trimScene(project, sceneId, patch = {}) {
  assertProject(project);
  project = normalizeProject(project);
  const entry = timelineEntries(project.scenes).find(item => item.scene.id === sceneId);
  if (!entry) throw new Error('The scene to trim no longer exists.');
  const scene = entry.scene;
  const trimStart = number(patch.trimStart, scene.trimStart, 'New trimStart');
  const duration = positive(patch.duration, scene.duration, 'New duration');
  const newSpeed = scene.kind === 'video' ? number(patch.speed, scene.speed, 'New speed', MIN_SPEED, MAX_SPEED) : 1;
  if (scene.kind === 'video' && trimStart + duration > scene.sourceDuration + EPS) throw new Error('The trim exceeds the original media.');
  const newDuration = duration / newSpeed;
  const keptFrom = Math.max(scene.trimStart, trimStart);
  const keptTo = Math.min(scene.trimStart + scene.duration, trimStart + duration);
  const map = [{ from: 0, to: entry.start, start: 0, rate: 1 }];
  if (keptTo > keptFrom) map.push({ from: entry.start + (keptFrom - scene.trimStart) / scene.speed,
    to: entry.start + (keptTo - scene.trimStart) / scene.speed,
    start: entry.start + (keptFrom - trimStart) / newSpeed, rate: scene.speed / newSpeed });
  map.push({ from: entry.end, to: Infinity, start: entry.start + newDuration, rate: 1 });
  const next = createProjectSnapshot(project);
  next.scenes[entry.index] = { ...clone(scene), trimStart, duration, speed: newSpeed };
  if (scene.kind === 'gap') Object.assign(next.scenes[entry.index], { trimStart: 0, sourceDuration: duration });
  if (scene.keyframes) next.scenes[entry.index].keyframes = rebaseKeyframes(scene, trimStart, duration, newSpeed);
  next.captions = mapTimed(project.captions, map);
  next.textOverlays = mapTimed(project.textOverlays, map);
  next.audioTracks = mapAudio(project, map, next.scenes, { linkedOnly: true, shiftLooseAfter: entry.end, looseDelta: newDuration - entry.outputDuration });
  return assertProject(next);
}

/** Delete a time range. Ripple closes it; non-ripple leaves a black silent gap. */
export function deleteTimeRange(project, start, end, options = {}) {
  assertProject(project);
  project = normalizeProject(project);
  number(start, undefined, 'Delete start'); number(end, undefined, 'Delete end');
  const duration = projectDuration(project);
  if (!(end > start) || end > duration + EPS) throw new Error('The deleted range must be inside the visual timeline.');
  const ripple = options.ripple !== false;
  const next = createProjectSnapshot(project);
  const map = [{ from: 0, to: start, start: 0, rate: 1 }, { from: end, to: Infinity, start: ripple ? start : end, rate: 1 }];
  next.scenes = [];
  let gapAdded = false;
  const addGap = () => {
    if (ripple || gapAdded) return;
    gapAdded = true;
    next.scenes.push({ id: uniqueId({ ...project, scenes: [...project.scenes, ...next.scenes] }, 'gap', options.gapId, options.idFactory),
      kind: 'gap', name: 'Gap', path: '', trimStart: 0, duration: end - start, sourceDuration: end - start,
      speed: 1, hasAudio: false, muted: true, fit: 'contain', transition: 'none', transitionDuration: 0 });
  };
  for (const entry of timelineEntries(project.scenes)) {
    if (entry.end <= start + EPS || entry.start >= end - EPS) {
      if (entry.start >= end - EPS) addGap();
      next.scenes.push(clone(entry.scene));
      continue;
    }
    const leftDuration = Math.max(0, start - entry.start);
    const rightFrom = Math.max(0, end - entry.start);
    if (leftDuration > EPS) next.scenes.push(sceneSlice(entry.scene, 0, leftDuration * entry.scene.speed, entry.scene.id));
    addGap();
    if (rightFrom < entry.outputDuration - EPS) {
      const rightId = leftDuration > EPS ? uniqueId({ ...project, scenes: [...project.scenes, ...next.scenes] }, `${entry.scene.id}-right`, undefined, options.idFactory) : entry.scene.id;
      next.scenes.push(sceneSlice(entry.scene, rightFrom * entry.scene.speed, entry.scene.duration, rightId, { _editOriginId: entry.scene.id }));
    }
  }
  addGap();
  next.captions = ripple ? mapTimed(project.captions, map) : mapTimedByScene(project, project.captions, map, 'gap', options);
  if (ripple) {
    next.textOverlays = mapTimed(project.textOverlays, map);
    next.audioTracks = mapAudio(project, map, next.scenes, options);
  } else {
    const linked = project.audioTracks.filter(track => sceneReference(track, project.scenes));
    const independent = project.audioTracks.filter(track => !sceneReference(track, project.scenes));
    next.audioTracks = [...mapAudio({ ...project, audioTracks: linked }, map, next.scenes, options), ...clone(independent)];
  }
  next.scenes = dropInternalFields(next.scenes);
  return assertProject(next);
}
export function deleteScene(project, sceneId, options = {}) {
  const entry = timelineEntries(project.scenes).find(item => item.scene.id === sceneId);
  if (!entry) throw new Error('The scene to delete no longer exists.');
  return deleteTimeRange(project, entry.start, entry.end, options);
}
export function deleteScenes(project, sceneIds, options = {}) {
  if (!Array.isArray(sceneIds)) throw new Error('Scene IDs must be an array.');
  const selected = new Set(sceneIds);
  if (selected.size !== sceneIds.length || sceneIds.some(sceneId => !project.scenes.some(scene => scene.id === sceneId))) throw new Error('The deletion contains an invalid scene ID.');
  let next = createProjectSnapshot(project);
  for (const scene of [...project.scenes].reverse()) if (selected.has(scene.id)) next = deleteScene(next, scene.id, options);
  return next;
}

function mapTimedByScene(project, items, map, prefix, options = {}) {
  const result = [];
  for (const item of items) {
    let partIndex = 0;
    for (const part of map) {
      const mapped = mapTimed([item], [part])[0];
      if (!mapped) continue;
      if (partIndex++) mapped.id = uniqueId({ ...project, captions: [...project.captions, ...result] }, `${item.id}-${prefix}-${partIndex}`, undefined, options.idFactory);
      if (Array.isArray(item.words) && mapped.words?.length < item.words.length) mapped.text = mapped.words.map(word => word.text).join(' ');
      result.push(mapped);
    }
  }
  return result.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Reorder a complete scene list without moving independent audio/music. */
export function reorderScenes(project, orderedIds, options = {}) {
  assertProject(project);
  project = normalizeProject(project);
  if (!Array.isArray(orderedIds) || orderedIds.length !== project.scenes.length || new Set(orderedIds).size !== orderedIds.length
    || orderedIds.some(sceneId => !project.scenes.some(scene => scene.id === sceneId))) throw new Error('Reorder must include every scene ID exactly once.');
  if (orderedIds.every((sceneId, index) => sceneId === project.scenes[index].id)) return createProjectSnapshot(project);
  const next = createProjectSnapshot(project);
  next.scenes = orderedIds.map(sceneId => clone(project.scenes.find(scene => scene.id === sceneId)));
  const newEntries = timelineEntries(next.scenes);
  const map = timelineEntries(project.scenes).map(entry => ({ from: entry.start, to: entry.end,
    start: newEntries.find(newEntry => newEntry.scene.id === entry.scene.id).start, rate: 1 }));
  const end = projectDuration(project);
  map.push({ from: end, to: Infinity, start: end, rate: 1 });
  next.captions = mapTimedByScene(project, project.captions, map, 'reorder', options);
  next.textOverlays = mapTimedByScene(project, project.textOverlays, map, 'reorder', options);
  const linked = project.audioTracks.filter(track => sceneReference(track, project.scenes));
  next.audioTracks = [...mapAudio({ ...project, audioTracks: linked }, map, next.scenes, options),
    ...clone(project.audioTracks.filter(track => !sceneReference(track, project.scenes)))];
  return assertProject(next);
}

/** Insert at a sequence boundary, shifting subsequent timeline content. */
export function insertScene(project, scene, index, options = {}) {
  assertProject(project);
  project = normalizeProject(project);
  if (!Number.isInteger(index) || index < 0 || index > project.scenes.length) throw new Error('Insertion index is outside the scene list.');
  const added = normalizeScene(scene, index, project.settings?.framing || 'contain');
  uniqueId(project, 'scene', added.id);
  const point = timelineEntries(project.scenes)[index]?.start ?? projectDuration(project);
  const addedDuration = sceneOutputDuration(added);
  const map = [{ from: 0, to: point, start: 0, rate: 1 }, { from: point, to: Infinity, start: point + addedDuration, rate: 1 }];
  const next = createProjectSnapshot(project);
  next.scenes.splice(index, 0, added);
  // A cue crossing the insertion must not remain visible over newly inserted media.
  next.captions = mapTimedByScene(project, project.captions, map, 'insert', options);
  next.textOverlays = mapTimedByScene(project, project.textOverlays, map, 'insert', options);
  next.audioTracks = mapAudio(project, map, next.scenes, { ...options, linkedOnly: true, shiftLooseAfter: point, looseDelta: addedDuration });
  return assertProject(next);
}

/** Duplicate source-related content with the clip; independent music is not copied. */
export function duplicateScene(project, sceneId, newId, options = {}) {
  assertProject(project);
  project = normalizeProject(project);
  const entry = timelineEntries(project.scenes).find(item => item.scene.id === sceneId);
  if (!entry) throw new Error('The scene to duplicate no longer exists.');
  const copyId = uniqueId(project, `${sceneId}-copy`, newId, options.idFactory);
  const duplicate = { ...clone(entry.scene), id: copyId, name: `${entry.scene.name || 'Clip'} (copy)` };
  const next = insertScene(project, duplicate, entry.index + 1, options);
  const map = [{ from: entry.start, to: entry.end, start: entry.end, rate: 1 }];
  for (const field of ['captions', 'textOverlays']) {
    const copied = mapTimed(project[field], map).map(item => ({ ...item,
      ...(item.originSceneId === sceneId ? { originSceneId: copyId } : {}),
      id: uniqueId({ ...next, captions: [...next.captions, ...next.textOverlays] }, `${item.id}-copy`, undefined, options.idFactory) }));
    next[field].push(...copied);
    next[field].sort((a, b) => a.start - b.start || a.end - b.end);
  }
  for (const track of project.audioTracks.filter(track => LINK_FIELDS.some(field => track[field] === sceneId))) {
    const pieces = intervalPieces(track.start, track.start + track.duration, map);
    if (!pieces.length) continue;
    const piece = pieces[0];
    const copied = mapAudioFadeEnvelope(track, invalidateAudioCache({ ...clone(track), id: uniqueId(next, `${track.id}-copy`, undefined, options.idFactory),
      start: piece.start, duration: piece.end - piece.start, trimStart: track.trimStart + (piece.from - track.start) * track.speed }), piece.from, piece.rate);
    next.audioTracks.push(relink(copied, sceneId, duplicate, entry.end));
  }
  return assertProject(next);
}

/** Snapshots own every editable property, including settings/music/watermark. */
export function createProjectSnapshot(project) { return clone(project); }
export function snapshotProjectKey(project) {
  const snapshot = createProjectSnapshot(project);
  delete snapshot.savedAt;
  snapshot.scenes = (snapshot.scenes || []).map(({ filmstrip, ...scene }) => scene);
  snapshot.audioTracks = (snapshot.audioTracks || []).map(({ waveform, waveformLoading, waveformError, ...track }) => track);
  // Migration and restore can reorder object properties without editing their
  // values. A key-order difference must never erase the redo branch.
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  };
  return JSON.stringify(canonical(snapshot));
}
export function createProjectHistory(project, limit = 80) {
  if (!Number.isInteger(limit) || limit < 2) throw new Error('History limit must be an integer of at least two.');
  return { snapshots: [createProjectSnapshot(project)], index: 0, limit };
}
export function commitProjectHistory(history, project) {
  if (snapshotProjectKey(history.snapshots[history.index]) === snapshotProjectKey(project)) return history;
  const snapshots = [...history.snapshots.slice(0, history.index + 1), createProjectSnapshot(project)].slice(-history.limit);
  return { ...history, snapshots, index: snapshots.length - 1 };
}
export function travelProjectHistory(history, delta) {
  if (!Number.isInteger(delta)) throw new Error('History movement must be an integer.');
  const index = Math.max(0, Math.min(history.snapshots.length - 1, history.index + delta));
  return { history: { ...history, index }, project: createProjectSnapshot(history.snapshots[index]) };
}
