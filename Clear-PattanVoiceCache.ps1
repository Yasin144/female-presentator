$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Pattan Voice Cache Cleaner'

Write-Host ''
Write-Host 'PATTAN VOICE PRESENTATOR - CACHE CLEANER' -ForegroundColor Cyan
Write-Host '----------------------------------------' -ForegroundColor DarkCyan
Write-Host 'This clears generated SC3/Chatterbox audio and Edge TTS memory cache.'
Write-Host 'Models, reference voices, lessons, source code, and exports are preserved.'
Write-Host ''

$accessCode = Read-Host 'Enter deletion access code'
if ($accessCode -cne '6875') {
    Write-Host ''
    Write-Host 'Access denied. Nothing was cleared.' -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

$removedFiles = 0
$removedBytes = [int64]0
$failures = [System.Collections.Generic.List[string]]::new()

function Clear-CacheDirectoryContents {
    param([Parameter(Mandatory = $true)][string]$LiteralDirectory)

    if (-not (Test-Path -LiteralPath $LiteralDirectory -PathType Container)) {
        Write-Host "Skipped (not present): $LiteralDirectory" -ForegroundColor DarkGray
        return
    }

    $items = @(Get-ChildItem -LiteralPath $LiteralDirectory -Force -ErrorAction SilentlyContinue)
    foreach ($item in $items) {
        try {
            if (-not $item.PSIsContainer) {
                $script:removedBytes += [int64]$item.Length
                $script:removedFiles++
            } else {
                $childFiles = @(Get-ChildItem -LiteralPath $item.FullName -File -Force -Recurse -ErrorAction SilentlyContinue)
                $script:removedFiles += $childFiles.Count
                $script:removedBytes += [int64](($childFiles | Measure-Object -Property Length -Sum).Sum)
            }
            Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction Stop
        } catch {
            $script:failures.Add("$($item.FullName): $($_.Exception.Message)")
        }
    }
    Write-Host "Cleared: $LiteralDirectory" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Clearing Edge TTS memory cache...' -ForegroundColor Yellow
try {
    $edgeResult = Invoke-RestMethod -Uri 'http://127.0.0.1:8427/api/cache/clear' -Method Post -TimeoutSec 5
    if ($edgeResult.ok) {
        Write-Host 'Cleared: Edge TTS memory cache' -ForegroundColor Green
    } else {
        Write-Host 'Edge TTS responded, but did not confirm the cache clear.' -ForegroundColor Yellow
    }
} catch {
    Write-Host 'Edge TTS is not running. Its memory cache is already empty.' -ForegroundColor DarkYellow
}

Clear-CacheDirectoryContents -LiteralDirectory 'D:\voice\tts-cache'
Clear-CacheDirectoryContents -LiteralDirectory 'D:\voice\temp\pattan-sc3-1788626678328'

Write-Host ''
$removedMiB = [Math]::Round($removedBytes / 1MB, 2)
if ($failures.Count -eq 0) {
    Write-Host "DONE - removed $removedFiles generated cache file(s), $removedMiB MB." -ForegroundColor Green
    Write-Host 'Restart Pattan Presentator before making a fresh voice generation.' -ForegroundColor Cyan
} else {
    Write-Host "Completed with $($failures.Count) item(s) that could not be cleared:" -ForegroundColor Yellow
    $failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    Write-Host 'Close Pattan Presentator and run this cleaner again.' -ForegroundColor Yellow
}

Write-Host ''
Read-Host 'Press Enter to close'
