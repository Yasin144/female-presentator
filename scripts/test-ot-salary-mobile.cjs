const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const readText = (relPath) => fs.readFileSync(path.join(rootDir, relPath), 'utf8');

const mainCjs = readText('main.cjs');
const preloadCjs = readText('preload.cjs');
const viteConfig = readText('vite.config.js');
const mainJsx = readText('src/main.jsx');
const appJsx = readText('src/App.jsx');
const studioHomeJsx = readText('src/components/StudioHome.jsx');
const androidLauncherJsx = readText('src/components/AndroidLauncher.jsx');
const otSalaryJsx = readText('src/components/OtSalary/OtSalary.jsx');
const otGeneratorJs = readText('src/components/OtSalary/otMobileAppGenerator.js');
const otManifest = JSON.parse(readText('public/ot-manifest.json'));
const otSw = readText('public/ot-sw.js');

// 1. Upstream + Local module integration checks
assert.match(appJsx, /id:\s*'ot-salary'/);
assert.match(appJsx, /id:\s*'srt-voice'/);
assert.match(appJsx, /id:\s*'captioner-2'/);
assert.match(appJsx, /id:\s*'kitten-shorts'/);
assert.match(studioHomeJsx, /id:\s*'ot-salary'/);
assert.match(studioHomeJsx, /id:\s*'srt-voice'/);

// 2. Mobile Server & Vite OT Sync API + /ot route checks
assert.match(mainCjs, /\/api\/ot-salary-sync/);
assert.match(mainCjs, /mergeAndSaveOtSalaryStoreToDisk/);
assert.match(mainCjs, /ot-salary-updated/);
assert.match(mainCjs, /isStandaloneOtPath/);
assert.match(viteConfig, /\/api\/ot-salary-sync/);
assert.match(viteConfig, /\/ot-mobile/);

// 3. Preload & main.jsx Mobile Bridge checks
assert.match(preloadCjs, /onOtSalaryUpdated:/);
assert.match(mainJsx, /isStandaloneOtMobileMode/);
assert.match(mainJsx, /<OtSalary standaloneMobile=\{true\} \/>/);
assert.match(mainJsx, /loadOtSalaryData:/);
assert.match(mainJsx, /saveOtSalaryData:/);
assert.match(mainJsx, /\/ot-sw\.js/);

// 4. Capacitor Android Launcher offline OT Mobile App check
assert.match(androidLauncherJsx, /Open OT &amp; Salary Tracker Mobile App/);
assert.match(androidLauncherJsx, /<OtSalary standaloneMobile=\{true\}/);

// 5. PWA Manifest & Service Worker checks
assert.equal(otManifest.short_name, 'OT & Salary');
assert.equal(otManifest.start_url, '/ot');
assert.match(otSw, /ot-salary/);

// 6. OtSalary.jsx Mobile App Mode, 1-Tap Punch, Day Cards, Bottom Nav & Sync Modal checks
assert.match(otSalaryJsx, /punchEnterNowAndSave/);
assert.match(otSalaryJsx, /punchExitNowAndSave/);
assert.match(otSalaryJsx, /quickSetTodayOtAndSave/);
assert.match(otSalaryJsx, /shareSalarySummaryOnWhatsApp/);
assert.match(otSalaryJsx, /downloadStandaloneMobileApp/);
assert.match(otSalaryJsx, /syncWithPcNow/);
assert.match(otSalaryJsx, /Mobile App \/ Sync/);
assert.match(otSalaryJsx, /Today Punch/);
assert.match(otSalaryJsx, /Month Days/);
assert.match(otSalaryJsx, /Rules & App/);
assert.match(otSalaryJsx, /OT-Salary-Mobile\.apk/);

// 7. Standalone Offline Mobile App HTML & Native Android APK checks
assert.match(otGeneratorJs, /generateStandaloneOtMobileHtml/);
assert.ok(fs.existsSync(path.join(rootDir, 'OT-Salary-Mobile-App.html')), 'OT-Salary-Mobile-App.html should exist in root');
assert.ok(fs.existsSync(path.join(rootDir, 'public/OT-Salary-Mobile-App.html')), 'public/OT-Salary-Mobile-App.html should exist');
assert.ok(fs.existsSync(path.join(rootDir, 'OT-Salary-Mobile.apk')), 'OT-Salary-Mobile.apk should exist in root');
assert.ok(fs.statSync(path.join(rootDir, 'OT-Salary-Mobile.apk')).size > 1_000_000, 'OT-Salary-Mobile.apk should be a valid non-empty APK');

console.log('All OT & Salary Mobile App + Android APK + Upstream integration tests passed!');

