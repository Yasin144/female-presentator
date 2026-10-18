import { assertProject, createProjectSnapshot, timelineEntries } from './editor-model.mjs';

export const MIN_AUDIO_RANGE_SECONDS = .001;
const LINK_FIELDS = ['originSceneId', 'detachedFromSceneId', 'reattachedToSceneId'];
const cacheFields = ['waveform', 'waveformLoading', 'waveformError', 'waveformCacheKey', 'waveformFingerprint'];
const finite = (value, label, min = 0, max = Infinity) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be a finite number from ${min} to ${max}.`);
  return value;
};
const tolerance = (...values) => Number.EPSILON * 32 * Math.max(1, ...values.map(Math.abs));
const sameNumber = (left, right) => Math.abs(left - right) <= tolerance(left, right);
const canonicalPath = value => String(value || '').replace(/\\/g, '/').toLowerCase();

/** Validate project-time bounds without sorting, snapping, or changing the source. */
export function validateAudioSelection(project, trackId, start, end, options = {}) {
  assertProject(project);
  const track = project.audioTracks.find(item => item.id === trackId);
  if (!track) throw new Error('The selected audio clip no longer exists.');
  const trackStart = finite(track.start, 'Audio start');
  const trackDuration = finite(track.duration, 'Audio duration');
  if (!trackDuration) throw new Error('Audio duration must be greater than zero.');
  const speed = finite(track.speed ?? 1, 'Audio speed', .25, 4);
  const trimStart = finite(track.trimStart ?? 0, 'Audio source trim');
  const sourceDuration = track.sourceDuration === undefined ? undefined : finite(track.sourceDuration, 'Audio source duration');
  if (sourceDuration !== undefined && trimStart + trackDuration * speed > sourceDuration + tolerance(sourceDuration)) throw new Error('The audio trim exceeds its original source duration.');
  finite(start, 'Selection start'); finite(end, 'Selection end');
  if (start < trackStart || end > trackStart + trackDuration || end <= start) throw new Error('Choose an increasing selection wholly inside the selected audio clip.');
  const sampleRate = options.sampleRate === undefined ? undefined : finite(options.sampleRate, 'Audio sample rate', 1, 768000);
  if (sampleRate !== undefined && !Number.isInteger(sampleRate)) throw new Error('Audio sample rate must be a whole number.');
  const minimum = sampleRate ? 1 / sampleRate : MIN_AUDIO_RANGE_SECONDS;
  const duration = end - start;
  if (duration + tolerance(start, end) < minimum) throw new Error(sampleRate ? 'Select at least one audio sample.' : 'Select at least one millisecond of audio.');
  const sourceStart = trimStart + (start - trackStart) * speed;
  const sourceEnd = trimStart + (end - trackStart) * speed;
  if (sourceDuration !== undefined && sourceEnd > sourceDuration + tolerance(sourceDuration)) throw new Error('The selected audio exceeds its original source duration.');
  return { track, start, end, sourceStart, sourceEnd, duration, speed, minimum };
}

/** A sliced track retains the phase of its original fades, including inner pauses. */
export function getAudioFadeEnvelope(track) {
  if (track.fadeEnvelope !== undefined) {
    const envelope = track.fadeEnvelope;
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('Audio fade envelope is invalid.');
    const result = { offset: finite(envelope.offset, 'Audio fade offset'), duration: finite(envelope.duration, 'Audio fade duration'),
      fadeIn: finite(envelope.fadeIn, 'Audio fade in'), fadeOut: finite(envelope.fadeOut, 'Audio fade out') };
    if (result.duration <= 0 || result.offset + track.duration > result.duration + tolerance(result.duration)) throw new Error('Audio fade envelope exceeds its original clip.');
    return result;
  }
  return { offset: 0, duration: track.duration, fadeIn: finite(track.fadeIn ?? 0, 'Audio fade in'), fadeOut: finite(track.fadeOut ?? 0, 'Audio fade out') };
}

export function audioFadeGain(track, localTime) {
  finite(localTime, 'Audio local time');
  const envelope = getAudioFadeEnvelope(track), time = envelope.offset + localTime;
  const clamp = value => Math.max(0, Math.min(1, value));
  return (envelope.fadeIn ? clamp(time / envelope.fadeIn) : 1) * (envelope.fadeOut ? clamp((envelope.duration - time) / envelope.fadeOut) : 1);
}

function validSceneLink(project, track) {
  for (const field of LINK_FIELDS) {
    const entry = timelineEntries(project.scenes).find(item => item.scene.id === track[field]);
    if (!entry) continue;
    const { scene, start, end } = entry;
    if (scene.kind !== 'video' || canonicalPath(track.path) !== canonicalPath(scene.path) || !sameNumber(track.speed ?? 1, scene.speed ?? 1)) continue;
    if (track.start < start || track.start + track.duration > end + tolerance(end)) continue;
    const sourceStart = scene.trimStart + (track.start - start) * scene.speed;
    if (sameNumber(track.trimStart ?? 0, sourceStart)) return entry;
  }
  return null;
}

function unlink(track) {
  for (const field of LINK_FIELDS) track[field] = '';
  for (const field of ['detachedOffset', 'timelineOffsetWithinScene', 'sourceSceneDuration']) delete track[field];
  track.pastedAudio = true;
  return track;
}

function uniqueAudioId(project, requested, idFactory, prefix) {
  const used = new Set(['scenes', 'audioTracks', 'captions', 'textOverlays'].flatMap(field => (project[field] || []).map(item => item.id)));
  const value = requested ?? (typeof idFactory === 'function' ? idFactory('audio') : undefined);
  if (value !== undefined) {
    if (typeof value !== 'string' || !value || used.has(value)) throw new Error('The new audio piece needs a unique nonempty ID.');
    return value;
  }
  let valueId = prefix;
  for (let index = 2; used.has(valueId); index++) valueId = `${prefix}-${index}`;
  return valueId;
}

function audioPiece(project, track, from, to, start, id) {
  const result = createProjectSnapshot(track), envelope = getAudioFadeEnvelope(track);
  Object.assign(result, { id, start, duration: to - from, trimStart: (track.trimStart ?? 0) + (from - track.start) * (track.speed ?? 1) });
  for (const field of cacheFields) delete result[field];
  if (envelope.fadeIn || envelope.fadeOut || track.fadeEnvelope) result.fadeEnvelope = { ...envelope, offset: envelope.offset + (from - track.start) };
  const linked = validSceneLink(project, track);
  if (!linked || !sameNumber(start, from)) return unlink(result);
  for (const field of LINK_FIELDS) if (result[field] && result[field] !== linked.scene.id) result[field] = '';
  Object.assign(result, { detachedOffset: start - linked.start, timelineOffsetWithinScene: start - linked.start, sourceSceneDuration: linked.outputDuration });
  return result;
}

/** Default deletion leaves a gap; ripple closes only this selected audio clip. */
export function editAudioSelection(project, trackId, start, end, options = {}) {
  const selection = validateAudioSelection(project, trackId, start, end, options);
  const { track, duration } = selection, action = options.action ?? 'delete';
  if (!['keep', 'delete'].includes(action)) throw new Error('Choose keep or delete for the audio selection.');
  if (options.ripple !== undefined && typeof options.ripple !== 'boolean') throw new Error('Audio ripple must be an explicit boolean.');
  const next = createProjectSnapshot(project), pieces = [], trackEnd = track.start + track.duration;
  if (action === 'keep' && start === track.start && end === trackEnd) {
    return { project: next, selectedId: track.id, pieceIds: [track.id], removedDuration: 0, selection };
  }
  if (action === 'keep') {
    pieces.push(audioPiece(project, track, start, end, start, track.id));
  } else {
    if (start > track.start) pieces.push(audioPiece(project, track, track.start, start, track.start, track.id));
    if (end < trackEnd) {
      const rightId = pieces.length ? uniqueAudioId(project, options.rightId, options.idFactory, `${track.id}-right`) : track.id;
      pieces.push(audioPiece(project, track, end, trackEnd, options.ripple === true ? start : end, rightId));
    }
  }
  next.audioTracks = next.audioTracks.flatMap(item => item.id === trackId ? pieces : [item]);
  assertProject(next);
  return { project: next, selectedId: pieces[0]?.id || '', pieceIds: pieces.map(piece => piece.id), removedDuration: action === 'delete' ? duration : track.duration - duration, selection };
}
