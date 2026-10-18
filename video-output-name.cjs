'use strict';
const fs = require('node:fs');
const path = require('node:path');
const allocatedOutputPaths = new Set();

function originalVideoName(source, extension = 'mp4') {
  const leaf = String(source || '').split(/[\\/]/).pop();
  const base = leaf.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'video';
  const safeBase = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? `_${base}` : base;
  const ext = ['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(String(extension).toLowerCase()) ? String(extension).toLowerCase() : 'mp4';
  return `${safeBase}.${ext}`;
}

function createVideoOutputPath(downloads, source, extension = 'mp4') {
  fs.mkdirSync(downloads, { recursive: true });
  const fileName = originalVideoName(source, extension);
  const parsed = path.parse(fileName);
  let counter = 0;
  for (;;) {
    const candidate = path.join(downloads, counter ? `${parsed.name} (${counter})${parsed.ext}` : fileName);
    const key = process.platform === 'win32' ? path.resolve(candidate).toLowerCase() : path.resolve(candidate);
    // Include jobs still encoding, before their output files exist on disk.
    if (!fs.existsSync(candidate) && !allocatedOutputPaths.has(key)) {
      allocatedOutputPaths.add(key);
      return candidate;
    }
    counter++;
  }
}
module.exports = { originalVideoName, createVideoOutputPath };
