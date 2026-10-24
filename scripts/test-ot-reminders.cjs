const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '..');
// Keep financial preservation checks pinned when the redesigned source is committed.
const FINANCIAL_BASELINE = '6df2d4ac23372d016b4825c83402def3887176a7';
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }

function readFinancialBaseline(relative) {
  try {
    return execFileSync('git', ['show', `${FINANCIAL_BASELINE}:${relative}`], {
      cwd: root, encoding: 'utf8', maxBuffer: 2e6, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`Financial baseline ${FINANCIAL_BASELINE} is unavailable for ${relative}. Fetch that original commit or use a full repository checkout before running preservation checks.`, { cause: error });
  }
}

(async () => {
  const { formatOtClock } = await import(pathToFileURL(path.join(root, 'src/components/OtSalary/otDisplay.js')));
  for (const [minutes, expected] of [[0, '00:00'], [1, '00:01'], [59, '00:59'], [60, '01:00'], [90, '01:30'], [95, '01:35'], [480, '08:00'], [1500, '25:00'], [-7, '00:00'], [NaN, '00:00'], [Infinity, '00:00'], [89.999, '01:30']]) equal(formatOtClock(minutes), expected);

  const voiceFile = path.join(root, 'src/components/OtSalary/timeCompletedVoice.js');
  const source = fs.readFileSync(voiceFile, 'utf8');
  let mediaStarts = 0, volumeChanges = 0, schedules = [], canceled = 0, spoken = [], tests = [];
  const bridge = {
    scheduleOtMilestones(json) { schedules.push(JSON.parse(json)); return true; },
    cancelOtMilestones() { canceled++; },
    speakOtMilestone(hour) { spoken.push(hour); return true; },
    testOtMilestoneInSeconds(seconds) { tests.push(seconds); return true; },
    forceMaxSpeakerVolume() { volumeChanges++; },
  };
  const window = { PattanBiometric: bridge, addEventListener() {}, AudioContext: class { constructor() { mediaStarts++; throw Error('Unexpected AudioContext'); } } };
  const sandbox = { window, document: { addEventListener() {} }, Date, Set, Map, Uint8Array, Int16Array, ArrayBuffer, DataView,
    Audio: class { constructor() { mediaStarts++; throw Error('Unexpected HTML audio'); } },
    setTimeout() {}, clearTimeout() {}, console, Blob, URL };
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/export function /g, 'function '), sandbox);
  equal(mediaStarts, 0, 'Import must be silent');
  vm.runInContext('ensureVoiceAudioUnlocked(); subscribeBackgroundClockTick(() => {});', sandbox);
  equal(mediaStarts, 0, 'Opening and ticking must not start audio');
  const base = Date.now() + 3600000;
  vm.runInContext(`armShiftAndOtMilestonesSchedule({ shiftEndEpochMs: ${base}, dateKey: 'saved-shift', alreadySpokenHours: [0,1] });`, sandbox);
  equal(schedules.length, 1, 'Native schedule used');
  equal(schedules[0], { shiftEndEpochMs: base, dateKey: 'saved-shift', alreadySpokenHours: [0,1] });
  equal(mediaStarts, 0, 'Arming future alarms must not start audio or pause music');
  equal(spoken.length, 0, 'Arming must not speak a catch-up milestone');
  equal(volumeChanges, 0, 'No volume mutation on opening or scheduling');
  vm.runInContext('stopScheduledVoiceAlarms();', sandbox);
  equal(canceled, 1, 'Punch-out cancels native alarms');
  vm.runInContext("armShiftAndOtMilestonesSchedule({ shiftEndEpochMs: 0, dateKey: '' });", sandbox);
  equal(canceled, 2, 'Invalid/empty shift disarms');
  vm.runInContext('speakOtMilestoneOutLoud(2); speakOtMilestoneOutLoud(100); scheduleLockScreenVoiceTestInSeconds(6);', sandbox);
  equal(spoken, [2,8], 'Explicit voice uses native notification');
  equal(tests, [6], 'Lock-screen test uses native alarm');
  equal(mediaStarts, 0, 'Native test must not keep audio alive');
  vm.runInContext('forceRaisePhoneSpeakerVolume();', sandbox);
  equal(volumeChanges, 0, 'Compatibility API cannot unmute or change volume');

  // Same module must also remain silent at startup without a native bridge.
  sandbox.window.PattanBiometric = null;
  vm.runInContext(`armShiftAndOtMilestonesSchedule({ shiftEndEpochMs: ${base}, dateKey: 'browser-shift' });`, sandbox);
  equal(mediaStarts, 0, 'Browser opening and future scheduling must be silent too');

  for (let h = 0; h <= 8; h++) {
    const wav = fs.readFileSync(path.join(root, `android/app/src/main/res/raw/ot_milestone_${h}.wav`));
    const match = source.match(new RegExp('"ot_' + h + '": "([A-Za-z0-9+/=]+)"'));
    const pcm = Buffer.from(match[1], 'base64');
    equal(wav.subarray(0,4).toString(), 'RIFF');
    equal(wav.readUInt32LE(24), 12000);
    equal(wav.readUInt32LE(40), wav.length - 44);
    equal(wav.subarray(44,44 + pcm.length), pcm, 'No speech samples truncated');
  }
  const component = fs.readFileSync(path.join(root, 'src/components/OtSalary/OtSalary.jsx'), 'utf8');
  const baseline = readFinancialBaseline('src/components/OtSalary/OtSalary.jsx');
  function contracts(text) {
    const result = {};
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'FunctionDeclaration' && node.id) result[node.id.name] = text.slice(node.start, node.end).replace(/\r\n/g, '\n');
      if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) result[node.id.name] = text.slice(node.init.start, node.init.end).replace(/\r\n/g, '\n');
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
      }
    }
    walk(parser.parse(text, { sourceType: 'module', plugins: ['jsx'] }));
    return result;
  }
  const currentContracts = contracts(component), originalContracts = contracts(baseline);
  for (const outcome of [{ ok: true }, { ok: false, error: 'Cancelled' }, { ok: false, error: 'Timed out' }, null, { ok: true }]) {
    const state = { unlocked: false, busy: false, error: '' };
    let authRequests = 0, entryBeeps = 0, entryAudio = 0;
    const unlock = vm.runInNewContext(`(${currentContracts.unlockExpensesWithBiometric})`, {
      useCallback: fn => fn,
      requestAndroidHardwareBiometric: async action => { equal(action, 'expenses', 'Expense entry must retain its authentication gate'); authRequests++; return outcome; },
      setExpensesUnlockBusy: value => { state.busy = value; },
      setExpensesUnlockError: value => { state.error = value; },
      setExpensesBiometricUnlocked: value => { state.unlocked = value; },
      setSaveNotice() {}, setTimeout() {}, triggerBiometricHaptic() {},
      playBiometricBeep() { entryBeeps++; },
      AudioContext: class { constructor() { entryAudio++; } },
    });
    equal(await unlock(), Boolean(outcome?.ok), 'Expense entry follows the authentication result');
    equal(state.unlocked, Boolean(outcome?.ok), 'Failed or cancelled authentication must keep Expenses locked');
    equal(state.busy, false, 'Expense authentication clears its busy state');
    equal(authRequests, 1, 'Every Expense entry still requests authentication');
    equal(entryBeeps, 0, 'Expense entry must not play a confirmation beep');
    equal(entryAudio, 0, 'Expense entry must not start an audio context');
  }
  for (const name of ['parseTimeToMinutes', 'minutesToTimeInput', 'computeDayEarnings', 'persistStore', 'rates']) {
    assert.ok(originalContracts[name], `Missing baseline contract ${name}`);
    equal(currentContracts[name], originalContracts[name], `Financial/time/persistence contract changed: ${name}`);
  }
  assert.doesNotMatch(component, /🙈|🐵|👁/); checks++;
  assert.match(component, /formatOtClock\(otMinutes\)/); checks++;
  assert.match(component, /runningToday \? liveOtTicker\.totalOtMinutes : cell\.earnings\.otMins/); checks++;
  for (const filename of ['OtSalary.jsx', 'OtVoiceStatusPanel.jsx']) parser.parse(fs.readFileSync(path.join(root, 'src/components/OtSalary', filename), 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
  checks += 2;
  console.log(`PASS: ${checks} OT display, audio startup, native scheduling/cancellation, icon and complete-voice-asset checks; financial contracts match baseline ${FINANCIAL_BASELINE.slice(0, 7)}.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
