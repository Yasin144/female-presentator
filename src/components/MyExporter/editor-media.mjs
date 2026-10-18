import { createProjectSnapshot, insertScene, normalizeProject, reorderScenes } from './editor-model.mjs';

const naturalNames = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const LINK_FIELDS = ['originSceneId', 'detachedFromSceneId', 'reattachedToSceneId'];
const numberValue = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const filename = item => String(typeof item === 'string' ? item : item?.name || item?.path || '').split(/[\\/]/).at(-1);
const stem = item => filename(item).replace(/\.[a-z][a-z0-9]{1,7}$/i, '');

/** Prefer explicit scene metadata, then a scene token, then a leading file index. */
export function getSceneNumber(item) {
  if (item && typeof item === 'object') {
    for (const key of ['sceneNumber', 'sceneNo']) {
      const value = numberValue(item[key]);
      if (value !== null) return value;
    }
  }
  const name = stem(item);
  const explicit = /scene[\s._()[\]-]*(?:no\.?[\s._()[\]-]*|number[\s._()[\]-]*|#\s*)?(\d+)(?![a-z0-9])/i.exec(name);
  if (explicit) return numberValue(Number(explicit[1]));
  const leading = /^(\d+)(?:$|[\s._-])/.exec(name.trim());
  if (!leading) return null;
  const value = numberValue(Number(leading[1]));
  // A year prefix with a descriptive suffix is normally an import date, not a
  // scene index. Pure numeric stems still keep their natural numeric meaning.
  if (value >= 1900 && value <= 2099 && name.trim() !== leading[1]) return null;
  return value;
}

/** Equal scene numbers keep the user's import order; unnumbered names sort naturally. */
export function sortMediaBySceneNumber(items) {
  if (!Array.isArray(items)) throw new Error('Media to sort must be an array.');
  return items.map((item, index) => ({ item, index, number: getSceneNumber(item) })).sort((left, right) => {
    if (left.number !== null || right.number !== null) {
      if (left.number === null) return 1;
      if (right.number === null) return -1;
      return left.number - right.number || left.index - right.index;
    }
    return naturalNames.compare(filename(left.item), filename(right.item)) || left.index - right.index;
  }).map(entry => entry.item);
}

const canonicalPath = value => String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const relevant = asset => asset?.kind === 'video' || asset?.kind === 'image';
function requireReady(asset) {
  const label = filename(asset) || 'Imported media';
  const state = String(asset.probeStatus || '').toLowerCase();
  if (asset.probeError || asset.probePending || asset.probeLoading || ['pending', 'loading', 'reading', 'failed', 'error'].includes(state)) {
    throw new Error(`${label}: media details are pending or failed. Wait for probing or re-import the file before adding all clips.`);
  }
  if (typeof asset.path !== 'string' || !asset.path.trim()) throw new Error(`${label}: source file is missing.`);
  if (asset.id !== undefined && (typeof asset.id !== 'string' || !asset.id)) throw new Error(`${label}: library ID is invalid.`);
  if (asset.kind === 'video' && (![asset.sourceDuration, asset.duration, asset.width, asset.height].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0))) {
    throw new Error(`${label}: media details are pending or failed. A verified duration and dimensions are required before adding all clips.`);
  }
  if (asset.kind === 'image' && (typeof asset.duration !== 'number' || !Number.isFinite(asset.duration) || asset.duration <= 0)) {
    throw new Error(`${label}: choose a positive image duration before adding all clips.`);
  }
}

/** Add once and reorder once. The caller commits this returned snapshot as one undo step. */
export function addAllMediaToTimeline(project, mediaLibrary = project?.mediaLibrary, options = {}) {
  if (!project || typeof project !== 'object') throw new Error('A project is required.');
  if (!Array.isArray(mediaLibrary)) throw new Error('The media library must be an array.');
  const assets = sortMediaBySceneNumber(mediaLibrary.filter(relevant));
  // Validate the entire batch before allocating IDs or creating an edited model.
  assets.forEach(requireReady);
  const initial = normalizeProject(createProjectSnapshot(project));
  let next = createProjectSnapshot(initial);
  const knownLibraryIds = new Set((next.scenes || []).filter(scene => scene.libraryId).map(scene => scene.libraryId));
  const legacyPaths = new Map();
  for (const scene of next.scenes || []) if (!scene.libraryId && scene.path) {
    const key = canonicalPath(scene.path); legacyPaths.set(key, (legacyPaths.get(key) || 0) + 1);
  }
  const addedIds = [];
  for (const asset of assets) {
    const libraryId = asset.libraryId || asset.id;
    if ([asset.libraryId, asset.id].some(value => value && knownLibraryIds.has(value))) continue;
    const key = canonicalPath(asset.path);
    const legacyCount = legacyPaths.get(key) || 0;
    if (legacyCount) {
      legacyPaths.set(key, legacyCount - 1);
      for (const value of [asset.libraryId, asset.id]) if (value) knownLibraryIds.add(value);
      continue;
    }
    if (typeof options.idFactory !== 'function') throw new Error('Adding media requires an ID factory.');
    const id = options.idFactory('scene');
    const scene = { ...createProjectSnapshot(asset), id, ...(libraryId ? { libraryId } : {}), probeError: '' };
    next = insertScene(next, scene, next.scenes.length, { idFactory: options.idFactory });
    addedIds.push(id);
    if (libraryId) {
      for (const value of [asset.libraryId, asset.id]) if (value) knownLibraryIds.add(value);
    } else legacyPaths.set(key, (legacyPaths.get(key) || 0) + 1);
  }
  // Legacy placed clips can recover scene-number metadata from their library
  // record for sorting without replacing any editable scene properties.
  const resolveNumber = scene => {
    const asset = assets.find(item => scene.libraryId ? [item.libraryId, item.id].includes(scene.libraryId) : canonicalPath(scene.path) === canonicalPath(item.path));
    for (const record of [scene, asset]) for (const key of ['sceneNumber', 'sceneNo']) {
      const value = numberValue(record?.[key]);
      if (value !== null) return value;
    }
    return getSceneNumber(scene) ?? getSceneNumber(asset);
  };
  const order = sortMediaBySceneNumber(next.scenes.map(scene => ({ ...scene, sceneNumber: resolveNumber(scene) ?? undefined }))).map(scene => scene.id);
  const reordered = order.some((id, index) => next.scenes[index].id !== id);
  next = reorderScenes(next, order, { idFactory: options.idFactory });
  // Insertion at the former end can shift loose audio positioned after it.
  // Independent audio has absolute project timing and must remain unchanged.
  const originalSceneIds = new Set((initial.scenes || []).map(scene => scene.id));
  const independent = new Map((initial.audioTracks || []).filter(track => !LINK_FIELDS.some(field => originalSceneIds.has(track[field]))).map(track => [track.id, track]));
  next.audioTracks = next.audioTracks.map(track => createProjectSnapshot(independent.get(track.id) || track));
  next.mediaLibrary = createProjectSnapshot(mediaLibrary);
  const selectedId = options.selectedId && next.scenes.some(scene => scene.id === options.selectedId) ? options.selectedId : next.scenes[0]?.id || '';
  return { project: next, addedCount: addedIds.length, addedIds, selectedId, reordered };
}
