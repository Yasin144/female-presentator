'use strict';

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { fileURLToPath } = require('node:url');
const { loadHelpers, validateCaptions } = require('./check-caption-groq-recordings.cjs');
const root = path.resolve(__dirname, '..');
const sourceFolder = 'D:/LESSONS/ENGLISH/ENGLISH C5 L9-12/ENGLISH C5 L9 VIDEOS';
const names = ['LIFE SKILLS', 'TIME TO KNOW NEW WORDS', 'TIME TO LISTEN', 'TIME TO LISTEN-1',
  'TIME TO RECITE', 'TIME TO WARMUP', 'TOP TIPS FOR GRAMMER', 'TOP TIPS FOR TEACHERS'];
const files = names.map(name => path.join(sourceFolder, 'ENGLISH C5 L9 ' + name + '.mp4'));
const recovery = path.join(root, 'caption-work', 'recovery', 'before-local-export-20261014-114126');
const audioNames = ['1791954689281', '1791954719911', '1791954722565', '1791954724730',
  '1791954727186', '1791954867937', '1791954871229', '1791954876610'].map(stamp => 'caption-' + stamp + '.wav');

function verifiedRecords() {
  const report = JSON.parse(fs.readFileSync(path.join(root, 'caption-work/diagnostics/local-caption-validation-latest.json'), 'utf8'));
  return audioNames.map(name => {
    const record = report.recordings.find(item => path.basename(item.file) === name);
    if (!record || record.status !== 'passed') throw new Error('Local transcript is not verified: ' + name);
    return record;
  });
}

async function main() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9228' });
  try {
    const pages = (await browser.pages()).filter(page => page.url().startsWith('app://voice/'));
    if (pages.length !== 1) throw new Error('The desktop app renderer is ambiguous.');
    const page = pages[0];
    const action = process.argv[2] || 'inspect';
    if (action === 'inspect') {
      console.log(JSON.stringify(await page.evaluate(() => ({ title: document.title,
        text: document.body.innerText.slice(0, 13000),
        api: Object.keys(window.electronAPI || {}).filter(name => /Agent|ranscribe|urnCaption|probeVideo/.test(name)),
        hasSavedProject: Boolean(localStorage.getItem('pattan-my-exporter-project-v1')),
        bridgeMethods: Object.keys(window.captionLocalWorkbenchAPI || {}),
      })), null, 2));
    } else if (action === 'checkpoint') {
      const initial = await page.evaluate(() => {
        const current = window.captionLocalWorkbenchAPI?.getState?.();
        if (!current || current.disabled) throw new Error('Caption jobs must be idle before checkpointing.');
        const settings = [...document.querySelectorAll('#aiCaptionSection input,#aiCaptionSection select,#aiCaptionSection textarea')]
          .filter(element => element.id && element.type !== 'password' && !/key|token|secret/i.test(element.id))
          .map(element => ({ id: element.id, value: element.type === 'file' ? '' : element.value, checked: element.checked }));
        return { current, settings, selectedEngine: document.getElementById('captionEngine')?.value,
          queue: [...document.querySelectorAll('#captionQueueList > div > button:first-child')].map(button => button.innerText),
          inputPaths: [...(document.getElementById('captionVideoInput')?.files || [])]
            .map(file => file.path || window.electronAPI?.getPathForFile?.(file)).filter(Boolean),
          projects: Object.fromEntries(Object.keys(localStorage)
            .filter(key => /project|workspace|caption|learning/i.test(key) && !/token|key|secret/i.test(key))
            .map(key => [key, localStorage.getItem(key)])) };
      });
      const checkpoint = path.join(root, 'caption-work', 'recovery', 'caption-queue-' + new Date().toISOString().replace(/[:.]/g, '-'));
      fs.mkdirSync(checkpoint, { recursive: true });
      const saved = [];
      try {
        for (let index = 0; index < initial.queue.length; index += 1) {
          await page.evaluate(rowIndex => {
            if (window.captionLocalWorkbenchAPI.getState().disabled) throw new Error('A caption job started during checkpointing.');
            document.querySelectorAll('#captionQueueList > div > button:first-child')[rowIndex].click();
          }, index);
          const snapshot = await page.evaluate(() => ({ ...window.captionLocalWorkbenchAPI.getState(),
            preview: document.querySelector('#captionExportActions video')?.src || '' }));
          if (snapshot.disabled) throw new Error('A caption job started during checkpointing.');
          const source = [...initial.inputPaths, ...files].find(file => path.basename(file) === snapshot.videoName);
          saved.push({ ...snapshot, source: source || null, sourceExists: !!source && fs.existsSync(source),
            row: initial.queue[index], outputPreview: / - exported\b/.test(initial.queue[index]) && snapshot.captions.length ? snapshot.preview : '' });
        }
      } finally {
        await page.evaluate(({ videoName, settings }) => {
          if (window.captionLocalWorkbenchAPI?.getState?.().disabled) return;
          const row = [...document.querySelectorAll('#captionQueueList button')].find(button => button.textContent.includes(videoName));
          row?.click();
          for (const setting of settings) {
            const control = document.getElementById(setting.id);
            if (!control || control.type === 'file') continue;
            control.value = setting.value;
            if (typeof setting.checked === 'boolean') control.checked = setting.checked;
          }
        }, { videoName: initial.current.videoName, settings: initial.settings });
        fs.writeFileSync(path.join(checkpoint, 'queue-checkpoint.json'), JSON.stringify({ ...initial, saved }, null, 2) + '\n');
      }
      console.log(JSON.stringify({ checkpoint, savedVideos: saved.length,
        drafts: saved.filter(item => item.captions?.length).length, engine: initial.selectedEngine }, null, 2));
    } else if (action === 'navigate') {
      const target = await page.evaluateHandle(() => {
        const matches = [...document.querySelectorAll('button,a')]
          .filter(element => element.textContent.includes('AI Captioning (Local)'));
        if (matches.length !== 1) throw new Error('Caption navigation is ambiguous.');
        return matches[0];
      });
      if (!target.asElement()) throw new Error('Caption navigation was not found.');
      await target.asElement().click();
      await page.waitForSelector('#captionEngine');
      console.log('Caption module opened.');
    } else if (action === 'reload-idle') {
      const busy = await page.evaluate(() => window.captionLocalWorkbenchAPI?.getState?.().disabled);
      if (busy) throw new Error('Wait for all caption jobs to finish before reloading the renderer.');
      await page.reload({ waitUntil: 'domcontentloaded' });
      console.log('Idle renderer reloaded.');
    } else if (action === 'restore-checkpoint') {
      const checkpointFile = path.resolve(process.argv[3] || '');
      const snapshot = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
      const before = await page.evaluate(() => ({ busy: window.captionLocalWorkbenchAPI?.getState?.().disabled,
        rows: document.querySelectorAll('#captionQueueList > div > button:first-child').length }));
      if (before.busy || before.rows) throw new Error('Restore requires an empty, idle caption queue. Existing work was left untouched.');
      const sourcePaths = snapshot.saved.map(item => item.source);
      if (!sourcePaths.length || sourcePaths.some(file => !file || !fs.existsSync(file))) throw new Error('A saved source video is missing.');
      await page.evaluate(filePaths => window.dispatchEvent(new CustomEvent('presentator-ai-video-captioning-import',
        { detail: { filePaths, language: 'English', autoStart: false } })), sourcePaths);
      for (const item of snapshot.saved.filter(item => item.captions?.length)) {
        await page.evaluate(fileName => [...document.querySelectorAll('#captionQueueList > div > button:first-child')]
          .find(button => button.textContent.includes(fileName))?.click(), item.videoName);
        await page.waitForFunction(fileName => window.captionLocalWorkbenchAPI.getState().videoName === fileName
          && document.getElementById('captionSourceVideo').readyState >= 1, {}, item.videoName);
        await page.evaluate(item => {
          const api = window.captionLocalWorkbenchAPI;
          api.applyCaptions(api.getState().itemId, item.captions, { timingSource: item.timingSource, warnings: item.warnings,
            sourceLanguage: item.sourceLanguage, outputLanguage: item.outputLanguage,
            ...(item.engine ? { engine: item.engine, recoveredFromEngine: item.recoveredFromEngine } : {}) });
        }, item);
      }
      await page.evaluate(snapshot => {
        const row = [...document.querySelectorAll('#captionQueueList > div > button:first-child')]
          .find(button => button.textContent.includes(snapshot.current.videoName));
        row?.click();
        for (const setting of snapshot.settings) {
          const control = document.getElementById(setting.id);
          if (!control || control.type === 'file') continue;
          control.value = setting.value;
          if (typeof setting.checked === 'boolean') control.checked = setting.checked;
          control.dispatchEvent(new Event(control.type === 'range' ? 'input' : 'change', { bubbles: true }));
        }
      }, snapshot);
      console.log('Restored sources, saved caption drafts, provenance and non-secret settings without starting jobs.');
    } else if (action === 'restore-sources') {
      const before = await page.evaluate(() => ({ busy: window.captionLocalWorkbenchAPI?.getState?.().disabled,
        rows: document.querySelectorAll('#captionQueueList > div > button:first-child').length }));
      if (before.busy || before.rows) throw new Error('Restore requires an empty, idle caption queue. Existing work was left untouched.');
      files.forEach(file => { if (!fs.existsSync(file)) throw new Error('Missing source video: ' + file); });
      await page.evaluate(filePaths => window.dispatchEvent(new CustomEvent('presentator-ai-video-captioning-import',
        { detail: { filePaths, language: 'English', autoStart: false } })), files);
      await page.waitForFunction(count => document.querySelectorAll('#captionQueueList > div > button:first-child').length === count, {}, files.length);
      console.log('Eight original sources restored without starting jobs.');
    } else if (action === 'import-groq-verified') {
      const context = vm.createContext({ Buffer }); loadHelpers(context);
      const reports = ['groq-live-8-videos-latest.json', 'groq-live-life-skills-retry.json', 'groq-fixed-three-latest.json']
        .map(name => JSON.parse(fs.readFileSync(path.join(root, 'caption-work', 'diagnostics', name), 'utf8')));
      const records = new Map();
      for (const report of reports) for (const record of report.recordings) {
        const index = audioNames.indexOf(path.basename(record.file));
        if (index >= 0 && record.status === 'passed' && record.resultPath) records.set(index, record);
      }
      const imported = [];
      for (const [index, record] of records) {
        const busy = await page.evaluate(() => window.captionLocalWorkbenchAPI.getState().disabled);
        if (busy) throw new Error('Wait for all caption jobs to finish before importing verified results.');
        const result = JSON.parse(fs.readFileSync(record.resultPath, 'utf8'));
        const audio = context.readGroqCaptionWav(fs.readFileSync(record.file));
        if (result.engine !== 'groq' || result.timingSource !== 'word' || validateCaptions(result, audio.duration).length)
          throw new Error('The saved result is not a validated Groq word transcript.');
        const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', files[index], '-vn', '-acodec', 'pcm_s16le',
          '-ar', '16000', '-ac', '1', '-f', 's16le', 'pipe:1'], { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
        const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
        if (decoded.status !== 0 || hash(decoded.stdout) !== hash(audio.pcm)) throw new Error('The source audio changed since the Groq test.');
        const cues = result.segments.map(segment => ({ start: segment.start, end: segment.end, text: segment.text,
          words: result.words.filter(word => word.start >= segment.start && word.end <= segment.end)
            .map(word => ({ text: word.word, start: word.start, end: word.end })) }));
        if (cues.reduce((count, cue) => count + cue.words.length, 0) !== result.words.length)
          throw new Error('Caption words lost their phrase coverage.');
        await page.evaluate(fileName => {
          const rows = [...document.querySelectorAll('#captionQueueList > div > button:first-child')]
            .filter(button => button.textContent.includes(fileName));
          if (rows.length !== 1) throw new Error('The source queue row is ambiguous.');
          rows[0].click();
        }, path.basename(files[index]));
        await page.waitForFunction(fileName => window.captionLocalWorkbenchAPI.getState().videoName === fileName
          && document.getElementById('captionSourceVideo').readyState >= 1, {}, path.basename(files[index]));
        const state = await page.evaluate(({ captions, warnings, sourceLanguage }) => {
          const api = window.captionLocalWorkbenchAPI;
          const selected = api.getState();
          if (selected.captions.length) {
            const signature = cues => JSON.stringify(cues.map(cue => [cue.start, cue.end, cue.text,
              (cue.words || []).map(word => [word.start, word.end, word.text])]));
            if (selected.engine !== 'groq' || selected.recoveredFromEngine || signature(selected.captions) !== signature(captions))
              throw new Error('An existing draft was left untouched.');
            return selected;
          }
          api.applyCaptions(selected.itemId, captions, { engine: 'groq', timingSource: 'word', warnings,
            sourceLanguage, outputLanguage: 'en' });
          return api.getState();
        }, { captions: cues, warnings: result.warnings || [], sourceLanguage: result.language || 'en' });
        if (state.engine !== 'groq' || state.recoveredFromEngine || state.captions.length !== cues.length)
          throw new Error('The app cannot preserve the verified Groq result provenance. Reload the updated renderer.');
        imported.push({ source: files[index], audioSha256: hash(audio.pcm), transcriptPath: record.resultPath, ...state });
      }
      const reportPath = path.join(root, 'caption-work', 'diagnostics', 'restored-groq-drafts.json');
      fs.writeFileSync(reportPath, JSON.stringify(imported, null, 2) + '\n');
      console.log(JSON.stringify({ imported: imported.length, reportPath, engine: 'groq', apiRequests: 0 }, null, 2));
    } else if (action === 'restore' || action === 'restore-one') {
      const busy = await page.evaluate(() => window.captionLocalWorkbenchAPI?.getState?.().disabled);
      if (busy) throw new Error('Wait for all caption jobs to finish before restoring sources.');
      files.forEach(file => { if (!fs.existsSync(file)) throw new Error('Missing source video: ' + file); });
      const onlyIndex = action === 'restore-one' ? Number(process.argv[3]) : null;
      if (onlyIndex !== null && (!Number.isInteger(onlyIndex) || onlyIndex < 0 || onlyIndex >= files.length))
        throw new Error('Specify a valid source queue index.');
      const selectedFiles = onlyIndex === null ? files : [files[onlyIndex]];
      const storage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
        .filter(key => /project|workspace|caption|learning/i.test(key) && !/token|key|secret/i.test(key))
        .map(key => [key, localStorage.getItem(key)])));
      fs.writeFileSync(path.join(recovery, onlyIndex === null ? 'saved-projects.json' : 'saved-projects-single-retry.json'), JSON.stringify(storage, null, 2) + '\n');
      fs.writeFileSync(path.join(recovery, onlyIndex === null ? 'source-queue.json' : 'source-queue-single-retry.json'), JSON.stringify({ files: selectedFiles, previousExported: [0, 4],
        captionSettings: { engine: 'groq', contentMode: 'speech', language: 'English', style: 'white-yellow',
          font: 'Nunito, sans-serif', fontSize: 50, color: '#fde047' } }, null, 2) + '\n');
      await page.evaluate(filePaths => window.dispatchEvent(new CustomEvent('presentator-ai-video-captioning-import',
        { detail: { filePaths, language: 'English', autoStart: false } })), selectedFiles);
      await page.waitForFunction(count => document.getElementById('captionQueueList')?.querySelectorAll('button').length >= count, {}, selectedFiles.length);
      console.log(selectedFiles.length + ' original source video(s) restored without starting jobs.');
    } else if (action === 'configure' || action === 'configure-groq') {
      const busy = await page.evaluate(() => window.captionLocalWorkbenchAPI?.getState?.().disabled);
      if (busy) throw new Error('Wait for all caption jobs to finish before changing engines.');
      await page.select('#captionEngine', action === 'configure-groq' ? 'groq' : 'local');
      await page.select('#captionContentMode', 'speech');
      const englishValue = await page.$eval('#captionLanguage', control => [...control.options]
        .find(option => option.value === 'en' || option.value === 'English')?.value);
      if (!englishValue) throw new Error('The English output option was not found.');
      await page.select('#captionLanguage', englishValue);
      await page.evaluate(() => {
        const recoveryControl = document.getElementById('captionAutoRecover');
        recoveryControl.checked = true;
        recoveryControl.dispatchEvent(new Event('change', { bubbles: true }));
        const localRecovery = document.getElementById('captionGroqLocalRecovery');
        if (localRecovery) {
          localRecovery.checked = false;
          localRecovery.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      console.log((action === 'configure-groq' ? 'Groq-only' : 'Local') + ' speech captions selected with missing-speech recovery enabled.');
    } else if (action === 'verify-sources') {
      const context = vm.createContext({ Buffer }); loadHelpers(context);
      const records = verifiedRecords();
      const proofs = files.map((file, index) => {
        const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-acodec', 'pcm_s16le',
          '-ar', '16000', '-ac', '1', '-f', 's16le', 'pipe:1'], { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
        if (decoded.status !== 0) throw new Error('Could not verify source audio: ' + file);
        const cached = context.readGroqCaptionWav(fs.readFileSync(records[index].file)).pcm;
        const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
        const actual = hash(decoded.stdout), expected = hash(cached);
        if (actual !== expected) throw new Error('The video audio changed after Local validation: ' + file);
        return { file, transcript: records[index].resultPath, sha256: actual, matches: true };
      });
      fs.writeFileSync(path.join(recovery, 'verified-source-audio.json'), JSON.stringify(proofs, null, 2) + '\n');
      console.log('All eight source audio tracks exactly match the verified Local transcriptions.');
    } else if (action === 'import-verified' || action === 'import-verified-one') {
      const proofs = JSON.parse(fs.readFileSync(path.join(recovery, 'verified-source-audio.json'), 'utf8'));
      if (proofs.length !== 8 || proofs.some(item => !item.matches)) throw new Error('Source audio verification is missing.');
      const onlyIndex = action === 'import-verified-one' ? Number(process.argv[3]) : null;
      if (onlyIndex !== null && (!Number.isInteger(onlyIndex) || onlyIndex < 0 || onlyIndex >= files.length))
        throw new Error('Specify a valid source queue index.');
      const before = await page.evaluate(() => ({
        busy: window.captionLocalWorkbenchAPI.getState().disabled,
        queue: document.getElementById('captionQueueList')?.innerText,
        status: document.getElementById('captionProgress')?.innerText,
      }));
      if (before.busy) throw new Error('Wait for the running queue to finish before importing captions.');
      if (onlyIndex !== null) fs.writeFileSync(path.join(recovery, 'failed-local-attempt.json'), JSON.stringify(before, null, 2) + '\n');
      const records = verifiedRecords();
      const saved = [];
      for (let index = 0; index < files.length; index += 1) {
        if (onlyIndex !== null && index !== onlyIndex) continue;
        const result = JSON.parse(fs.readFileSync(records[index].resultPath, 'utf8'));
        const cues = result.segments.map(segment => ({ start: segment.start, end: segment.end, text: segment.text,
          words: result.words.filter(word => word.start >= segment.start && word.end <= segment.end)
            .map(word => ({ text: word.word, start: word.start, end: word.end })) }));
        if (cues.reduce((count, cue) => count + cue.words.length, 0) !== result.words.length) throw new Error('Caption words lost their phrase coverage.');
        await page.evaluate(fileName => {
          const rows = [...document.querySelectorAll('#captionQueueList button')]
            .filter(button => button.textContent.includes(fileName));
          if (rows.length !== 1) throw new Error('Source queue row is ambiguous.');
          rows[0].click();
        }, path.basename(files[index]));
        await page.waitForFunction(fileName => window.captionLocalWorkbenchAPI?.getState()?.videoName === fileName
          && document.getElementById('captionSourceVideo')?.readyState >= 1, {}, path.basename(files[index]));
        const state = await page.evaluate(({ captions, warnings, sourceLanguage, outputLanguage }) => {
          const api = window.captionLocalWorkbenchAPI;
          const state = api.getState();
          api.applyCaptions(state.itemId, captions, { timingSource: 'word', warnings, sourceLanguage, outputLanguage });
          return api.getState();
        }, { captions: cues, warnings: result.warnings || [], sourceLanguage: result.language || 'en', outputLanguage: 'en' });
        if (state.captions.length !== cues.length || state.timingSource !== 'word')
          throw new Error('The verified Local caption import did not apply.');
        saved.push({ source: files[index], engine: 'local', transcriptPath: records[index].resultPath, ...state });
      }
      const settings = await page.evaluate(() => [...document.querySelectorAll('#aiCaptionSection input,#aiCaptionSection select,#aiCaptionSection textarea')]
        .filter(element => element.id && element.type !== 'password' && !/key|token/i.test(element.id))
        .map(element => ({ id: element.id, value: element.type === 'file' ? '' : element.value, checked: element.checked })));
      const savedFile = onlyIndex === null ? 'local-caption-queue.json' : 'local-caption-retry-' + onlyIndex + '.json';
      fs.writeFileSync(path.join(recovery, savedFile), JSON.stringify({ files, settings, saved }, null, 2) + '\n');
      const projects = JSON.parse(fs.readFileSync(path.join(recovery, 'saved-projects.json'), 'utf8'));
      if (projects['pattan-my-exporter-project-v1']) fs.writeFileSync(path.join(recovery, 'my-exporter-recovery.pattanproject'), projects['pattan-my-exporter-project-v1']);
      console.log('Imported and saved verified Local captions for ' + saved.length + ' video(s).');
    } else if (action === 'verify-checkpoint') {
      const state = await page.evaluate(() => window.captionLocalWorkbenchAPI.getState());
      if (state.disabled) throw new Error('Wait for all caption exports to finish before verifying outputs.');
      const snapshot = JSON.parse(fs.readFileSync(path.resolve(process.argv[3] || ''), 'utf8'));
      const exported = snapshot.saved.filter(item => / - exported\b/.test(item.row));
      if (!exported.length) throw new Error('No completed exports were captured.');
      const probe = file => {
        const response = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
          { encoding: 'utf8', windowsHide: true });
        if (response.status !== 0) throw new Error('Could not inspect video: ' + file);
        return JSON.parse(response.stdout);
      };
      const verified = exported.map(item => {
        const output = fileURLToPath(item.outputPreview);
        const original = probe(item.source), encoded = probe(output);
        const sourceVideo = original.streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
        const video = encoded.streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
        const audio = encoded.streams.find(stream => stream.codec_type === 'audio');
        if (!video || !audio || video.width !== sourceVideo.width || video.height !== sourceVideo.height
          || Math.abs(Number(encoded.format.duration) - Number(original.format.duration)) > 0.15)
          throw new Error('Export dimensions, audio or duration do not match the source: ' + output);
        let previousEnd = 0;
        for (const cue of item.captions) {
          if (cue.start < previousEnd || cue.end <= cue.start || cue.end > Number(original.format.duration) + 0.005)
            throw new Error('The saved caption timeline is outside the video or overlapping.');
          previousEnd = cue.end;
          let wordEnd = cue.start;
          for (const word of cue.words || []) {
            if (word.start < wordEnd || word.end > cue.end || word.end <= word.start)
              throw new Error('The saved word timeline is invalid.');
            wordEnd = word.end;
          }
        }
        const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'],
          { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
        if (decode.status !== 0 || decode.stderr.trim()) throw new Error('The exported video failed full audio/video decoding: ' + output);
        return { source: item.source, output, engine: item.engine, recoveredFromEngine: item.recoveredFromEngine,
          captions: item.captions.length, width: video.width, height: video.height,
          duration: Number(encoded.format.duration), bytes: fs.statSync(output).size, fullDecode: true };
      });
      const reportPath = path.join(root, 'caption-work', 'diagnostics', 'ready-caption-export-verification.json');
      fs.writeFileSync(reportPath, JSON.stringify({ verified }, null, 2) + '\n');
      console.log(JSON.stringify({ verified: verified.length, reportPath, engines: [...new Set(verified.map(item => item.engine))] }, null, 2));
    } else if (action === 'export-ready') {
      const state = await page.evaluate(() => window.captionLocalWorkbenchAPI.getState());
      if (state.disabled) throw new Error('Wait for the active caption job to finish before exporting.');
      const button = await page.$('#captionQueueExportAllBtn');
      if (!button || await button.evaluate(element => element.disabled)) throw new Error('There are no ready captions to export.');
      await button.click();
      console.log('Started export of ready caption drafts only; no new recognition requests.');
    } else if (action === 'monitor-ready') {
      const reportPath = path.join(root, 'caption-work', 'diagnostics', 'ready-caption-export-latest.json');
      let previous = '';
      for (;;) {
        const snapshot = await page.evaluate(() => ({ engine: document.getElementById('captionEngine')?.value,
          queue: [...document.querySelectorAll('#captionQueueList > div > button:first-child')].map(button => button.innerText),
          status: document.getElementById('captionStatusText')?.innerText,
          current: window.captionLocalWorkbenchAPI.getState() }));
        fs.writeFileSync(reportPath, JSON.stringify(snapshot, null, 2) + '\n');
        const exported = snapshot.queue.filter(row => / - exported\b/.test(row)).length;
        const key = exported + ':' + snapshot.current.videoName;
        if (key !== previous) {
          console.log(`${exported}/${snapshot.queue.length} exported. ${snapshot.current.videoName}`);
          previous = key;
        }
        if (!snapshot.current.disabled) { console.log(JSON.stringify({ reportPath, exported, queue: snapshot.queue }, null, 2)); break; }
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    } else if (action === 'status') {
      const snapshot = await page.evaluate(() => ({
        engine: document.getElementById('captionEngine')?.value,
        contentMode: document.getElementById('captionContentMode')?.value,
        queue: document.getElementById('captionQueueList')?.innerText,
        status: document.getElementById('captionProgress')?.innerText,
        queueStatus: document.getElementById('captionQueueStatus')?.innerText,
        runDisabled: document.getElementById('captionQueueRunBtn')?.disabled,
        current: window.captionLocalWorkbenchAPI?.getState?.(),
        observed: window.__localExportRecovery || {},
        latestExportPreview: document.querySelector('#captionExportActions video')?.src || '',
      }));
      fs.writeFileSync(path.join(recovery, 'live-local-queue.json'), JSON.stringify(snapshot, null, 2) + '\n');
      const { current, observed, ...status } = snapshot;
      console.log(JSON.stringify({ ...status, currentVideo: current?.videoName, captionCount: current?.captions?.length,
        warnings: current?.warnings, savedCaptionDrafts: Object.keys(observed).length }, null, 2));
    } else if (action === 'watch') {
      await page.evaluate(() => {
        if (window.__localExportRecoveryObserver) return;
        window.__localExportRecovery = {};
        const capture = () => {
          const state = window.captionLocalWorkbenchAPI?.getState?.();
          if (!state?.videoName || !state.captions?.length) return;
          const preview = document.querySelector('#captionExportActions video');
          const settings = [...document.querySelectorAll('#aiCaptionSection input,#aiCaptionSection select,#aiCaptionSection textarea')]
            .filter(element => element.id && element.type !== 'password' && !/key|token/i.test(element.id))
            .map(element => ({ id: element.id, value: element.type === 'file' ? '' : element.value, checked: element.checked }));
          window.__localExportRecovery[state.videoName] = { ...state, settings,
            outputPreview: preview?.src || '', savedLabel: document.getElementById('captionExportActions')?.innerText };
        };
        window.__localExportRecoveryObserver = new MutationObserver(capture);
        window.__localExportRecoveryObserver.observe(document.getElementById('captionQueueList'), { childList: true, subtree: true });
        capture();
      });
      console.log('Watching completed Local captions without changing the running queue.');
    } else if (action === 'monitor') {
      let previous = '';
      for (;;) {
        const snapshot = await page.evaluate(() => ({
          engine: document.getElementById('captionEngine')?.value,
          queue: document.getElementById('captionQueueList')?.innerText,
          status: document.getElementById('captionProgress')?.innerText,
          queueStatus: document.getElementById('captionQueueStatus')?.innerText,
          runDisabled: document.getElementById('captionQueueRunBtn')?.disabled,
          current: window.captionLocalWorkbenchAPI?.getState?.(),
          observed: window.__localExportRecovery || {},
        }));
        fs.writeFileSync(path.join(recovery, 'live-local-queue.json'), JSON.stringify(snapshot, null, 2) + '\n');
        const phase = snapshot.status?.replace(/\d+%/g, '%');
        const exported = (snapshot.queue?.match(/ - exported/g) || []).length;
        const key = snapshot.current?.videoName + ':' + exported + ':' + phase;
        if (key !== previous) {
          const total = (snapshot.queue?.match(/^\d+\./gm) || []).length;
          console.log(`${exported}/${total} exported. ${snapshot.status}`);
          previous = key;
        }
        if (snapshot.current?.disabled === false) { console.log(snapshot.queue); break; }
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    } else if (action === 'save-current') {
      const state = await page.evaluate(() => ({ ...window.captionLocalWorkbenchAPI.getState(),
        outputPreview: document.querySelector('#captionExportActions video')?.src || '',
        savedLabel: document.getElementById('captionExportActions')?.innerText,
        settings: [...document.querySelectorAll('#aiCaptionSection input,#aiCaptionSection select,#aiCaptionSection textarea')]
          .filter(element => element.id && element.type !== 'password' && !/key|token/i.test(element.id))
          .map(element => ({ id: element.id, value: element.type === 'file' ? '' : element.value, checked: element.checked })),
      }));
      const source = files.find(file => path.basename(file) === state.videoName);
      if (!source || state.disabled || !state.captions.length) throw new Error('The current caption draft is not ready to save.');
      const savePath = path.join(recovery, path.basename(source) + '.captions.json');
      fs.writeFileSync(savePath, JSON.stringify({ source, engine: 'local', ...state }, null, 2) + '\n');
      console.log(JSON.stringify({ savePath, videoName: state.videoName, captions: state.captions.length,
        outputPreview: state.outputPreview, timingSource: state.timingSource, warnings: state.warnings }, null, 2));
    } else if (action === 'save-completed') {
      const busy = await page.evaluate(() => window.captionLocalWorkbenchAPI.getState().disabled);
      if (busy) throw new Error('Wait for all queue jobs to finish before saving the full queue.');
      const saved = [];
      for (const file of files) {
        await page.evaluate(fileName => [...document.querySelectorAll('#captionQueueList button')]
          .find(button => button.textContent.includes(fileName))?.click(), path.basename(file));
        await page.waitForFunction(fileName => window.captionLocalWorkbenchAPI.getState().videoName === fileName
          && document.getElementById('captionSourceVideo').readyState >= 1, {}, path.basename(file));
        const state = await page.evaluate(() => ({ ...window.captionLocalWorkbenchAPI.getState(),
          outputPreview: document.querySelector('#captionExportActions video')?.src || '',
          savedLabel: document.getElementById('captionExportActions')?.innerText,
          settings: [...document.querySelectorAll('#aiCaptionSection input,#aiCaptionSection select,#aiCaptionSection textarea')]
            .filter(element => element.id && element.type !== 'password' && !/key|token/i.test(element.id))
            .map(element => ({ id: element.id, value: element.type === 'file' ? '' : element.value, checked: element.checked })),
        }));
        saved.push({ source: file, engine: 'local', ...state });
        fs.writeFileSync(path.join(recovery, path.basename(file) + '.captions.json'), JSON.stringify(state, null, 2) + '\n');
      }
      fs.writeFileSync(path.join(recovery, 'completed-local-exports.json'), JSON.stringify(saved, null, 2) + '\n');
      console.log('Saved caption drafts and export locations for all eight videos.');
    } else if (action === 'verify-completed' || action === 'verify-current') {
      const expectedFiles = action === 'verify-current' ? [files[6]] : files;
      const saved = action === 'verify-current'
        ? [JSON.parse(fs.readFileSync(path.join(recovery, path.basename(files[6]) + '.captions.json'), 'utf8'))]
        : JSON.parse(fs.readFileSync(path.join(recovery, 'completed-local-exports.json'), 'utf8'));
      if (saved.length !== expectedFiles.length) throw new Error('The completed queue is incomplete.');
      const probe = file => {
        const result = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
          { encoding: 'utf8', windowsHide: true });
        if (result.status !== 0) throw new Error('Could not inspect video: ' + file);
        return JSON.parse(result.stdout);
      };
      const results = saved.map((item, index) => {
        if (item.source !== expectedFiles[index] || item.engine !== 'local' || !item.captions?.length)
          throw new Error('The saved Local caption queue does not match the source videos.');
        const output = fileURLToPath(item.outputPreview);
        const originalProbe = probe(item.source), outputProbe = probe(output);
        const originalVideo = originalProbe.streams.find(stream => stream.codec_type === 'video');
        const video = outputProbe.streams.find(stream => stream.codec_type === 'video');
        const audio = outputProbe.streams.find(stream => stream.codec_type === 'audio');
        const durationDifference = Math.abs(Number(outputProbe.format.duration) - Number(originalProbe.format.duration));
        if (!video || !audio || video.width !== originalVideo.width || video.height !== originalVideo.height
          || !Number.isFinite(durationDifference) || durationDifference > 0.1 || fs.statSync(output).size === 0)
          throw new Error('The exported video failed its stream or duration check: ' + output);
        let previousEnd = 0, words = 0;
        for (const cue of item.captions) {
          if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < previousEnd - 1e-6
            || cue.end <= cue.start || cue.start < 0 || cue.end > item.duration + 0.05 || !cue.words?.length)
            throw new Error('The saved caption timeline is invalid: ' + item.videoName);
          let previousWordEnd = cue.start;
          for (const word of cue.words) {
            if (!word.text?.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end)
              || word.start < previousWordEnd - 1e-6 || word.end <= word.start || word.end > cue.end + 1e-6)
              throw new Error('The saved word timing is invalid: ' + item.videoName);
            previousWordEnd = word.end;
            words += 1;
          }
          previousEnd = cue.end;
        }
        return { source: item.source, output, captionCount: item.captions.length, wordCount: words,
          width: video.width, height: video.height, videoCodec: video.codec_name, audioCodec: audio.codec_name,
          durationSeconds: Number(outputProbe.format.duration), durationDifferenceSeconds: durationDifference,
          sizeBytes: fs.statSync(output).size, timelineValid: true, warnings: item.warnings || [] };
      });
      const report = { checkedAt: new Date().toISOString(), engine: 'local', exportedCount: results.length,
        technicalChecksPassed: true, recognitionAccuracyRequiresReview: true, results };
      fs.writeFileSync(path.join(recovery, action === 'verify-current' ? 'grammar-local-verification.json' : 'completed-local-verification.json'),
        JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report, null, 2));
    } else if (action === 'export-current') {
      const state = await page.evaluate(() => ({ engine: document.getElementById('captionEngine')?.value,
        current: window.captionLocalWorkbenchAPI.getState(), disabled: document.getElementById('captionExportBtn')?.disabled }));
      if (state.engine !== 'local' || state.disabled || state.current.disabled || !state.current.captions.length
        || state.current.videoName !== path.basename(files[6])) throw new Error('The verified Local grammar draft is not ready to export.');
      await page.click('#captionExportBtn');
      console.log('Started direct export of the verified Local grammar caption draft.');
    } else if (action === 'start') {
      const state = await page.evaluate(() => ({ engine: document.getElementById('captionEngine')?.value,
        disabled: document.getElementById('captionQueueRunBtn')?.disabled }));
      if (state.engine !== 'local' || state.disabled) throw new Error('The Local export queue is not ready.');
      await page.click('#captionQueueRunBtn');
      console.log('Started the Local transcription and export queue.');
    } else throw new Error('Unknown session action.');
  } finally { await browser.disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
