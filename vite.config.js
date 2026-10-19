import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    allowedHosts: true,
    watch: {
      ignored: [
        '**/.*-venv/**',
        '**/.venv/**',
        '**/AI_Models/**',
        '**/generated-media/**',
        '**/temp/**',
        '**/node_modules/**',
      ],
    },
  },
  build: {
    outDir: 'renderer-dist',
  },
  resolve: {
    alias: {
      'flow-sdk': path.resolve(__dirname, './src/services/flow-sdk.js'),
    },
  },
  plugins: [
    react(),
    {
      name: 'serve-root-files',
      configureServer(server) {
        const otSseClients = new Set();
        const mergeOtSalaryStores = (existing = {}, incoming = {}) => {
          const exSettingsTs = Number(existing.settingsUpdatedAt || 0);
          const inSettingsTs = Number(incoming.settingsUpdatedAt || 0);
          const mergedSettings = inSettingsTs >= exSettingsTs
            ? { ...(existing.settings || {}), ...(incoming.settings || {}) }
            : { ...(incoming.settings || {}), ...(existing.settings || {}) };
          const settingsUpdatedAt = Math.max(exSettingsTs, inSettingsTs, Date.now());

          const exDays = existing.days && typeof existing.days === 'object' ? existing.days : {};
          const inDays = incoming.days && typeof incoming.days === 'object' ? incoming.days : {};
          const mergedDays = incoming.replaceAll === true ? {} : { ...exDays };

          for (const [iso, inRec] of Object.entries(inDays)) {
            if (!inRec || typeof inRec !== 'object') continue;
            const exRec = mergedDays[iso];
            const inTs = Number(inRec.updatedAtMs || Date.parse(inRec.updatedAt || inRec.savedAt || '') || 0);
            const exTs = exRec ? Number(exRec.updatedAtMs || Date.parse(exRec.updatedAt || exRec.savedAt || '') || 0) : -1;
            if (!exRec || inTs >= exTs) {
              if (inRec._deleted) {
                delete mergedDays[iso];
              } else {
                mergedDays[iso] = { ...exRec, ...inRec };
              }
            }
          }

          const exExpenses = existing.expenses && typeof existing.expenses === 'object' ? existing.expenses : {};
          const inExpenses = incoming.expenses && typeof incoming.expenses === 'object' ? incoming.expenses : {};
          const mergedExpenses = incoming.replaceAll === true ? {} : { ...exExpenses };

          for (const [txId, inTx] of Object.entries(inExpenses)) {
            if (!inTx || typeof inTx !== 'object') continue;
            const exTx = mergedExpenses[txId];
            const inTs = Number(inTx.updatedAtMs || Date.parse(inTx.updatedAt || '') || inTx.timestampMs || 0);
            const exTs = exTx ? Number(exTx.updatedAtMs || Date.parse(exTx.updatedAt || '') || exTx.timestampMs || 0) : -1;
            if (!exTx || inTs >= exTs) {
              if (inTx._deleted) {
                delete mergedExpenses[txId];
              } else {
                mergedExpenses[txId] = { ...exTx, ...inTx };
              }
            }
          }

          return {
            settings: mergedSettings,
            settingsUpdatedAt,
            days: mergedDays,
            expenses: mergedExpenses,
            updatedAt: new Date().toISOString(),
            updatedAtMs: Date.now(),
          };
        };

        server.middlewares.use((req, res, next) => {
          if (req.url === '/api/mobile-link') {
            const linkFile = path.join(__dirname, 'temp', 'active-mobile-link.json');
            let data = { wifiUrl: `http://10.149.161.101:5173`, mobileUrl: ``, updatedAt: new Date().toISOString() };
            if (fs.existsSync(linkFile)) {
              try { data = JSON.parse(fs.readFileSync(linkFile, 'utf8')); } catch (_) {}
            }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(data));
            return;
          }
          if (req.url && req.url.split('?')[0] === '/api/ot-salary-events') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache, no-transform',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Private-Network': 'true',
            });
            res.write(`data: ${JSON.stringify({ connected: true, ts: Date.now() })}\n\n`);
            otSseClients.add(res);
            req.on('close', () => {
              otSseClients.delete(res);
            });
            return;
          }
          if (req.url && req.url.split('?')[0] === '/api/ot-salary-sync') {
            const otSalaryFilePath = path.join(__dirname, 'ot-salary-data.json');
            const corsHeaders = {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, X-Presentator-Mobile-Token',
              'Access-Control-Allow-Private-Network': 'true',
              'Cache-Control': 'no-store',
            };
            if (req.method === 'OPTIONS') {
              res.writeHead(204, corsHeaders);
              res.end();
              return;
            }
            if (req.method === 'GET') {
              let data = null;
              try {
                if (fs.existsSync(otSalaryFilePath)) data = JSON.parse(fs.readFileSync(otSalaryFilePath, 'utf8'));
              } catch (_) {}
              res.writeHead(200, corsHeaders);
              res.end(JSON.stringify({ ok: true, success: true, data, filePath: otSalaryFilePath }));
              return;
            }
            if (req.method === 'POST') {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', () => {
                try {
                  const incoming = JSON.parse(body || '{}');
                  let existing = {};
                  try {
                    if (fs.existsSync(otSalaryFilePath)) existing = JSON.parse(fs.readFileSync(otSalaryFilePath, 'utf8'));
                  } catch (_) {}
                  const merged = mergeOtSalaryStores(existing, incoming);
                  fs.writeFileSync(otSalaryFilePath, JSON.stringify(merged, null, 2), 'utf8');
                  const ssePayload = `data: ${JSON.stringify({ ok: true, data: merged, savedAt: merged.updatedAt })}\n\n`;
                  for (const client of otSseClients) {
                    try { client.write(ssePayload); } catch (_) { otSseClients.delete(client); }
                  }
                  res.writeHead(200, corsHeaders);
                  res.end(JSON.stringify({ ok: true, success: true, data: merged, filePath: otSalaryFilePath, savedAt: merged.updatedAt }));
                } catch (err) {
                  res.writeHead(500, corsHeaders);
                  res.end(JSON.stringify({ ok: false, error: err.message }));
                }
              });
              return;
            }
          }
          if (req.url && ['/ot', '/ot/', '/ot-mobile'].includes(req.url.split('?')[0].toLowerCase())) {
            req.url = '/?app=ot';
          }
          if (req.url === '/api/generate-rhyme-song' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const payload = JSON.parse(body || '{}');
                const stamp = Date.now();
                payload.stamp = stamp;
                
                const tempDir = path.join(__dirname, 'temp');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                const reqFile = path.join(tempDir, `_req_${stamp}.json`);
                fs.writeFileSync(reqFile, JSON.stringify(payload, null, 2), 'utf8');

                const scriptPath = path.join(__dirname, 'scripts', 'generate_mobile_rhyme.py');
                const { execSync } = require('child_process');
                const pyOut = execSync(`python "${scriptPath}" "${reqFile}"`, { encoding: 'utf8', timeout: 30000 });
                const result = JSON.parse(pyOut.trim() || '{}');

                if (result.ok && result.finalMp3 && fs.existsSync(result.finalMp3)) {
                  const rawText = String(payload.lyrics || payload.text || payload.prompt || 'kids-rhyme').trim();
                  const firstLine = rawText.split(/\r?\n/)[0] || 'kids-rhyme';
                  const songTitle = String(payload.title || firstLine);
                  const safeTitle = songTitle.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'kids-rhyme';
                  const targetDuration = Math.max(5, Math.min(30, Number(payload.duration) || 30));
                  const dynamicFileName = `${safeTitle}-${targetDuration}sec.mp3`;

                  const audioBuffer = fs.readFileSync(result.finalMp3);
                  const base64 = audioBuffer.toString('base64');
                  try {
                    if (fs.existsSync(reqFile)) fs.unlinkSync(reqFile);
                    if (result.tmpVocal && fs.existsSync(result.tmpVocal)) fs.unlinkSync(result.tmpVocal);
                    if (fs.existsSync(result.finalMp3)) fs.unlinkSync(result.finalMp3);
                  } catch(_) {}

                  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                  res.end(JSON.stringify({
                    ok: true,
                    audioBase64: base64,
                    mimeType: 'audio/mp3',
                    fileName: dynamicFileName,
                    filename: dynamicFileName,
                    engine: 'ACE-Step Q8 + 4K BGM Master'
                  }));
                  return;
                }
              } catch (err) {
                console.error('[Vite Rhyme Handler] error:', err);
              }
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Mobile rhyme generation failed on server.' }));
            });
            return;
          }

          if (req.url === '/api/preview-rhyme-mix' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const payload = JSON.parse(body || '{}');
                const stamp = Date.now();
                payload.stamp = stamp;
                payload.lyrics = 'Welcome to preschool rhyme studio! Testing vocals with background music rhythm.';
                payload.duration = 8;

                const tempDir = path.join(__dirname, 'temp');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                const reqFile = path.join(tempDir, `_req_prev_${stamp}.json`);
                fs.writeFileSync(reqFile, JSON.stringify(payload, null, 2), 'utf8');

                const scriptPath = path.join(__dirname, 'scripts', 'generate_mobile_rhyme.py');
                const { execSync } = require('child_process');
                const pyOut = execSync(`python "${scriptPath}" "${reqFile}"`, { encoding: 'utf8', timeout: 30000 });
                const result = JSON.parse(pyOut.trim() || '{}');

                if (result.ok && result.finalMp3 && fs.existsSync(result.finalMp3)) {
                  const audioBuffer = fs.readFileSync(result.finalMp3);
                  const base64 = audioBuffer.toString('base64');
                  try {
                    if (fs.existsSync(reqFile)) fs.unlinkSync(reqFile);
                    if (result.tmpVocal && fs.existsSync(result.tmpVocal)) fs.unlinkSync(result.tmpVocal);
                    if (fs.existsSync(result.finalMp3)) fs.unlinkSync(result.finalMp3);
                  } catch(_) {}
                  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                  res.end(JSON.stringify({ ok: true, audioBase64: base64, mimeType: 'audio/mp3' }));
                  return;
                }
              } catch (err) {
                console.error('[Vite Rhyme Preview Handler] error:', err);
              }
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Mobile preview failed.' }));
            });
            return;
          }
          if (req.url === '/' || req.url.startsWith('/src') || req.url.startsWith('/@') || req.url.startsWith('/node_modules')) {
            return next()
          }
          const filePath = path.join(__dirname, req.url.split('?')[0])
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase()
            const contentType = MIME_TYPES[ext] || 'application/octet-stream'
            const stat = fs.statSync(filePath)
            res.writeHead(200, {
              'Content-Type': contentType,
              'Content-Length': stat.size,
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'no-store',
            })
            fs.createReadStream(filePath).pipe(res)
            return
          }
          next()
        })
      }
    }
  ],
})
