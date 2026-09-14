// Never execute these CMD launchers. Test their real inline PowerShell using
// fake process/health/port queries; no application or service is started.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const names = ['Launch-Presentator.cmd', 'Voice-Presentator.cmd', 'Pattan-Presentator.cmd'];
const launchers = names.map(name => ({ name, source: fs.readFileSync(path.join(root, name), 'utf8') }));
const commands = launcher => [...launcher.source.matchAll(/^powershell[^\r\n]*? -Command "([^\r\n]*)" >nul 2>&1\s*$/gmi)].map(match => match[1]);
const guards = launchers.map(launcher => commands(launcher).find(command => command.includes('Get-CimInstance')));
const probes = launchers.flatMap(commands).filter(command => command.includes('Invoke-RestMethod'));

function runPowerShell(script) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 12000,
    env: { ...process.env, APP_DIR: root }
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

test('active launcher wrappers never terminate port owners, Python processes, or Electron apps', () => {
  for (const launcher of launchers) {
    const executableLines = launcher.source.split(/\r?\n/).filter(line => !/^\s*(?:REM\b|::)/i.test(line)).join('\n');
    assert.doesNotMatch(executableLines, /\b(?:taskkill|Stop-Process|netstat|wmic)\b|\.Kill\s*\(/i, launcher.name);
    assert.match(launcher.source, /No processes were changed/);
    assert.match(launcher.source, /Presentator is already running/);
    assert.ok(launcher.source.indexOf('Get-CimInstance') < launcher.source.indexOf('npm'), launcher.name);
  }
});

test('launch paths, environments, desktop wrappers, and app restart behavior are preserved', () => {
  const [launch, voice, pattan] = launchers.map(value => value.source);
  assert.match(launch, /cd \/d "%~dp0"/);
  assert.match(launch, /npm\.cmd start/);
  assert.match(voice, /set "PYTHON_VENV=%APP_DIR%\\\.voiceclone-venv\\Scripts\\python\.exe"/);
  assert.match(voice, /set "SINGING_PYTHON=%APP_DIR%\\\.singing-venv\\Scripts\\python\.exe"/);
  assert.match(voice, /start \/wait "" "%ELECTRON%" "%APP_DIR%"/);
  assert.match(voice, /goto LAUNCH/);
  assert.match(pattan, /set "PYTHON=%APP_DIR%\\\.edge-tts-venv\\Scripts\\python\.exe"/);
  assert.match(pattan, /start "" "%APP_DIR%\\node_modules\\electron\\dist\\electron\.exe" "%APP_DIR%"/);
  for (const name of ['Start.cmd', 'Yasin Presentator.cmd']) {
    assert.match(fs.readFileSync(path.join(root, name), 'utf8'), /call "%~dp0Launch-Presentator\.cmd"/);
  }
  assert.match(fs.readFileSync(path.join(root, 'Create-Desktop-Shortcut.ps1'), 'utf8'), /"Voice-Presentator\.cmd"/);
});

test('every inline startup PowerShell command parses without executing the launchers', { skip: process.platform !== 'win32' }, () => {
  assert.equal(guards.length, 3);
  assert.ok(guards.every(Boolean));
  assert.equal(new Set(guards).size, 1);
  assert.equal(probes.length, 5);
  const encodedCommands = Buffer.from(JSON.stringify(launchers.flatMap(commands))).toString('base64');
  const result = runPowerShell(`
$commands = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedCommands}')) | ConvertFrom-Json
foreach ($command in $commands) {
  $tokens = $null; $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseInput($command, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw ($errors | Out-String) }
}
exit 0
`);
  assert.equal(result.status, 0, result.stderr);
});

test('existing-app guards identify only this workspace main process, never an unrelated Electron app', { skip: process.platform !== 'win32' }, () => {
  for (const [mode, expected] of [['same', 0], ['unrelated', 1], ['renderer', 1], ['none', 1], ['error', 2]]) {
    const result = runPowerShell(String.raw`
function Get-CimInstance {
  param($ClassName, $ErrorAction)
  if ('${mode}' -eq 'error') { throw 'Synthetic process-query failure' }
  if ('${mode}' -eq 'none') { return @() }
  $exe = Join-Path $env:APP_DIR 'node_modules\electron\dist\electron.exe'
  if ('${mode}' -eq 'unrelated') { $exe = 'C:\Another App\electron.exe' }
  $line = if ('${mode}' -eq 'renderer') { 'electron --type=renderer' } else { 'electron main-app' }
  return [pscustomobject]@{ ExecutablePath = $exe; CommandLine = $line }
}
${guards[0]}
`);
    assert.equal(result.status, expected, `${mode}: ${result.stderr}`);
  }
});

test('service probes distinguish healthy, unoccupied, and conflicting ports without writes', { skip: process.platform !== 'win32' }, () => {
  for (const command of probes) {
    const urlPort = command.match(/127\.0\.0\.1:(\d+)\/health/)[1];
    assert.match(command, new RegExp(`Get-NetTCPConnection -LocalPort ${urlPort} -State Listen`));
    assert.match(command, /exit 2/);
  }
  for (const [mode, expected] of [['healthy', 0], ['free', 1], ['occupied', 2]]) {
    const result = runPowerShell(`
function Invoke-RestMethod { param($Uri, $TimeoutSec) if ('${mode}' -ne 'healthy') { throw 'Synthetic health failure' }; return @{ ok = $true } }
function Get-NetTCPConnection { param($LocalPort, $State, $ErrorAction) if ($State -ne 'Listen') { throw 'Only local listeners may be inspected' }; if ('${mode}' -eq 'occupied') { return @{ OwningProcess = 999 } }; return @() }
${probes[0]}
`);
    assert.equal(result.status, expected, `${mode}: ${result.stderr}`);
  }
  const voice = launchers.find(value => value.name === 'Voice-Presentator.cmd').source;
  for (const port of [8426, 8427, 8431, 8434]) assert.match(voice, new RegExp(`Port ${port} is occupied but not ready`));
  assert.match(launchers.find(value => value.name === 'Pattan-Presentator.cmd').source, /if errorlevel 2 \(\s*echo Port 8426[^]*?goto launch_electron\s*\)/);
});
