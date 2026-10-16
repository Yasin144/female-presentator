const TIME = /^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})$/;

export function parseSrtTime(value) {
  const match = String(value || '').trim().match(TIME);
  if (!match) return NaN;
  const [, hours, minutes, seconds, fraction] = match;
  if (Number(minutes) > 59 || Number(seconds) > 59) return NaN;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(fraction.padEnd(3, '0')) / 1000;
}

export function parseSrt(source) {
  const blocks = String(source || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  const cues = [];
  for (const [index, block] of blocks.entries()) {
    const lines = block.split('\n').map(line => line.trim());
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].match(/^([^\s]+)\s*-->\s*([^\s]+)/);
    if (!timing) throw new Error(`Cue ${index + 1} has an invalid time range.`);
    const start = parseSrtTime(timing[1]);
    const end = parseSrtTime(timing[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error(`Cue ${index + 1} must have valid start and end times.`);
    }
    const text = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    if (text) cues.push({ start, end, text });
  }
  if (!cues.length) throw new Error('No spoken subtitle cues were found in this SRT file.');
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(value / 3600);
  const m = Math.floor(value / 60) % 60;
  const s = Math.floor(value % 60);
  return `${h ? `${String(h).padStart(2, '0')}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
