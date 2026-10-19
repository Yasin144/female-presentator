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
assert.doesNotMatch(appJsx, /id:\s*'kitten-shorts'/);
assert.doesNotMatch(studioHomeJsx, /id:\s*'kitten-shorts'/);
assert.doesNotMatch(studioHomeJsx, /id:\s*'local-captions'/);
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

// 4. Capacitor Android Launcher offline OT Mobile App & Error Boundary check
assert.match(androidLauncherJsx, /Open OT, Salary &amp; Mobile Expenses App/);
assert.match(androidLauncherJsx, /<OtSalary standaloneMobile=\{true\}/);
assert.match(androidLauncherJsx, /class MobileOtErrorBoundary/);
assert.match(mainJsx, /<MobileOtErrorBoundary><OtSalary standaloneMobile=\{true\} \/><\/MobileOtErrorBoundary>/);

// 5. PWA Manifest & Service Worker checks
assert.equal(otManifest.short_name, 'OT & Salary');
assert.equal(otManifest.start_url, '/ot?app=ot');
assert.match(otSw, /ot-salary/);

// 6. OtSalary.jsx Mobile App Mode, 1-Tap Punch, Day Cards, Bottom Nav & Sync Modal checks
assert.match(otSalaryJsx, /const getNowTimeHHMM =/);
assert.match(otSalaryJsx, /const parseTimeMinutes =/);
assert.match(otSalaryJsx, /const minutesToHHMM =/);
assert.match(otSalaryJsx, /const STORAGE_KEY =/);
assert.match(otSalaryJsx, /const generateStandaloneOtMobileHtml =/);
assert.match(otSalaryJsx, /punchEnterNowAndSave/);
assert.match(otSalaryJsx, /punchExitNowAndSave/);
assert.match(otSalaryJsx, /quickSetTodayOtAndSave/);
assert.match(otSalaryJsx, /shareSalarySummaryOnWhatsApp/);
assert.match(otSalaryJsx, /downloadStandaloneMobileApp/);
assert.match(otSalaryJsx, /syncWithPcNow/);
assert.match(otSalaryJsx, /App \/ Sync/);
assert.match(otSalaryJsx, /Today Punch/);
assert.match(otSalaryJsx, /Month Days/);
assert.match(otSalaryJsx, /Rules & App/);
assert.match(otSalaryJsx, /OT-Salary-Mobile\.apk/);

// 7. Biometric Touch Sensor (IN & OUT) & Native Android Real Phone Unlock Biometric Bridge checks
const androidMainActivity = readText('android/app/src/main/java/com/pattan/presentator/MainActivity.java');
const androidManifest = readText('android/app/src/main/AndroidManifest.xml');
const mobileTxParserJava = readText('android/app/src/main/java/com/pattan/presentator/MobileTransactionParser.java');
const paymentNotifServiceJava = readText('android/app/src/main/java/com/pattan/presentator/PaymentNotificationService.java');
const expensesModuleJsx = readText('src/components/OtSalary/ExpensesModule.jsx');

assert.match(androidManifest, /android\.permission\.USE_BIOMETRIC/);
assert.match(androidManifest, /android\.permission\.USE_FINGERPRINT/);
assert.match(androidManifest, /android\.permission\.VIBRATE/);
assert.match(androidManifest, /android\.permission\.READ_SMS/);
assert.match(androidManifest, /android\.permission\.RECEIVE_SMS/);
assert.match(androidManifest, /PaymentNotificationService/);
assert.match(androidMainActivity, /PattanBiometric/);
assert.match(androidMainActivity, /BiometricPrompt/);
assert.match(androidMainActivity, /DEVICE_CREDENTIAL/);
assert.match(androidMainActivity, /createConfirmDeviceCredentialIntent/);
assert.match(otSalaryJsx, /performBiometricPunch/);
assert.match(otSalaryJsx, /Biometric Touch Sensor \(IN &amp; OUT\)/);
assert.match(otSalaryJsx, /Touch Sensor — IN \(Enter\)/);
assert.match(otSalaryJsx, /Touch Sensor — OUT \(Exit \+ OT\)/);
assert.match(otSalaryJsx, /biometricIn/);
assert.match(otSalaryJsx, /biometricOut/);
assert.match(androidMainActivity, /OnBackPressedCallback/);
assert.match(androidMainActivity, /handleSmartBackGesture/);
assert.match(otSalaryJsx, /__handlePattanHardwareBack/);
assert.match(otGeneratorJs, /__handlePattanHardwareBack/);
assert.match(otGeneratorJs, /performBioTouchPunch/);
assert.match(otGeneratorJs, /requestMobileUnlockBiometric/);
assert.match(otGeneratorJs, /bioTouchInBtn/);
assert.match(otGeneratorJs, /bioTouchOutBtn/);

// 8. Real-time Instant Mobile <-> Web Sync Engine checks
assert.match(androidMainActivity, /syncHttpPost/);
assert.match(androidMainActivity, /pattan-native-sync-response/);
assert.match(viteConfig, /\/api\/ot-salary-events/);
assert.match(viteConfig, /mergeOtSalaryStores/);
assert.match(viteConfig, /Access-Control-Allow-Private-Network/);
assert.match(mainCjs, /Access-Control-Allow-Private-Network/);
assert.match(otSalaryJsx, /pattan_ot_salary_live_sync_yasin144_v2/);
assert.match(otSalaryJsx, /OT &amp; SALARY PRO/);
assert.match(otSalaryJsx, /OT_SALARY_LIVE_SYNC/);
assert.match(otSalaryJsx, /BroadcastChannel/);
assert.match(otSalaryJsx, /settingsUpdatedAt/);
assert.match(otSalaryJsx, /updatedAtMs/);
assert.match(otGeneratorJs, /CLOUD_RELAY_URL/);
assert.match(otGeneratorJs, /OT, SALARY &amp; EXPENSES PRO/);
assert.match(otGeneratorJs, /OT_SALARY_LIVE_SYNC/);
assert.match(otGeneratorJs, /mergeIncomingData/);

// 9. Expenses Module (Expense Memory) & Mobile Transaction / Note Auto-Extraction checks
assert.match(otSalaryJsx, /ExpensesModule/);
assert.match(otSalaryJsx, /EXPENSES/);
assert.match(expensesModuleJsx, /pattan-mobile-transactions/);
assert.match(expensesModuleJsx, /parseSmsOrUpiTextJs/);
assert.match(expensesModuleJsx, /triggerMobileTransactionScan/);
assert.match(expensesModuleJsx, /reconcileAndMergeTransactions/);
assert.match(expensesModuleJsx, /answerNaturalLanguageFinanceQuery/);
assert.match(expensesModuleJsx, /remainingSalary/);
assert.match(mobileTxParserJava, /scanSmsInbox/);
assert.match(mobileTxParserJava, /saveCapturedTransaction/);
assert.match(mobileTxParserJava, /AndroidKeyStore/);
assert.match(paymentNotifServiceJava, /NotificationListenerService/);
assert.match(paymentNotifServiceJava, /ACTION_MOBILE_TXN/);
assert.match(androidMainActivity, /scanMobileTransactions/);
assert.match(androidMainActivity, /clearSavedMobileTransactions/);
assert.match(androidMainActivity, /openNotificationListenerSettings/);
assert.match(otGeneratorJs, /tab-expenses/);
assert.match(otGeneratorJs, /expScanMobileBtn/);

// 10. Standalone Offline Mobile App HTML & Native Android APK checks
assert.match(otGeneratorJs, /generateStandaloneOtMobileHtml/);
assert.ok(fs.existsSync(path.join(rootDir, 'OT-Salary-Mobile-App.html')), 'OT-Salary-Mobile-App.html should exist in root');
assert.ok(fs.existsSync(path.join(rootDir, 'public/OT-Salary-Mobile-App.html')), 'public/OT-Salary-Mobile-App.html should exist');
assert.ok(fs.existsSync(path.join(rootDir, 'OT-Salary-Mobile.apk')), 'OT-Salary-Mobile.apk should exist in root');
assert.ok(fs.statSync(path.join(rootDir, 'OT-Salary-Mobile.apk')).size > 1_000_000, 'OT-Salary-Mobile.apk should be a valid non-empty APK');

console.log('All OT & Salary + Mobile Expenses Module + Biometric Touch Sensor + Instant Live Sync + Android APK tests passed!');


