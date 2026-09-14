// Offline PowerShell function tests. No listener, FFmpeg process, media job,
// user file, or actual deletion is started by this harness.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const script = String.raw`
$ErrorActionPreference = 'Stop'
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'video-export-server.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$required = @('Invoke-VideoMux', 'Join-VideoSegments', 'Handle-Request', 'Get-QueryParameters', 'Remove-MuxUploadSession', 'Start-VideoExportListener')
$definitions = @{}
foreach ($node in $ast.FindAll({ param($item) $item -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  if ($required -contains $node.Name) { $definitions[$node.Name] = $node.Extent.Text }
}
foreach ($name in $required) { if (-not $definitions.ContainsKey($name)) { throw "Missing function: $name" }; Invoke-Expression $definitions[$name] }
function Get-FFmpegPath { return 'Invoke-OfflineFfmpeg' }
function Write-Host { param([Parameter(ValueFromRemainingArguments=$true)]$Message) }
function Write-MuxDebugLog { param($Message) }
$script:files = @{}
$script:removed = @()
function Test-Path { param([string]$Path, [string]$LiteralPath) if ($LiteralPath) { $Path = $LiteralPath }; return $script:files.ContainsKey($Path) }
function Remove-Item { param([string]$Path, [string]$LiteralPath, [switch]$Force, $ErrorAction) if ($LiteralPath) { $Path = $LiteralPath }; $script:removed += $Path; $script:files.Remove($Path) }
function Invoke-OfflineFfmpeg { $script:capturedArguments = $args; throw 'Offline argument capture only' }
$filters = @()
foreach ($exact in @($false, $true)) {
  foreach ($speed in @(0.5, 1.0, 1.25, 2.0, 2.5, 3.0)) {
    foreach ($music in @('none', 'mixed', 'ducked')) {
      $script:files = @{ 'offline-music.wav' = $true }
      try {
        Invoke-VideoMux -VideoPath 'offline-video.ivf' -AudioPath 'offline-audio.wav' -MusicPath $(if ($music -eq 'none') { '' } else { 'offline-music.wav' }) -AudioDuckingEnabled ($music -eq 'ducked') -AudioSpeed $speed -VideoSpeed 1 -TargetDurationMs 8000 -PdfExactTimeline $exact -KeepOutputFile | Out-Null
      } catch {
        if ($_.Exception.Message -notmatch 'Offline argument capture only') { throw }
        $position = [Array]::IndexOf($script:capturedArguments, '-filter_complex')
        $filters += @{ exact = $exact; speed = $speed; music = $music; filter = $script:capturedArguments[$position + 1] }
      }
    }
  }
}

# A missing declared segment must fail closed, not be filtered out silently.
$script:files = @{ 'offline-segment-a.webm' = $true }
$missingRejected = $false; $missingResult = ''
try { $missingResult = Join-VideoSegments -VideoPaths @('offline-segment-a.webm', 'offline-missing-segment.webm') } catch { $missingRejected = $true }

# Simulate an encoder leaving a partial output, without creating a real file.
$script:files = @{ 'offline-segment-a.webm' = $true; 'offline-segment-b.webm' = $true }
$script:removed = @()
function Get-VideoDimensions { param($VideoPath) return @{ Width = 1280; Height = 720 } }
function Invoke-OfflineFfmpeg { $script:partialOutput = [string]$args[-1]; $script:files[$script:partialOutput] = $true; $global:LASTEXITCODE = 1; return 'Synthetic concat encoder failure' }
$partialRejected = $false
try { Join-VideoSegments -VideoPaths @('offline-segment-a.webm', 'offline-segment-b.webm') -Metadata ([pscustomobject]@{ includeIntroSegment = $true }) | Out-Null } catch { $partialRejected = $true }
$partial = @{ rejected = $partialRejected; output = $script:partialOutput; removed = @($script:removed); remaining = @($script:files.Keys) }

# Complete-session failures before response writing still own the joined file.
$baseUrl = 'http://127.0.0.1:8430'
function Read-JsonBody { param($Bytes) return [pscustomobject]@{ sessionId = 'offline-session' } }
function Write-JsonResponse { param($Stream, $StatusCode, $Payload) $script:response = @{ status = $StatusCode; payload = $Payload } }
function Write-FileResponse { param($Stream, $StatusCode, $FilePath, $ContentType, $ExtraHeaders) $script:response = @{ status = $StatusCode; file = $FilePath } }
function Get-MediaDurationSeconds { param($MediaPath) return 1 }
function Join-VideoSegments { param($VideoPaths, $Metadata) $script:files['offline-joined.webm'] = $true; return 'offline-joined.webm' }
function Invoke-VideoMux { param($VideoPath, $AudioPath, $MusicPath, $AudioSpeed, $VideoSpeed, $ExportQuality, $MusicVolume, $TargetDurationMs, $HoldLastFrameMs, $AudioDuckingEnabled, $PdfExactTimeline, [switch]$KeepOutputFile) if ($script:failureMode -eq 'encode') { throw 'Synthetic mux failure' }; $script:files['offline-muxed.mp4'] = $true; return 'offline-muxed.mp4' }
$completion = @()
foreach ($failureMode in @('encode', 'short-visuals', 'success')) {
  $script:failureMode = $failureMode
  $script:removed = @(); $script:response = $null
  $script:files = @{ 'offline-segment-a.webm' = $true; 'offline-segment-b.webm' = $true; 'offline-audio.wav' = $true; 'unrelated-user-file.mp4' = $true }
  $metadata = [pscustomobject]@{ audioSpeed = 1; videoSpeed = 1; targetDurationMs = 8000; strictVisualSync = ($failureMode -eq 'short-visuals') }
  $script:MuxUploadSessions = @{ 'offline-session' = @{ Id = 'offline-session'; Metadata = $metadata; VideoPath = 'offline-segment-a.webm'; VideoPaths = @('offline-segment-a.webm', 'offline-segment-b.webm'); AudioPath = 'offline-audio.wav'; MusicPath = ''; VideoBytes = 3; AudioBytes = 3; MusicBytes = 0 } }
  Handle-Request -Request @{ Method = 'POST'; RawUrl = '/api/mux-upload-complete'; BodyBytes = [byte[]]@() } -Stream ([System.IO.Stream]::Null)
  $completion += @{ mode = $failureMode; response = $script:response; removed = @($script:removed); remaining = @($script:files.Keys); sessionCount = $script:MuxUploadSessions.Count }
}
# A canceled partial upload removes only its registered paths, without encoding.
$script:files = @{ 'cancel-owned-video.webm' = $true; 'cancel-owned-audio.wav' = $true; 'other-active-video.webm' = $true; 'unrelated-user-file.mp4' = $true }
$script:removed = @(); $script:cancelEncodeCalls = 0
$script:MuxUploadSessions = @{
  'cancel-owned' = @{ VideoPaths = @('cancel-owned-video.webm'); AudioPath = 'cancel-owned-audio.wav'; MusicPath = '' }
  'other-active' = @{ VideoPaths = @('other-active-video.webm'); AudioPath = ''; MusicPath = '' }
}
function Read-JsonBody { param($Bytes) return $script:cancelPayload }
function Invoke-VideoMux { $script:cancelEncodeCalls += 1; throw 'Cancellation must not encode media' }
$cancellations = @()
foreach ($cancelId in @('cancel-owned', 'cancel-owned', 'unknown-session', '')) {
  $script:cancelPayload = [pscustomobject]@{ sessionId = $cancelId }
  Handle-Request -Request @{ Method = 'POST'; RawUrl = '/api/mux-upload-cancel'; BodyBytes = [byte[]]@() } -Stream ([System.IO.Stream]::Null)
  $cancellations += @{ id = $cancelId; response = $script:response; remaining = @($script:files.Keys); sessions = @($script:MuxUploadSessions.Keys) }
}
# Test bind behavior with fake listeners: no real port is opened or closed.
$busyListener = [pscustomobject]@{ Attempts = 0 }
$busyListener | Add-Member -MemberType ScriptMethod -Name Start -Value { $this.Attempts += 1; throw [System.Net.Sockets.SocketException]::new(10048) }
$bindError = ''
try { Start-VideoExportListener -Listener $busyListener -Port 8430 } catch { $bindError = $_.Exception.Message }
$freeListener = [pscustomobject]@{ Attempts = 0 }
$freeListener | Add-Member -MemberType ScriptMethod -Name Start -Value { $this.Attempts += 1 }
Start-VideoExportListener -Listener $freeListener -Port 8430
$unsafeStartupCommands = @($ast.FindAll({ param($item) $item -is [System.Management.Automation.Language.CommandAst] -and $item.GetCommandName() -in @('taskkill', 'Stop-Process', 'netstat') }, $true) | ForEach-Object { $_.GetCommandName() })
@{ filters = $filters; missing = @{ rejected = $missingRejected; result = $missingResult }; partial = $partial; completion = $completion; cancellations = $cancellations; cancelEncodeCalls = $script:cancelEncodeCalls; startup = @{ busyAttempts = $busyListener.Attempts; freeAttempts = $freeListener.Attempts; error = $bindError; unsafeCommands = $unsafeStartupCommands } } | ConvertTo-Json -Depth 10 -Compress
`;

let results;
function runOfflineHarness() {
  if (results) return results;
  const process = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024
  });
  assert.equal(process.error, undefined, process.error?.message);
  assert.equal(process.status, 0, process.stderr || process.stdout);
  results = JSON.parse(process.stdout.trim());
  return results;
}

test('every export route honors playback rates through 2.5x without changing pitch', { skip: process.platform !== 'win32' }, () => {
  const { filters } = runOfflineHarness();
  assert.equal(filters.length, 36);
  for (const entry of filters) {
    const tempos = [...entry.filter.matchAll(/atempo=([\d.]+)/g)].map(match => Number(match[1]));
    const tempo = tempos.reduce((product, value) => product * value, 1);
    assert.equal(tempo, Math.min(2.5, Math.max(0.5, entry.speed)), JSON.stringify(entry));
    assert.ok(tempos.every(value => value >= 0.5 && value <= 2));
    assert.match(entry.filter, /trim=duration=8\.000/);
  }
});

test('a missing declared video segment fails instead of exporting only the surviving segments', { skip: process.platform !== 'win32' }, () => {
  assert.equal(runOfflineHarness().missing.rejected, true);
});

test('failed intro-segment normalization removes its partial output but preserves all inputs', { skip: process.platform !== 'win32' }, () => {
  const { partial } = runOfflineHarness();
  assert.equal(partial.rejected, true);
  assert.ok(partial.removed.includes(partial.output));
  assert.deepEqual(partial.remaining.sort(), ['offline-segment-a.webm', 'offline-segment-b.webm']);
});

test('mux failures and short-visual rejection release joined outputs and the exact upload session only', { skip: process.platform !== 'win32' }, () => {
  for (const entry of runOfflineHarness().completion) {
    assert.equal(entry.response.status, entry.mode === 'success' ? 200 : 500, entry.mode);
    assert.equal(entry.sessionCount, 0, entry.mode);
    assert.ok(entry.removed.includes('offline-joined.webm'), entry.mode);
    assert.deepEqual(entry.remaining, ['unrelated-user-file.mp4'], entry.mode);
  }
});

test('busy-port startup reports a clear error without terminating any existing application', { skip: process.platform !== 'win32' }, () => {
  const { startup } = runOfflineHarness();
  assert.equal(startup.busyAttempts, 1);
  assert.equal(startup.freeAttempts, 1);
  assert.match(startup.error, /127\.0\.0\.1:8430/);
  assert.match(startup.error, /No existing process was stopped/);
  assert.deepEqual(startup.unsafeCommands, []);
});

test('upload cancellation is idempotent and preserves every other session and user file', { skip: process.platform !== 'win32' }, () => {
  const { cancellations, cancelEncodeCalls } = runOfflineHarness();
  assert.equal(cancelEncodeCalls, 0);
  assert.equal(cancellations.length, 4);
  cancellations.forEach((entry, index) => {
    assert.equal(entry.response.status, entry.id ? 200 : 400);
    if (entry.id) assert.equal(entry.response.payload.removed, index === 0);
    assert.deepEqual(entry.remaining.sort(), ['other-active-video.webm', 'unrelated-user-file.mp4']);
    assert.deepEqual(entry.sessions, ['other-active']);
  });
});
