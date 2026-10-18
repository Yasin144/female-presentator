const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const parser = require('@babel/parser');
const code = fs.readFileSync(require('node:path').join(__dirname, '..', 'script.js'), 'utf8');
const ast = parser.parse(code, { sourceType: 'script' });
function load(name, globals = {}) {
  const node = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  return vm.runInNewContext(`(${code.slice(node.start, node.end)})`, globals);
}
for (const exportingVideo of [false, true]) {
  test(`number cues follow measured audio boundaries during ${exportingVideo ? 'export' : 'playback'}`, () => {
    const state = { speaking: true, exportingVideo, activeAudio: { currentTime: 0, duration: 9 }, exportCapture: {}, narration: { syncProfile: { profile: { numberTableStartsMs: [700, 3100, 6400] } } } };
    const visible = load('getVisibleNumberTableCount', { state });
    for (const [ms, count] of [[0, 0], [699, 0], [700, 1], [3099, 1], [3100, 2], [6399, 2], [6400, 3]]) {
      state.activeAudio.currentTime = ms / 1000;
      state.exportCapture.elapsedMs = ms;
      assert.equal(visible({ start: 101, end: 103 }), count);
    }
  });
}
for (const [width, height] of [[1196, 632], [456, 872], [316, 392]]) {
  test(`all 300 cells fit inside ${width} by ${height}`, () => {
    const rectangles = [];
    const ctx = new Proxy({}, { get: (_, key) => key === 'fillRect' ? (...args) => rectangles.push(args) : () => {}, set: () => true });
    const draw = load('drawNumberTableBoard', { ctx, state: {}, getNumberTableTheme: () => ({}), getPresentationTitleText: () => '', });
    const data = load('getNumberTableData')('Number table from 999700 to 999999');
    draw({ x: 0, y: 0, width, height }, data);
    for (const [x, y, w, h] of rectangles) {
      assert.ok(x >= 0 && y >= 0 && x + w <= width && y + h <= height);
    }
    assert.ok(rectangles.length > 0);
  });
}

test('number export uses complete measured timing without speech recognition', () => {
  const getNumberTableData = load('getNumberTableData');
  const resolve = load('getMeasuredNumberTableExportProfile', { getNumberTableData });
  const profile = { units: [{}], numberTableStartsMs: [200, 2100, 4300] };
  assert.deepEqual(Array.from(resolve('Table from 301 to 303', profile, 6000).numberTableStartsMs), [200, 2100, 4300]);
  for (const starts of [[200], [200, NaN, 4300], [200, 100, 4300], [200, 2100, 7000]]) {
    assert.equal(resolve('Table from 301 to 303', { ...profile, numberTableStartsMs: starts }, 6000), null);
  }
});
for (const [step, expected] of [[2, [2,4,6,8,10,12,14,16,18,20]], [5, [5,10,15,20]], [10, [10,20]]]) {
  test(`count by ${step} narrates only its multiples and keeps the full grid`, () => {
    const getNumberTableData = load('getNumberTableData');
    const text = load('buildNumberTableLessonText')(1, 20, step);
    const table = getNumberTableData(text);
    assert.deepEqual(Array.from(table.spokenValues), expected);
    assert.equal(table.cells.flat().filter(v => v !== null).length, 20);
    assert.equal(table.cells[0][0], 1);
    assert.equal(table.cells[0][1], 2);
    assert.equal(load('getNumberTableNarrationText', { getNumberTableData })(text), expected.join('. ') + '.');
    const chunks = load('getNumberTableNarrationChunkEntries', { getNumberTableData })(text);
    assert.deepEqual(Array.from(chunks, c => c.text), expected.map(v => v + '.'));
    assert.equal(chunks.at(-1).gapAfterMs, 0);
    const state = { exportingVideo: true, exportCapture: { elapsedMs: 2500 }, narration: { syncProfile: { profile: { units: [{}], numberTableStartsMs: expected.map((_, i) => i * 2000 + 500) } } } };
    assert.equal(load('getVisibleNumberTableCount', { state })(table), 2);
    assert.ok(load('getMeasuredNumberTableExportProfile', { getNumberTableData })(text, state.narration.syncProfile.profile, 30000));
  });
}
test('skip counting starts with the first multiple in range and rejects an empty range', () => {
  const build = load('buildNumberTableLessonText');
  const parse = load('getNumberTableData');
  assert.deepEqual(Array.from(parse(build(3, 13, 5)).spokenValues), [5, 10]);
  assert.equal(build(1, 4, 5), '');
  assert.equal(parse(build(20, 1, 10)).step, 10);
  assert.equal(parse(build(1, 20)).spokenValues.length, 20);
});
test('skip counting generates every number even when glossary parsing also matches', async () => {
  const getNumberTableData = load('getNumberTableData');
  const getNumberTableNarrationChunkEntries = load('getNumberTableNarrationChunkEntries', { getNumberTableData });
  const generated = [];
  const text = load('buildNumberTableLessonText')(1, 10, 2);
  const fn = load('requestNarrationBlob', {
    Blob, requireNarrationVoiceId: v => v,
    buildNarrationText: load('getNumberTableNarrationText', { getNumberTableData }),
    getNarrationChunkConfig: () => ({ threshold: 100 }),
    getGlossaryNarrationChunkEntries: () => [{text: 'Wrong term', gapAfterMs: 0}, {text: 'Wrong definition', gapAfterMs: 0}],
    getNumberTableNarrationChunkEntries, getNumberTableData,
    getVowelsConsonantsNarrationChunkEntries: () => null, getAlphabetNarrationChunkEntries: () => null,
    EDGE_NARRATION_VOICE: 'edge', NARRATION_CHUNK_JOIN_GAP_MS: 250,
    normalizeNarrationChunkEntries: c => c,
    beginAnjaliGenerationActivity() {}, endAnjaliGenerationActivity() {}, updateTaskProgressUi() {},
    window: {setInterval: () => 1, clearInterval() {}}, clamp: (v,a,b) => Math.max(a,Math.min(b,v)),
    generateNarrationChunkWithFallback: async t => { generated.push(t); return { chunks:[t], blobs:[new Blob([t])], durations:[1000] }; },
    combineNarrationBlobs: async b => new Blob(b),
    buildSpeechSyncProfileFromChunkDurations: () => ({units:[{}],chunkStartsMs:[0,2580,5160,7740,10320]}),
    buildNarrationChunkAudibleStarts: () => [0,2580,5160,7740,10320],
  });
  let profile;
  await fn(text, 'anjali', { onSyncProfile: p => {profile = p;} });
  assert.deepEqual(generated, ['2.', '4.', '6.', '8.', '10.']);
  assert.equal(profile.numberTableStartsMs.length, 5);
});
test('export safely reuses complete skip-counting audio', async () => {
  const text = 'Number table from 1 to 10\nCount by 2';
  const getNumberTableData = load('getNumberTableData');
  const getMeasuredNumberTableExportProfile = load('getMeasuredNumberTableExportProfile', { getNumberTableData });
  const blob = new Blob(['audio']);
  const state = { narration: {blob, voice:'edge', textSource:text, durationMs:12000, syncProfile:{profile:{units:[{}],numberTableStartsMs:[0,2500,5000,7500,10000]}}} };
  const isNumberTableNarrationCurrent = load('isNumberTableNarrationCurrent', { state, getNumberTableData, getMeasuredNumberTableExportProfile });
  const fn = load('ensureAnjaliNarrationReadyForExport', { state, syncExportVoiceSelection(){}, getSelectedEdgeExportVoice:()=> 'edge', getAlphabetSayAloudData:()=>null, isNumberTableNarrationCurrent, isAudioBlobAudible:async()=>true });
  assert.equal(await fn({textSource:text}), blob);
  state.narration.durationMs = 1000;
  assert.equal(isNumberTableNarrationCurrent(text), false);
});
test('playback rejects a short skip-counting cache for every voice', () => {
  const text = 'Number table from 1 to 10\nCount by 2';
  const getNumberTableData = load('getNumberTableData');
  const getMeasuredNumberTableExportProfile = load('getMeasuredNumberTableExportProfile', {getNumberTableData});
  const state = { preferredNarrationVoice:'edge', narration:{url:'blob:test',blob:new Blob(['audio']),voice:'edge',textSource:text,durationMs:1000,source:'Generated edge narration',syncProfile:{profile:{units:[{}],numberTableStartsMs:[0,100,200,300,400]}}} };
  const isNumberTableNarrationCurrent = load('isNumberTableNarrationCurrent', {state,getNumberTableData,getMeasuredNumberTableExportProfile});
  const fn = load('hasFreshGeneratedAnjaliNarration', {state,normalizeNarrationVoiceId:v=>v,isNumberTableNarrationCurrent,getAlphabetSayAloudData:()=>null,buildNarrationText:t=>t,isNarrationDurationTooShortForText:()=>false});
  assert.equal(fn(text), false);
  state.narration.durationMs = 12000;
  state.narration.syncProfile.profile.numberTableStartsMs = [0,2500,5000,7500,10000];
  assert.equal(fn(text), true);
});
test('number names displays the reference range with correct hyphenated words', () => {
  const globals = {};
  for (const name of ['SMALL_NUMBER_WORDS', 'TENS_NUMBER_WORDS']) {
    const declaration = ast.program.body.find(n => n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
    globals[name] = vm.runInNewContext(code.slice(declaration.start, declaration.end) + `; ${name}`);
  }
  globals.convertTwoDigitNumberToWords = load('convertTwoDigitNumberToWords', globals);
  globals.convertThreeDigitNumberToWords = load('convertThreeDigitNumberToWords', globals);
  const format = load('formatNumberName', {convertIntegerToInternationalWords:load('convertIntegerToInternationalWords',globals)});
  assert.equal(format(71),'Seventy-one');
  assert.equal(format(80),'Eighty');
  assert.equal(format(81),'Eighty-one');
  assert.equal(format(90),'Ninety');
  const table = load('getNumberTableData')(load('buildNumberTableLessonText')(71,90,1,'names'));
  assert.equal(table.displayMode,'names');
  const texts = [];
  const ctx = new Proxy({}, {get:(_,key)=>key==='fillText' ? text=>texts.push(text) : ()=>{},set:()=>true});
  const state = {previewPageIndex:0};
  const draw = load('drawNumberNamesBoard',{state,ctx,getNumberNamesPageIndex:load('getNumberNamesPageIndex',{state}),formatNumberName:format});
  draw({x:0,y:0,width:1196,height:632},table);
  for(const text of ['From 71 to 80','From 81 to 90','Seventy-one','Eighty-one','Ninety']) assert.ok(texts.includes(text));
});
test('number names pages advance at the matching narrated number', () => {
  const table = load('getNumberTableData')('Number table from 1 to 100\nDisplay number names');
  const state = {speaking:true};
  let visible = 30;
  const page = load('getNumberNamesPageIndex',{state,getVisibleNumberTableCount:()=>visible});
  assert.equal(page(table),0);
  visible=31;
  assert.equal(page(table),1);
  visible=100;
  assert.equal(page(table),3);
});

test('71 to 100 displays every requested numeral and name on one page', () => {
  const table = load('getNumberTableData')('Number table from 71 to 100\nDisplay number names');
  const state = {previewPageIndex:0};
  const texts = [];
  const ctx = new Proxy({}, {get:(_,key)=>key==='fillText' ? t=>texts.push(t) : ()=>{},set:()=>true});
  load('drawNumberNamesBoard',{state,ctx,getNumberNamesPageIndex:load('getNumberNamesPageIndex',{state}),formatNumberName:v=>`name-${v}`})({x:0,y:0,width:1196,height:632},table);
  for(let value=71;value<=100;value++) {assert.ok(texts.includes(String(value)));assert.ok(texts.includes(`name-${value}`));}
  assert.ok(texts.includes('From 91 to 100'));
});
