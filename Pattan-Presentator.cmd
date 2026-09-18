@echo off
setlocal
set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"

REM ---- Load private Groq key (never committed to Git) ----
if exist "%APP_DIR%\.groq_api_key" (
  set /p GROQ_API_KEY=<"%APP_DIR%\.groq_api_key"
)


title Voice Presentator — Starting...
cd /d "%APP_DIR%"

REM Reuse this workspace's app without interrupting other Electron programs.
powershell -NoProfile -Command "$exe=Join-Path $env:APP_DIR 'node_modules\electron\dist\electron.exe'; try { $running=Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch '(?:^|\s)--type=' }; if($running){exit 0}; exit 1 } catch { exit 2 }" >nul 2>&1
if errorlevel 2 ( echo Could not check whether Presentator is already running. No processes were changed. & exit /b 1 )
if not errorlevel 1 ( echo Presentator is already running. Use its existing window. & exit /b 0 )

REM ── Node / Electron dependencies ─────────────────────────────────────────
if not exist "%APP_DIR%\node_modules\electron\dist\electron.exe" (
  echo Installing Electron dependencies...
  call npm install --cache "%APP_DIR%\.npm-cache"
  if errorlevel 1 ( echo Failed to install Node dependencies. & pause & exit /b 1 )
)

REM Electron owns SC3 startup using .voiceclone-venv, health checks and retries.
REM Do not launch Chatterbox with the unrelated Edge TTS Python environment.

:launch_electron
REM ── Launch Electron detached — CMD exits immediately ─────────────────────
echo Launching Voice Presentator...
start "" "%APP_DIR%\node_modules\electron\dist\electron.exe" "%APP_DIR%"

endlocal
