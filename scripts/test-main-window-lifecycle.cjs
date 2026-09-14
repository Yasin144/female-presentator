'use strict';

// Execute only the production window/protocol callbacks in a stubbed VM. Never
// load main.cjs as a module: doing so would start services and alter app state.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');

function between(start, end) {
  const first = source.indexOf(start);
  assert.notEqual(first, -1, 'Production start marker exists: ' + start);
  const last = source.indexOf(end, first + start.length);
  assert.notEqual(last, -1, 'Production end marker exists: ' + end);
  return source.slice(first, last + end.length);
}

function makeWindowHarness() {
  const windows = [];
  const handlers = new Map();
  const listeners = new Map();
  const saveCalls = [];
  const app = new EventEmitter();
  const metrics = { kills: 0, quits: 0, shortcutUnregisters: 0 };
  app.quit = () => { metrics.quits += 1; };

  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.owner = this;
      this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      this.webContents.executeJavaScript = () => { throw new Error('Unexpected renderer evaluation'); };
      windows.push(this);
    }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    maximize() {}
    show() { this.shown = true; }
    setTitle(title) { this.title = title; }
    isDestroyed() { return this.destroyed; }
    static fromWebContents(contents) { return contents?.owner || null; }
    static getAllWindows() { return windows.filter(window => !window.destroyed); }
  }

  const context = vm.createContext({
    require(name) {
      assert.equal(name, 'electron', 'No services, subprocesses, or other real imports');
      return { screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1280, height: 800 } }) } };
    },
    BrowserWindow: FakeWindow,
    Menu: { buildFromTemplate: template => template, setApplicationMenu() {} },
    ipcMain: {
      handle(channel, handler) {
        if (handlers.has(channel)) throw new Error('Attempted to register a second handler for ' + channel);
        handlers.set(channel, handler);
      },
      on(channel, handler) {
        const entries = listeners.get(channel) || [];
        entries.push(handler);
        listeners.set(channel, entries);
      },
    },
    fs: {
      existsSync(filename) {
        assert.ok(filename.endsWith(path.join('renderer-dist', 'index.html')), 'No user configuration or secret reads');
        return true;
      },
    },
    dialog: { async showSaveDialog(...args) { saveCalls.push(args); return { canceled: true }; } },
    path,
    os,
    ROOT: path.resolve(__dirname, '..'),
    IS_DEV: false,
    console: { log() {}, warn() {}, error() {} },
    process: { platform: 'win32' },
    app,
    globalShortcut: { unregisterAll() { metrics.shortcutUnregisters += 1; } },
    killAll() { metrics.kills += 1; },
  });
  vm.runInContext(between('let mainWindowIpcRegistered = false;', '\n  return win;\n}'), context);
  vm.runInContext(between("let _isRecovering = false;", "app.on('before-quit', () => {\n  globalShortcut.unregisterAll();\n  killAll();\n});"), context);
  return { context, windows, handlers, listeners, saveCalls, app, metrics, createWindow: () => vm.runInContext('createWindow()', context) };
}

test('replacement windows do not duplicate application IPC or lose per-window hooks', async () => {
  const h = makeWindowHarness();
  const first = await h.createWindow();
  const firstHandlers = new Map(h.handlers);
  assert.ok(firstHandlers.size > 50, 'Exercise the full production registration block');
  first.destroyed = true;
  const second = await h.createWindow();
  assert.equal(h.handlers.size, firstHandlers.size);
  for (const [channel, handler] of firstHandlers) assert.equal(h.handlers.get(channel), handler, channel);
  assert.equal(h.listeners.get('get-groq-api-key').length, 1);
  for (const window of [first, second]) {
    assert.equal(window.url, 'app://voice/renderer-dist/index.html');
    assert.equal(window.webContents.listenerCount('did-finish-load'), 2);
    assert.equal(window.webContents.listenerCount('will-navigate'), 1);
    assert.equal(window.webContents.listenerCount('did-navigate'), 1);
    assert.equal(window.listenerCount('ready-to-show'), 1);
  }
});

test('Save dialog belongs to the invoking replacement window, not the destroyed first window', async () => {
  const h = makeWindowHarness();
  const first = await h.createWindow();
  first.destroyed = true;
  const second = await h.createWindow();
  const handler = h.handlers.get('show-save-dialog');
  await handler({ sender: second.webContents }, { fileName: 'counting.mp4' });
  assert.equal(h.saveCalls[0][0], second);
  assert.equal(h.saveCalls[0][1].defaultPath, path.join(os.homedir(), 'Desktop', 'counting.mp4'));
  assert.equal(h.saveCalls[0][1].filters[0].extensions[0], 'mp4');
  await handler({ sender: {} });
  assert.equal(h.saveCalls[1].length, 1, 'Detached callers get an unparented dialog');
  assert.equal(h.saveCalls[1][0].title, 'Save File');
});

test('closing a window during recovery preserves workers; normal app exit still shuts down', async () => {
  const h = makeWindowHarness();
  const window = await h.createWindow();
  vm.runInContext('_isRecovering = true;', h.context);
  window.destroyed = true;
  window.emit('closed');
  h.app.emit('window-all-closed');
  assert.equal(h.metrics.kills, 0);
  assert.equal(h.metrics.quits, 0);
  await h.createWindow();
  vm.runInContext('_isRecovering = false;', h.context);
  h.app.emit('window-all-closed');
  assert.equal(h.metrics.kills, 1);
  assert.equal(h.metrics.quits, 1);
  h.app.emit('before-quit');
  assert.equal(h.metrics.shortcutUnregisters, 1);
  assert.equal(h.metrics.kills, 2);
});

test('closing one of several windows does not stop the app workers', async () => {
  const h = makeWindowHarness();
  const first = await h.createWindow();
  await h.createWindow();
  first.destroyed = true;
  first.emit('closed');
  assert.equal(h.metrics.kills, 0);
  assert.equal(h.metrics.quits, 0);
});

test('app media protocol imports net and passes a correctly escaped local file URL', async () => {
  const fetches = [];
  let handler;
  let expectedPath;
  const fakeElectron = {
    net: { fetch: async url => { fetches.push(url); return new Response('mock media', { status: 200 }); } },
    protocol: { handle(scheme, callback) { assert.equal(scheme, 'app'); handler = callback; } },
  };
  const context = vm.createContext({
    require(name) {
      if (name === 'electron') return fakeElectron;
      if (name === 'url') return { pathToFileURL };
      throw new Error('Unexpected import: ' + name);
    },
    fs: { existsSync(filename) { assert.equal(filename, expectedPath); return true; } },
    URL, Response,
  });
  const electronImport = source.match(/^const \{ app,.*?require\('electron'\);$/m)?.[0];
  const urlImport = source.match(/^const \{ pathToFileURL \} = require\('url'\);$/m)?.[0];
  assert.ok(electronImport);
  assert.ok(urlImport);
  vm.runInContext(electronImport + '\n' + urlImport + '\n' + between("protocol.handle('app', (request) => {", '\n  });'), context);
  for (const name of ['video.mp4', 'lesson #1? 100% café.mp4']) {
    expectedPath = path.join(path.parse(process.cwd()).root, 'media test', name).replace(/\\/g, '/');
    const encoded = expectedPath.split('/').map(encodeURIComponent).join('/');
    const response = await handler({ url: 'app://media/' + encoded });
    assert.equal(response.status, 200);
    assert.equal(fetches.at(-1), pathToFileURL(expectedPath).href);
    assert.equal(new URL(fetches.at(-1)).search, '');
    assert.equal(new URL(fetches.at(-1)).hash, '');
  }
});
