import type { CaptionItem, WordItem } from './types';

export interface CaptionIssue {
  kind: string;
  severity: 'warning' | 'error';
  index: number;
  start: number;
  message: string;
}

type SubtitleFormat = 'srt' | 'vtt' | 'json';
const MAX_FILE_LENGTH = 2_000_000;
const MAX_CAPTIONS = 10_000;
const MAX_WORDS = 100_000;
const MAX_SECONDS = 7 * 24 * 60 * 60;
const MAX_LYRIC_WORDS = 4_000;
const MIN_ESTIMATED_WORD_SECONDS = 0.001;

function requireFormat(format: SubtitleFormat): void {
  if (!['srt', 'vtt', 'json'].includes(format)) throw new Error('Choose SRT, VTT or JSON subtitles.');
}

function requireDuration(duration?: number): void {
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SECONDS)) {
    throw new Error('Video duration must be a positive, finite number of seconds.');
  }
}

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_SECONDS;
}

function requireCaptions(value: unknown, duration?: number, allowEmpty = true): CaptionItem[] {
  requireDuration(duration);
  if (!Array.isArray(value) || value.length > MAX_CAPTIONS || (!allowEmpty && !value.length)) {
    throw new Error(allowEmpty ? `Subtitles must contain an array of at most ${MAX_CAPTIONS} cues.` : 'Generate or import timed captions before using this tool.');
  }
  let wordCount = 0;
  let textLength = 0;
  return value.map((cue, index) => {
    const label = `Caption ${index + 1}`;
    if (!cue || typeof cue !== 'object' || !validTime(cue.start) || !validTime(cue.end) || cue.end <= cue.start) {
      throw new Error(`${label} needs finite, nonnegative times with its end after its start.`);
    }
    if (duration !== undefined && cue.end > duration) throw new Error(`${label} ends beyond the video duration. No captions were changed.`);
    if (typeof cue.text !== 'string' || !cue.text.trim()) throw new Error(`${label} has no caption text.`);
    textLength += cue.text.length;
    if (textLength > MAX_FILE_LENGTH) throw new Error('Caption text is too large; import a smaller subtitle file.');
    const clean: CaptionItem = { start: cue.start, end: cue.end, text: cue.text };
    // Preserve this supported cue setting; never carry arbitrary CSS/HTML data.
    if (typeof cue.colorOverride === 'string' && /^#[0-9a-f]{6}$/i.test(cue.colorOverride)) clean.colorOverride = cue.colorOverride;
    if (cue.words !== undefined) {
      if (!Array.isArray(cue.words)) throw new Error(`${label} word timing must be an array.`);
      wordCount += cue.words.length;
      if (wordCount > MAX_WORDS) throw new Error('The subtitle file contains too many timed words.');
      clean.words = cue.words.map((word: WordItem, wordIndex: number) => {
        if (!word || typeof word.text !== 'string' || !word.text.trim() || !validTime(word.start) || !validTime(word.end) || word.end <= word.start) {
          throw new Error(`${label}, word ${wordIndex + 1} has invalid text or collapsed timing.`);
        }
        if (word.start < cue.start || word.end > cue.end) throw new Error(`${label}, word ${wordIndex + 1} is outside its caption time range.`);
        textLength += word.text.length;
        if (textLength > MAX_FILE_LENGTH * 2) throw new Error('Timed word text is too large; import a smaller subtitle file.');
        return { text: word.text, start: word.start, end: word.end };
      });
    }
    return clean;
  });
}

function parseTimestamp(value: string, format: 'srt' | 'vtt'): number {
  const pattern = format === 'srt' ? /^(\d{1,3}):(\d{2}):(\d{2}),([0-9]{3})$/ : /^(?:(\d{2,3}):)?(\d{2}):(\d{2})\.([0-9]{3})$/;
  const match = pattern.exec(value);
  if (!match) throw new Error(`Invalid ${format.toUpperCase()} timestamp: ${value}`);
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) throw new Error(`Invalid ${format.toUpperCase()} timestamp: ${value}`);
  const result = hours * 3600 + minutes * 60 + seconds + Number(match[4]) / 1000;
  if (!validTime(result)) throw new Error('Subtitle timestamps must be within seven days.');
  return result;
}

/** Imported markup is plain caption text. Nothing from subtitle files is executed. */
export function parseSubtitleFile(text: string, format: SubtitleFormat): CaptionItem[] {
  requireFormat(format);
  if (typeof text !== 'string' || text.length > MAX_FILE_LENGTH) throw new Error('Import a subtitle file smaller than 2 MB.');
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!normalized.trim()) throw new Error('The subtitle file is empty.');
  if (format === 'json') {
    let parsed: unknown;
    try { parsed = JSON.parse(normalized); } catch { throw new Error('The caption JSON file is not valid JSON.'); }
    const cues = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && 'captions' in parsed ? (parsed as { captions: unknown }).captions : undefined;
    return requireCaptions(cues, undefined, false);
  }
  let body = normalized.trim();
  if (format === 'vtt') {
    const headerEnd = body.indexOf('\n');
    const header = headerEnd < 0 ? body : body.slice(0, headerEnd);
    if (!/^WEBVTT(?:[ \t].*)?$/.test(header)) throw new Error('VTT files must begin with a WEBVTT header.');
    const remainder = headerEnd < 0 ? [] : body.slice(headerEnd + 1).split('\n');
    // Common exported VTT header metadata is not a cue ID or caption text.
    while (remainder.length && /^(?:(?:Kind|Language):|X-TIMESTAMP-MAP=)/i.test(remainder[0])) remainder.shift();
    body = remainder.join('\n').trim();
  }
  const blocks = body.split(/\n[ \t]*\n+/).filter(block => block.trim());
  const captions: CaptionItem[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (format === 'vtt' && /^(?:NOTE(?:[ \t]|$)|STYLE[ \t]*$|REGION[ \t]*$)/.test(lines[0])) continue;
    let timingIndex = 0;
    if (!lines[0].includes('-->')) {
      if (format === 'srt' && !/^\d+[ \t]*$/.test(lines[0])) throw new Error(`Caption ${captions.length + 1} has an invalid SRT cue number.`);
      timingIndex = 1;
    }
    const timing = lines[timingIndex];
    const match = typeof timing === 'string' && /^\s*(\S+)\s+-->\s+(\S+)(?:[ \t]+(.*))?\s*$/.exec(timing);
    if (!match || (format === 'srt' && match[3])) throw new Error(`Caption ${captions.length + 1} has an invalid subtitle time range.`);
    if (format === 'vtt' && match[3] && !match[3].split(/\s+/).every(setting => /^[A-Za-z]+:\S+$/.test(setting))) {
      throw new Error(`Caption ${captions.length + 1} has invalid VTT cue settings.`);
    }
    captions.push({ start: parseTimestamp(match[1], format), end: parseTimestamp(match[2], format), text: lines.slice(timingIndex + 1).join('\n') });
    if (captions.length > MAX_CAPTIONS) throw new Error('The subtitle file contains too many cues.');
  }
  return requireCaptions(captions, undefined, false);
}

function serializeTimestamp(seconds: number, format: 'srt' | 'vtt'): string {
  const millis = Math.round(seconds * 1000);
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor(millis / 60_000) % 60;
  const wholeSeconds = Math.floor(millis / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}${format === 'srt' ? ',' : '.'}${String(millis % 1000).padStart(3, '0')}`;
}

export function serializeSubtitles(captions: CaptionItem[], format: SubtitleFormat): string {
  requireFormat(format);
  const clean = requireCaptions(captions);
  if (format === 'json') return JSON.stringify({ version: 1, captions: clean }, null, 2) + '\n';
  const blocks = clean.map((cue, index) => {
    if (Math.round(cue.end * 1000) <= Math.round(cue.start * 1000)) throw new Error(`Caption ${index + 1} is too short to export with millisecond timing.`);
    if (/\r/.test(cue.text) || /\n[ \t]*\n/.test(cue.text)) throw new Error(`Caption ${index + 1} contains blank lines. Use JSON to preserve them or remove the blank lines for SRT/VTT.`);
    return `${format === 'srt' ? `${index + 1}\n` : ''}${serializeTimestamp(cue.start, format)} --> ${serializeTimestamp(cue.end, format)}\n${cue.text}`;
  });
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + blocks.join('\n\n') + (blocks.length ? '\n' : '');
}

function normalizeWord(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');
}

function tokens(text: string): string[] { return text.match(/\S+/gu) || []; }

function wordTextMatches(cue: CaptionItem): boolean {
  if (!Array.isArray(cue.words) || cue.words.some(word => !word || typeof word.text !== 'string')) return false;
  return tokens(cue.text).map(normalizeWord).join(' ') === (cue.words || []).map(word => normalizeWord(word.text)).join(' ');
}

export function inspectCaptionQuality(captions: CaptionItem[], duration?: number): CaptionIssue[] {
  const issues: CaptionIssue[] = [];
  const add = (kind: string, severity: 'warning' | 'error', index: number, start: number, message: string) => {
    if (issues.length < 5_000) issues.push({ kind, severity, index, start: validTime(start) ? start : 0, message });
  };
  if (!Array.isArray(captions)) { add('invalid-captions', 'error', -1, 0, 'Captions must be an array.'); return issues; }
  if (duration !== undefined && (!validTime(duration) || duration === 0)) add('invalid-duration', 'error', -1, 0, 'Video duration is invalid.');
  let lastEnd = 0;
  let lastStart = 0;
  for (let index = 0; index < Math.min(captions.length, MAX_CAPTIONS); index++) {
    const cue = captions[index];
    if (!cue || !validTime(cue.start) || !validTime(cue.end) || cue.end <= cue.start) {
      add('invalid-timing', 'error', index, cue?.start || 0, 'This caption has invalid or collapsed timing.');
      continue;
    }
    if (duration !== undefined && validTime(duration) && cue.end > duration) add('beyond-duration', 'error', index, cue.start, 'This caption ends after the video.');
    if (index > 0 && cue.start < lastStart) add('out-of-order', 'error', index, cue.start, 'Caption start times are out of order.');
    if (index > 0 && cue.start < lastEnd) add('overlap', 'warning', index, cue.start, 'This caption overlaps a previous caption.');
    if (cue.start - lastEnd > 2) add('gap', 'warning', index, cue.start, `${(cue.start - lastEnd).toFixed(1)} seconds without captions before this cue; this may be music or silence.`);
    if (typeof cue.text !== 'string' || !cue.text.trim()) add('empty-text', 'error', index, cue.start, 'This caption has no text.');
    else {
      const count = Array.from(cue.text.replace(/\s/gu, '')).length;
      const rate = count / (cue.end - cue.start);
      if (rate > 25 || tokens(cue.text).length / (cue.end - cue.start) > 4.5) add('too-fast', 'warning', index, cue.start, `Text may be too fast to read (${Math.round(rate)} characters per second).`);
      if (cue.text.split('\n').length > 2) add('many-lines', 'warning', index, cue.start, 'More than two caption lines may cover too much of the picture.');
    }
    if (cue.words !== undefined && !Array.isArray(cue.words)) add('invalid-words', 'error', index, cue.start, 'Word timing is not an array.');
    else if (cue.words?.length) {
      let previousWordEnd = cue.start;
      for (const word of cue.words) {
        if (!word || !validTime(word.start) || !validTime(word.end) || word.end <= word.start || typeof word.text !== 'string' || !word.text.trim()) {
          add('invalid-word-timing', 'error', index, cue.start, 'A word has invalid text or collapsed timing.');
          continue;
        }
        if (word.start < cue.start || word.end > cue.end) add('word-outside-cue', 'error', index, word.start, 'A word is timed outside its caption.');
        if (word.start < previousWordEnd) add('word-overlap', 'warning', index, word.start, 'Timed words overlap or are out of order.');
        previousWordEnd = Math.max(previousWordEnd, word.end);
      }
      if (typeof cue.text === 'string' && !wordTextMatches(cue)) add('word-text-mismatch', 'warning', index, cue.start, 'Caption text differs from its timed words; review karaoke highlighting.');
    }
    lastStart = cue.start;
    lastEnd = Math.max(lastEnd, cue.end);
  }
  if (duration !== undefined && validTime(duration) && duration - lastEnd > 2 && captions.length) {
    add('gap', 'warning', captions.length - 1, lastEnd, `${(duration - lastEnd).toFixed(1)} seconds without captions at the end; this may be music or silence.`);
  }
  if (captions.length > MAX_CAPTIONS) add('too-many-cues', 'error', -1, 0, 'The caption list is too large to inspect completely.');
  return issues;
}

function transformTiming(captions: CaptionItem[], transform: (time: number) => number, duration?: number): CaptionItem[] {
  const clean = requireCaptions(captions, duration);
  const transformed = clean.map(cue => ({ ...cue, start: transform(cue.start), end: transform(cue.end),
    ...(cue.words !== undefined ? { words: cue.words.map(word => ({ ...word, start: transform(word.start), end: transform(word.end) })) } : {}) }));
  return requireCaptions(transformed, duration);
}

/** Reject the entire edit if any cue/word would leave the video; never silently collapse words. */
export function shiftCaptionTiming(captions: CaptionItem[], offset: number, duration?: number): CaptionItem[] {
  if (!Number.isFinite(offset)) throw new Error('Timing offset must be a finite number of seconds.');
  return transformTiming(captions, time => time + offset, duration);
}

export function scaleCaptionTiming(captions: CaptionItem[], factor: number, anchor = 0, duration?: number): CaptionItem[] {
  if (!Number.isFinite(factor) || factor <= 0 || !validTime(anchor)) throw new Error('Timing scale must be positive and its anchor must be a finite, nonnegative time.');
  return transformTiming(captions, time => anchor + (time - anchor) * factor, duration);
}

export function replaceCaptionText(captions: CaptionItem[], find: string, replace: string, caseSensitive = false): CaptionItem[] {
  const clean = requireCaptions(captions);
  if (typeof find !== 'string' || !find.length || find.length > 10_000 || typeof replace !== 'string' || replace.length > 10_000) {
    throw new Error('Enter nonempty find text and a replacement shorter than 10,000 characters.');
  }
  const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu');
  const result = clean.map(cue => {
    const text = cue.text.replace(pattern, () => replace);
    if (text === cue.text) return cue;
    const next: CaptionItem = { start: cue.start, end: cue.end, text, ...(cue.colorOverride ? { colorOverride: cue.colorOverride } : {}) };
    if (cue.words?.length && wordTextMatches(cue)) {
      const nextTokens = tokens(text);
      if (nextTokens.length === cue.words.length) next.words = cue.words.map((word, index) => ({ ...word, text: nextTokens[index] }));
    }
    return next;
  });
  return requireCaptions(result);
}

export function splitCaption(captions: CaptionItem[], index: number, atSeconds: number): CaptionItem[] {
  const clean = requireCaptions(captions);
  if (!Number.isInteger(index) || index < 0 || index >= clean.length) throw new Error('Select a caption to split.');
  const cue = clean[index];
  if (!Number.isFinite(atSeconds) || atSeconds <= cue.start || atSeconds >= cue.end) throw new Error('The split point must be inside the selected caption.');
  const cueTokens = tokens(cue.text);
  if (cueTokens.length < 2) throw new Error('A caption needs at least two words to split.');
  let splitIndex: number;
  let splitTime: number;
  let leftWords: WordItem[] | undefined;
  let rightWords: WordItem[] | undefined;
  if (cue.words?.length) {
    if (!wordTextMatches(cue) || cue.words.length !== cueTokens.length) throw new Error('Reconcile the caption text and its timed words before splitting this cue.');
    const boundaries = cue.words.slice(1).map((word, offset) => ({ time: word.start, index: offset + 1 }))
      .filter(boundary => boundary.time > cue.start && boundary.time < cue.end && cue.words![boundary.index - 1].end <= boundary.time);
    if (!boundaries.length) throw new Error('There is no nonoverlapping word boundary at which to split this caption.');
    const closest = boundaries.reduce((best, boundary) => Math.abs(boundary.time - atSeconds) < Math.abs(best.time - atSeconds) ? boundary : best);
    splitIndex = closest.index;
    splitTime = closest.time;
    leftWords = cue.words.slice(0, splitIndex);
    rightWords = cue.words.slice(splitIndex);
  } else {
    splitIndex = Math.max(1, Math.min(cueTokens.length - 1, Math.round((atSeconds - cue.start) / (cue.end - cue.start) * cueTokens.length)));
    splitTime = cue.start + (cue.end - cue.start) * splitIndex / cueTokens.length;
  }
  const positions = Array.from(cue.text.matchAll(/\S+/gu));
  const splitPosition = positions[splitIndex].index!;
  const color = cue.colorOverride ? { colorOverride: cue.colorOverride } : {};
  const left: CaptionItem = { start: cue.start, end: splitTime, text: cue.text.slice(0, splitPosition).trim(), ...color, ...(leftWords ? { words: leftWords } : {}) };
  const right: CaptionItem = { start: splitTime, end: cue.end, text: cue.text.slice(splitPosition).trim(), ...color, ...(rightWords ? { words: rightWords } : {}) };
  return requireCaptions([...clean.slice(0, index), left, right, ...clean.slice(index + 1)]);
}

export function mergeCaptionWithNext(captions: CaptionItem[], index: number): CaptionItem[] {
  const clean = requireCaptions(captions);
  if (!Number.isInteger(index) || index < 0 || index >= clean.length - 1) throw new Error('Select a caption that has a following caption to merge.');
  const left = clean[index];
  const right = clean[index + 1];
  if (left.end > right.start) throw new Error('Resolve overlapping caption times before merging these cues.');
  const merged: CaptionItem = { start: left.start, end: right.end, text: `${left.text}\n${right.text}`, ...(left.colorOverride ? { colorOverride: left.colorOverride } : {}) };
  if (left.words?.length && right.words?.length) merged.words = [...left.words, ...right.words];
  return requireCaptions([...clean.slice(0, index), merged, ...clean.slice(index + 2)]);
}

interface LyricToken { text: string; normalized: string; line: number; }
interface SourceToken extends WordItem { normalized: string; accurate: boolean; }

function lyricTokens(lyrics: string): LyricToken[] {
  const result: LyricToken[] = [];
  lyrics.replace(/\r\n?/g, '\n').split('\n').forEach((line, lineIndex) => {
    let prefix = '';
    for (const text of tokens(line)) {
      const normalized = normalizeWord(text);
      if (!normalized) {
        const previous = result[result.length - 1];
        if (previous?.line === lineIndex) previous.text += ` ${text}`;
        else prefix += `${text} `;
      } else {
        result.push({ text: prefix + text, normalized, line: lineIndex });
        prefix = '';
      }
    }
  });
  return result;
}

function sequenceMatches(source: SourceToken[], lyrics: LyricToken[]): { source: number; lyric: number }[] {
  const width = lyrics.length + 1;
  const matrix = new Uint16Array((source.length + 1) * width);
  for (let row = source.length - 1; row >= 0; row--) {
    for (let col = lyrics.length - 1; col >= 0; col--) {
      matrix[row * width + col] = source[row].normalized && source[row].normalized === lyrics[col].normalized
        ? matrix[(row + 1) * width + col + 1] + 1
        : Math.max(matrix[(row + 1) * width + col], matrix[row * width + col + 1]);
    }
  }
  const matches: { source: number; lyric: number }[] = [];
  let row = 0;
  let col = 0;
  while (row < source.length && col < lyrics.length) {
    if (source[row].normalized && source[row].normalized === lyrics[col].normalized) { matches.push({ source: row++, lyric: col++ }); }
    else if (matrix[(row + 1) * width + col] > matrix[row * width + col + 1]) row++;
    else col++;
  }
  return matches;
}

/** Offline text matching plus interpolation, not acoustic forced alignment. */
export function fitLyricsToCaptions(captions: CaptionItem[], lyrics: string, duration?: number): {
  captions: CaptionItem[]; matchedWords: number; totalWords: number; estimatedWords: number; warnings: string[];
} {
  // ASR occasionally returns zero-length words. Cue ranges must remain valid, but
  // these bad word anchors can be ignored without losing the rest of a transcript.
  const clean = requireCaptions(Array.isArray(captions) ? captions.map(cue => cue && ({ start: cue.start, end: cue.end, text: cue.text, colorOverride: cue.colorOverride })) : captions, duration, false);
  if (typeof lyrics !== 'string' || !lyrics.trim() || lyrics.length > 200_000) throw new Error('Paste lyrics with words, shorter than 200,000 characters.');
  const desired = lyricTokens(lyrics);
  if (!desired.length || desired.length > MAX_LYRIC_WORDS) throw new Error(`Fit a section containing 1–${MAX_LYRIC_WORDS} lyric words at a time.`);
  const ordered = clean.map((cue, index) => ({ ...cue, original: captions[index] })).sort((left, right) => left.start - right.start || left.end - right.end);
  const source: SourceToken[] = [];
  const warnings: string[] = [];
  let skippedWordAnchors = 0;
  let previousAnchorEnd = 0;
  for (let index = 0; index < ordered.length; index++) {
    const cue = ordered[index];
    if (index && ordered[index - 1].end > cue.start) throw new Error('Resolve overlapping caption times before fitting lyrics.');
    const original = cue.original;
    if (Array.isArray(original.words) && original.words.length && wordTextMatches(original)) {
      original.words.forEach((word, wordIndex) => {
        const parts = lyricTokens(word.text);
        const usable = validTime(word.start) && validTime(word.end) && word.end > word.start && word.start >= cue.start && word.end <= cue.end && word.start >= previousAnchorEnd;
        if (!usable) skippedWordAnchors++;
        if (usable) previousAnchorEnd = word.end;
        const start = usable ? word.start : cue.start + (cue.end - cue.start) * wordIndex / original.words!.length;
        const end = usable ? word.end : cue.start + (cue.end - cue.start) * (wordIndex + 1) / original.words!.length;
        parts.forEach((part, partIndex) => source.push({ text: part.text, normalized: part.normalized, start: start + (end - start) * partIndex / parts.length,
          end: start + (end - start) * (partIndex + 1) / parts.length, accurate: usable && parts.length === 1 }));
      });
    } else {
      if (original.words !== undefined) skippedWordAnchors += Array.isArray(original.words) ? original.words.length : 1;
      const parts = lyricTokens(cue.text);
      parts.forEach((part, partIndex) => source.push({ text: part.text, normalized: part.normalized, start: cue.start + (cue.end - cue.start) * partIndex / parts.length,
        end: cue.start + (cue.end - cue.start) * (partIndex + 1) / parts.length, accurate: false }));
    }
    if (source.length > MAX_LYRIC_WORDS) throw new Error(`Fit a section with at most ${MAX_LYRIC_WORDS} recognized words at a time.`);
  }
  if (skippedWordAnchors) warnings.push(`${skippedWordAnchors} invalid or inconsistent ASR word anchors were ignored; their timing will be estimated where needed.`);
  const matches = sequenceMatches(source, desired);
  let anchors = matches.filter(match => source[match.source].accurate);
  if (anchors.length < 2 || new Set(anchors.map(match => source[match.source].normalized)).size < 2) {
    anchors = [];
    warnings.push('No reliable word timing anchors were found. All lyric times are estimates across the existing caption span, including possible music or silence.');
  }
  const timeline: (WordItem | undefined)[] = new Array(desired.length);
  for (const match of anchors) timeline[match.lyric] = { text: desired[match.lyric].text, start: source[match.source].start, end: source[match.source].end };
  const spanStart = ordered[0].start;
  const spanEnd = ordered[ordered.length - 1].end;
  let previousIndex = -1;
  let previousEnd = spanStart;
  const stops = [...anchors.map(match => ({ index: match.lyric, start: source[match.source].start, end: source[match.source].end })), { index: desired.length, start: spanEnd, end: spanEnd }];
  for (const stop of stops) {
    const count = stop.index - previousIndex - 1;
    if (count > 0) {
      if (stop.start - previousEnd < count * MIN_ESTIMATED_WORD_SECONDS) {
        throw new Error('There is not enough time between the existing word anchors for these lyrics. Correct the cue times or fit a shorter lyric section.');
      }
      for (let offset = 0; offset < count; offset++) {
        const lyricIndex = previousIndex + 1 + offset;
        timeline[lyricIndex] = { text: desired[lyricIndex].text, start: previousEnd + (stop.start - previousEnd) * offset / count,
          end: previousEnd + (stop.start - previousEnd) * (offset + 1) / count };
      }
    }
    previousIndex = stop.index;
    previousEnd = stop.end;
  }
  const fitted: CaptionItem[] = [];
  let group: WordItem[] = [];
  let groupLine = -1;
  const flush = () => {
    if (!group.length) return;
    // Regrouped lyrics inherit the setting of the source cue at their start;
    // an estimated word in an uncaptained gap uses the ordinary global color.
    const sourceCue = ordered.find(cue => group[0].start >= cue.start && group[0].start < cue.end);
    fitted.push({ start: group[0].start, end: group[group.length - 1].end, text: group.map(word => word.text).join(' '), words: group,
      ...(sourceCue?.colorOverride ? { colorOverride: sourceCue.colorOverride } : {}) });
    group = [];
  };
  timeline.forEach((word, index) => {
    if (desired[index].line !== groupLine || group.length === 8 || (group.length && word!.start - group[group.length - 1].end > 2)) flush();
    groupLine = desired[index].line;
    group.push(word!);
  });
  flush();
  const estimatedWords = desired.length - anchors.length;
  warnings.push(estimatedWords ? `${estimatedWords} of ${desired.length} lyric word times are estimates. Review synchronization before export.` : 'Lyric words matched existing word times by text. Review synchronization before export.');
  warnings.push('This tool matches text and estimates missing timing; it does not listen to the audio or perform acoustic forced alignment.');
  const normalizedLines = lyrics.trim().split(/\r?\n/).map(line => lyricTokens(line).map(word => word.normalized).join(' ')).filter(Boolean);
  if (new Set(normalizedLines).size < normalizedLines.length || new Set(desired.map(word => word.normalized)).size < desired.length / 2) warnings.push('Repeated lyrics may match the wrong chorus. Review each repeated section.');
  return { captions: requireCaptions(fitted, duration, false), matchedWords: matches.length, totalWords: desired.length, estimatedWords, warnings };
}
