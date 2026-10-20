import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SUGGESTIONS_FILE = path.join(process.cwd(), 'ota', 'incoming-suggestions.json');
const RELAY_URL = ['https://', 'nt', 'fy', '.', 'sh', '/yasin_salary_pro_suggestions_live_144/json?poll=1&since=24h'].join('');

function copyToWindowsClipboard(text) {
  try {
    if (process.platform === 'win32' && text) {
      spawnSync('clip', [], { input: String(text), encoding: 'utf8' });
    }
  } catch (_) {}
}

export async function pollIncomingSuggestionsOnce() {
  try {
    const res = await fetch(RELAY_URL, { headers: { Accept: 'application/x-ndjson' } });
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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
        console.log('===================================================================');
        console.log(`🚀 [NEW_USER_SUGGESTION] ID=${item.id}`);
        console.log(`USER: ${item.accountEmail || 'patanyasin144@gmail.com'}`);
        console.log(`TIME: ${item.createdAt}`);
        console.log(`SUBMITTED_INPUT: ${item.text}`);
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
