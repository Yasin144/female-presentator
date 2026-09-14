'use strict';

// Structural contracts supplement the isolated real-renderer Home QA. These
// tests never start Electron, call a service, or load a user's document.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const input = read('src/components/InputPanel.jsx');
const stage = read('src/components/StagePanel.jsx');
const appSource = read('src/App.jsx');
const homeSource = read('src/components/StudioHome.jsx');
const harness = read('scripts/qa-simple-home.cjs');
const preload = read('scripts/qa-app-smoke-preload.cjs');
const ids = source => [...source.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);

test('the simple shell has a Home view and an explicit Back to Home control', () => {
  assert.match(appSource, /simple-studio/);
  assert.match(appSource, /studio-back-home/);
  assert.match(appSource, /Back to Home/);
});

test('Home exposes all ten named tools and five helpers without a disclosure menu', () => {
  for (const id of ['pdf', 'lesson', 'singing', 'local-captions', 'captions', 'quotes', 'exporter', 'resizer', 'translator', 'transcription', 'narration', 'speech', 'media', 'templates', 'services']) {
    assert.equal([...homeSource.matchAll(new RegExp("id: '" + id + "'", 'g'))].length, 1, 'Home destination exists once: ' + id);
  }
  assert.match(homeSource, /data-home-tool=\{tool\.id\}/);
  assert.match(homeSource, /aria-label="All tools"/);
  assert.match(homeSource, /aria-describedby=/);
  assert.doesNotMatch(homeSource, /<details|<summary|studio-sidebar/);
});

test('the simple navigation preserves PDF, song, local caption and transcription control IDs', () => {
  const actual = ids(input);
  for (const id of ['pdfSection', 'pdfInput', 'pdfVoiceSelect', 'pdfCountingDisplaySelect', 'pdfShowBtn', 'pdfPresentBtn', 'pdfRangeFromInput', 'pdfRangeToInput', 'pdfSelectRangeBtn', 'lessonContentSection', 'lessonInput', 'singSongSection', 'singSongInput', 'singSongProcessBtn', 'aiCaptionSection', 'captionVideoInput', 'captionActionBtn', 'captionExportBtn', 'audioToTextSection', 'transcribeAudioInput']) {
    assert.equal(actual.filter(value => value === id).length, 1, 'Original control remains unique: ' + id);
  }
});

test('Home navigation retains original preview and stop controls', () => {
  const actual = new Set(ids(stage));
  for (const id of ['stagePanel', 'editBtn', 'playBtn', 'pauseStageBtn', 'stopStageBtn', 'prevPageBtn', 'nextPageBtn']) assert.ok(actual.has(id), id);
});

test('Home QA runs in a fresh hidden offscreen profile without production startup', () => {
  assert.match(harness, /fs\.mkdtempSync\(/);
  assert.match(harness, /app\.setPath\('userData', profile\)/);
  assert.match(harness, /show: false/);
  assert.match(harness, /offscreen: true/);
  assert.doesNotMatch(harness, /require\(['"](?:\.\.\/)?(?:main|preload)\.cjs['"]\)/);
  assert.match(harness, /preload: path\.join\(__dirname, 'qa-app-smoke-preload\.cjs'\)/);
});

test('Home QA intercepts every network scheme and denies extra privileges', () => {
  for (const protocol of ['http', 'https']) assert.ok(harness.includes(`protocol.handle('${protocol}', mockNetwork)`));
  assert.match(harness, /'ws:\/\/\*\/\*', 'wss:\/\/\*\/\*', 'file:\/\/\*\/\*'/);
  assert.match(harness, /setPermissionRequestHandler/);
  assert.match(harness, /callback\(false\)/);
  assert.match(harness, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\(|child_process|execSync|spawn\(/);
});

test('Home QA checks desktop and narrow screen paint, overflow and all primary modules', () => {
  assert.match(harness, /width: 1440, height: 1000/);
  assert.match(harness, /width: 390, height: 844/);
  assert.match(harness, /capturePage/);
  assert.match(harness, /body has horizontal overflow/);
  for (const id of ['pdf', 'lesson', 'singing', 'local-captions', 'captions', 'quotes', 'exporter', 'resizer', 'translator', 'transcription']) assert.ok(harness.includes(`'${id}'`), id);
  assert.match(harness, /Each captured screen has distinct painted content/);
});

test('Home QA verifies native keyboard cards and unrelated module isolation', () => {
  assert.match(harness, /'BUTTON'/);
  assert.match(harness, /pressKey\('Enter'\)/);
  assert.match(harness, /no unrelated PDF, song, caption, transcription or lesson module leaks/);
  assert.match(harness, /Home has no competing sidebar/);
  assert.match(harness, /leading action is fully visible below the fixed header/);
});

test('Home QA verifies input identity, selected files and text across navigation', () => {
  assert.match(harness, /assigned without change events/);
  assert.match(harness, /sameNode:/);
  assert.match(harness, /sameFile:/);
  assert.match(harness, /lessonTextRetained:/);
  assert.match(harness, /Navigation preserves original file inputs and selected File objects/);
});

test('Home QA proves navigation does not interrupt busy preview or start processing', () => {
  assert.match(harness, /Busy preview refuses Home navigation without stopping playback/);
  assert.match(harness, /Silent preview starts no narration or export/);
  assert.match(harness, /state\.speaking = true/);
  assert.match(harness, /state\.speaking = false/);
  assert.match(harness, /Opening tools does not start presentation work/);
  assert.match(preload, /isMobileRemote: process\.argv\.includes\('--qa-mobile-remote'\)/);
  assert.match(harness, /await verifyMobileHistory\(\)/);
  assert.match(harness, /Remote browser Back\/Forward restores exact section/);
  assert.match(harness, /Mobile browser Back refuses busy preview without stopping it/);
});
