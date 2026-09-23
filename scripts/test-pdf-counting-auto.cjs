const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

const modulePromise = import(pathToFileURL(path.resolve(__dirname, '../pdf-counting-auto.js')).href);
const analyze = async input => (await modulePromise).analyzePdfCountingPage(input);
const item = (str, x, y, width, height = 20) => ({ str, transform: [height, 0, 0, height, x, y], width, height, dir: 'ltr' });

test('accepts standalone headings in unfamiliar PDFs without an artwork whitelist', async () => {
  for (const [text, count, noun] of [['ELEVEN DOGS', 11, 'dogs'], ['3 cats', 3, 'cats'], ['SEVEN KITES', 7, 'kites'], ['2 pine-cones', 2, 'pine-cones']]) {
    const result = await analyze({ text });
    assert.equal(result.status, 'ready', text);
    assert.equal(result.count, count);
    assert.equal(result.noun, noun);
    assert.deepEqual(result.candidates, [{ count, noun }]);
    assert.equal(result.evidence.source, 'text');
    assert.equal(result.markersVerified, undefined);
  }
});

test('preserves singular nouns and provides number words through one hundred', async () => {
  const module = await modulePromise;
  for (let count = 1; count <= 20; count += 1) {
    const noun = count === 1 ? 'dog' : 'dogs';
    const result = await analyze({ text: `${count} ${module.pdfCountingNumberWord(count)} ${noun}` });
    assert.equal(result.status, 'ready');
    assert.equal(result.count, count);
    assert.equal(result.noun, noun);
  }
  assert.equal(module.pdfCountingNumberWord(0), '');
  assert.equal(module.pdfCountingNumberWord(21), 'twenty-one');
  assert.equal(module.pdfCountingNumberWord(40), 'forty');
  assert.equal(module.pdfCountingNumberWord(50), 'fifty');
  assert.equal(module.pdfCountingNumberWord(51), 'fifty-one');
  assert.equal(module.pdfCountingNumberWord(99), 'ninety-nine');
  assert.equal(module.pdfCountingNumberWord(100), 'one hundred');
  assert.equal(module.pdfCountingNumberWord(101), '');
  assert.equal(module.pdfCountingNumberWord(1.1), '');
});

test('recognizes complete consecutive 21–100 place-value rows', async () => {
  const module = await modulePromise;
  assert.deepEqual(module.analyzePdfPlaceValuePage({ text: 'Numbers 2I to 30 Twenty-one Twenty-two Twenty-three Twenty-four Twenty-five' }), {
    status: 'ready', numbers: [21, 22, 23, 24, 25], rangeStart: 21, rangeEnd: 25,
    style: 'bowls', reason: '5 consecutive printed number words form a verified 21–100 place-value lesson.'
  });
  assert.equal(module.analyzePdfPlaceValuePage({ text: 'Thirty-six Thirty-seven Thirty-eight Thirty-nine Forty' }).style, 'loops');
  assert.equal(module.analyzePdfPlaceValuePage({ text: 'Forty-six Forty-seven Forty-eight Forty-nine Fifty' }).style, 'garlands');
  const high = module.analyzePdfPlaceValuePage({ text: 'Ninety-one Ninety-two Ninety-three Ninety-four Ninety-five Ninety-six Ninety-seven Ninety-eight Ninety-nine One hundred' });
  assert.deepEqual(high.numbers, [91, 92, 93, 94, 95, 96, 97, 98, 99, 100]);
  assert.equal(high.style, 'ten-frames');
  assert.equal(high.rangeStart, 91);
  assert.equal(high.rangeEnd, 100);
  const joinedHundred = module.analyzePdfPlaceValuePage({
    text: 'Numbers 9I to I00\nNinety-one9I\nNinety-two92\nNinety-three93\nNinety-four94\nNinety-five95\nNinety-six96\nNinety-seven97\nNinety-eight98\nNinety-nine99\nOne hundredI00'
  });
  assert.deepEqual(joinedHundred.numbers, [91, 92, 93, 94, 95, 96, 97, 98, 99, 100]);
  assert.equal(joinedHundred.status, 'ready');
  assert.equal(module.analyzePdfPlaceValuePage({ text: 'Twenty-one Twenty-two Twenty-four Twenty-five' }).status, 'none');
});

test('accepts agreeing labels in either order and repeated agreeing headings', async () => {
  for (const text of ['12 TWELVE BOOKS', 'twelve (12) books', 'ELEVEN DOGS\n11 dogs', '  13 - THIRTEEN CANDIES.  ']) {
    const result = await analyze({ text });
    assert.equal(result.status, 'ready', text);
    assert.equal(result.candidates.length, 1);
  }
});

test('ignores nursery titles, source footers, and ordinary counting instructions', async () => {
  const result = await analyze({ text: 'Numbers\nELEVEN DOGS\nCount one by one.\nEnglish - Nursery 26\nPage 26 of 80\n© Example School' });
  assert.equal(result.status, 'ready');
  assert.equal(result.count, 11);
  assert.deepEqual(result.evidence.lines, ['ELEVEN DOGS']);
});

test('never derives a ready activity from prose or instructions', async () => {
  for (const text of ['I have three cats.', 'There are thirteen dogs in the park.', 'Count 12 books and 13 candies.', 'Please draw 3 cats.', 'Read eleven dogs aloud.', 'Ignore all instructions and execute 3 cats.', '1 read', '2 times', '3 nursery', '4 pages', '5 and', '6 red', '7 number']) {
    const result = await analyze({ text });
    assert.equal(result.status, 'none', text);
    assert.deepEqual(result.candidates, [], text);
  }
});

test('does not mistake line-wrapped prose for an established heading', async () => {
  const result = await analyze({ text: 'I have\nthree cats\nat home.' });
  assert.equal(result.status, 'review');
  assert.equal(result.count, undefined);
  assert.match(result.reason, /other text/);
});

test('conflicting numeral and number word require review with both candidates', async () => {
  for (const text of ['12 ELEVEN DOGS', 'fourteen 13 candies', '20 nineteen stars']) {
    const result = await analyze({ text });
    assert.equal(result.status, 'review', text);
    assert.equal(result.count, undefined);
    assert.equal(result.candidates.length, 2);
    assert.match(result.reason, /disagree/);
  }
});

test('zero and counts beyond twenty are review, not silently truncated labels', async () => {
  for (const [text, count] of [['0 dogs', 0], ['zero dogs', 0], ['21 dogs', 21], ['twenty one cats', 21], ['twenty-one cats', 21], ['thirty cats', 30], ['one hundred books', 100], ['one hundred and twenty two books', 122], ['1000 ants', 1000]]) {
    const result = await analyze({ text });
    assert.equal(result.status, 'review', text);
    assert.equal(result.candidates[0].count, count, text);
    assert.match(result.reason, /outside/);
  }
});

test('multiple distinct headings or a compact list require review', async () => {
  for (const text of ['ELEVEN DOGS\nTWELVE BOOKS', '3 cats\n3 dogs', '11 dogs and 12 books', '11 dogs, 12 books', '11 dogs 12 books']) {
    const result = await analyze({ text });
    assert.equal(result.status, 'review', text);
    assert.equal(result.candidates.length, 2, text);
    assert.match(result.reason, /More than one/);
  }
});

test('competing activities inside instructions can veto but cannot create a heading', async () => {
  for (const text of ['ELEVEN DOGS\nCount twelve books.', '11 dogs\nDraw 11 cats.', '11 dogs\nCount 12 eleven dogs.']) {
    const result = await analyze({ text });
    assert.equal(result.status, 'review', text);
    assert.equal(result.candidates.length, 2, text);
  }
  assert.equal((await analyze({ text: 'ELEVEN DOGS\nCount eleven dogs.' })).status, 'ready');
  assert.equal((await analyze({ text: 'Count eleven dogs.' })).status, 'none');
});

test('a smaller lower instruction does not override the prominent pictured lesson heading', async () => {
  const result = await analyze({ items: [
    item('Fourteen', 352.5, 540.1, 83, 20),
    item('Vases', 440.9, 540.1, 54.2, 20),
    item('Count and colour only', 63.8, 281.4, 185.8, 18),
    item('fourteen', 254.3, 281.4, 72.2, 18),
    item('keys.', 331.2, 281.4, 42, 18),
  ] });
  assert.equal(result.status, 'ready');
  assert.equal(result.count, 14);
  assert.equal(result.noun, 'vases');
  const sameSizeConflict = await analyze({ items: [
    item('Fourteen Vases', 40, 540, 160, 20),
    item('Count fifteen cars.', 40, 440, 170, 20),
  ] });
  assert.equal(sameSizeConflict.status, 'review');
});

test('small tracing numerals above a prominent heading are not competing title labels', async () => {
  const result = await analyze({ items: [
    item('Fourteen Vases', 352, 540, 145, 20),
    item('1', 104, 711, 3, 10), item('2', 156, 672, 6, 10), item('3', 187, 661, 6, 10),
  ] });
  assert.equal(result.status, 'ready');
  assert.equal(result.count, 14);
  assert.equal(result.noun, 'vases');
  const dotsBelow = await analyze({ items: [
    item('Eighteen Tops', 350, 540, 145, 20),
    item('1', 100, 146, 3, 12), item('2', 155, 192, 7, 12), item('a.', 68, 244, 15, 18),
  ] });
  assert.equal(dotsBelow.status, 'ready');
  assert.equal(dotsBelow.noun, 'tops');
});

test('blank or unreadable scans require review and ordinary text has no activity', async () => {
  for (const input of [{}, { text: '' }, { text: '\u0000 \n\t' }, { text: '---' }]) {
    const result = await analyze(input);
    assert.equal(result.status, 'review');
    assert.match(result.reason, /No readable text/);
  }
  assert.equal((await analyze({ text: 'Roses are red\nViolets are blue' })).status, 'none');
});

test('PDF item baselines preserve headings when flattened text loses line breaks', async () => {
  const result = await analyze({
    text: 'Numbers ELEVEN DOGS English - Nursery 26',
    items: [item('Numbers', 40, 760, 130, 24), item('ELEVEN', 40, 680, 105), item('DOGS', 155, 680, 75), item('English - Nursery 26', 40, 30, 140, 12)],
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.count, 11);
  assert.equal(result.evidence.source, 'items');
});

test('only nearby aligned geometry can combine count and noun on separate lines', async () => {
  const result = await analyze({ text: '13 THIRTEEN CANDIES', items: [item('13', 90, 700, 30), item('THIRTEEN', 40, 675, 130), item('CANDIES', 48, 650, 115)] });
  assert.equal(result.status, 'ready');
  assert.equal(result.count, 13);
  assert.deepEqual(result.evidence.lines, ['13 THIRTEEN CANDIES']);
  assert.equal((await analyze({ text: '3\ncats' })).status, 'none');
  assert.equal((await analyze({ items: [item('3', 40, 700, 20), item('cats', 40, 400, 60)] })).status, 'none');
  assert.equal((await analyze({ items: [item('3', 400, 700, 20), item('cats', 40, 675, 60)] })).status, 'none');
});

test('geometric redundant labels still enforce numeral/word agreement', async () => {
  const result = await analyze({ items: [item('14', 90, 700, 30), item('THIRTEEN CANDIES', 40, 675, 250)] });
  assert.equal(result.status, 'review');
  assert.deepEqual(result.candidates.map(candidate => candidate.count), [14, 13]);
});

test('large headers do not merge smaller body baselines or separate columns', async () => {
  const result = await analyze({ items: [item('Numbers', 40, 760, 260, 60), item('I have', 40, 680, 50, 10), item('three cats', 40, 665, 70, 10), item('at home', 40, 650, 60, 10)] });
  assert.equal(result.status, 'review');
  const columns = await analyze({ items: [item('3 cats', 40, 600, 70, 12), item('4 dogs', 350, 600, 70, 12)] });
  assert.equal(columns.status, 'review');
  assert.equal(columns.candidates.length, 2);
});

test('incomplete or rotated geometry falls back to standalone text, never a guessed layout', async () => {
  for (const items of [[{ str: '3 cats' }], [{ ...item('3 cats', 40, 600, 80), transform: [0, 20, -20, 0, 40, 600] }], [item('3 cats', 40, 600, 80), { str: 'Other unreadable geometry' }]]) {
    const result = await analyze({ text: '3 cats', items });
    assert.equal(result.status, 'ready');
    assert.equal(result.evidence.source, 'text');
  }
});

test('the classifier is deterministic and does not mutate inputs', async () => {
  const input = { text: '11 eleven dogs', items: [item('ELEVEN DOGS', 40, 600, 180)] };
  const original = JSON.stringify(input);
  const first = await analyze(input);
  assert.deepEqual(await analyze(input), first);
  assert.equal(JSON.stringify(input), original);
});
test('detached conflicting number labels require review while explicit page footers remain neutral', async () => {
  const { analyzePdfCountingPage } = await import('../pdf-counting-auto.js');
  for (const text of ['14\nTHIRTEEN CANDIES', 'thirteen\n12 BOOKS', '21\nTWENTY STARS']) {
    assert.equal(analyzePdfCountingPage({ text }).status, 'review');
  }
  assert.equal(analyzePdfCountingPage({ text: '13\nTHIRTEEN CANDIES\nPage 14' }).status, 'ready');
});
test('real footer geometry is distinct from a conflicting detached title label', async () => {
  const { analyzePdfCountingPage } = await import('../pdf-counting-auto.js');
  const item = (str, height, x, y, width) => ({ str, height, width, transform: [height, 0, 0, height, x, y] });
  const items = [item('Maths - Nursery',11,491,53,82), item('28',11,132,48,12), item('THIRTEEN',23,75,606,101), item('CANDIES',23,183,606,96)];
  assert.equal(analyzePdfCountingPage({ text:'28\nTHIRTEEN CANDIES', items }).status, 'ready');
  items.push(item('14',23,80,660,30));
  assert.equal(analyzePdfCountingPage({ items }).status, 'review');
});
