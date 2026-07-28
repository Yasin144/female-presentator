# End Codex Ollama Session Script
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "🛑 TERMINATING CODEX & OLLAMA SESSIONS..." -ForegroundColor Yellow
Write-Host "==============================================" -ForegroundColor Cyan

# 1. Kill running codex and ollama processes
Get-Process -Name "ollama", "codex" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Stopping process: $($_.ProcessName) (PID: $($_.Id))..." -ForegroundColor DarkYellow
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

# 2. Clean up config.toml and set model back to gpt-5.6-sol
$configPath = Join-Path $env:USERPROFILE ".codex\config.toml"
if (Test-Path $configPath) {
    $content = Get-Content $configPath -Raw
    if ($content) {
        $cleaned = $content -replace "(?m)^model_provider\s*=.*$", "" `
                            -replace "(?m)^model_catalog_json\s*=.*$", "" `
                            -replace "(?m)^model\s*=.*$", "model = `"gpt-5.6-sol`"" `
                            -replace "(?m)^notify\s*=.*$", "" `
                            -replace "(?ms)\[model_providers\.ollama[^\]]*\].*?(?=\n\[|\Z)", ""
        if (-not ($cleaned -match "(?m)^model\s*=")) {
            $cleaned = "model = `"gpt-5.6-sol`"`nmodel_reasoning_effort = `"low`"`n" + $cleaned
        }
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($configPath, $cleaned.Trim(), $utf8NoBom)
        Write-Host "✅ Restored gpt-5.6-sol in config.toml (BOM-free)" -ForegroundColor Green
    }
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
Write-Host "✨ NATIVE CODEX (gpt-5.6-sol) RESTORED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Cyan
