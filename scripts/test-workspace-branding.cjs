'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('active app branding uses Pattan Workspace without changing saved app identity', () => {
  for (const file of ['src/App.jsx', 'src/components/MyExporter/MyExporter.jsx', 'src/components/AndroidLauncher.jsx']) {
    assert.match(read(file), /Pattan Workspace/);
    assert.doesNotMatch(read(file), /Pattan Studio/);
  }
  assert.match(read('index.html'), /<title>Pattan Workspace<\/title>/);
  assert.match(read('main.cjs'), /title:\s*'Pattan Workspace'/);
  assert.match(read('main.cjs'), /win\.setTitle\('Pattan Workspace'\)/);
  assert.equal(JSON.parse(read('package.json')).name, 'presentator', 'Keep existing user-data location');
  assert.match(read('src/studioPreferences.mjs'), /pattan-studio-app-theme-v1/, 'Keep saved theme');
});

test('WhatsApp preview and prepared chat use the same renamed heading', async () => {
  const ui = await import(pathToFileURL(path.join(root, 'src/studioPreferences.mjs')));
  const { formatDraftMessage } = require('../whatsapp-drafts.cjs');
  for (const status of ['completed', 'failed']) {
    const draft = { status, processName: 'PDF export', details: 'Example result' };
    assert.equal(ui.formatWhatsAppDraft(draft), formatDraftMessage(draft));
    assert.match(formatDraftMessage(draft), /^Pattan Workspace\n/);
  }
});
