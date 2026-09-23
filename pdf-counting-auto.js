// This module only classifies extracted PDF text. It never follows document
// instructions, selects artwork, or grants permission to label source objects.
const NUMBER_WORDS = Object.freeze([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty',
]);
const EXTENDED_NUMBER_WORDS = Object.freeze([
  ...NUMBER_WORDS,
  'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five',
  'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine', 'thirty',
  'thirty-one', 'thirty-two', 'thirty-three', 'thirty-four', 'thirty-five',
  'thirty-six', 'thirty-seven', 'thirty-eight', 'thirty-nine', 'forty',
  'forty-one', 'forty-two', 'forty-three', 'forty-four', 'forty-five',
  'forty-six', 'forty-seven', 'forty-eight', 'forty-nine', 'fifty',
  'fifty-one', 'fifty-two', 'fifty-three', 'fifty-four', 'fifty-five',
  'fifty-six', 'fifty-seven', 'fifty-eight', 'fifty-nine', 'sixty',
  'sixty-one', 'sixty-two', 'sixty-three', 'sixty-four', 'sixty-five',
  'sixty-six', 'sixty-seven', 'sixty-eight', 'sixty-nine', 'seventy',
  'seventy-one', 'seventy-two', 'seventy-three', 'seventy-four', 'seventy-five',
  'seventy-six', 'seventy-seven', 'seventy-eight', 'seventy-nine', 'eighty',
  'eighty-one', 'eighty-two', 'eighty-three', 'eighty-four', 'eighty-five',
  'eighty-six', 'eighty-seven', 'eighty-eight', 'eighty-nine', 'ninety',
  'ninety-one', 'ninety-two', 'ninety-three', 'ninety-four', 'ninety-five',
  'ninety-six', 'ninety-seven', 'ninety-eight', 'ninety-nine', 'one hundred',
]);
const WORD_VALUES = new Map(NUMBER_WORDS.map((word, value) => [word, value]));
const TENS = new Map([
  ['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50],
  ['sixty', 60], ['seventy', 70], ['eighty', 80], ['ninety', 90],
]);
const NON_NOUNS = new Set((
  'a an the and or but of in on at to from for with by into over under as ' +
  'is are was were be been being am has have had do does did can could will would should ' +
  'i you he she it we they me us them my your his her its our their ' +
  'this that these those each all any some more less other another same many much ' +
  'count counts counting read reads reading write writes writing draw draws drawing ' +
  'say says saying speak speaks speaking look looks looking see sees seeing ' +
  'trace traces tracing colour colours colouring color colors coloring ' +
  'add adds adding subtract subtracts subtracting match matches matching ' +
  'circle circles circling tick ticks ticking find finds finding learn learns learning ' +
  'show shows showing select selects selecting click clicks clicking ' +
  'run runs running jump jumps jumping eat eats eating go goes going get gets getting ' +
  'take takes taking make makes making put puts putting open opens opening ' +
  'close closes closing listen listens listening repeat repeats repeating ' +
  'delete deletes deleting remove removes removing install installs installing ' +
  'upload uploads uploading download downloads downloading send sends sending ' +
  'execute executes executing ignore ignores ignoring save saves saving ' +
  'export exports exporting follow follows following move moves moving ' +
  'page pages nursery class classes grade grades lesson lessons chapter chapters ' +
  'unit units volume volumes part parts exercise exercises question questions ' +
  'activity activities section sections worksheet worksheets number numbers ' +
  'time times once twice first second third fourth fifth last next previous ' +
  'english maths math mathematics hindi science answer answers total totals ' +
  'hundred hundreds thousand thousands million millions billion billions ' +
  'point points plus minus equals equal divided multiplied percent ' +
  'red blue green yellow big small little large happy sad aloud together again'
).split(/\s+/));
for (const word of [...WORD_VALUES.keys(), ...TENS.keys()]) NON_NOUNS.add(word);

export function pdfCountingNumberWord(count) {
  return Number.isInteger(count) && count >= 1 && count <= 100 ? EXTENDED_NUMBER_WORDS[count] : '';
}

// The LKG 21–100 pages are place-value lists, not single-object headings. Use
// the printed number words as the trustworthy signal because the decorative
// font often extracts 1 as I (for example, 21 becomes 2I).
export function analyzePdfPlaceValuePage({ text = '' } = {}) {
  const normalized = cleanLine(text).toLowerCase().replace(/[–—]/g, '-');
  const numbers = [];
  for (let value = 21; value <= 100; value += 1) {
    const word = EXTENDED_NUMBER_WORDS[value];
    const pattern = new RegExp(`(?:^|[^a-z-])${word.replace('-', '[-\\s]')}(?=$|[^a-z-])`, 'i');
    if (pattern.test(normalized)) numbers.push(value);
  }
  const expectedLength = numbers[0] >= 51 ? 10 : 5;
  if (![5, 10].includes(numbers.length)
      || numbers.length !== expectedLength
      || numbers.some((value, index) => index && value !== numbers[index - 1] + 1)) {
    return { status: 'none', reason: 'No complete consecutive place-value list from 21 to 100 was found.', numbers: [] };
  }
  const tens = Math.floor(numbers[0] / 10);
  if (numbers.some(value => Math.floor(value / 10) !== tens && value % 10 !== 0)) {
    return { status: 'review', reason: 'The number list crosses an unexpected place-value boundary.', numbers };
  }
  return {
    status: 'ready', numbers,
    rangeStart: numbers[0], rangeEnd: numbers.at(-1),
    style: numbers[0] >= 51 ? 'ten-frames' : numbers[0] < 31 ? 'bowls' : numbers[0] < 41 ? 'loops' : 'garlands',
    reason: `${numbers.length} consecutive printed number words form a verified 21–100 place-value lesson.`
  };
}

function cleanLine(value) {
  return String(value ?? '').normalize('NFKC').replace(/\u0000/g, '')
    .replace(/[\t\f\v ]+/g, ' ').trim();
}

function headingTokens(text) {
  return cleanLine(text).toLowerCase().replace(/[.!:]$/, '')
    .replace(/[()[\]]/g, ' ').replace(/\s+[-–—]\s+/g, ' ')
    .trim().split(/\s+/).filter(Boolean);
}

function readNumber(tokens, start) {
  const token = tokens[start];
  if (/^\d+$/.test(token || '')) {
    const value = Number(token);
    return Number.isSafeInteger(value) ? { value, length: 1 } : null;
  }
  // Hyphenated number words are a single label, not two disagreeing labels.
  if (token?.includes('-')) {
    const parts = token.split('-');
    const number = readNumber(parts, 0);
    return number && number.length === parts.length ? { value: number.value, length: 1 } : null;
  }
  const first = WORD_VALUES.get(token) ?? TENS.get(token);
  if (first === undefined) return null;
  let value = first;
  let length = 1;
  if (first >= 1 && first <= 9 && tokens[start + 1] === 'hundred') {
    value *= 100;
    length += 1;
    const next = tokens[start + length] === 'and' ? length + 1 : length;
    const remainder = readNumber(tokens, start + next);
    if (remainder && remainder.value < 100) {
      value += remainder.value;
      length = next + remainder.length;
    }
  } else if (TENS.has(token)) {
    const units = WORD_VALUES.get(tokens[start + 1]);
    if (units >= 1 && units <= 9) {
      value += units;
      length += 1;
    }
  }
  return { value, length };
}

function isNoun(word) {
  return typeof word === 'string' && /^[\p{L}]{2,}(?:-[\p{L}]{2,})*$/u.test(word)
    && !NON_NOUNS.has(word);
}

function parseHeading(text) {
  const tokens = headingTokens(text);
  const noun = tokens.at(-1);
  if (tokens.length < 2 || tokens.length > 10 || !isNoun(noun)) return null;
  const labels = [];
  for (let index = 0; index < tokens.length - 1;) {
    const number = readNumber(tokens, index);
    if (!number || index + number.length > tokens.length - 1) return null;
    labels.push(number.value);
    index += number.length;
  }
  return labels.length ? { noun, labels, count: labels[0], text: cleanLine(text) } : null;
}

function isOnlyNumber(text) {
  const tokens = headingTokens(text);
  if (!tokens.length) return false;
  for (let index = 0; index < tokens.length;) {
    const number = readNumber(tokens, index);
    if (!number) return false;
    index += number.length;
  }
  return true;
}

function compactActivityList(text) {
  // Recognize only a complete list, never harvest an activity from prose.
  const tokens = cleanLine(text).toLowerCase().replace(/[.!]$/, '')
    .replace(/[,;/&]/g, ' and ').split(/\s+/).filter(Boolean);
  const headings = [];
  let start = 0;
  while (start < tokens.length && headings.length < 10) {
    if (tokens[start] === 'and' && headings.length) start += 1;
    let match = null;
    for (let end = Math.min(tokens.length, start + 10); end > start + 1; end -= 1) {
      const heading = parseHeading(tokens.slice(start, end).join(' '));
      if (heading) { match = { heading, end }; break; }
    }
    if (!match) return [];
    headings.push(match.heading);
    start = match.end;
  }
  return start === tokens.length && headings.length > 1 ? headings : [];
}

function geometryLines(items) {
  if (!Array.isArray(items)) return null;
  const readable = items.filter(item => cleanLine(item?.str));
  const records = readable.flatMap(item => {
    const transform = item.transform;
    if (!Array.isArray(transform) || transform.length < 6) return [];
    const [a, b, c, d, x, y] = transform.map(Number);
    const height = Math.abs(Number(item.height)) || Math.hypot(c, d);
    const width = Math.abs(Number(item.width));
    if (![a, b, c, d, x, y, height, width].every(Number.isFinite) || height <= 0 || width <= 0) return [];
    // Rotated text and right-to-left text need a separate layout interpretation.
    if (Math.abs(b) > Math.abs(a) * 0.2 || Math.abs(c) > Math.abs(d) * 0.2 || item.dir === 'rtl') return [];
    return [{ text: cleanLine(item.str), x, y, width, height }];
  });
  if (!records.length || records.length !== readable.length) return null;
  const rows = [];
  for (const item of records.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find(value => Math.abs(value.y - item.y) <= Math.max(1, Math.min(value.height, item.height) * 0.35));
    if (row) {
      row.items.push(item);
      row.height = Math.max(row.height, item.height);
    } else rows.push({ y: item.y, height: item.height, items: [item] });
  }
  const lines = [];
  for (const row of rows) {
    let line = null;
    for (const item of row.items.sort((a, b) => a.x - b.x)) {
      const gap = line ? item.x - (line.x + line.width) : Infinity;
      if (!line || gap > Math.max(18, Math.min(line.height, item.height) * 3)) {
        line = { ...item };
        lines.push(line);
      } else {
        const separator = gap > Math.min(line.height, item.height) * 0.08 ? ' ' : '';
        line.text = cleanLine(line.text + separator + item.text);
        line.width = Math.max(line.width, item.x + item.width - line.x);
        line.height = Math.max(line.height, item.height);
      }
    }
  }
  return lines;
}

function nearbyAligned(first, second) {
  const verticalGap = first.y - second.y;
  if (verticalGap <= 0 || verticalGap > Math.max(first.height, second.height) * 1.7) return false;
  const overlap = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const centerGap = Math.abs(first.x + first.width / 2 - second.x - second.width / 2);
  return overlap > Math.min(first.width, second.width) * 0.4 || centerGap <= Math.min(first.height, second.height);
}

function isNeutralContext(text) {
  const line = cleanLine(text).toLowerCase();
  return !line || isOnlyNumber(line)
    || /^(?:numbers?|counting|counting time|maths?|mathematics|english|nursery|kindergarten)(?:\b[^.!?]*)?$/.test(line)
    || /^(?:pdf\s+)?page\s*\d+(?:\s*(?:of|\/)\s*\d+)?$/.test(line)
    || /^(?:volume|chapter|unit|lesson|class|grade|semester)\s*[-: ]*\d+\b/.test(line)
    || /^(?:count|look|say|read|trace|write|draw|colou?r|circle|match|tick|learn|practice|listen|repeat|how many|let us|let's)\b/.test(line)
    || /^(?:©|copyright\b|all rights reserved\b|https?:\/\/|www\.)/.test(line);
}

function contextualHeadings(text) {
  // These matches can veto an already found heading, but can never create a
  // ready activity. For example, "ELEVEN DOGS / Count twelve books" is unsafe.
  const line = cleanLine(text).toLowerCase();
  if (/^(?:©|copyright\b|all rights reserved\b|https?:\/\/|www\.|(?:pdf\s+)?page\b|english\b|nursery\b|volume\b|chapter\b|unit\b|lesson\b|class\b|grade\b|semester\b)/.test(line)) return [];
  const tokens = line.split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
  const headings = [];
  for (let start = 0; start < tokens.length - 1; start += 1) {
    if (!readNumber(tokens, start)) continue;
    for (let end = Math.min(tokens.length, start + 10); end > start + 1; end -= 1) {
      const heading = parseHeading(tokens.slice(start, end).join(' '));
      if (heading) {
        headings.push(heading);
        start = end - 1;
        break;
      }
    }
  }
  return headings;
}

function candidateKey(candidate) {
  return `${candidate.count}:${candidate.noun}`;
}

export function analyzePdfCountingPage({ text = '', items = [] } = {}) {
  const textLines = String(text ?? '').split(/\r\n?|\n/).map(cleanLine).filter(Boolean);
  const geometry = geometryLines(items);
  const lines = geometry || textLines.map(line => ({ text: line }));
  const evidence = { source: geometry ? 'items' : 'text', lines: [] };
  if (!lines.some(line => /[\p{L}\p{N}]/u.test(line.text))) {
    return { status: 'review', reason: 'No readable text; this page may need OCR or manual review.', candidates: [], evidence };
  }
  const headings = [];
  const consumed = new Set();
  let multipleOnOneLine = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (consumed.has(index)) continue;
    const line = lines[index];
    let heading = parseHeading(line.text);
    // A separately positioned count label can be joined only to nearby aligned
    // text. Text-only input never guesses relationships across line breaks.
    if (geometry && isOnlyNumber(line.text)) {
      let combined = line.text;
      for (let end = index + 1; end <= Math.min(index + 2, lines.length - 1); end += 1) {
        if (!nearbyAligned(lines[end - 1], lines[end])) break;
        combined += ` ${lines[end].text}`;
        const merged = parseHeading(combined);
        if (merged) {
          heading = merged;
          for (let used = index + 1; used <= end; used += 1) consumed.add(used);
          break;
        }
        if (!isOnlyNumber(lines[end].text)) break;
      }
    }
    if (heading) {
      headings.push(heading);
      consumed.add(index);
      evidence.lines.push(heading.text);
    } else {
      const list = compactActivityList(line.text);
      if (list.length) {
        headings.push(...list);
        consumed.add(index);
        evidence.lines.push(line.text);
        multipleOnOneLine = true;
      }
    }
  }
  const standaloneHeadingLines = geometry ? lines.filter((_, index) => consumed.has(index)) : [];
  const prominentHeading = standaloneHeadingLines.length === 1 ? standaloneHeadingLines[0] : null;
  const isVisuallySecondaryInstruction = line => Boolean(geometry && prominentHeading
    && /^(?:count|join|trace|write|draw|colou?r|circle|match|tick)\b/i.test(line.text)
    && line.height <= prominentHeading.height * .95
    && prominentHeading.y - line.y >= prominentHeading.height * 4);
  const isVisuallySecondaryExerciseMark = line => Boolean(geometry && prominentHeading
    && Math.abs(prominentHeading.y - line.y) >= prominentHeading.height * 4
    && (line.height <= prominentHeading.height * .65
      || (/^[a-z]\.$/i.test(line.text) && line.height <= prominentHeading.height * .95)));
  // A large, standalone activity title above a smaller instruction block is
  // the lesson heading. The instruction may mention another set to colour or
  // tick, but it must not override the pictured title object.
  const contextHeadings = headings.length ? lines.flatMap((line, index) =>
    consumed.has(index) || isVisuallySecondaryInstruction(line) ? [] : contextualHeadings(line.text)) : [];
  const allHeadings = [...headings, ...contextHeadings];
  const candidates = [...new Map(allHeadings.flatMap(heading => heading.labels.map(count => {
    const candidate = { count, noun: heading.noun };
    return [candidateKey(candidate), candidate];
  }))).values()];
  const review = reason => ({ status: 'review', reason, candidates, evidence });
  if (!headings.length) {
    return { status: 'none', reason: 'No standalone count-and-object heading was found.', candidates: [], evidence };
  }
  if (allHeadings.some(heading => new Set(heading.labels).size > 1)) {
    return review('The numeral and number word disagree. Confirm the intended count.');
  }
  if (allHeadings.some(heading => heading.count < 1 || heading.count > 20)) {
    return review('The heading contains a count outside the supported range of 1 to 20.');
  }
  if (multipleOnOneLine || candidates.length > 1) {
    return review('More than one counting activity was found. Choose one count and object.');
  }
  // A detached numeral is still evidence. Do not silently choose THIRTEEN
  // over a separate 14 merely because the labels were on different lines.
  // Explicit "Page 14" footers are neutral; ambiguous bare numbers need review.
  const headingLines = geometry ? lines.filter((_, index) => consumed.has(index)) : [];
  const headingHeight = Math.max(0, ...headingLines.map(line => line.height));
  const lowestHeading = Math.min(Infinity, ...headingLines.map(line => line.y));
  const lowestText = geometry ? Math.min(...lines.map(line => line.y)) : 0;
  const isGeometricFooterNumber = line => geometry && line.height <= headingHeight * .65
    && line.y < lowestHeading - headingHeight * 4 && line.y <= lowestText + line.height * 2
    && lines.some(other => other !== line && Math.abs(other.y - line.y) <= line.height
      && other.height <= headingHeight * .65
      && /^(?:maths?\s*[-–—]|english\s*[-–—]|nursery\b|kindergarten\b|©|copyright\b|all rights reserved\b|https?:\/\/|www\.|(?:pdf\s+)?page\b)/i.test(other.text));
  const detachedNumbers = lines.flatMap((line, index) => {
    if (consumed.has(index) || !isOnlyNumber(line.text)) return [];
    // A small bottom number aligned with explicit footer text is not a title
    // label. This decision requires geometry; bare text alone stays uncertain.
    if (isGeometricFooterNumber(line)) return [];
    // Small tracing samples above a prominent count-and-object heading belong
    // to the writing exercise, not to the pictured lesson title.
    if (isVisuallySecondaryExerciseMark(line)) return [];
    const tokens = headingTokens(line.text), values = [];
    for (let start = 0; start < tokens.length;) {
      const number = readNumber(tokens, start);
      values.push(number.value); start += number.length;
    }
    return values;
  });
  if (detachedNumbers.some(value => value !== candidates[0]?.count)) {
    return review('A separate number conflicts with the counting heading. Confirm it is not a page number or another activity.');
  }
  if (lines.some((line, index) => !consumed.has(index) && !isNeutralContext(line.text)
      && !isVisuallySecondaryInstruction(line) && !isVisuallySecondaryExerciseMark(line))) {
    return review('A possible heading appears with other text; confirm it is a counting activity.');
  }
  const [{ count, noun }] = candidates;
  return { status: 'ready', count, noun, reason: 'One consistent standalone counting heading was found.', candidates, evidence };
}
