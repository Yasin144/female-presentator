'use strict';

// Exercise the actual isolated Local worker, with independent caption checks.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const vm = require('node:vm');
const { validateCaptions, loadHelpers } = require('./check-caption-groq-recordings.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const expectSilence = args.includes('--expect-silence');
  const files = args.filter(arg => !['--live', '--expect-silence'].includes(arg)).map(file => path.resolve(file));
  if (!files.length) throw new Error('Provide explicit WAV paths; add --live to run the Local model.');
  const python = path.join(root, '.voiceclone-venv', 'Scripts', 'python.exe');
  const directory = path.join(root, 'caption-work', 'diagnostics', 'local-' + Date.now());
  fs.mkdirSync(directory, { recursive: true });
  const report = { mode: live ? 'live' : 'offline', recordings: [] };
  const context = vm.createContext({ Buffer });
  loadHelpers(context);
  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error('Recording does not exist: ' + file);
    const item = { file, status: 'validated' };
    report.recordings.push(item);
    item.duration = context.readGroqCaptionWav(fs.readFileSync(file)).duration;
    if (!live) {
      fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
      continue;
    }
    console.log('Testing Local: ' + path.basename(file));
    const start = Date.now();
    try {
      const output = await new Promise((resolve, reject) => {
        const child = spawn(python, ['-u', path.join(root, 'whisper-transcribe-caption.py'), file, 'auto', 'local-qa', 'speech', '', 'recover'],
          { cwd: root, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_OFFLINE: '1' } });
        let stdout = '', stderr = '';
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        const timer = setTimeout(() => {
          if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          else child.kill();
          reject(new Error('Local replay exceeded 20 minutes.'));
        }, 1200000);
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => {
          clearTimeout(timer);
          if (code !== 0) reject(new Error(stderr.slice(-500) || 'Worker exited with code ' + code));
          else resolve(stdout);
        });
      });
      const result = JSON.parse(output.trim().split(/\r?\n/).at(-1));
      if (result.error) throw new Error(result.error);
      const resultPath = path.join(directory, path.basename(file) + '.json');
      fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
      item.resultPath = resultPath;
      item.words = result.words?.length || 0;
      item.segments = result.segments?.length || 0;
      item.warnings = result.warnings || [];
      item.noSpeech = result.noSpeech === true && !item.words && !item.segments && !String(result.text || '').trim();
      if (expectSilence && !item.noSpeech) throw new Error('Silent audio produced hallucinated speech.');
      item.issues = item.noSpeech ? [] : validateCaptions({ ...result, timingSource: item.words ? 'word' : 'estimated' }, item.duration);
      if (item.issues.length) throw new Error(item.issues.join(' '));
      item.status = 'passed';
    } catch (error) { item.status = 'failed'; item.error = error.message; }
    item.elapsedSeconds = (Date.now() - start) / 1000;
    console.log(`${item.status.toUpperCase()} ${path.basename(file)}: ${item.words || 0} words, ${item.elapsedSeconds.toFixed(1)}s${item.error ? '; ' + item.error : ''}`);
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log('Report: ' + path.join(directory, 'report.json'));
  process.exitCode = report.recordings.some(item => item.status === 'failed') ? 1 : 0;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
