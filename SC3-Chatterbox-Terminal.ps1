param([switch]$Once, [switch]$Launch)

# Node/Electron's detached PowerShell launch can exit immediately on Windows
# when its standard handles are ignored. Let Windows create the visible
# console from a short-lived hidden launcher instead.
if ($Launch) {
    $viewerShell = Join-Path $PSHOME 'powershell.exe'
    $viewerArgs = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
    Start-Process -FilePath $viewerShell -ArgumentList $viewerArgs -WorkingDirectory $PSScriptRoot -WindowStyle Normal -ErrorAction Stop | Out-Null
    return
}

# Read-only status terminal. Closing it never stops or restarts the voice server.
$ErrorActionPreference = 'Stop'
$terminalMutex = $null
$ownsTerminalMutex = $false
try {
    if (-not $Once) {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $rootBytes = [Text.Encoding]::UTF8.GetBytes($PSScriptRoot.ToLowerInvariant())
            $workspaceKey = [BitConverter]::ToString($sha.ComputeHash($rootBytes)).Replace('-', '')
        } finally { $sha.Dispose() }
        $terminalMutex = New-Object Threading.Mutex($false, "Local\PattanSC3Terminal-$workspaceKey")
        try { $ownsTerminalMutex = $terminalMutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $ownsTerminalMutex = $true }
        if (-not $ownsTerminalMutex) { return }
    }

    $Host.UI.RawUI.WindowTitle = 'SC3 Chatterbox Python - Live Status'
    Write-Host 'SC3 CHATTERBOX - LIVE STATUS' -ForegroundColor Cyan
    Write-Host 'Voice server: http://127.0.0.1:8426'
    Write-Host 'This terminal monitors the existing server. Closing it will NOT stop narration.'
    Write-Host ('Startup log: ' + (Join-Path $PSScriptRoot 'logs\sc3-startup.log'))
    Write-Host ''
    $lastMessage = ''
    do {
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:8426/health' -TimeoutSec 4
            if ($health.engine -ne 'chatterbox-tts') {
                $message = 'WARNING: Port 8426 is responding, but it is not SC3 Chatterbox.'
                $color = 'Yellow'
            } elseif ($health.chatterboxError) {
                $message = 'ERROR: ' + $health.chatterboxError
                $color = 'Red'
            } elseif ($health.modelLoaded -and $health.chatterboxReady) {
                $message = 'READY - SC3 Chatterbox model loaded (' + $health.device + ')'
                $color = 'Green'
                try {
                    $progress = Invoke-RestMethod 'http://127.0.0.1:8426/api/narrate/progress' -TimeoutSec 4
                    if ($progress.active) {
                        $message = 'WORKING - ' + $progress.stage + ' | ' + $progress.pct + '%'
                        $color = 'Cyan'
                    } elseif ($progress.stage -and $progress.stage -ne 'idle') {
                        $message += ' | Last status: ' + $progress.stage
                    }
                } catch { $message += ' | Progress temporarily unavailable' }
            } else {
                $message = 'LOADING - Please wait for the Chatterbox model to finish loading.'
                $color = 'Yellow'
            }
        } catch {
            $message = 'WAITING - SC3 Chatterbox is not responding yet. Model loading can take several minutes. Check the startup log if this continues.'
            $color = 'Yellow'
        }
        if ($message -ne $lastMessage) {
            Write-Host ('[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $message) -ForegroundColor $color
            $lastMessage = $message
        }
        if (-not $Once) { Start-Sleep -Seconds 3 }
    } while (-not $Once)
} finally {
    if ($ownsTerminalMutex) { $terminalMutex.ReleaseMutex() }
    if ($terminalMutex) { $terminalMutex.Dispose() }
}
