function parseTimestamp(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction.padEnd(3, '0')}`);
}

export function parseSrt(text) {
  const blocks = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim().split(/\n\s*\n/);
  const segments = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex(line => line.includes('-->'));
    if (timeIndex < 0) continue;
    const [startText, endText] = lines[timeIndex].split('-->').map(value => value.trim().split(/\s+/)[0]);
    const start = parseTimestamp(startText);
    const end = parseTimestamp(endText);
    const caption = lines.slice(timeIndex + 1).join(' ').replace(/<[^>]*>/g, '').replace(/\{\\an\d\}/g, '').trim();
    const speech = caption.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").trim();
    if (start === null || end === null || !speech) continue;
    if (end <= start) throw new Error(`Subtitle ${segments.length + 1} has an invalid time range.`);
    segments.push({ start, end, text: speech, caption });
  }
  segments.sort((a, b) => a.start - b.start || a.end - b.end);
  if (!segments.length) throw new Error('No timed subtitle lines were found. Please choose a valid .srt file.');
  if (segments.length > 100) throw new Error('This module currently supports up to 100 subtitle lines per Short.');
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index].start < segments[index - 1].end - 0.03) {
      throw new Error(`Subtitle lines ${index} and ${index + 1} overlap. Adjust the SRT timing so the voices can take turns cleanly.`);
    }
  }
  return segments;
}
