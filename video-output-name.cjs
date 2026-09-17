'use strict';
const fs = require('node:fs');
const path = require('node:path');

function originalVideoName(source, extension = 'mp4') {
  const leaf = String(source || '').split(/[\\/]/).pop();
  const base = leaf.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'video';
  const safeBase = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? `_${base}` : base;
  const ext = ['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(String(extension).toLowerCase()) ? String(extension).toLowerCase() : 'mp4';
  return `${safeBase}.${ext}`;
}

function createVideoOutputPath(downloads, source, extension = 'mp4') {
  // Unique directories protect source files and concurrent exports without
  // changing the user's filename. No writes ever target the source directory.
  const root = path.join(downloads, 'Pattan Exports');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'export-'));
  return path.join(directory, originalVideoName(source, extension));
}
module.exports = { originalVideoName, createVideoOutputPath };
