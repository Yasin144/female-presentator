import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { CaptionItem, CaptionSettings, WordItem } from './types';

let ff: FFmpeg | null = null;

interface BurnVideoMeta {
  width?: number;
  height?: number;
  duration?: number;
}

const SPEECH_GAP_SECONDS = 0.75;
const CAPTION_WORD_LIMIT = 6;
const CAPTION_BOTTOM_OFFSET_PX = 80;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ff?.loaded) return ff;
  ff = new FFmpeg();
  const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ff.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  return ff;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}

function pad2(n: number) { return String(Math.floor(n)).padStart(2,'0'); }
function toAss(s: number) {
  return `${pad2(s/3600)}:${pad2((s%3600)/60)}:${pad2(s%60)}.${String(Math.round((s-Math.floor(s))*100)).padStart(2,'0')}`;
}
function hexToAssColor(h: string) {
  const r=h.slice(1,3),g=h.slice(3,5),b=h.slice(5,7);
  return `&H00${b}${g}${r}`;
}

function escapeAssText(text: string) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

function isRtlLanguage(language: CaptionSettings['language']) {
  return language === 'Urdu' || language === 'Arabic';
}

function captionFontName(language: CaptionSettings['language']) {
  if (language === 'English') return 'Arial';
  if (language === 'Urdu' || language === 'Arabic') return 'Tahoma';
  return 'Nirmala UI';
}

function shapeCaptionText(text: string, settings: CaptionSettings) {
  const safe = escapeAssText(text);
  return isRtlLanguage(settings.language) ? `\u202B${safe}\u202C` : safe;
}

function captionBottomSafety(fontSize: number, lineCount = 1) {
  return CAPTION_BOTTOM_OFFSET_PX;
}

function normalizeDisplayedCaptionWords(input: WordItem[]): WordItem[] {
  const words = input.map(word => ({
    ...word,
    text: String(word.text || '').trim(),
  }));
  for (let index = 0; index < words.length - 1; index += 1) {
    const current = words[index].text.replace(/[^A-Za-z]/g, '').toLowerCase();
    const next = words[index + 1].text.replace(/[^A-Za-z]/g, '').toLowerCase();
    if (current === 'info' && (next === 'kits' || next === 'kids')) {
      words[index] = { ...words[index], text: 'Info' };
      words[index + 1] = { ...words[index + 1], text: 'Kids' };
    }
  }
  const letterCounts = new Map<string, number>();
  for (const word of words) {
    const token = word.text.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (token.length === 1) letterCounts.set(token, (letterCounts.get(token) || 0) + 1);
  }
  const dominant = [...letterCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!dominant || dominant[1] < 2) return words;
  const lessonLetter = dominant[0];
  return words.map((word, index) => {
    if (word.text.toLowerCase() !== 'for') return word;
    const previous = String(words[index - 1]?.text || '').replace(/[^A-Za-z]/g, '').toUpperCase();
    return previous === lessonLetter ? word : { ...word, text: `${lessonLetter} for` };
  });
}

function speechBoundCaptionEvents(caps: CaptionItem[], offset: number): CaptionItem[] {
  const shifted: CaptionItem[] = [];
  for (const cap of caps) {
    const validWords = (cap.words || [])
      .filter(w => String(w.text || '').trim() && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
      .sort((a, b) => a.start - b.start);

    if (!validWords.length) {
      shifted.push({ ...cap, start: cap.start + offset, end: cap.end + offset });
      continue;
    }

    let group: WordItem[] = [];
    const flush = () => {
      if (!group.length) return;
      const words = group.map(w => ({
        ...w,
        start: w.start + offset,
        end: Math.min(w.end, w.start + 1.5) + offset,
      }));
      shifted.push({
        start: words[0].start,
        end: words[words.length - 1].end,
        text: words.map(w => w.text).join(' '),
        words,
      });
      group = [];
    };

    for (const word of validWords) {
      const previous = group[group.length - 1];
      if (previous && word.start - previous.end > SPEECH_GAP_SECONDS) flush();
      group.push(word);
    }
    flush();
  }
  return shifted;
}

function normalizeCaptionTimeline(caps: CaptionItem[], offset: number): CaptionItem[] {
  // Preserve the user's selected/editor caption cards. Flattening the whole
  // transcript here makes continuous speech export as one long subtitle line.
  const speechEvents = speechBoundCaptionEvents(caps, offset);

  const sorted = speechEvents
    .filter(c => c && String(c.text || '').trim() && Number.isFinite(c.start) && Number.isFinite(c.end))
    .map(c => ({
      ...c,
      start: Math.max(0, c.start),
      end: Math.max(Math.max(0, c.start) + 0.05, c.end),
      words: c.words?.map(w => ({
        ...w,
        start: Math.max(0, w.start),
        end: Math.max(Math.max(0, w.start) + 0.01, w.end),
      })),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out: CaptionItem[] = [];
  for (const current of sorted) {
    const previous = out[out.length - 1];
    if (previous && current.start < previous.end) {
      current.start = Math.max(previous.end + 0.01, current.start);
      if (previous.words?.length) {
        previous.words = previous.words
          .map(w => ({
            ...w,
            start: Math.max(previous.start, w.start),
            end: Math.max(w.start + 0.01, w.end),
          }))
          .filter(w => w.end > w.start);
      }
      if (current.words?.length) {
        current.words = current.words.map(w => ({
          ...w,
          start: Math.max(current.start, w.start),
          end: Math.max(Math.max(current.start, w.start) + 0.01, w.end),
        }));
      }
      current.end = Math.max(current.start + 0.05, current.end);
    }
    out.push(current);
  }
  return out;
}

function splitCaptionForExport(cap: CaptionItem, maxWords: number): CaptionItem[] {
  const words = (cap.words?.length
    ? cap.words
    : cap.text.trim().split(/\s+/).map((text, i, all) => ({
        text,
        start: cap.start + (i / all.length) * (cap.end - cap.start),
        end: cap.start + ((i + 1) / all.length) * (cap.end - cap.start),
      })))
    .filter(w => String(w.text || '').trim() && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const limit = Math.max(1, Math.min(CAPTION_WORD_LIMIT, Math.round(maxWords || CAPTION_WORD_LIMIT)));
  if (words.length <= limit) return [cap];

  const parts: CaptionItem[] = [];
  for (let i = 0; i < words.length; i += limit) {
    const slice = words.slice(i, i + limit);
    parts.push({
      start: slice[0].start,
      end: Math.max(slice[0].start + 0.05, slice[slice.length - 1].end),
      text: slice.map(w => w.text).join(' '),
      words: slice,
    });
  }
  return parts;
}

function buildAss(caps: CaptionItem[], s: CaptionSettings, meta: BurnVideoMeta = {}): string {
  const exportWordLimit = Math.max(1, Math.min(CAPTION_WORD_LIMIT, Math.round(s.maxWordsPerCaption || CAPTION_WORD_LIMIT)));
  const timelineCaps = normalizeCaptionTimeline(caps, s.offset || 0)
    .flatMap(cap => splitCaptionForExport(cap, exportWordLimit));
  // Auto-detect font based on actual text content to prevent missing glyphs (tofu boxes)
  // if the user's language dropdown doesn't match the actual script being rendered.
  const allText = timelineCaps.map(c => c.text).join(' ');
  let fontName = 'Arial';
  
  let hasIndic = false, hasArabic = false;
  for (const ch of allText) {
    const p = ch.codePointAt(0) ?? 0;
    if ((p >= 0x0900 && p <= 0x0D7F)) hasIndic = true; // Indic scripts (Hindi, Telugu, Tamil, etc)
    if ((p >= 0x0600 && p <= 0x06FF)) hasArabic = true; // Arabic/Urdu
  }
  
  if (hasIndic) fontName = 'Nirmala UI';
  else if (hasArabic) fontName = 'Tahoma';
  else if (['Telugu', 'Hindi', 'Tamil'].includes(s.language)) fontName = 'Nirmala UI';
  else if (['Urdu', 'Arabic'].includes(s.language)) fontName = 'Tahoma';

  const playResX = Math.max(1, Math.round(meta.width || 1920));
  const playResY = Math.max(1, Math.round(meta.height || 1080));
  // Portrait clips are narrow: scale against both dimensions so captions never
  // become giant merely because the video is tall.
  const fs = Math.max(10, Math.min(
    Math.round(playResY * 0.075),
    Math.round(playResX * 0.078),
    Math.round(s.fontSize || 35),
  ));
  
  // Swap primary and secondary colors for standard karaoke behavior:
  // - SecondaryColour (sec) is the inactive/unhighlighted color (normal text, e.g. White).
  // - PrimaryColour (pri) is the active/highlighted color (highlighted text, e.g. Yellow).
  const pri = hexToAssColor(s.style === 'white-yellow' || s.style === 'karaoke' ? '#facc15' : (s.highlightColor || '#facc15'));
  const sec = hexToAssColor(s.style === 'white-yellow' || s.style === 'karaoke'
    ? '#ffffff'
    : s.fontColor==='White'?'#ffffff':s.fontColor==='Yellow'?'#facc15':s.fontColor==='Cyan'?'#22d3ee':'#000000');

  const align = s.position==='top' ? 8 : 2;
  const encoding = 1;

  // Map BorderStyle, Outline, Shadow based on s.style
  let borderStyle = 1; // 1 = outline, 3 = box
  let outline = 2;
  let shadow = 0;

  if (s.style === 'pill') {
    borderStyle = 3;
    outline = 0;
  } else if (s.style === 'minimal') {
    borderStyle = 1;
    outline = 0;
    shadow = 1; // small drop-shadow so text is readable on bright backgrounds
  } else if (s.style === 'white-yellow' || s.style === 'karaoke') {
    borderStyle = 1;
    outline = 0;
    shadow = 0;
  } else {
    // 'outline'
    borderStyle = 1;
    outline = 3; // Thick black outline
    shadow = 1;  // Subtle drop shadow
  }

  // Map BackColour based on s.bgColor
  let backColor = '&H80000000'; // Default 50% opacity black
  if (s.bgColor === 'Black (70%)') {
    backColor = '&H4D000000'; // 70% opacity black
  } else if (s.bgColor === 'White (20%)') {
    backColor = '&HCCffffff'; // 20% opacity white
  } else if (s.bgColor === 'Black') {
    backColor = '&H00000000'; // 100% opaque black
  } else if (s.bgColor === 'Transparent') {
    backColor = '&HFF000000'; // 100% transparent
  }

  // Outline color: solid black for any style that renders an outline, transparent for pill (box style)
  const outColor = outline > 0 ? '&H00000000' : '&HFF000000';

  const marginV = CAPTION_BOTTOM_OFFSET_PX;
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${playResX}\nPlayResY: ${playResY}\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,${fontName},${fs},${pri},${sec},${outColor},${backColor},-1,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${align},10,10,${marginV},${encoding}\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`;

  const x = Math.round(playResX * Math.max(0, Math.min(100, s.xPos)) / 100);
  const anchor = s.position === 'top' ? 8 : 2;
  const wrapWordsForAss = (words: WordItem[]) => {
    if (!words.length) return [] as WordItem[][];
    const availableWidth = Math.max(80, playResX * 0.85);
    let measure: CanvasRenderingContext2D | null = null;
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      measure = canvas.getContext('2d');
      if (measure) measure.font = `900 ${fs}px ${fontName}`;
    }

    const lines: WordItem[][] = [];
    let line: WordItem[] = [];
    for (const word of words) {
      const testText = [...line, word].map(w => w.text).join(' ');
      const width = measure ? measure.measureText(testText).width : testText.length * fs * 0.56;
      if (line.length && width > availableWidth) {
        lines.push(line);
        line = [word];
      } else {
        line.push(word);
      }
    }
    if (line.length) lines.push(line);
    return lines;
  };
  const estimateLineCount = (words: WordItem[]) => {
    if (s.position === 'top') return 1;
    return Math.max(1, wrapWordsForAss(words).length);
  };
  const posPrefixFor = (words: WordItem[]) => {
    const y = s.position === 'top'
      ? Math.round(playResY * Math.max(0, Math.min(100, s.yPos)) / 100)
      : playResY - captionBottomSafety(fs, estimateLineCount(words));
    return `{\\an${anchor}\\pos(${x},${y})}`;
  };

  const lines = timelineCaps.flatMap(c => {
    const words: WordItem[] = normalizeDisplayedCaptionWords(c.words?.length ? c.words : c.text.trim().split(/\s+/).map((t,i,a)=>({
      text:t, start:c.start+(i/a.length)*(c.end-c.start), end:c.start+((i+1)/a.length)*(c.end-c.start)
    })));
    if (s.style === 'white-yellow' || s.style === 'karaoke') {
      const validWords = words.filter(w => w.end > w.start);
      const activeLines = validWords.map((word, activeIndex) => {
          const nextWord = validWords[activeIndex + 1];
          // Keep the current karaoke state visible until the next spoken word.
          // Ending at Whisper's very short word.end made quick words (and even
          // whole short sentences) appear to have no karaoke highlight at 25fps.
          const visibleUntil = nextWord?.start ?? c.end;
          const lineEnd = Math.max(word.start + 0.08, Math.min(visibleUntil, c.end));
          // Display the complete sentence in white, then highlight only the
          // word currently being spoken. This is standard karaoke behavior.
          const revealedWords = validWords;
          const posPrefix = posPrefixFor(revealedWords);
          let tokenCursor = 0;
          const styledText = wrapWordsForAss(revealedWords).map(line => (
            line.map((token) => {
              // Every other word remains white; only the spoken word is yellow.
              const color = tokenCursor === activeIndex ? pri : sec;
              tokenCursor += 1;
              return `{\\alpha&H00&\\1c${color}}${escapeAssText(token.text)}`;
            }).join(' ')
          )).join('\\N');
          const text = isRtlLanguage(s.language) || hasArabic
            ? `\u202B${styledText}\u202C`
            : styledText;
          return `Dialogue: 0,${toAss(word.start)},${toAss(lineEnd)},Default,,0,0,0,,${posPrefix}${text}`;
        });
      return activeLines;
    }
    // Standard styles use the same progressive reveal rule. At "I" show I;
    // at "am" show I am; at "Ali" show I am Ali—never future words.
    return words.flatMap((word, activeIndex) => {
      const nextWord = words[activeIndex + 1];
      const lineEnd = Math.max(word.start + 0.08,
        Math.min(nextWord?.start ?? c.end, c.end));
      const revealedWords = words.slice(0, activeIndex + 1);
      const text = wrapWordsForAss(revealedWords)
        .map(line => shapeCaptionText(line.map(token => token.text).join(' '), s))
        .join('\\N');
      return [`Dialogue: 0,${toAss(word.start)},${toAss(lineEnd)},Default,,0,0,0,,${posPrefixFor(revealedWords)}${text}`];
    });
  });
  return [header,...lines].join('\n');
}

export async function burnCaptions(
  file: File, caps: CaptionItem[], settings: CaptionSettings,
  onProgress: (p: number) => void,
  signal?: AbortSignal,
  videoMeta: BurnVideoMeta = {},
): Promise<{ blob?: Blob; outputPath?: string; outputFileName?: string }> {
  throwIfAborted(signal);
  
  // Try the ultra-fast native FFmpeg IPC route first
  const api = (window as any).electronAPI;
  if (api?.burnCaptions && api?.getPathForFile) {
    const videoPath = api.getPathForFile(file);
    if (videoPath) {
      onProgress(5);
      let nativeMeta: BurnVideoMeta = videoMeta;
      if ((!nativeMeta.width || !nativeMeta.height) && api?.probeVideoMeta) {
        try {
          const probed = await api.probeVideoMeta({ videoPath });
          if (probed?.ok) {
            nativeMeta = {
              width: probed.width || nativeMeta.width,
              height: probed.height || nativeMeta.height,
              duration: probed.duration || nativeMeta.duration,
            };
          }
        } catch {}
      }
      const assContent = buildAss(caps, settings, nativeMeta);

      // Listen for real FFmpeg progress events sent from main process via contextBridge.
      // Keep a gentle heartbeat too, because some FFmpeg builds/files do not emit
      // useful out_time progress until late in the burn.
      let ticker: ReturnType<typeof setInterval> | null = null;
      let shownPct = 5;

      const onRealProgress = (data: any) => {
        let progressVal = 0;
        if (typeof data === 'number') {
          progressVal = data;
        } else if (data && typeof data === 'object') {
          if (data.videoPath && data.videoPath !== videoPath) return;
          progressVal = typeof data.pct === 'number' ? data.pct : 0;
        }
        shownPct = Math.max(shownPct, Math.min(98, progressVal));
        onProgress(shownPct);
      };

      if (api?.onBurnProgress) {
        api.onBurnProgress(onRealProgress);
      }
      ticker = setInterval(() => {
        const remaining = 98 - shownPct;
        if (remaining <= 0.2) return;
        shownPct = Math.min(98, shownPct + Math.max(0.35, remaining * 0.018));
        onProgress(Math.round(shownPct));
      }, 900);

      try {
        const result = await api.burnCaptions({
          videoPath,
          sourceFileName: file.name,
          captions: caps,
          fontSize: settings.fontSize,
          position: settings.position,
          assContent,
        });
        if (ticker) clearInterval(ticker);
        if (api?.offBurnProgress) api.offBurnProgress(onRealProgress);
        if (result.ok) {
          onProgress(100);
          return { outputPath: result.outputPath, outputFileName: result.fileName };
        }
        throw new Error(result.error || 'Native burn failed');
      } catch (err: any) {
        if (ticker) clearInterval(ticker);
        if (api?.offBurnProgress) api.offBurnProgress(onRealProgress);
        console.warn('[burnCaptions] Native fast-burn failed, falling back to WASM:', err);
      }
    }
  }

  // Fallback to WASM FFmpeg
  const assContent = buildAss(caps, settings, videoMeta);
  const engine = await getFFmpeg();
  const onAbort = () => {
    try { engine.terminate(); } catch {}
    ff = null;
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  engine.on('progress', ({progress}) => {
    throwIfAborted(signal);
    onProgress(Math.round(progress*100));
  });

  async function writeFont(fileName: string, paths: string[]) {
    let fontBuf: ArrayBuffer | null = null;
    for (const path of paths) {
      try {
        const res = await fetch(path);
        if (res.ok) {
          fontBuf = await res.arrayBuffer();
          break;
        }
      } catch {}
    }
    if (fontBuf) {
      await engine.writeFile(fileName, new Uint8Array(fontBuf));
    }
  }

  // Load fonts used by caption scripts:
  // Arial: English/Latin, Nirmala UI: Hindi/Telugu/Tamil, Tahoma: Urdu/Arabic.
  try {
    await writeFont('Nirmala.ttc', ['/src/assets/Nirmala.ttc', '/Nirmala.ttc', 'Nirmala.ttc']);
  } catch (err) {
    console.error('[burnCaptions] Failed to load Nirmala.ttc:', err);
  }

  try {
    await writeFont('arial.ttf', ['/src/assets/arial.ttf', '/arial.ttf', 'arial.ttf']);
  } catch (err) {
    console.error('[burnCaptions] Failed to load arial.ttf:', err);
  }

  try {
    await writeFont('tahoma.ttf', ['/src/assets/tahoma.ttf', '/tahoma.ttf', 'tahoma.ttf']);
  } catch (err) {
    console.error('[burnCaptions] Failed to load tahoma.ttf:', err);
  }

  try {
    throwIfAborted(signal);
    await engine.writeFile('input.mp4', await fetchFile(file));
    throwIfAborted(signal);
    await engine.writeFile('caps.ass', assContent);
    throwIfAborted(signal);
    await engine.exec([
      '-i', 'input.mp4',
      '-vf', 'ass=caps.ass:fontsdir=.',
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '16',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      '-y', 'out.mp4'
    ]);
    throwIfAborted(signal);
    const data = await engine.readFile('out.mp4');
    if (!data || (data as any).length <= 0) {
      throw new Error('FFmpeg produced an empty video. Please try re-burning this file.');
    }
    return { blob: new Blob([data], { type:'video/mp4' }) };
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
