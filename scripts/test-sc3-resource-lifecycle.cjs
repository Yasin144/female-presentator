'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
function functionRegion(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n// —', start);
  assert.ok(start >= 0 && end > start, `${name} must remain independently testable`);
  return source.slice(start, end);
}
const pauseRegion = 'async ' + functionRegion('pauseManagedServersForImage');
const watchdogRegion = functionRegion('startAnjaliWatchdog');

function worker(pid = 123) {
  const entry = { proc: { pid, killed: false, exitCode: null }, stopped: false,
    restartCount: 5, lastRestartAt: 100, starts: 0, signals: [] };
  entry.proc.kill = signal => { entry.signals.push(signal); entry.proc.killed = true; };
  entry.start = () => { entry.starts++; };
  return entry;
}

function harness({ entries = { AnjaliAI: worker() }, deferredKill = false, platform = 'win32' } = {}) {
  const calls = { exec: [], spawn: [], timeout: [], intervals: [], cleared: [], health: [], status: [], startup: 0 };
  const pendingKills = [];
  let health = async () => false;
  const context = {
    servers: entries, isQuitting: false, process: { platform },
    console: { warn() {} },
    execFile(command, args, options, callback) {
      calls.exec.push({ command, args: Array.from(args), options });
      if (deferredKill) pendingKills.push(callback); else callback(null);
    },
    spawn(command, args, options) { calls.spawn.push({ command, args: Array.from(args), options }); },
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      calls.timeout.push(timer);
      if (delay === 1200) queueMicrotask(callback);
      return timer;
    },
    setInterval(callback, delay) {
      const timer = { callback, delay };
      calls.intervals.push(timer);
      return timer;
    },
    clearInterval(timer) { calls.cleared.push(timer); },
    pingPort(...args) { calls.health.push(args); return health(...args); },
    startAnjaliServer() { calls.startup++; },
    BrowserWindow: { getAllWindows: () => [{ webContents: { send(...args) { calls.status.push(args); } } }] },
  };
  const api = vm.runInNewContext(`let anjaliHealthTimer = null; let anjaliHealthFailureCount = 0;
    ${pauseRegion}\n${watchdogRegion}\n({ pauseManagedServersForImage, startAnjaliWatchdog,
    getFailures: () => anjaliHealthFailureCount,
    setFailures: value => { anjaliHealthFailureCount = value; } })`, context);
  return { api, calls, context, entries,
    finishKills() { for (const callback of pendingKills.splice(0)) callback(null); },
    setHealth(value) { health = typeof value === 'function' ? value : async () => value; },
    tick() { return calls.intervals.at(-1).callback(); },
  };
}

test('overlapping resource jobs kill once and restart only after the last idempotent resume', async () => {
  const h = harness({ deferredKill: true });
  const entry = h.entries.AnjaliAI;
  const first = h.api.pauseManagedServersForImage(['AnjaliAI']);
  const second = h.api.pauseManagedServersForImage(['AnjaliAI']);
  assert.equal(entry.resourcePauseCount, 2);
  assert.equal(entry.stopped, true);
  assert.equal(h.calls.exec.length, 1);
  assert.deepEqual(h.calls.exec[0].args, ['/PID', '123', '/T', '/F']);
  assert.equal(h.calls.exec[0].options.windowsHide, true);
  h.finishKills();
  const [resumeFirst, resumeSecond] = await Promise.all([first, second]);
  assert.equal(h.calls.timeout.filter(timer => timer.delay === 1200).length, 1);
  resumeFirst(); resumeFirst();
  assert.equal(entry.resourcePauseCount, 1);
  assert.equal(entry.stopped, true);
  assert.equal(entry.starts, 0);
  resumeSecond(); resumeSecond();
  assert.equal(entry.resourcePauseCount, 0);
  assert.equal(entry.stopped, false);
  assert.equal(entry.starts, 1);
  assert.equal(entry.restartCount, 0);
  assert.equal(entry.lastRestartAt, 0);
});

test('independent worker leases can finish in either order without releasing another worker', async () => {
  const h = harness({ entries: { AnjaliAI: worker(123), Sc3Singing: worker(456) } });
  const resumeVoice = await h.api.pauseManagedServersForImage(['AnjaliAI']);
  const resumeSong = await h.api.pauseManagedServersForImage(['Sc3Singing']);
  assert.equal(h.calls.exec.length, 2);
  resumeSong();
  assert.equal(h.entries.Sc3Singing.starts, 1);
  assert.equal(h.entries.AnjaliAI.starts, 0);
  assert.equal(h.entries.AnjaliAI.stopped, true);
  resumeVoice();
  assert.equal(h.entries.AnjaliAI.starts, 1);
});

test('overlapping jobs with different worker sets retain each lease until its own job completes', async () => {
  const h = harness({ entries: { AnjaliAI: worker(123), Sc3Singing: worker(456) } });
  const resumeBoth = await h.api.pauseManagedServersForImage(['AnjaliAI', 'Sc3Singing']);
  const resumeVoice = await h.api.pauseManagedServersForImage(['AnjaliAI']);
  resumeBoth();
  assert.equal(h.entries.Sc3Singing.starts, 1);
  assert.equal(h.entries.AnjaliAI.starts, 0);
  resumeVoice();
  assert.equal(h.entries.AnjaliAI.starts, 1);
  assert.equal(h.calls.exec.length, 2);
});

test('duplicate keys use one lease and already stopped, killed, or external workers stay untouched', async () => {
  const stopped = worker(456); stopped.stopped = true;
  const killed = worker(789); killed.proc.killed = true;
  const external = { proc: null, stopped: false, restartCount: 7 };
  const h = harness({ entries: { AnjaliAI: worker(), stopped, killed, external } });
  const resume = await h.api.pauseManagedServersForImage(['AnjaliAI', 'AnjaliAI', 'stopped', 'killed', 'external', 'missing']);
  assert.equal(h.calls.exec.length, 1);
  assert.equal(h.entries.AnjaliAI.resourcePauseCount, 1);
  resume();
  assert.equal(h.entries.AnjaliAI.starts, 1);
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.starts, 0);
  assert.equal(killed.starts, 0);
  assert.deepEqual(external, { proc: null, stopped: false, restartCount: 7 });
});

test('quitting before a resource job leaves workers alone and quitting during it prevents resume', async () => {
  const h = harness();
  h.context.isQuitting = true;
  const unusedResume = await h.api.pauseManagedServersForImage(['AnjaliAI']);
  unusedResume();
  assert.equal(h.calls.exec.length, 0);
  assert.equal(h.entries.AnjaliAI.starts, 0);
  h.context.isQuitting = false;
  const resume = await h.api.pauseManagedServersForImage(['AnjaliAI']);
  h.context.isQuitting = true;
  resume(); resume();
  assert.equal(h.entries.AnjaliAI.resourcePauseCount, 0);
  assert.equal(h.entries.AnjaliAI.stopped, true);
  assert.equal(h.entries.AnjaliAI.starts, 0);
});

test('non-Windows resource pause still kills once and last resume starts once', async () => {
  const h = harness({ platform: 'linux' });
  const resumeFirst = await h.api.pauseManagedServersForImage(['AnjaliAI']);
  const resumeSecond = await h.api.pauseManagedServersForImage(['AnjaliAI']);
  assert.deepEqual(h.entries.AnjaliAI.signals, ['SIGKILL']);
  assert.equal(h.calls.exec.length, 0);
  resumeSecond();
  assert.equal(h.entries.AnjaliAI.starts, 0);
  resumeFirst();
  assert.equal(h.entries.AnjaliAI.starts, 1);
});

test('intentional pause resets watchdog misses and cannot revive a worker after 30 checks', async () => {
  const h = harness();
  h.api.startAnjaliWatchdog();
  h.api.setFailures(29);
  h.entries.AnjaliAI.stopped = true;
  for (let check = 0; check < 40; check++) await h.tick();
  assert.equal(h.api.getFailures(), 0);
  assert.equal(h.calls.health.length, 0);
  assert.equal(h.calls.spawn.length, 0);
  assert.equal(h.calls.status.length, 0);
  assert.equal(h.entries.AnjaliAI.stopped, true);
  h.entries.AnjaliAI.stopped = false;
  await h.tick();
  assert.equal(h.api.getFailures(), 1);
  assert.equal(h.calls.spawn.length, 0);
});

test('actual consecutive health failures retain recovery after 30 checks', async () => {
  const h = harness();
  h.api.startAnjaliWatchdog();
  assert.equal(h.calls.intervals[0].delay, 30000);
  for (let check = 0; check < 29; check++) await h.tick();
  assert.equal(h.calls.spawn.length, 0);
  await h.tick();
  assert.equal(h.calls.spawn.length, 1);
  assert.deepEqual(h.calls.spawn[0].args, ['/PID', '123', '/T', '/F']);
  assert.equal(h.calls.spawn[0].options.windowsHide, true);
  assert.equal(h.api.getFailures(), 0);
  assert.equal(h.calls.status[0][1].status, 'restarting');
});

test('successful health resets accumulated misses without restarting', async () => {
  const h = harness();
  h.api.startAnjaliWatchdog();
  h.api.setFailures(29);
  h.setHealth(true);
  await h.tick();
  assert.equal(h.api.getFailures(), 0);
  assert.equal(h.calls.spawn.length, 0);
});

test('pause during an outstanding health check prevents its failed result from restarting', async () => {
  const h = harness();
  let finishHealth;
  h.setHealth(() => new Promise(resolve => { finishHealth = resolve; }));
  h.api.startAnjaliWatchdog();
  h.api.setFailures(29);
  const pendingTick = h.tick();
  h.entries.AnjaliAI.stopped = true;
  finishHealth(false);
  await pendingTick;
  assert.equal(h.api.getFailures(), 0);
  assert.equal(h.calls.spawn.length, 0);
  assert.equal(h.calls.status.length, 0);
});

test('quitting before or during a health check cannot start recovery', async () => {
  const h = harness();
  h.api.startAnjaliWatchdog();
  h.context.isQuitting = true;
  await h.tick();
  assert.equal(h.calls.health.length, 0);
  h.context.isQuitting = false;
  let finishHealth;
  h.setHealth(() => new Promise(resolve => { finishHealth = resolve; }));
  h.api.setFailures(29);
  const pendingTick = h.tick();
  h.context.isQuitting = true;
  finishHealth(false);
  await pendingTick;
  assert.equal(h.calls.spawn.length, 0);
  assert.equal(h.calls.status.length, 0);
});

test('watchdog retains startup recovery when no managed process is available', async () => {
  const h = harness({ entries: { AnjaliAI: { proc: null, stopped: false } } });
  h.api.startAnjaliWatchdog();
  h.api.setFailures(29);
  await h.tick();
  assert.equal(h.calls.spawn.length, 0);
  const restartTimer = h.calls.timeout.find(timer => timer.delay === 1000);
  assert.ok(restartTimer);
  assert.equal(h.calls.startup, 0);
  restartTimer.callback();
  assert.equal(h.calls.startup, 1);
});

test('restarting the watchdog clears its previous timer', () => {
  const h = harness();
  h.api.startAnjaliWatchdog();
  const firstTimer = h.calls.intervals[0];
  h.api.startAnjaliWatchdog();
  assert.deepEqual(h.calls.cleared, [firstTimer]);
  assert.equal(h.calls.intervals.length, 2);
});
