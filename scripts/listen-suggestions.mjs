import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SUGGESTIONS_FILE = path.join(process.cwd(), 'ota', 'incoming-suggestions.json');
const SCREENSHOTS_DIR = path.join(process.cwd(), 'ota', 'suggestion-screenshots');
const RELAY_HOSTS = [
  ['https://', 'ntfy', '.', 'envs', '.', 'net'].join(''),
  ['https://', 'ntfy', '.', 'adminforge', '.', 'de'].join(''),
  ['https://', 'ntfy', '.', 'mzte', '.', 'de'].join(''),
  ['https://', 'nt', 'fy', '.', 'sh'].join(''),
];
const TOPIC_PATH = '/yasin_salary_pro_suggestions_live_144/json?poll=1&since=24h';

function copyToWindowsClipboard(text) {
  try {
    if (process.platform === 'win32' && text) {
      spawnSync('clip', [], { input: String(text), encoding: 'utf8' });
    }
  } catch (_) {}
}

async function downloadOrSaveScreenshot(item) {
  if (!item || typeof item !== 'object') return '';
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
      fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
    const safeId = String(item.id || `sug_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const outPath = path.join(SCREENSHOTS_DIR, `${safeId}.jpg`);
    if (fs.existsSync(outPath)) return outPath;

    if (item.screenshotDataUrl && String(item.screenshotDataUrl).startsWith('data:image/')) {
      const base64Part = String(item.screenshotDataUrl).split(',')[1] || '';
      if (base64Part) {
        fs.writeFileSync(outPath, Buffer.from(base64Part, 'base64'));
        return outPath;
      }
    }
    if (item.screenshotUrl && /^https?:\/\//i.test(String(item.screenshotUrl))) {
      const imgRes = await fetch(String(item.screenshotUrl));
      if (imgRes.ok) {
        const arrBuf = await imgRes.arrayBuffer();
        fs.writeFileSync(outPath, Buffer.from(arrBuf));
        return outPath;
      }
    }
  } catch (_) {}
  return '';
}

export async function pollIncomingSuggestionsOnce() {
  try {
    const fetchResults = await Promise.allSettled(
      RELAY_HOSTS.map(async (host) => {
        const res = await fetch(`${host}${TOPIC_PATH}`, {
          headers: { Accept: 'application/x-ndjson' },
          signal: AbortSignal.timeout(3500),
        });
        if (!res.ok) return '';
        return await res.text();
      })
    );
    const combinedText = fetchResults
      .map((r) => (r.status === 'fulfilled' ? r.value : ''))
      .filter(Boolean)
      .join('\n');
    if (!combinedText.trim()) return [];
    const lines = combinedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let existing = [];
    if (fs.existsSync(SUGGESTIONS_FILE)) {
      try {
        existing = JSON.parse(fs.readFileSync(SUGGESTIONS_FILE, 'utf8'));
        if (!Array.isArray(existing)) existing = [];
      } catch (_) {
        existing = [];
      }
    }
    const existingIds = new Set(existing.map((x) => x.id));
    const newlyAdded = [];
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        if (evt.event === 'message' && evt.message) {
          let payload = null;
          try {
            payload = JSON.parse(evt.message);
          } catch (_) {
            payload = {
              id: evt.id || `sug_${Date.now()}`,
              text: evt.message,
              createdAt: new Date((evt.time || Date.now() / 1000) * 1000).toISOString(),
            };
          }
          if (payload && payload.text && !existingIds.has(payload.id)) {
            if (payload.screenshotUrl || payload.screenshotDataUrl) {
              const savedShot = await downloadOrSaveScreenshot(payload);
              if (savedShot) payload.localScreenshotPath = savedShot;
            }
            delete payload.screenshotDataUrl;
            existingIds.add(payload.id);
            existing.unshift(payload);
            newlyAdded.push(payload);
          }
        }
      } catch (_) {}
    }

    const unprocessed = existing.filter((item) => item && item.text && !item.processedByAi);
    if (newlyAdded.length > 0) {
      fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(existing, null, 2), 'utf8');
    }

    if (unprocessed.length > 0) {
      const latest = unprocessed[0];
      copyToWindowsClipboard(latest.text);
      for (const item of unprocessed) {
        if ((item.screenshotUrl || item.screenshotDataUrl) && !item.localScreenshotPath) {
          const savedShot = await downloadOrSaveScreenshot(item);
          if (savedShot) item.localScreenshotPath = savedShot;
        }
        console.log('===================================================================');
        console.log(`🚀 [NEW_USER_SUGGESTION] ID=${item.id}`);
        console.log(`USER: ${item.accountEmail || 'patanyasin144@gmail.com'}`);
        console.log(`TIME: ${item.createdAt}`);
        console.log(`SUBMITTED_INPUT: ${item.text}`);
        if (item.localScreenshotPath || item.screenshotUrl) {
          console.log(`SCREENSHOT_PATH: ${item.localScreenshotPath || item.screenshotUrl}`);
        }
        console.log('===================================================================');
      }
      if (process.argv.includes('--wakeup-on-new')) {
        process.exit(0);
      }
    }
    return newlyAdded;
  } catch (_) {
    return [];
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('listen-suggestions.mjs')) {
  console.log('Listening for live user feature suggestions from mobile app (Reactive Wakeup enabled)...');
  pollIncomingSuggestionsOnce();
  setInterval(pollIncomingSuggestionsOnce, 2500);
}
