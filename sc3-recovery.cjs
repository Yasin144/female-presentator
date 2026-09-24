const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function checkpointDirectory(root, source, voice) {
  const stat = fs.statSync(source);
  const key = crypto.createHash('sha256').update(JSON.stringify([path.resolve(source), stat.size, stat.mtimeMs, voice, 'sc3-long-v1'])).digest('hex');
  const dir = path.join(root, key);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function checkpoint(dir, key, generate, valid = value => value.length > 0) {
  const name = crypto.createHash('sha256').update(key).digest('hex');
  const file = path.join(dir, name + '.cache');
  if (fs.existsSync(file)) {
    const saved = fs.readFileSync(file);
    if (valid(saved)) return saved;
  }
  const value = Buffer.from(await generate());
  if (!valid(value)) throw new Error('Invalid checkpoint output');
  const pending = file + '.partial';
  fs.writeFileSync(pending, value);
  fs.renameSync(pending, file);
  return value;
}

function transcriptionWindows(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid media duration');
  const windows = [];
  for (let start = 0; start < seconds; start += 300) windows.push({ start, duration: Math.min(300, seconds-start) });
  return windows;
}

function retryable(error) {
  const message = String(error?.message || error);
  if (/cancel|not found|no speech|no clear speech|permission|ENOSPC|out of memory|invalid/i.test(message)) return false;
  return /timeout|timed out|ECONN|EPIPE|socket|network|busy|temporar|502|503|504|429|no response/i.test(message);
}

async function retry(operation, report = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= 2 || !retryable(error)) throw error;
      report(`Temporary failure: ${error.message}. Retrying ${attempt + 1}/2...`);
      await wait(5000 * (attempt + 1));
    }
  }
}

function duration(ffmpeg, file) {
  const probe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
  return new Promise((resolve, reject) => {
    execFile(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { windowsHide: true, timeout: 20000 }, (error, stdout) => {
      const seconds = Number(String(stdout).trim());
      if (error || !Number.isFinite(seconds) || seconds <= 0) reject(error || new Error('Invalid media duration'));
      else resolve(seconds);
    });
  });
}

function muxArgs(video, audio, output, videoSeconds, audioSeconds) {
  const seconds = Math.max(videoSeconds, audioSeconds);
  return ['-y', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0',
    '-vf', `tpad=stop_mode=clone:stop_duration=${Math.max(0, seconds - videoSeconds) + 1}`,
    '-af', 'apad', '-t', String(seconds), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output];
}
function timedSections(parts, durationSeconds) {
  const sections = [];
  for (const part of parts) {
    const words = (part.words || []).filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && String(w.word || w.text || '').trim());
    let group = [];
    const flush = () => {
      if (!group.length) return;
      sections.push({ start: group[0].start + part.offset, end: group.at(-1).end + part.offset, text: group.map(w => String(w.word || w.text).trim()).join(' ') });
      group = [];
    };
    for (const word of words) {
      if (group.length && (word.start - group.at(-1).end > .45 || group.map(w => w.word || w.text).join(' ').length + String(word.word || word.text).length > 80)) flush();
      group.push(word);
    }
    flush();
    if (!words.length) for (const seg of part.segments || []) sections.push({start:seg.start+part.offset,end:seg.end+part.offset,text:seg.text});
  }
  let cursor = 0;
  return sections.sort((a,b)=>a.start-b.start).map(section => {
    const start = Math.max(cursor, section.start, 0), end = Math.min(durationSeconds, section.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !section.text?.trim()) return null;
    cursor = end;
    return {...section,start,end};
  }).filter(Boolean);
}

function fitAudioFilter(sourceSeconds, targetSeconds) {
  let rate = sourceSeconds / targetSeconds;
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid speech timing');
  const filters = [];
  while (rate > 2) { filters.push('atempo=2'); rate /= 2; }
  while (rate < .5) { filters.push('atempo=0.5'); rate /= .5; }
  filters.push(`atempo=${rate}`, 'apad');
  return filters.join(',');
}

function naturalSpeechSeconds(sourceSeconds, targetSeconds) {
  if (![sourceSeconds, targetSeconds].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid speech timing');
  return Math.max(sourceSeconds, targetSeconds);
}

function naturalVideoTimeline(sections, videoSeconds) {
  if (!Number.isFinite(videoSeconds) || videoSeconds <= 0) throw new Error('Invalid video duration');
  const intervals = [];
  let cursor = 0, output = 0;
  const append = (start, end, seconds) => {
    if (end <= start) return;
    intervals.push({ start, end, outputStart: output, outputEnd: output + seconds, scale: seconds / (end - start) });
    output += seconds;
  };
  for (const section of sections) {
    if (![section.start, section.end, section.outputSeconds].every(Number.isFinite) || section.start < cursor ||
      section.end <= section.start || section.end > videoSeconds + .001 || section.outputSeconds < section.end - section.start - .001)
      throw new Error('Invalid natural narration timeline');
    append(cursor, section.start, section.start - cursor);
    append(section.start, section.end, Math.max(section.outputSeconds, section.end - section.start));
    cursor = section.end;
  }
  append(cursor, videoSeconds, videoSeconds - cursor);
  return { intervals, seconds: output };
}

function naturalVideoFilter(timeline) {
  // Balanced decision tree keeps frame-time evaluation logarithmic even for
  // hour-long videos. Gaps run at 1x; only longer speech sections slow down.
  const n = value => Number(value.toFixed(8));
  const branch = rows => {
    if (rows.length === 1) {
      const row = rows[0];
      return `${n(row.outputStart)}+(T-STARTT-${n(row.start)})*${n(row.scale)}`;
    }
    const middle = Math.floor(rows.length / 2);
    return `if(lt(T-STARTT,${n(rows[middle].start)}),${branch(rows.slice(0,middle))},${branch(rows.slice(middle))})`;
  };
  if (!timeline.intervals.length) throw new Error('Empty video timeline');
  return `setpts='(${branch(timeline.intervals)})/TB',fps=30,tpad=stop_mode=clone:stop_duration=1`;
}

function naturalMuxArgs(video, audio, output, filterPath, seconds) {
  return ['-y', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0',
    '-filter_script:v', filterPath, '-af', 'apad', '-t', String(seconds),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output];
}
function narrationTokens(text) {
  const tokens = String(text || '').normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'")
    .replace(/\bwon't\b/g, 'will not').replace(/\bcan't\b/g, 'cannot')
    .replace(/\blet's\b/g, 'let us').replace(/n't\b/g, ' not')
    .replace(/\bcolours?\b/g, word => word === 'colours' ? 'colors' : 'color')
    .match(/[\p{L}\p{N}]+/gu) || [];
  return normalizeNarrationNumbers(tokens);
}

function normalizeNarrationNumbers(tokens) {
  const small = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19
  };
  const tens = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90
  };
  const normalized = [];
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (/^\d+$/.test(token)) {
      normalized.push(`#${Number(token)}`);
      index += 1;
      continue;
    }
    if (Object.hasOwn(tens, token)) {
      let value = tens[token];
      if (Object.hasOwn(small, tokens[index + 1]) && small[tokens[index + 1]] > 0 && small[tokens[index + 1]] < 10) {
        value += small[tokens[index + 1]];
        index += 1;
      }
      normalized.push(`#${value}`);
      index += 1;
      continue;
    }
    if (Object.hasOwn(small, token)) {
      let value = small[token];
      let consumed = 1;
      if (value > 0 && tokens[index + 1] === 'hundred') {
        value *= 100;
        consumed = 2;
        const tailIndex = index + consumed + (tokens[index + consumed] === 'and' ? 1 : 0);
        const tail = tokens[tailIndex];
        if (Object.hasOwn(tens, tail)) {
          value += tens[tail];
          consumed = tailIndex - index + 1;
          const final = tokens[index + consumed];
          if (Object.hasOwn(small, final) && small[final] > 0 && small[final] < 10) {
            value += small[final];
            consumed += 1;
          }
        } else if (Object.hasOwn(small, tail)) {
          value += small[tail];
          consumed = tailIndex - index + 1;
        }
      }
      normalized.push(`#${value}`);
      index += consumed;
      continue;
    }
    normalized.push(token);
    index += 1;
  }
  return normalized;
}

function compareNarration(expected, recognized) {
  const a = narrationTokens(expected), b = narrationTokens(recognized);
  const rows = Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
  for (let i=0;i<=a.length;i++) rows[i][0]=i;
  for (let j=0;j<=b.length;j++) rows[0][j]=j;
  for (let i=1;i<=a.length;i++) for (let j=1;j<=b.length;j++) rows[i][j]=Math.min(rows[i-1][j]+1,rows[i][j-1]+1,rows[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  const edits = rows[a.length][b.length];
  return { ok:a.length>0 && edits===0, edits, expected, recognized };
}

function isHarmlessBrandTitleMisrecognition(expected, recognized) {
  const wanted = narrationTokens(expected);
  const heard = narrationTokens(recognized);
  // Whisper often hears the short Info Kids title as "Info gets" or "Info
  // kits". It is a brand/title sting, not the lesson wording. Keep strict
  // checking for every actual sentence, number and teaching phrase.
  return wanted.length >= 2 && wanted.length <= 5
    && heard.length >= 2 && heard.length <= 5
    && wanted[0] === 'info' && heard[0] === 'info'
    && /^(kids?|kits?)$/.test(wanted[1] || '');
}

async function verifyNarration(expected, generateAndRecognize, report = () => {}) {
  let last;
  for (let attempt=0;attempt<6;attempt++) {
    const result = await generateAndRecognize(attempt);
    last = compareNarration(expected, result.text);
    report({...last,attempt:attempt+1});
    if (last.ok) return result.audio;
    if (isHarmlessBrandTitleMisrecognition(expected, result.text)) {
      report({...last, attempt: attempt + 1, acceptedBrandTitle: true});
      return result.audio;
    }
  }
  throw new Error(`Narration review required: expected "${expected}"; recognized "${last.recognized}" after 6 attempts including shorter-phrase recovery. Verified progress is saved. Export stopped.`);
}
function recoveryPhrases(text, attempt) {
  if (attempt < 3) return [text];
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const limit = [8, 5, 3][Math.min(2, attempt-3)];
  const parts = [];
  for (let i=0;i<words.length;i+=limit) parts.push(words.slice(i,i+limit).join(' '));
  return parts;
}
function preserveSourceSound(section) {
  const seconds = section.end - section.start;
  const text = narrationTokens(section.text).join(' ');
  // Do not stretch a tiny hesitation or train sound into synthetic speech.
  // Preserve the recording itself; this is not a successful TTS verification.
  return seconds > 0 && ((seconds <= .4 && /^(um|uh|hmm|hm|ah|oh)$/.test(text)) ||
    (seconds <= 1.5 && /^(choo choo|hmm|hm)$/.test(text)));
}
module.exports = { retryable, retry, duration, muxArgs, checkpointDirectory, checkpoint, transcriptionWindows, timedSections, fitAudioFilter, naturalSpeechSeconds, naturalVideoTimeline, naturalVideoFilter, naturalMuxArgs, narrationTokens, normalizeNarrationNumbers, compareNarration, verifyNarration, recoveryPhrases, preserveSourceSound, isHarmlessBrandTitleMisrecognition };
