'use strict';

// Retained control contracts supplement qa-simple-home.cjs, which loads
// and paints the actual built app in an isolated Electron profile.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const input = read('src/components/InputPanel.jsx');
const stage = read('src/components/StagePanel.jsx');
const appSource = read('src/App.jsx');
const homeSource = read('src/components/StudioHome.jsx');
const harness = read('scripts/qa-simple-home.cjs');
const preload = read('scripts/qa-app-smoke-preload.cjs');
const ids = source => [...source.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);

test('the simplified shell keeps named core workspaces and starts at Home', () => {
  assert.match(appSource, /className="classic-studio simple-studio"/);
  assert.match(appSource, /\[currentModule, setCurrentModule\] = useState\('home'\)/);
  assert.match(homeSource, /aria-label="All tools"/);
  for (const label of ['PDF Presenter', 'Quote Studio', 'My Exporter', 'Video Resizer']) assert.ok(homeSource.includes(label));
  for (const workspace of ['home', 'presentator', 'quotes', 'exporter', 'resizer']) assert.ok(appSource.includes(`data-workspace="${workspace}"`));
});

test('Home replaces the drawer with a named return action and keyboard-accessible tool cards', () => {
  assert.match(appSource, /className="studio-back-home" type="button" onClick=\{backToHome\}/);
  assert.match(homeSource, /data-home-tool=\{tool\.id\}/);
  assert.doesNotMatch(appSource, /className="studio-sidebar"|setSidebarOpen/);
  assert.match(appSource, /homeCardRef\.current/);
  assert.match(appSource, /e\.key === 'Escape'/);
  assert.match(appSource, /event\.key !== 'Tab'/);
});

test('command search keeps its dialog and text input accessible', () => {
  assert.match(appSource, /role="dialog" aria-modal="true" aria-label="Find a tool or action"/);
  assert.match(appSource, /aria-label="Search tools and actions"/);
  assert.match(appSource, /e\.key === 'ArrowDown'/);
  assert.match(appSource, /e\.key === 'Enter'/);
});

test('lesson preparation retains the legacy engine control IDs', () => {
  const actual = new Set(ids(input));
  for (const id of ['inputPanel', 'subjectSelect', 'lessonInput', 'showScreenBtn', 'resetInputsBtn', 'themeToggle', 'themeSelect', 'templateWorkflowSection', 'lessonContentSection']) {
    assert.ok(actual.has(id), 'Missing legacy input ID: ' + id);
  }
});

test('PDF preview, local preparation, page selection, and narration controls remain wired', () => {
  const actual = new Set(ids(input));
  for (const id of ['pdfSection', 'pdfInput', 'pdfVoiceSelect', 'pdfCountingDisplaySelect', 'pdfCountingPictureInput', 'pdfCountingPictureSave', 'pdfShowBtn', 'pdfPresentBtn', 'pdfPageList', 'pdfRangeFromInput', 'pdfRangeToInput', 'pdfSelectRangeBtn', 'pdfSelectAllBtn', 'pdfClearSelectionBtn', 'pdfStatus']) {
    assert.ok(actual.has(id), 'Missing PDF ID: ' + id);
  }
});

test('stage retains its playback, stop, edit, and page-navigation controls', () => {
  const actual = new Set(ids(stage));
  for (const id of ['stagePanel', 'editBtn', 'playBtn', 'pauseStageBtn', 'stopStageBtn', 'prevPageBtn', 'nextPageBtn', 'stagePlaybackSpeedSelect', 'stageImageUploadBtn', 'stageVideoUploadBtn']) {
    assert.ok(actual.has(id), 'Missing stage ID: ' + id);
  }
});

test('the redesign adds no duplicate static engine IDs within or across panels', () => {
  for (const source of [input, stage]) {
    const panelIds = ids(source);
    assert.equal(new Set(panelIds).size, panelIds.length, 'Duplicate ID inside one panel');
  }
  const all = [...ids(input), ...ids(stage)];
  const duplicates = all.filter((id, index) => all.indexOf(id) !== index);
  // Existing mirrored intro/poster controls predate this presentation-only
  // redesign. The visual refresh must not create any additional duplicates.
  const existingMirrors = new Set(['introClipEnabled', 'introClipStatus', 'introPosterUploadBtn', 'introPosterInput', 'introPosterStatus']);
  assert.deepEqual(duplicates.filter(id => !existingMirrors.has(id)), []);
});

test('the visual QA uses a fresh hidden profile instead of the running app', () => {
  assert.match(harness, /fs\.mkdtempSync\(/);
  assert.match(harness, /app\.setPath\('userData', profile\)/);
  assert.match(harness, /show: false/);
  assert.match(harness, /offscreen: true/);
  assert.doesNotMatch(harness, /require\(['"](?:\.\.\/)?(?:main|preload)\.cjs['"]\)/);
});

test('the visual QA intercepts network and denies extra browser privileges', () => {
  for (const protocol of ['http', 'https']) assert.ok(harness.includes(`protocol.handle('${protocol}', mockNetwork)`));
  assert.match(harness, /'ws:\/\/\*\/\*', 'wss:\/\/\*\/\*', 'file:\/\/\*\/\*'/);
  assert.match(harness, /setPermissionRequestHandler/);
  assert.match(harness, /callback\(false\)/);
  assert.match(harness, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
});

test('the visual QA reuses only a stubbed test bridge', () => {
  assert.match(harness, /preload: path\.join\(__dirname, 'qa-app-smoke-preload\.cjs'\)/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\(/);
  assert.doesNotMatch(preload, /child_process|execSync|spawn\(/);
  assert.match(preload, /canceled: true/);
});

test('visual QA includes desktop and narrow screen paint and overflow assertions', () => {
  assert.match(harness, /width: 1440, height: 1000/);
  assert.match(harness, /width: 390, height: 844/);
  assert.match(harness, /capturePage/);
  assert.match(harness, /body has horizontal overflow/);
  assert.match(harness, /Each captured screen has distinct painted content/);
});

test('all retained preparation modules have one discoverable tool entry', async () => {
  const { PREPARATION_TOOLS } = await import(pathToFileURL(path.join(root, 'src/studioTools.mjs')).href);
  assert.ok(Array.isArray(PREPARATION_TOOLS), 'Focused preparation tools retain a shared inventory');
  const toolIds = PREPARATION_TOOLS.map(tool => tool.id);
  assert.equal(new Set(toolIds).size, toolIds.length, 'Tool IDs are unique');
  const actual = new Set(ids(input));
  for (const id of ['singSongSection', 'aiCaptionSection', 'audioToTextSection', 'speechToolsSection', 'narrationSection', 'mediaSection', 'templateWorkflowSection', 'serverControlsSection', 'lessonContentSection', 'pdfSection']) {
    assert.ok(toolIds.includes(id), 'Missing retained module link: ' + id);
    assert.ok(actual.has(id), 'The linked original module still exists: ' + id);
  }
  assert.equal(PREPARATION_TOOLS.find(tool => tool.id === 'singSongSection').label, 'Sing Song');
  assert.equal(PREPARATION_TOOLS.find(tool => tool.id === 'aiCaptionSection').label, 'AI Captioning (Local)');
});

test('Home cards open mounted tools rather than replacing protected controls', () => {
  assert.match(appSource, /<StudioHome onOpen=\{openHomeTool\}/);
  assert.match(appSource, /openLessonTool\(tool\.target\)/);
  assert.match(homeSource, /data-home-tool=/);
  assert.match(appSource, /PREPARATION_TOOLS/);
  assert.match(appSource, /data-section=\{activeLessonTool\}/);
  for (const id of ['singSongInput', 'sc3VideoInput', 'singSongProcessBtn', 'captionVideoInput', 'captionActionBtn', 'captionExportBtn']) {
    assert.equal(ids(input).filter(actual => actual === id).length, 1, 'Protected original control remains unique: ' + id);
  }
});

test('module access visual checks verify original data retention and safe preview navigation', () => {
  assert.match(harness, /verifyNavigationFixtures\(\)/);
  assert.match(harness, /verifyPreviewSafety\(viewport\.name\)/);
  assert.match(harness, /sameNode:/);
  assert.match(harness, /sameFile:/);
  assert.match(harness, /no unrelated PDF, song, caption, transcription or lesson module leaks/);
  assert.match(harness, /Busy preview refuses Home navigation without stopping playback/);
  assert.match(harness, /assigned without change events/);
});
