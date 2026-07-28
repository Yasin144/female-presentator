# End Codex Ollama Session Script
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "🛑 TERMINATING CODEX & OLLAMA SESSIONS..." -ForegroundColor Yellow
Write-Host "==============================================" -ForegroundColor Cyan

# 1. Kill running codex and ollama processes
Get-Process -Name "ollama", "codex" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Stopping process: $($_.ProcessName) (PID: $($_.Id))..." -ForegroundColor DarkYellow
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

# 2. Clean up config.toml
$configPath = Join-Path $env:USERPROFILE ".codex\config.toml"
if (Test-Path $configPath) {
    $content = Get-Content $configPath -Raw
    $cleaned = $content -replace "(?m)^model_provider\s*=.*$", "" `
                        -replace "(?m)^model_catalog_json\s*=.*$", "" `
                        -replace "(?m)^model\s*=\s*`"qwen.*`"$", "" `
                        -replace "(?ms)\[model_providers\.ollama[^\]]*\].*?(?=\n\[|\Z)", ""
    Set-Content -Path $configPath -Value $cleaned.Trim() -Encoding UTF8
    Write-Host "✅ Cleared Ollama configurations from config.toml" -ForegroundColor Green
}

# 3. Disable local ollama model JSON
$ollamaJson = Join-Path $env:USERPROFILE ".codex\ollama-launch-models.json"
if (Test-Path $ollamaJson) {
    Rename-Item -Path $ollamaJson -NewName "ollama-launch-models.json.bak" -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Renamed ollama-launch-models.json to .bak" -ForegroundColor Green
}

# 4. Relaunch Codex cleanly
Write-Host "🚀 Relaunching native Codex..." -ForegroundColor Cyan
Start-Process "explorer.exe" -ArgumentList "shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App" -ErrorAction SilentlyContinue

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "✨ CODEX OLLAMA SESSION ENDED & NATIVE CODEX RESTORED!" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Cyan
