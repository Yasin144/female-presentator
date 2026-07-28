# End Codex Ollama Session Script
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "🛑 TERMINATING CODEX & OLLAMA SESSIONS..." -ForegroundColor Yellow
Write-Host "==============================================" -ForegroundColor Cyan

# 1. Run official Ollama restore if available
try {
    Write-Host "Running official Ollama restore..." -ForegroundColor Yellow
    ollama launch codex-app --restore --yes | Out-Null
} catch {
    Write-Host "Ollama CLI restore skipped or not required." -ForegroundColor Gray
}

# 2. Kill running codex and ollama processes to release locks
Get-Process -Name "ollama", "codex" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Stopping process: $($_.ProcessName) (PID: $($_.Id))..." -ForegroundColor DarkYellow
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

# 3. Clean up config.toml, enforce model = gpt-5.6-sol, and add thread fallback entry
$configPath = Join-Path $env:USERPROFILE ".codex\config.toml"
if (Test-Path $configPath) {
    $content = [System.IO.File]::ReadAllText($configPath)
    if ($content) {
        $cleaned = $content -replace "(?m)^model_provider\s*=.*$", "" `
                            -replace "(?m)^model_catalog_json\s*=.*$", "" `
                            -replace "(?m)^model\s*=.*$", "model = `"gpt-5.6-sol`"" `
                            -replace "(?ms)notify\s*=\s*\[[\s\S]*?\]", "" `
                            -replace "(?ms)\[model_providers\.ollama[^\]]*\].*?(?=\n\[|\Z)", ""
        if (-not ($cleaned -match "(?m)^model\s*=")) {
            $cleaned = "model = `"gpt-5.6-sol`"`nmodel_reasoning_effort = `"low`"`n" + $cleaned
        }
        # Add fallback for past threads so they load seamlessly
        if (-not ($cleaned -match "\[model_providers\.ollama-launch-codex-app\]")) {
            $cleaned = $cleaned.Trim() + "`n`n[model_providers.ollama-launch-codex-app]`nname = `"OpenAI`"`nbase_url = `"https://api.openai.com/v1/`"`n"
        }
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($configPath, $cleaned.Trim(), $utf8NoBom)
        Write-Host "✅ Restored gpt-5.6-sol & legacy thread fallback in config.toml" -ForegroundColor Green
    }
}

# 4. Disable local ollama model JSON
$ollamaJson = Join-Path $env:USERPROFILE ".codex\ollama-launch-models.json"
if (Test-Path $ollamaJson) {
    Rename-Item -Path $ollamaJson -NewName "ollama-launch-models.json.bak" -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Renamed ollama-launch-models.json to .bak" -ForegroundColor Green
}

# 5. Relaunch Codex cleanly
Write-Host "🚀 Relaunching native Codex..." -ForegroundColor Cyan
Start-Process "explorer.exe" -ArgumentList "shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App" -ErrorAction SilentlyContinue

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "✨ NATIVE CODEX (gpt-5.6-sol) RESTORED & THREADS FIXED!" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Cyan
