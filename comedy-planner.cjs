'use strict';

function buildSceneWindows(duration) {
  const seconds = Number(duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('The video duration is invalid.');
  const step = Math.max(4, seconds / 60);
  const windows = [];
  for (let start = 0; start < seconds; start += step) {
    const end = Math.min(seconds, start + step);
    if (end - start >= 1.2) windows.push({ start, end });
  }
  return windows;
}

function chooseComedySlot(start, end, occupied = []) {
  const blocked = occupied
    .map(cue => ({ start: Math.max(start, Number(cue.start) - 0.12), end: Math.min(end, Number(cue.end) + 0.12) }))
    .filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start)
    .sort((a, b) => a.start - b.start);
  const free = [];
  let cursor = start;
  for (const cue of blocked) {
    if (cue.start > cursor) free.push({ start: cursor, end: cue.start });
    cursor = Math.max(cursor, cue.end);
  }
  if (cursor < end) free.push({ start: cursor, end });
  free.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const longest = free[0];
  if (!longest || longest.end - longest.start < 1.2) return null;
  const margin = Math.min(0.25, (longest.end - longest.start - 1.2) / 2);
  return { start: Number((longest.start + margin).toFixed(3)), end: Number((longest.end - margin).toFixed(3)) };
}

function normalizeComedyReply(reply) {
  const action = String(reply?.action || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  const dialogue = String(reply?.dialogue || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const confidence = Math.max(0, Math.min(1, Number(reply?.confidence) || 0));
  return { action, dialogue, confidence };
}

module.exports = { buildSceneWindows, chooseComedySlot, normalizeComedyReply };
