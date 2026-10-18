export function transcriptCues(result, maxWords = 8) {
  if (!result?.ok) throw new Error(result?.error || 'Caption transcription failed.');
  const rawWords = Array.isArray(result.words) ? result.words : [];
  if (rawWords.length) {
    let previousEnd = 0;
    const words = rawWords.map((word, index) => {
      const rawText = word.word ?? word.text;
      const text = typeof rawText === 'string' ? rawText.trim() : '';
      const { start, end } = word;
      if (!text || typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)
        || start < 0 || end <= start || start < previousEnd) throw new Error(`Speech timestamps conflict at word ${index + 1}. Previous captions are preserved.`);
      previousEnd = end;
      return { text, start, end };
    });
    const cues = []; let group = [];
    const flush = () => {
      if (group.length) cues.push({ start: group[0].start, end: group.at(-1).end, text: group.map(word => word.text).join(' '), words: group, timingSource: 'word' });
      group = [];
    };
    for (const word of words) {
      if (group.length && (group.length >= maxWords || word.start - group.at(-1).end >= .75 || /[.!?]["'’)]?$/.test(group.at(-1).text))) flush();
      group.push(word);
    }
    flush(); return cues;
  }
  let previousEnd = 0;
  return (result.segments || []).map((segment, index) => {
    const text = typeof segment.text === 'string' ? segment.text.trim() : '';
    if (!text || typeof segment.start !== 'number' || typeof segment.end !== 'number' || !Number.isFinite(segment.start)
      || !Number.isFinite(segment.end) || segment.start < previousEnd || segment.end <= segment.start) throw new Error(`Caption segment ${index + 1} has invalid timing. Previous captions are preserved.`);
    previousEnd = segment.end;
    return { start: segment.start, end: segment.end, text, words: [], timingSource: 'estimated' };
  });
}

export function cuesForScene(cues, scene, offset = 0) {
  const trimStart = Number(scene.trimStart || 0);
  const trimEnd = trimStart + Number(scene.duration);
  const speed = Number(scene.speed || 1);
  const out = [];
  for (const cue of cues) {
    const start = Math.max(trimStart, cue.start); const end = Math.min(trimEnd, cue.end);
    if (end <= start) continue;
    const words = (cue.words || []).filter(word => word.end > start && word.start < end).map(word => ({
      ...word, start: offset + (Math.max(start, word.start) - trimStart) / speed,
      end: offset + (Math.min(end, word.end) - trimStart) / speed,
    })).filter(word => word.end > word.start);
    if (cue.words?.length && !words.length) continue;
    out.push({ ...cue, originSceneId: scene.id, start: words.length ? words[0].start : offset + (start - trimStart) / speed, end: words.length ? words.at(-1).end : offset + (end - trimStart) / speed,
      text: words.length ? words.map(word => word.text).join(' ') : cue.text, words });
  }
  return out;
}

export async function translateCueTexts(cues, target, source, { signal, fetcher = fetch, endpoint = 'http://127.0.0.1:8434/api/translate/batch' } = {}) {
  if (signal?.aborted) throw signal.reason || new Error('Caption generation cancelled.');
  if (!cues.length || target === 'auto' || target === source) return cues.map(cue => ({ ...cue, words: (cue.words || []).map(word => ({ ...word })) }));
  const texts = cues.map(cue => cue.text);
  const response = await fetcher(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts, target, source: source || 'auto' }), signal });
  if (!response.ok) throw new Error(`Caption translation failed (HTTP ${response.status}). Previous captions are preserved.`);
  const payload = await response.json();
  if (signal?.aborted) throw signal.reason || new Error('Caption generation cancelled.');
  if ((payload.target && payload.target !== target) || !Array.isArray(payload.results) || payload.results.length !== cues.length
    || payload.results.some(text => typeof text !== 'string' || !text.trim())) throw new Error('Translation returned incomplete captions. Previous captions are preserved.');
  return cues.map((cue, index) => ({ ...cue, text: payload.results[index].trim(), words: [], timingSource: 'estimated',
    sourceLanguage: source || 'auto', outputLanguage: target }));
}
