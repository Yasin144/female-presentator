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
const presenterCss = read('src/classic-presentator.css');
const legacySource = read('script.js');
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
  for (const id of ['inputPanel', 'subjectSelect', 'lessonInput', 'showScreenBtn', 'resetInputsBtn', 'themeSelect', 'templateWorkflowSection', 'lessonContentSection']) {
    assert.ok(actual.has(id), 'Missing legacy input ID: ' + id);
  }
});

test('the duplicate stage theme switch is removed and the header moon owns appearance', () => {
  assert.doesNotMatch(input, /id="themeToggle"|themeToggleLabel/);
  assert.match(appSource, /document\.body\.setAttribute\('data-theme', appTheme\)/);
});

test('the header theme icon changes from moon to sun in light mode', () => {
  const preferences = read('src/components/StudioPreferences.jsx');
  const icons = read('src/components/StudioIcon.jsx');
  assert.match(preferences, /appTheme === 'dark' \? 'moon' : 'sun'/);
  assert.match(icons, /sun:/);
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

test('intro controls stay synchronized, default on, and an unchecked control is authoritative', () => {
  assert.match(stage, /id="introClipEnabled" type="checkbox" defaultChecked/);
  assert.match(legacySource, /introClipEnabledControls\.forEach/);
  assert.match(legacySource, /function getIntroClipRequested\(\)/);
  assert.doesNotMatch(legacySource, /introClipEnabled\?\.checked \|\| state\.introPlayback\.enabled/);
});

test('English lesson rendering preserves typed whitespace and open style panels use the full row', () => {
  assert.match(legacySource, /isPureInputModeEnabled\(\) \|\| state\.subjectMode === "english"/);
  assert.match(presenterCss, /\.stage-toolbar-card\[open\][^{]*\{[^}]*flex:\s*1 0 100%/s);
  assert.match(stage, /keepOnePanelOpen/);
});

test('font size buttons invalidate the cached lesson layout before their immediate redraw', () => {
  const setter = legacySource.match(/function setFontScale\(nextScale\) \{[\s\S]*?window\.ppSetFontScale/)?.[0] || '';
  const invalidateAt = setter.indexOf('invalidateDrawSceneLayoutCache()');
  const drawAt = setter.indexOf('drawScene(state.mouthOpen)');
  assert.ok(invalidateAt >= 0, 'font scale change clears the cached layout');
  assert.ok(drawAt > invalidateAt, 'font scale redraw happens after cache invalidation');
});

test('added stage images have calm rendering, full-canvas movement, and direct removal', () => {
  assert.doesNotMatch(legacySource, /drawGenericImageScanner/);
  assert.match(legacySource, /function getSlideImageWorkspace[\s\S]*?x:\s*0,[\s\S]*?y:\s*0,[\s\S]*?width:\s*canvas\.width,[\s\S]*?height:\s*canvas\.height/);
  assert.match(legacySource, /removeHandle:\s*isHovered \? removeHandle : null/);
  assert.match(legacySource, /return \{ index: box\.index, mode: "remove" \}/);
  assert.match(legacySource, /if \(hit\.mode === "remove"\)[\s\S]*?removeImageAt\(hit\.index\)/);
});

test('the header subject selector exposes only English without removing maths tools elsewhere', () => {
  const subjectSelect = input.match(/<select id="subjectSelect"[\s\S]*?<\/select>/)?.[0] || '';
  assert.match(subjectSelect, /value="english"/);
  assert.doesNotMatch(subjectSelect, /value="maths"/);
  assert.match(input, /id="mathsTranslatorStatus"/);
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

test('the retired Meta AI integration is absent while local tools remain available', () => {
  assert.doesNotMatch(appSource, /MetaWorkspace|data-workspace="meta"|id:\s*'meta'/);
  assert.doesNotMatch(homeSource, /Meta AI|target:\s*'meta'/);
  for (const label of ['Sing Song', 'AI Captioning (Local)', 'Caption Burner']) {
    assert.match(homeSource, new RegExp(label.replace(/[()]/g, '\\$&')));
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
