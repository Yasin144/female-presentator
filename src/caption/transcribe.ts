import { CaptionItem, Language, LANG_CODE, CODE_TO_NAME } from './types';

interface HFChunk { text: string; timestamp: [number, number] }
interface HFResponse {
  text?: string;
  chunks?: HFChunk[];
  error?: string;
  estimated_time?: number;
  language?: string;
}

const CAPTION_SILENCE_GAP_SECONDS = 0.75;
const INDIC_CAPTION_CODES = new Set(['te', 'hi', 'ta', 'ur', 'ar']);

function normalizeNurseryCaptionText(value: string): string {
  return String(value || '').replace(/\b(?:horsen|hors)\b/gi, (word) => {
    if (word === word.toUpperCase()) return 'HORSE';
    if (word[0] === word[0]?.toUpperCase()) return 'Horse';
    return 'horse';
  })
    // Whisper can confuse the child's name Ali with "Oli". Limit this fix to
    // self-introductions so a genuine person named Oli is not changed globally.
    .replace(/\bI\s+am\s+Oli\b/gi, 'I am Ali')
    .replace(/\bI['’]m\s+Oli\b/gi, "I'm Ali");
}

function getLanguageCode(language: Language): string | undefined {
  if (language === 'Auto-Detect') return undefined;
  const code = LANG_CODE[language];
  if (!code) throw new Error(`Unsupported caption language: ${language}`);
  return code;
}

function getLanguageName(codeOrName: string | undefined, fallback = 'Auto-Detect'): string {
  if (!codeOrName) return fallback;
  return CODE_TO_NAME[codeOrName] ?? codeOrName;
}

function buildCaptionChunksFromTranslatedText(text: string, start: number, end: number, maxWords: number): CaptionItem[] {
  const words = normalizeNurseryCaptionText(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const duration = Math.max(0.3, end - start);
  const step = duration / Math.max(1, words.length);
  const wordItems = words.map((word, index) => ({
    text: word,
    start: start + index * step,
    end: start + (index + 1) * step,
  }));

  const out: CaptionItem[] = [];
  const limit = Math.max(1, maxWords);
  for (let i = 0; i < wordItems.length; i += limit) {
    const slice = wordItems.slice(i, i + limit);
    out.push({
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      text: slice.map(w => w.text).join(' '),
      words: slice,
    });
  }
  return out;
}

function captionsFromLocalSegments(segments: any[], maxWords: number): CaptionItem[] {
  const out: CaptionItem[] = [];
  for (const seg of segments || []) {
    const text = String(seg?.text || '').trim();
    const start = Number(seg?.start ?? 0);
    const end = Number(seg?.end ?? start + 1);
    if (!text) continue;
    out.push(...buildCaptionChunksFromTranslatedText(text, start, end, maxWords));
  }
  return out;
}

function processLocalWhisperResult(result: any, language: Language, maxWords: number): { captions: CaptionItem[]; detectedLang: string; detectedCode?: string } {
  const targetCode = getLanguageCode(language);
  const resultText = [
    String(result?.text || ''),
    ...(Array.isArray(result?.segments) ? result.segments.map((s: any) => String(s?.text || '')) : []),
  ].join(' ');
  if (isCaptionRepetitionLoop(resultText)) throw new Error('Local Whisper produced a repeated caption loop.');
  const detectedCode = inferLangFromScript(resultText)
    || normalizeLangCode(result?.language)
    || (language !== 'Auto-Detect' ? targetCode : undefined);
  const detectedLang = getLanguageName(detectedCode, language === 'Auto-Detect' ? 'Auto-Detect' : language);
  let captions: CaptionItem[] = [];
  if (Array.isArray(result?.words) && result.words.length > 0) {
    const chunks = result.words.map((w: any) => ({
      text: normalizeNurseryCaptionText(String(w.word || w.text || '').trim()),
      timestamp: [Number(w.start ?? 0), Number(w.end ?? (Number(w.start ?? 0) + 0.3))] as [number, number],
    })).filter((w: HFChunk) => w.text);
    captions = groupIntoSentences(chunks, maxWords);
  }
  if (!captions.length && Array.isArray(result?.segments)) captions = captionsFromLocalSegments(result.segments, maxWords);
  if (!captions.length && String(result?.text || '').trim()) captions = buildFromText(normalizeNurseryCaptionText(String(result.text)), maxWords);
  if (!captions.length) throw new Error('Local Whisper returned no speech');
  if (isCaptionRepetitionLoop(captions.map(c => c.text).join(' '))) throw new Error('Local Whisper produced repeated captions.');
  return { captions, detectedLang, detectedCode };
}

export async function transcribeLocalMediaPath(
  filePath: string,
  language: Language,
  maxWords: number,
  onProgress: (msg: string, pct: number) => void,
): Promise<{ captions: CaptionItem[]; detectedLang: string; detectedCode?: string }> {
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  if (!api?.transcribeVideo) throw new Error('Caption Burner local transcription service is unavailable.');
  const targetCode = getLanguageCode(language);
  onProgress(`Caption Burner local AI: detecting and transcribing${targetCode ? ` (${language})` : ''}...`, 8);
  const result = await api.transcribeVideo({ videoPath: filePath, languageHint: targetCode || 'auto' });
  if (!result?.ok) throw new Error(String(result?.error || 'Caption Burner local transcription failed'));
  const processed = processLocalWhisperResult(result, language, maxWords);
  onProgress(`Caption Burner captions ready · ${processed.detectedLang}`, 97);
  return processed;
}

async function transcribeWithLocalWhisper(
  file: File,
  language: Language,
  maxWords: number,
  onProgress: (msg: string, pct: number) => void,
  signal?: AbortSignal,
): Promise<{ captions: CaptionItem[]; detectedLang: string; detectedCode?: string } | null> {
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  if (!api?.transcribeVideo || !api?.getPathForFile) return null;

  throwIfAborted(signal);
  const filePath = api.getPathForFile(file);
  if (!filePath) return null;

  const targetCode = getLanguageCode(language);
  const languageHint = targetCode || 'auto';

  onProgress(
    `Detecting and transcribing the spoken language locally${targetCode ? ` (${language})` : ''}...`,
    8,
  );

  const result = await api.transcribeVideo({ videoPath: filePath, languageHint });
  throwIfAborted(signal);
  if (!result?.ok) {
    throw new Error(String(result?.error || 'Local Whisper transcription failed'));
  }

  return processLocalWhisperResult(result, language, maxWords);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}

function isGenericWhisperHallucination(text: string): boolean {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return new Set([
    "i'm sorry",
    'i am sorry',
    'thank you',
    'thanks for watching',
    'please subscribe',
    'subscribe',
  ]).has(normalized);
}

async function isSilentWavChunk(chunk: Blob): Promise<boolean> {
  const bytes = await chunk.arrayBuffer();
  if (bytes.byteLength <= HDR + 2) return true;
  const samples = new Int16Array(bytes, HDR, Math.floor((bytes.byteLength - HDR) / 2));
  if (!samples.length) return true;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] / 32768;
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / samples.length) < 0.001;
}

async function abortableDelay(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Cancelled', 'AbortError'));
    }, { once: true });
  });
}

async function translateTextBatch(texts: string[], targetCode: string, signal?: AbortSignal): Promise<string[]> {
  const cleanTexts = texts.map(t => String(t || '').trim());
  if (!cleanTexts.length) return [];

  if (targetCode === 'te') {
    return translateTextBatchDirectGoogle(cleanTexts, targetCode, signal);
  }

  try {
    throwIfAborted(signal);
    const resp = await fetch('http://127.0.0.1:8434/api/translate/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: cleanTexts, target: targetCode, source: 'auto' }),
      signal,
    });
    if (resp.ok) {
      const json = await resp.json();
      if (Array.isArray(json.results) && json.results.length === cleanTexts.length) {
        return json.results.map((t: unknown, i: number) => String(t || cleanTexts[i]));
      }
    }
  } catch (err) {
    console.warn('[CB] Local translation server failed, trying direct Google endpoint', err);
  }

  const out: string[] = [];
  for (const text of cleanTexts) {
    try {
      throwIfAborted(signal);
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetCode)}&dt=t&q=${encodeURIComponent(text)}`;
      const resp = await fetch(url, { signal });
      const json = await resp.json();
      const translated = Array.isArray(json?.[0])
        ? json[0].map((part: any[]) => part?.[0] || '').join('')
        : '';
      out.push(translated || text);
    } catch {
      out.push(text);
    }
  }
  return out;
}

async function translateTextBatchDirectGoogle(texts: string[], targetCode: string, signal?: AbortSignal): Promise<string[]> {
  const out: string[] = [];
  for (const text of texts) {
    try {
      throwIfAborted(signal);
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetCode)}&dt=t&q=${encodeURIComponent(text)}`;
      const timeoutSignal = AbortSignal.timeout(5000);
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const resp = await fetch(url, { signal: combinedSignal });
      const json = await resp.json();
      const translated = Array.isArray(json?.[0])
        ? json[0].map((part: any[]) => part?.[0] || '').join('')
        : '';
      out.push(translated || text);
    } catch {
      out.push(text);
    }
  }
  return out;
}

async function translateCaptionTextsInBatches(
  texts: string[],
  targetCode: string,
  onProgress: (msg: string, pct: number) => void,
  language: Language,
  signal?: AbortSignal,
): Promise<string[]> {
  const batchSize = 24;
  const results: string[] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    throwIfAborted(signal);
    const part = Math.floor(i / batchSize) + 1;
    const total = Math.ceil(texts.length / batchSize);
    onProgress(`Translating to ${language} — batch ${part}/${total}...`, 94 + Math.min(2, Math.round((part / total) * 2)));
    const translated = await translateTextBatch(texts.slice(i, i + batchSize), targetCode, signal);
    results.push(...translated);
  }
  return results;
}

function groupCaptionsIntoSentences(captions: CaptionItem[]): CaptionItem[][] {
  const sentences: CaptionItem[][] = [];
  let currentSentence: CaptionItem[] = [];

  for (let i = 0; i < captions.length; i++) {
    const cap = captions[i];
    currentSentence.push(cap);

    const text = cap.text.trim();
    const hasPunctuation = /[.!?]$/.test(text);

    const nextCap = captions[i + 1];
    const hasPause = nextCap ? (nextCap.start - cap.end > 0.8) : true;
    
    // Also split if the group is getting too long (to prevent translation batch overflow)
    const tooLong = currentSentence.length >= 8 || (cap.end - currentSentence[0].start > 20);

    if (hasPunctuation || hasPause || tooLong) {
      sentences.push(currentSentence);
      currentSentence = [];
    }
  }

  if (currentSentence.length > 0) {
    sentences.push(currentSentence);
  }

  return sentences;
}

async function translateCaptionsToLanguage(
  captions: CaptionItem[],
  language: Language,
  onProgress: (msg: string, pct: number) => void,
  maxWords: number,
  signal?: AbortSignal,
): Promise<CaptionItem[]> {
  throwIfAborted(signal);
  if (language === 'Auto-Detect') return captions;
  const targetCode = getLanguageCode(language);
  if (!targetCode) return captions;

  onProgress(`Translating captions to ${language}...`, 94);

  // Group captions into full sentences for context-aware translation
  const sentenceGroups = groupCaptionsIntoSentences(captions);
  const sentenceTexts = sentenceGroups.map(group => group.map(c => c.text).join(' '));

  // Translate all sentences in batches
  const translatedTexts = await translateCaptionTextsInBatches(sentenceTexts, targetCode, onProgress, language, signal);

  // Rebuild timed segments from translated text for each sentence group
  const rebuiltCaptions: CaptionItem[] = [];
  for (let i = 0; i < sentenceGroups.length; i++) {
    const group = sentenceGroups[i];
    const origText = sentenceTexts[i];
    const transText = translatedTexts[i] || origText;
    const start = group[0].start;
    const end = group[group.length - 1].end;

    const rebuilt = buildCaptionChunksFromTranslatedText(transText.trim(), start, end, maxWords);
    rebuiltCaptions.push(...rebuilt);
  }

  const output = rebuiltCaptions.length ? rebuiltCaptions : captions;
  assertCaptionLanguage(output, targetCode, language);
  return output;
}

// ── Quick API health check (exported for test button) ─────────────────────
export async function testHFToken(token: string): Promise<string> {
  try {
    const formData = new FormData();
    formData.append('model', 'whisper-large-v3');
    // Provide a tiny 1-byte blob to trigger a validation error without uploading real audio
    formData.append('file', new Blob(['1'], { type: 'audio/wav' }), 'audio.wav');
    
    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    
    if (resp.status === 401) return '❌ Invalid API token (401)';
    if (resp.status === 429) return '⚠️ Rate limited (429)';
    if (resp.status === 200 || resp.status === 400) return '✅ Groq Token Valid — Ready!';
    const body = await resp.text().catch(() => '');
    return `⚠️ Status ${resp.status}: ${body.slice(0, 80)}`;
  } catch (e: any) {
    return `❌ Network error: ${e.message}`;
  }
}

// ── Group word-chunks into caption segments ───────────────────────────────
function groupIntoSentences(chunks: HFChunk[], maxWords = 4): CaptionItem[] {
  const caps: CaptionItem[] = [];
  let currentGroup: HFChunk[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.text?.trim()) continue;

    const prevChunk = currentGroup.length ? currentGroup[currentGroup.length - 1] : null;
    const gap = prevChunk ? (chunk.timestamp[0] ?? 0) - (prevChunk.timestamp[1] ?? 0) : 0;

    const previousEndsSentence = prevChunk
      ? /[.!?]["'’)]?$/.test(prevChunk.text.trim())
      : false;

    // Never preload words from the next spoken phrase. Close the current card
    // at a sentence boundary, a real pause, or the configured word limit.
    if (
      currentGroup.length >= maxWords ||
      gap > CAPTION_SILENCE_GAP_SECONDS ||
      previousEndsSentence
    ) {
      if (currentGroup.length) {
        const start = currentGroup[0].timestamp[0] ?? 0;
        const end   = currentGroup[currentGroup.length - 1].timestamp[1] ?? start + 1;
        const normalizedText = normalizeNurseryCaptionText(
          currentGroup.map(c => c.text.trim()).join(' ')
        );
        const normalizedWords = normalizedText.split(/\s+/);
        caps.push({
          start, end,
          text: normalizedText,
          words: currentGroup.map((c, index) => ({
            start: c.timestamp[0] ?? 0,
            end:   c.timestamp[1] ?? ((c.timestamp[0] ?? 0) + 1),
            text:  normalizedWords[index] || c.text.trim(),
          }))
        });
      }
      currentGroup = [];
    }
    currentGroup.push(chunk);
  }

  // Push remainder
  if (currentGroup.length) {
    const start = currentGroup[0].timestamp[0] ?? 0;
    const end   = currentGroup[currentGroup.length - 1].timestamp[1] ?? start + 1;
    const normalizedText = normalizeNurseryCaptionText(
      currentGroup.map(c => c.text.trim()).join(' ')
    );
    const normalizedWords = normalizedText.split(/\s+/);
    caps.push({
      start, end,
      text: normalizedText,
      words: currentGroup.map((c, index) => ({
        start: c.timestamp[0] ?? 0,
        end:   c.timestamp[1] ?? ((c.timestamp[0] ?? 0) + 1),
        text:  normalizedWords[index] || c.text.trim(),
      }))
    });
  }

  return caps.filter(c => c.text.length > 0);
}

function wordFingerprint(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function flattenCaptionWords(captions: CaptionItem[]): { text: string; start: number; end: number }[] {
  const words: { text: string; start: number; end: number }[] = [];
  for (const cap of captions) {
    const capWords = cap.words?.length
      ? cap.words
      : String(cap.text || '').trim().split(/\s+/).filter(Boolean).map((text, i, arr) => ({
          text,
          start: cap.start + (i / Math.max(1, arr.length)) * (cap.end - cap.start),
          end: cap.start + ((i + 1) / Math.max(1, arr.length)) * (cap.end - cap.start),
        }));

    for (const word of capWords) {
      const text = String(word.text || '').trim();
      const start = Number(word.start);
      const end = Number(word.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
      words.push({ text, start: Math.max(0, start), end: Math.max(start + 0.05, end) });
    }
  }
  return words.sort((a, b) => a.start - b.start || a.end - b.end);
}

function sameOverlapWord(a: { text: string; start: number; end: number }, b: { text: string; start: number; end: number }): boolean {
  const aKey = wordFingerprint(a.text);
  const bKey = wordFingerprint(b.text);
  if (!aKey || !bKey || aKey !== bKey) return false;
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  if (overlap <= 0) return false;
  const shortest = Math.max(0.05, Math.min(a.end - a.start, b.end - b.start));
  return overlap >= Math.min(0.35, shortest * 0.55);
}

function mergeWordTimelines(existing: CaptionItem[], incoming: CaptionItem[], maxWords: number): CaptionItem[] {
  const merged: { text: string; start: number; end: number }[] = [];

  for (const word of flattenCaptionWords([...existing, ...incoming])) {
    const duplicateIndex = merged.findIndex(prev => sameOverlapWord(prev, word));
    if (duplicateIndex >= 0) {
      const prev = merged[duplicateIndex];
      merged[duplicateIndex] = {
        text: prev.text.length >= word.text.length ? prev.text : word.text,
        start: Math.min(prev.start, word.start),
        end: Math.max(prev.end, word.end),
      };
      continue;
    }
    merged.push(word);
  }

  return rebuildCaptionsFromWords(merged.sort((a, b) => a.start - b.start || a.end - b.end), maxWords);
}

function rebuildCaptionsFromWords(words: { text: string; start: number; end: number }[], maxWords: number): CaptionItem[] {
  const out: CaptionItem[] = [];
  const limit = Math.max(1, maxWords);
  let group: { text: string; start: number; end: number }[] = [];

  const flush = () => {
    if (!group.length) return;
    out.push({
      start: group[0].start,
      end: group[group.length - 1].end,
      text: group.map(w => w.text).join(' '),
      words: group.map(w => ({ ...w })),
    });
    group = [];
  };

  for (const word of words) {
    const prev = group[group.length - 1];
    const gap = prev ? word.start - prev.end : 0;
    if (group.length >= limit || gap > CAPTION_SILENCE_GAP_SECONDS) flush();
    group.push(word);
  }
  flush();
  return out;
}

// ── Plain-text → evenly spaced captions (no timestamps) ──────────────────
function buildFromText(text: string, maxWords: number): CaptionItem[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const caps: CaptionItem[] = [];
  const avgDur = 0.5;
  for (let i = 0; i < words.length; i += maxWords) {
    const sl    = words.slice(i, i + maxWords);
    const start = i * avgDur;
    const end   = (i + sl.length) * avgDur;
    caps.push({
      start, end, text: sl.join(' '),
      words: sl.map((t, j) => ({ text: t, start: start + j * avgDur, end: start + (j + 1) * avgDur })),
    });
  }
  return caps;
}

// ── Unicode script → BCP-47 language code ────────────────────────────────
function inferLangFromScript(text: string): string | null {
  const c: Record<string, number> = {};
  for (const ch of text) {
    const p = ch.codePointAt(0) ?? 0;
    if (p >= 0x0C00 && p <= 0x0C7F) c.te = (c.te||0)+1;  // Telugu
    if (p >= 0x0900 && p <= 0x097F) c.hi = (c.hi||0)+1;  // Hindi
    if (p >= 0x0B80 && p <= 0x0BFF) c.ta = (c.ta||0)+1;  // Tamil
    if (p >= 0x0600 && p <= 0x06FF) c.ar = (c.ar||0)+1;  // Arabic/Urdu
    if (p >= 0x0041 && p <= 0x007A) c.en = (c.en||0)+1;  // Latin
  }
  if (!Object.keys(c).length) return null;
  const best = Object.entries(c).sort((a,b)=>b[1]-a[1])[0];
  return best[1] > 3 ? best[0] : null;
}

function isCaptionRepetitionLoop(text: string): boolean {
  const compact = text.replace(/[\s\p{P}\p{S}_]+/gu, '');
  if (compact.length >= 30) {
    const counts = new Map<string, number>();
    for (const ch of Array.from(compact)) counts.set(ch, (counts.get(ch) || 0) + 1);
    const topCount = Math.max(...counts.values());
    if (topCount / compact.length > 0.45) return true;
    if (counts.size <= 4) return true;
    for (let size = 1; size <= 6; size += 1) {
      const pattern = compact.slice(0, size);
      const repeated = pattern.repeat(Math.floor(compact.length / size));
      if (repeated.length >= 24 && compact.startsWith(repeated) && repeated.length / compact.length > 0.70) {
        return true;
      }
    }
  }

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 6) return false;
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  return Math.max(...counts.values()) / words.length > 0.6;
}

function assertCaptionLanguage(captions: CaptionItem[], targetCode: string, language: Language) {
  const text = captions.map(c => c.text).join(' ');
  const letters = Array.from(text).filter(ch => /\p{L}/u.test(ch));
  if (letters.length < 4) return;

  const inRange = (ch: string, from: number, to: number) => {
    const p = ch.codePointAt(0) ?? 0;
    return p >= from && p <= to;
  };
  const matches = letters.filter(ch => {
    if (targetCode === 'te') return inRange(ch, 0x0C00, 0x0C7F);
    if (targetCode === 'hi') return inRange(ch, 0x0900, 0x097F);
    if (targetCode === 'ta') return inRange(ch, 0x0B80, 0x0BFF);
    if (targetCode === 'ur' || targetCode === 'ar') return inRange(ch, 0x0600, 0x06FF);
    if (targetCode === 'en') return /[A-Za-z]/.test(ch);
    return true;
  }).length;

  if (matches / letters.length < 0.20) {
    throw new Error(`Translation to ${language} failed. Export stopped to prevent burning captions in the wrong language.`);
  }
}

// ── On-disk WAV accessor (avoids loading full file into renderer memory) ─────
interface WavHandle {
  wavPath: string;   // actual file path on disk
  size:    number;   // total WAV file size in bytes
  blob?:   Blob;     // fallback in-memory blob (browser mode)
}

// ── Extract 16 kHz mono WAV from video ───────────────────────────────────
// In Electron: FFmpeg writes WAV to disk and returns the path. We never load
// the full file into renderer memory — only the 12-second chunks are read.
// In browser: falls back to in-memory AudioContext decoding.
async function extractAudioAsWav(file: File): Promise<WavHandle> {
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  const isElectron = !!(api && api.isElectron);

  if (isElectron) {
    if (!api.getPathForFile) {
      throw new Error("Electron API 'getPathForFile' is missing! Preload script might not be loaded correctly.");
    }
    const filePath = api.getPathForFile(file);
    if (!filePath) {
      throw new Error(`Electron 'getPathForFile' returned empty for file "${file.name}" (size: ${file.size} bytes). Make sure the file exists and is accessible on your disk.`);
    }
    if (!api.extractAudio) {
      throw new Error("Electron API 'extractAudio' is missing!");
    }
    const res = await api.extractAudio({ videoPath: filePath });
    if (res?.ok && res.wavPath) {
      return { wavPath: res.wavPath, size: res.size };
    }
    throw new Error(`Native audio extraction failed: ${res?.error || 'Unknown error'}`);
  }

  // Browser fallback — load full file into memory (works for short videos)
  const ab  = await file.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(ab);
  } catch {
    throw new Error(`Audio decode failed — try re-saving the video as MP4`);
  }
  await ctx.close();

  const mono = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < decoded.length; i++) mono[i] += ch[i] / decoded.numberOfChannels;
  }

  const wavBuf = new ArrayBuffer(44 + mono.length * 2);
  const v = new DataView(wavBuf);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o+i, s.charCodeAt(i)); };
  ws(0,'RIFF'); v.setUint32(4, 36+mono.length*2, true); ws(8,'WAVE'); ws(12,'fmt ');
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,16000,true); v.setUint32(28,32000,true);
  v.setUint16(32,2,true); v.setUint16(34,16,true); ws(36,'data');
  v.setUint32(40, mono.length*2, true);
  const s16 = new Int16Array(wavBuf, 44);
  for (let i = 0; i < mono.length; i++) s16[i] = Math.max(-32768, Math.min(32767, mono[i]*32768));
  const blob = new Blob([wavBuf], { type: 'audio/wav' });
  return { wavPath: '', size: blob.size, blob };
}

// ── Build a WAV chunk from a byte range of the on-disk (or in-memory) WAV ──
async function buildWavChunkFromPcm(audio: WavHandle, pcmStart: number, pcmBytes: number): Promise<Blob> {
  const safeStart = Math.max(0, pcmStart);
  const totalPcm  = audio.size - HDR;
  const safeBytes = Math.max(0, Math.min(pcmBytes, Math.max(0, totalPcm - safeStart)));
  if (safeBytes === 0) return new Blob([], { type: 'audio/wav' });

  let pcm: ArrayBuffer;

  if (audio.blob) {
    // Browser fallback: slice the in-memory blob
    pcm = await audio.blob.slice(HDR + safeStart, HDR + safeStart + safeBytes).arrayBuffer();
  } else {
    // Electron path: read a byte-range slice from the on-disk WAV via IPC
    const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
    if (!api?.readAudioChunk) throw new Error('readAudioChunk not available');
    const res = await api.readAudioChunk({
      wavPath: audio.wavPath,
      offset:  HDR + safeStart,
      length:  safeBytes,
    });
    if (!res?.ok) throw new Error(`Read chunk failed: ${res?.error}`);
    // res.data is a Buffer (Node.js) serialized as a Uint8Array-like object
    pcm = (res.data instanceof ArrayBuffer) ? res.data : (res.data.buffer as ArrayBuffer).slice(
      res.data.byteOffset, res.data.byteOffset + res.data.byteLength
    );
  }

  const out = new ArrayBuffer(HDR + pcm.byteLength);
  const v = new DataView(out);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF');
  v.setUint32(4, 36 + pcm.byteLength, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * BPS, true);
  v.setUint16(32, BPS, true);
  v.setUint16(34, 16, true);
  ws(36, 'data');
  v.setUint32(40, pcm.byteLength, true);
  new Uint8Array(out, HDR).set(new Uint8Array(pcm));
  return new Blob([out], { type: 'audio/wav' });
}

// ── Transcription checkpoint (resume on re-upload) ────────────────────────
const CHECKPOINT_PREFIX = 'cb_checkpoint_v2_';

interface Checkpoint {
  numChunks:     number;
  captions:      CaptionItem[];
  completedUpTo: number; // last chunk index that was successfully transcribed
  spokenLangCode?: string;
  displayLang?:  string;
}

function cpKey(file: File) {
  return CHECKPOINT_PREFIX + file.name.replace(/[^a-z0-9]/gi, '_') + '_' + file.size;
}

function loadCheckpoint(file: File): Checkpoint | null {
  try {
    const raw = localStorage.getItem(cpKey(file));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveCheckpoint(file: File, cp: Checkpoint) {
  try { localStorage.setItem(cpKey(file), JSON.stringify(cp)); } catch (_) {}
}

function clearCheckpoint(file: File) {
  try { localStorage.removeItem(cpKey(file)); } catch (_) {}
}

async function toB64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onloadend = () => res((r.result as string).split(',')[1]);
    r.onerror   = rej;
    r.readAsDataURL(blob);
  });
}

// ── Call Whisper with fallback timestamp strategy ─────────────────────────
// Strategy 1: return_timestamps='word'  (best — karaoke highlights)
// Strategy 2: return_timestamps=true    (segment level — if word fails/empty)
// Strategy 3: return_timestamps=false   (plain text only — last resort)
async function callWhisper(
  chunk: Blob,
  token: string,
  langCode?: string,
  timestampMode: 'word' | 'segment' | 'none' = 'word',
  retryCount = 0,
  signal?: AbortSignal,
  contextPrompt?: string,       // tail words from previous chunk for cross-boundary continuity
): Promise<HFResponse> {
  throwIfAborted(signal);

  const formData = new FormData();
  formData.append('file', chunk, 'audio.wav');
  formData.append('model', 'whisper-large-v3'); // Full model — best accuracy
  formData.append('response_format', 'verbose_json');
  formData.append('temperature', '0');           // Deterministic greedy decoding — no random substitutions
  // Context prompt: helps Whisper stay in speech mode and continue from previous chunk
  const prompt = contextPrompt
    ? contextPrompt
    : 'Transcribe every spoken word exactly as heard. Do not summarise, add music notes, or skip words.';
  formData.append('prompt', prompt);
  if (langCode) formData.append('language', langCode);
  if (timestampMode === 'word') {
    formData.append('timestamp_granularities[]', 'word');
    formData.append('timestamp_granularities[]', 'segment');
  } else if (timestampMode === 'segment') {
    formData.append('timestamp_granularities[]', 'segment');
  }

  const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
    signal,
  });

  if (resp.status === 429) {
    const retryAfter = resp.headers.get('retry-after') || '2';
    if (retryCount < 5) {
      await abortableDelay(parseInt(retryAfter) * 1000, signal);
      return callWhisper(chunk, token, langCode, timestampMode, retryCount + 1, signal, contextPrompt);
    }
    throw new Error('Rate limited — wait a moment and retry');
  }
  if (resp.status === 401) throw new Error('Invalid API token — check your Groq API key');
  if (!resp.ok) throw new Error(`Groq API Error ${resp.status}: ${(await resp.text()).slice(0,120)}`);

  const json = await resp.json();
  if (json.error) {
    if (retryCount < 2) {
      await abortableDelay(3000, signal);
      return callWhisper(chunk, token, langCode, timestampMode, retryCount + 1, signal, contextPrompt);
    }
    throw new Error(`Whisper error: ${json.error.message || json.error}`);
  }

  const out: HFResponse = { text: json.text, language: json.language };
  if (json.words && json.words.length > 0) {
    out.chunks = json.words.map((w: any) => ({ text: normalizeNurseryCaptionText(w.word), timestamp: [w.start, w.end] }));
  } else if (json.segments && json.segments.length > 0) {
    out.chunks = json.segments.map((s: any) => ({ text: normalizeNurseryCaptionText(s.text), timestamp: [s.start, s.end] }));
  }
  return out;
}

// ── Transcribe one audio chunk with fallback strategy ─────────────────────
async function transcribeChunk(
  chunk: Blob, token: string, langCode: string | undefined, timeOffset: number, maxWords: number, signal?: AbortSignal,
  contextPrompt?: string,
): Promise<CaptionItem[]> {
  console.log(`[CB] transcribeChunk offset=${timeOffset.toFixed(1)}s size=${chunk.size} lang=${langCode}`);

  // Try 1: word-level timestamps
  let result = await callWhisper(chunk, token, langCode, 'word', 0, signal, contextPrompt);
  console.log('[CB] word result: chunks=', result.chunks?.length ?? 0, 'text=', result.text?.slice(0,60));
  if (result.chunks && result.chunks.length > 0) {
    const shifted = result.chunks.map(c => ({
      text: normalizeNurseryCaptionText(c.text),
      timestamp: [
        (c.timestamp[0] ?? 0) + timeOffset,
        ((c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 0.3)) + timeOffset,
      ] as [number, number],
    }));
    return groupIntoSentences(shifted, maxWords);
  }

  // Try 2: segment-level timestamps
  result = await callWhisper(chunk, token, langCode, 'segment', 0, signal, contextPrompt);
  console.log('[CB] segment result: chunks=', result.chunks?.length ?? 0, 'text=', result.text?.slice(0,60));
  if (result.chunks && result.chunks.length > 0) {
    const shifted = result.chunks.map(c => ({
      text: normalizeNurseryCaptionText(c.text),
      timestamp: [
        (c.timestamp[0] ?? 0) + timeOffset,
        ((c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 2)) + timeOffset,
      ] as [number, number],
    }));
    return groupIntoSentences(shifted, maxWords);
  }

  // Try 3: no timestamps — plain text
  result = await callWhisper(chunk, token, langCode, 'none', 0, signal, contextPrompt);
  console.log('[CB] none result: text=', result.text?.slice(0,60));
  const txt = normalizeNurseryCaptionText(result.text?.trim() ?? '');
  if (txt) {
    return buildFromText(txt, maxWords).map(cap => ({
      ...cap, start: cap.start + timeOffset, end: cap.end + timeOffset,
      words: cap.words?.map(w => ({ ...w, start: w.start + timeOffset, end: w.end + timeOffset })),
    }));
  }

  console.warn('[CB] All 3 modes returned empty for this chunk');
  return [];
}

function normalizeLangCode(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const l = lang.toLowerCase().trim();
  if (l === 'hindi' || l === 'hi') return 'hi';
  if (l === 'telugu' || l === 'te') return 'te';
  if (l === 'tamil' || l === 'ta') return 'ta';
  if (l === 'urdu' || l === 'ur') return 'ur';
  if (l === 'arabic' || l === 'ar') return 'ar';
  if (l === 'english' || l === 'en') return 'en';
  if (l.length >= 2) return l.slice(0, 2);
  return undefined;
}

// ── Constants ─────────────────────────────────────────────────────────────
const SR = 16000, BPS = 2, HDR = 44;
// Groq Whisper API has a strict max_completion_tokens limit of 448.
// We MUST chunk the audio into small blocks (12s) to prevent the AI from silently truncating the output.
// Highly tokenized languages + verbose_json word timestamps consume massive amounts of tokens.
const CHUNK_SECONDS = 12; 
const CHUNK_OVERLAP_SECONDS = 2;
const CHUNK_PCM_BYTES = CHUNK_SECONDS * SR * BPS;
const CHUNK_OVERLAP_BYTES = CHUNK_OVERLAP_SECONDS * SR * BPS;

// ── Public API ────────────────────────────────────────────────────────────
export async function transcribeWithHuggingFace(
  file:               File,
  language:           Language,
  hfToken:            string,
  maxWordsPerCaption: number,
  onProgress:         (msg: string, pct: number) => void,
  engine:             'auto' | 'local' | 'groq' = 'groq',
  signal?:            AbortSignal,
): Promise<{ captions: CaptionItem[]; detectedLang: string }> {

  throwIfAborted(signal);
  const targetCode = getLanguageCode(language);
  const preferCloudWhisper =
    engine === 'auto' &&
    (language === 'Auto-Detect' || (targetCode ? INDIC_CAPTION_CODES.has(targetCode) : false));

  // Local tiny/small Whisper is fast for English, but it can hallucinate Indic
  // narration. Use Groq large-v3 first for Auto-Detect and Indic languages.
  if (engine === 'local' || (engine === 'auto' && !preferCloudWhisper)) {
    try {
      const local = await transcribeWithLocalWhisper(file, language, maxWordsPerCaption, onProgress, signal);
      if (local?.captions?.length) {
        const targetCode = getLanguageCode(language);
        const inferredCode = local.detectedCode || inferLangFromScript(local.captions.map(c => c.text).join(' ')) || undefined;
        const sameLanguage =
          language === 'Auto-Detect' ||
          (targetCode && inferredCode && targetCode === inferredCode);
        const finalCaptions = sameLanguage
          ? local.captions
          : await translateCaptionsToLanguage(local.captions, language, onProgress, maxWordsPerCaption, signal);
        onProgress(`${local.detectedLang || 'Local'} captions ready ✓`, 97);
        return { captions: finalCaptions, detectedLang: local.detectedLang };
      }
    } catch (err) {
      if (engine === 'local') {
        throw new Error(`Local Whisper failed: ${err}`);
      }
      console.warn('[CB] Local Whisper failed, falling back to Groq:', err);
      onProgress('Local Whisper failed, trying Groq...', 10);
    }
  } else if (preferCloudWhisper) {
    onProgress('Using high-accuracy Whisper for Telugu/Hindi auto-detect...', 6);
  }

  if (engine === 'local') {
    throw new Error('Local engine failed and fallback is disabled');
  }

  onProgress('Extracting audio…', 5);
  const audio = await extractAudioAsWav(file);
  throwIfAborted(signal);

  // We must ALWAYS probe for the actual spoken language so Whisper doesn't hallucinate.
  // Then, if the user requested a different caption language, we translate it afterwards.
  let spokenLangCode: string | undefined;
  let displayLang = language === 'Auto-Detect' ? 'Auto' : language;
  
  onProgress('🔍 Detecting spoken language…', 8);
  try {
    let probeStart = 0;
    const probeDuration = 10 * SR * BPS;
    const totalPcm = audio.size - HDR;
    while (probeStart < totalPcm) {
      const pcmBytes = Math.min(probeDuration, totalPcm - probeStart);
      const chunk = await buildWavChunkFromPcm(audio, probeStart, pcmBytes);
      if (!(await isSilentWavChunk(chunk))) {
        const result = await callWhisper(chunk, hfToken, undefined, 'segment', 0, signal);
        const sample = (result.chunks ?? []).slice(0, 6).map(c => c.text).join('') + (result.text ?? '');
        const inferred = inferLangFromScript(sample) || normalizeLangCode(result.language);
        if (inferred) {
          spokenLangCode = inferred;
          const detectedName = CODE_TO_NAME[inferred] ?? inferred.toUpperCase();
          onProgress(`🌐 Spoken: ${detectedName}`, 10);
          await abortableDelay(500, signal);
          break;
        }
      }
      probeStart += probeDuration - (2 * SR * BPS); // 2-second overlap to avoid missing speech boundary
    }
  } catch (e) {
    console.warn('[CB] spoken language detection probe failed:', e);
  }

  const totalPcmBytes = Math.max(0, audio.size - HDR);
  const stepPcmBytes = CHUNK_PCM_BYTES - CHUNK_OVERLAP_BYTES;
  const numChunks = Math.max(1, Math.ceil(Math.max(0, totalPcmBytes - CHUNK_OVERLAP_BYTES) / stepPcmBytes));
  let lastErr: string | null = null;

  // ── Resume from checkpoint ───────────────────────────────────────────────
  const cp = loadCheckpoint(file);
  let all: CaptionItem[] = [];
  let startFromChunk = 0;

  if (cp && cp.numChunks === numChunks && cp.completedUpTo >= 0) {
    all           = cp.captions || [];
    startFromChunk = cp.completedUpTo + 1;
    spokenLangCode = cp.spokenLangCode || spokenLangCode;
    displayLang    = cp.displayLang    || displayLang;
    const resumePct = 12 + Math.round((startFromChunk / numChunks) * 82);
    onProgress(`▶ Resuming from part ${startFromChunk + 1}/${numChunks}…`, resumePct);
    console.log(`[CB] Resuming transcription from chunk ${startFromChunk}/${numChunks} with ${all.length} saved captions`);
  }

  let chunkContextPrompt: string | undefined;  // tail of previous chunk passed into next for continuity

  for (let i = startFromChunk; i < numChunks; i++) {
    const pct = 12 + Math.round((i / numChunks) * 82);
    onProgress(`${displayLang} — part ${i + 1}/${numChunks}…`, pct);

    const pcmStart   = i * stepPcmBytes;
    const pcmBytes   = Math.min(CHUNK_PCM_BYTES, totalPcmBytes - pcmStart);
    const chunk      = await buildWavChunkFromPcm(audio, pcmStart, pcmBytes);
    const timeOffset = pcmStart / (SR * BPS);

    try {
      throwIfAborted(signal);
      if (await isSilentWavChunk(chunk)) {
        console.log(`[CaptionBurner] Skipping silent chunk ${i + 1}/${numChunks}`);
        // Still save checkpoint so we can skip this chunk on resume too
        saveCheckpoint(file, { numChunks, captions: all, completedUpTo: i, spokenLangCode, displayLang });
        continue;
      }
      const caps = await transcribeChunk(chunk, hfToken, spokenLangCode, timeOffset, maxWordsPerCaption, signal, chunkContextPrompt);
      if (caps.length > 0) {
        const cleanCaps = caps.filter(cap => !isGenericWhisperHallucination(cap.text));
        all = mergeWordTimelines(all, cleanCaps, maxWordsPerCaption);

        // Build context prompt for next chunk: last 30 words of this chunk's text
        const allWords = caps.map(c => c.text).join(' ').trim().split(/\s+/);
        chunkContextPrompt = allWords.slice(-30).join(' ');
      }
      // ✅ Save checkpoint after every successful chunk
      saveCheckpoint(file, { numChunks, captions: all, completedUpTo: i, spokenLangCode, displayLang });
    } catch (err: any) {
      lastErr = String(err.message || err);
      console.error(`[CaptionBurner] Chunk ${i+1} failed:`, lastErr);
      // Save progress so far before possibly throwing
      saveCheckpoint(file, { numChunks, captions: all, completedUpTo: i - 1, spokenLangCode, displayLang });
      if (lastErr.includes('Invalid API token') || lastErr.includes('Rate limited')) throw new Error(lastErr);
    }
  }

  if (all.length === 0) {
    if (lastErr) throw new Error(`Transcription failed: ${lastErr}`);
    all = [{ start: 0, end: 3, text: "Your caption here", words: [{ start: 0, end: 3, text: "Your caption here" }] }];
    displayLang = displayLang || 'Unknown';
  }

  // If the initial 10-second probe failed to detect the spoken language (e.g. silent intro),
  // infer the spoken language from the final full text so the translation pipeline still triggers!
  if (!spokenLangCode && all.length > 0) {
    const fullText = all.map(c => c.text).join(' ');
    spokenLangCode = inferLangFromScript(fullText) || undefined;
    if (spokenLangCode && language === 'Auto-Detect') {
      displayLang = CODE_TO_NAME[spokenLangCode] ?? spokenLangCode.toUpperCase();
    }
  }

  // If the user requested a specific language (e.g. English) but the spoken language is different (e.g. Telugu), translate!
  const needsTranslation = language !== 'Auto-Detect' && spokenLangCode && targetCode && spokenLangCode !== targetCode;
  
  if (needsTranslation) {
    onProgress(`Translating to ${language}…`, 90);
  }

  const finalCaptions = needsTranslation
    ? await translateCaptionsToLanguage(all, language, onProgress, maxWordsPerCaption, signal)
    : all;

  if (isCaptionRepetitionLoop(finalCaptions.map(c => c.text).join(' '))) {
    clearCheckpoint(file);
    throw new Error('Transcription produced repeated Telugu/Hindi caption loops. Please retry with clearer audio or Groq selected.');
  }

  // ✅ Transcription complete — clear checkpoint so it doesn't resume next time
  clearCheckpoint(file);
  onProgress(`${displayLang || 'Done'} captions ready ✓`, 97);
  return { captions: finalCaptions, detectedLang: displayLang };
}

// ── AI Spelling Correction using Groq LLaMA ───────────────────────────────
export async function fixSpellingsWithGroq(
  captions: CaptionItem[],
  language: string,
  apiKey: string,
  onProgress: (msg: string, pct: number) => void,
  signal?: AbortSignal,
): Promise<CaptionItem[]> {
  throwIfAborted(signal);
  if (!apiKey || apiKey === 'HF_TOKEN_LOCAL') {
    throw new Error('Groq API Key required for AI Spelling Check');
  }

  onProgress('Preparing spelling check...', 10);
  
  const BATCH_SIZE = 30;
  let allUpdated: CaptionItem[] = [];

  for (let i = 0; i < captions.length; i += BATCH_SIZE) {
    const batch = captions.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(captions.length / BATCH_SIZE);
    
    onProgress(`AI Spellcheck — batch ${batchNum}/${totalBatches}...`, 50 + Math.round((batchNum/totalBatches)*40));
    
    const payload = batch.map((c, idx) => ({ id: i + idx, text: c.text }));
    
    const systemPrompt = `You are an expert ${language} linguist and proofreader.
The captions are already written in ${language}.
Your task:
1. Fix only obvious spelling and punctuation errors.
2. Preserve the original language and writing system exactly.
3. Never translate, transliterate, or change English text into another script.
4. Keep English words in English and native-language words in their original script.
5. Keep the exact same number of items and the exact same 'id' for each item.
You MUST output a valid JSON object containing exactly one key called "captions" which holds the array of corrected objects. NO markdown formatting, NO explanations.
Example output format:
{
  "captions": [
    { "id": 0, "text": "correct text here" }
  ]
}`;

    let resp: Response | null = null;
    let retries = 0;
    const maxRetries = 6;
    while (retries < maxRetries) {
      throwIfAborted(signal);
      resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(payload) }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" }
        }),
        signal,
      });

      if (resp.status === 429) {
        retries++;
        const text = await resp.text();
        console.warn(`[Spellcheck] Batch ${batchNum} rate limited. Retry ${retries}/${maxRetries}. Response:`, text);
        
        let delayMs = 4500;
        try {
          const errJson = JSON.parse(text);
          const msg = errJson?.error?.message || '';
          const match = msg.match(/try again in ([\d\.]+)s/i);
          if (match && match[1]) {
            delayMs = Math.ceil(parseFloat(match[1]) * 1000) + 500;
          }
        } catch (_) {}
        
        onProgress(`Rate limited — waiting ${Math.ceil(delayMs / 1000)}s...`, 50 + Math.round((batchNum / totalBatches) * 40));
        await abortableDelay(delayMs, signal);
        continue;
      }

      break;
    }

    if (!resp || !resp.ok) {
      const errText = resp ? await resp.text() : 'No response';
      throw new Error(`Groq AI Error: ${errText}`);
    }

    const json = await resp.json();
    let content = json.choices[0].message.content.trim();
    
    if (content.startsWith('```json')) {
      content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    }
    
    try {
      let correctedList = JSON.parse(content);
      if (!Array.isArray(correctedList)) {
        correctedList = correctedList.captions || correctedList.items || Object.values(correctedList)[0];
      }
      
      if (!Array.isArray(correctedList)) throw new Error('Invalid JSON structure returned by AI');

      const updatedBatch = batch.map((cap, idx) => {
        const match = correctedList.find((item: any) => item.id === i + idx);
        if (match && match.text) {
          // If we had word-level timestamps from voice detection, we MUST preserve them!
          // Since the spelling changed, we re-distribute the new words across the original exact time bounds.
          let newWords = undefined;
          if (cap.words && cap.words.length > 0) {
            const newTokens = match.text.trim().split(/\s+/);
            const origWords = cap.words;
            newWords = newTokens.map((token: string, tokenIdx: number) => {
              // Proportionally map the new token index to the original word index
              const origIdx = Math.floor((tokenIdx / newTokens.length) * origWords.length);
              const origIdxNext = Math.min(origWords.length - 1, Math.floor(((tokenIdx + 1) / newTokens.length) * origWords.length));
              
              // Map the exact voice detection timestamps
              const start = origWords[origIdx].start;
              const end = origWords[origIdxNext].end || origWords[origIdx].end;
              return { text: token, start, end };
            });
          }
          return { ...cap, text: match.text, words: newWords }; 
        }
        return cap;
      });
      
      allUpdated.push(...updatedBatch);
    } catch (err) {
      console.warn(`[Spellcheck] Batch ${batchNum} failed to parse, keeping original text.`);
      allUpdated.push(...batch);
    }
  }

  onProgress('Spelling check complete!', 100);
  return allUpdated;
}
