'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const nodeTests = [
  'test-caption-local-ipc.cjs', 'test-caption-asr-timing.cjs', 'test-my-exporter-captions.cjs',
  'test-caption-group-parity.cjs', 'test-caption-export-parity.cjs', 'test-caption-retranscribe.cjs',
  'test-caption-song-routing.cjs', 'test-caption-language.cjs', 'test-caption-resource-ipc.cjs',
  'test-caption-resource-policy.cjs', 'test-caption-tools.cjs', 'test-caption-intelligence.cjs',
  'test-caption-spoken-preview.cjs', 'test-caption-workbench.cjs', 'test-caption-local-workbench.cjs',
  'test-caption-audio-preprocess.cjs', 'test-caption-recovery-parity.cjs',
].map(file => path.join('scripts', file));
const jobs = [[process.execPath, ['--test', '--test-reporter=tap', ...nodeTests]],
  [process.execPath, ['--test', '--test-reporter=tap',
    'scripts/test-caption-groq-ipc.cjs', 'scripts/test-caption-groq-scenarios.cjs', 'scripts/test-caption-groq-transport.cjs']],
  ...['test-caption-local-scenarios.py', 'test-caption-local-timeline.py',
    'test-caption-http-fallback.py', 'test-song-caption-mode.py']
    .map(file => [process.env.CAPTION_TEST_PYTHON || 'python', [path.join('scripts', file)]])];
if (process.argv.includes('--browser')) jobs.push([process.execPath, ['scripts/test-caption-local-browser.cjs']]);
let failures = 0;
const report = { jobs: [] };
for (const [command, args] of jobs) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const output = (result.stdout || '') + (result.stderr || '');
  const nodeTotal = output.match(/^# tests (\d+)/m);
  const pythonTotal = output.match(/Ran (\d+) tests?/);
  const browserChecks = args.at(-1) === 'scripts/test-caption-local-browser.cjs'
    ? Number(output.match(/"passed":\s*(\d+)/)?.[1] || 0) : 0;
  const passed = !result.error && result.status === 0;
  const total = Number(nodeTotal?.[1] || pythonTotal?.[1] || 0);
  const skipped = Number(output.match(/^# skipped (\d+)/m)?.[1] || 0);
  const name = nodeTotal ? (args.includes('scripts/test-caption-groq-ipc.cjs') ? 'Groq IPC, timing and transport suite' : 'Node caption suite') : args.at(-1);
  report.jobs.push({ name, passed, tests: total, skipped, ...(browserChecks ? { browserChecks } : {}) });
  console.log(`${passed ? 'PASSED' : 'FAILED'} ${name}: ${browserChecks ? browserChecks + ' browser checks' : total + ' tests'}, ${skipped} skipped`);
  if (result.error) console.error(result.error.message);
  if (!passed) { failures += 1; console.error(output); }
}
const directory = path.join(root, 'caption-work', 'diagnostics');
fs.mkdirSync(directory, { recursive: true });
report.tests = report.jobs.reduce((sum, job) => sum + job.tests, 0);
report.skipped = report.jobs.reduce((sum, job) => sum + job.skipped, 0);
report.browserChecks = report.jobs.reduce((sum, job) => sum + (job.browserChecks || 0), 0);
report.failedJobs = failures;
const reportPath = path.join(directory, 'local-tests-latest.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`Caption checks: ${report.tests} tests, ${report.browserChecks} browser checks, ${report.skipped} skipped, ${failures} failed suites. Report: ${reportPath}`);
process.exitCode = failures ? 1 : 0;
