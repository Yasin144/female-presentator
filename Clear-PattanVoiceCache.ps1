param([switch]$ListOnly)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath($PSScriptRoot)

function Assert-CacheTarget([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    $parent = Split-Path -Parent $resolved
    $leaf = Split-Path -Leaf $resolved
    $allowed = ($parent -eq (Join-Path $workspace 'tts-cache') -and $leaf -match '^[a-f0-9]{64}\.wav$') -or
        ($parent -eq (Join-Path $workspace 'temp') -and ($leaf -eq 'sc3-resume' -or $leaf -match '^pattan-sc3-\d+$'))
    if (-not $allowed) { throw "Refusing unexpected target: $resolved" }
    foreach ($ancestor in @($workspace, $parent, $resolved)) {
        if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked cache path: $ancestor" }
    }
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($resolved)
    while ($pending.Count) {
        $item = Get-Item -LiteralPath $pending.Pop() -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked cache entry: $($item.FullName)" }
        if ($item.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) { $pending.Push($child.FullName) }
        }
    }
    return $resolved
}

function Assert-AppClosed {
    $active = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        $_.CommandLine -and $_.CommandLine.IndexOf($workspace, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        ($_.Name -eq 'electron.exe' -or ($_.Name -match '^python(w)?\.exe$' -and $_.CommandLine -match 'anjali-chatterbox-server|timed-voiceover-server|whisper-transcribe|sc3-singing'))
    })
    if ($active.Count) { throw 'Close Presentator and its voice/transcription server windows, then run this shortcut again. No processes were stopped.' }
}

try {
    Write-Host 'PATTAN - CLEAN GENERATED VOICE CACHE' -ForegroundColor Cyan
    Write-Host 'Clears generated voice clips and Sing Song retry progress. Lessons, models, source videos and Downloads are preserved.'
    $targets = @()
    foreach ($name in @('tts-cache','temp')) {
        $cacheRoot = Join-Path $workspace $name
        if (-not (Test-Path -LiteralPath $cacheRoot)) { continue }
        if ((Get-Item -LiteralPath $cacheRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked cache root: $cacheRoot" }
        foreach ($entry in Get-ChildItem -LiteralPath $cacheRoot -Force) {
            if (($name -eq 'tts-cache' -and -not $entry.PSIsContainer -and $entry.Name -match '^[a-f0-9]{64}\.wav$') -or
                ($name -eq 'temp' -and $entry.PSIsContainer -and ($entry.Name -eq 'sc3-resume' -or $entry.Name -match '^pattan-sc3-\d+$'))) {
                $targets += Assert-CacheTarget $entry.FullName
            }
        }
    }
    if ($ListOnly) { $targets; return }
    Assert-AppClosed
    if (-not $targets.Count) { Write-Host 'No generated voice cache found.'; return }
    Write-Host "Found $($targets.Count) cache items. Saved retry progress will be cleared."
    Write-Host 'Items go to the Recycle Bin where supported by Windows.'
    if ((Read-Host 'Type CLEAN to continue') -cne 'CLEAN') { Write-Host 'Cancelled. Nothing changed.'; return }
    Assert-AppClosed
    Add-Type -AssemblyName Microsoft.VisualBasic
    $cleaned = 0
    foreach ($target in $targets) {
        $safeTarget = Assert-CacheTarget $target
        if (Test-Path -LiteralPath $safeTarget -PathType Container) {
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($safeTarget, 'OnlyErrorDialogs', 'SendToRecycleBin', 'ThrowException')
        } else {
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($safeTarget, 'OnlyErrorDialogs', 'SendToRecycleBin', 'ThrowException')
        }
        $cleaned++
    }
    Write-Host "Finished: $cleaned cache items removed. Reopen Presentator for fresh audio." -ForegroundColor Green
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($ListOnly) { throw }
} finally {
    if (-not $ListOnly) { Read-Host 'Press Enter to close' | Out-Null }
}
