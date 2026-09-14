'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');

function section(firstMarker, lastMarker) {
  const first = source.indexOf(firstMarker);
  const last = source.indexOf(lastMarker, first);
  assert.ok(first >= 0 && last >= first, 'Production source markers remain present');
  return source.slice(first, last + lastMarker.length);
}

const LISTENERS = [
  '  TCP    127.0.0.1:54321    127.0.0.1:8430    ESTABLISHED     99',
  '  TCP    0.0.0.0:8430      0.0.0.0:0         LISTENING       101',
  '  TCP    [::]:8430         [::]:0            LISTENING       101',
  '  TCP    127.0.0.1:8432    0.0.0.0:0         LISTENING       102',
  '  TCP    127.0.0.1:18430   0.0.0.0:0         LISTENING       103',
  '  TCP    127.0.0.1:8434    127.0.0.1:443     TIME_WAIT       104',
  '  UDP    0.0.0.0:8434      *:*                               105',
].join('\r\n');

function startupHarness({ output = LISTENERS, health = false, dev = false } = {}) {
  const spawned = [];
  const commands = [];
  const warnings = [];
  const context = vm.createContext({
    servers: {},
    process: { platform: 'win32' }, IS_DEV: dev, ROOT: path.resolve(__dirname, '..'),
    console: { log() {}, error() {}, warn: (...parts) => warnings.push(parts.join(' ')) },
    execFile(command, args, options, callback) {
      commands.push({ command, args, options });
      assert.equal(command, 'netstat.exe', 'Only read-only port inspection is allowed');
      assert.deepEqual(Array.from(args), ['-ano', '-p', 'tcp']);
      assert.equal(options.windowsHide, true);
      queueMicrotask(() => callback(null, output));
    },
    fs: { existsSync: () => true }, path,
    pingPort: async () => health,
    spawnManaged: (...args) => spawned.push(args),
    startAnjaliServer() {},
    startAnjaliWatchdog() {},
    setTimeout() {},
    WHISPER_PYTHON: 'whisper-test', TRANSCRIBE_HTTP_SERVER: 'transcribe-test',
    PS: 'powershell-test', ANJALI_PYTHON: 'voice-test', EDGE_TTS_SERVER: 'edge-test',
    SC3_SINGING_SERVER: 'singing-test', SINGING_PYTHON: 'singing-python-test',
    IMAGEGEN_PYTHON: 'image-python-test', IMAGEGEN_SERVER: 'image-test',
    TRANSLATE_SERVER: 'translate-test', PYTHON_ENV: {}, SINGING_ENV: {}, NPM: 'npm-test',
  });
  vm.runInContext(section('const occupiedStartupPorts = new Map();', '  servers[key].startupError = message;\n  return true;\n}'), context);
  vm.runInContext(section('function startServers() {', '  setTimeout(startAnjaliWatchdog, 180000);\n}'), context);
  return { context, spawned, commands, warnings };
}

test('startup parsing considers only exact local TCP listeners, never remote clients', () => {
  const { context } = startupHarness();
  const result = vm.runInContext(`parseLocalListeningPorts(${JSON.stringify(LISTENERS)}, [8430, 8432, 8434])`, context);
  assert.deepEqual([...result].map(([port, pids]) => [port, [...pids]]), [[8430, [101]], [8432, [102]]]);
});

test('startup inspects without taskkill, reuses healthy endpoints, and spawns nothing', async () => {
  const h = startupHarness({ health: true, dev: true });
  await vm.runInContext('inspectServerPorts()', h.context);
  vm.runInContext('startServers()', h.context);
  await new Promise(setImmediate);
  assert.equal(h.commands.length, 1);
  assert.equal(h.spawned.length, 0);
  assert.equal(h.warnings.length, 0);
  assert.ok(h.context.servers.FFmpegServer);
  assert.equal(h.context.servers.FFmpegServer.proc, null, 'Reused worker is not claimed as an owned child');
  assert.ok(!source.includes('function freeServerPorts()'), 'Unsafe process eviction is removed');
});

test('unhealthy occupied ports are reported and skipped; unoccupied workers still start', async () => {
  const h = startupHarness();
  await vm.runInContext('inspectServerPorts()', h.context);
  vm.runInContext('startServers()', h.context);
  await new Promise(setImmediate);
  const startedKeys = h.spawned.map(args => args[0]);
  assert.deepEqual(startedKeys.sort(), ['EdgeTTS', 'Sc3Singing', 'TranscriptionServer', 'TranslationServer']);
  assert.match(h.context.servers.FFmpegServer.startupError, /8430.*101/);
  assert.match(h.context.servers.ImageGenerator.startupError, /8432.*102/);
  assert.equal(h.context.servers.FFmpegServer.proc, null);
  assert.equal(h.warnings.length, 2);
  assert.equal(h.commands.length, 1, 'No stop or restart command issued for an occupied port');
});

test('health ping accepts only successful HTTP statuses and drains its response', async () => {
  const pingCode = section("function pingPort(port, path_ = '/health', timeoutMs = 4000) {", '\n  });\n}');
  for (const statusCode of [200, 204, 301, 401, 404, 500]) {
    let drained = false;
    const request = new EventEmitter();
    request.destroy = () => {};
    const context = vm.createContext({
      setTimeout: () => 1, clearTimeout() {},
      http: { get(options, onResponse) { queueMicrotask(() => onResponse({ statusCode, resume() { drained = true; } })); return request; } },
    });
    vm.runInContext(pingCode, context);
    assert.equal(await vm.runInContext('pingPort(8430)', context), statusCode >= 200 && statusCode < 300);
    assert.equal(drained, true);
  }
});

test('voice process lookup/recovery matches the exact invoked workspace script, not a foreign basename', async () => {
  const commands = [];
  const context = vm.createContext({
    path: path.win32,
    ANJALI_SERVER: 'D:\\voice\\anjali-chatterbox-server.py', ROOT: 'D:\\voice', PS: 'powershell-test',
    execFile(command, args, options, callback) {
      assert.equal(command, 'powershell-test');
      assert.equal(options.windowsHide, true);
      commands.push(args.at(-1));
      callback(null, '1234'); // Stub only: no PowerShell process is run.
    },
  });
  vm.runInContext(section('function getAnjaliProcessMatchPattern() {', '\nasync function waitForAnjaliHealth').replace(/\nasync function waitForAnjaliHealth$/, ''), context);
  const pattern = new RegExp(vm.runInContext('getAnjaliProcessMatchPattern()', context), 'i');
  for (const command of [
    'D:\\voice\\.voiceclone-venv\\Scripts\\python.exe -u D:\\voice\\anjali-chatterbox-server.py',
    '"C:\\Program Files\\Python\\python.exe" -u "D:\\VOICE\\anjali-chatterbox-server.py"',
    'python.exe D:/voice/anjali-chatterbox-server.py --port 8426',
  ]) assert.equal(pattern.test(command), true, command);
  for (const command of [
    'python.exe D:\\other-app\\anjali-chatterbox-server.py',
    'python.exe D:\\voice-copy\\anjali-chatterbox-server.py',
    'python.exe D:\\voice\\anjali-chatterbox-server.py.backup',
    'python.exe other.py D:\\voice\\anjali-chatterbox-server.py',
    'python.exe -c "print(\'D:\\voice\\anjali-chatterbox-server.py\')"',
  ]) assert.equal(pattern.test(command), false, command);
  assert.equal(await vm.runInContext('isAnjaliServerProcessRunning()', context), true);
  await vm.runInContext('killAnjaliServerProcesses()', context);
  assert.equal(commands.length, 2);
  assert.ok(commands.every(command => command.includes('-match') && !command.includes("-like '*anjali-chatterbox-server.py*'")));
  assert.equal(commands[0].split('| Where-Object ')[1].split(' | ')[0], commands[1].split('| Where-Object ')[1].split(' | ')[0]);
});

test('a second app instance exits before startup; the owning instance restores and focuses its window', () => {
  const code = section('if (!app.requestSingleInstanceLock()) {', "  existingWindow.focus();\n});");
  for (const hasLock of [false, true]) {
    let quit = 0;
    const calls = [];
    const app = new EventEmitter();
    app.requestSingleInstanceLock = () => hasLock;
    app.quit = () => { quit += 1; };
    const window = { isDestroyed: () => false, isMinimized: () => true, restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus') };
    const context = vm.createContext({ app, BrowserWindow: { getAllWindows: () => [window] }, continued: false });
    vm.runInContext('(function boot() {\n' + code + '\ncontinued = true;\n})()', context);
    assert.equal(context.continued, hasLock);
    assert.equal(quit, hasLock ? 0 : 1);
    app.emit('second-instance');
    assert.deepEqual(calls, hasLock ? ['restore', 'show', 'focus'] : []);
  }
});

test('app-ready startup never globally kills unrelated cloudflared tunnels', () => {
  const startup = section('app.whenReady().then(async () => {', "  // Register app:// protocol");
  assert.ok(!startup.includes('taskkill'));
  assert.ok(!startup.includes('execFile'));
  assert.ok(startup.includes("saveMobileLinkState('', { status: 'starting'"), 'Stale published link state is still cleared');
  const shutdown = section('function killAll() {', "  saveMobileLinkState('', { status: 'inactive', stoppedAt: new Date().toISOString() });\n}");
  assert.ok(shutdown.includes('killProcessTree(mobileTunnelProcess)'), 'Intentional owned tunnel shutdown remains');
});
