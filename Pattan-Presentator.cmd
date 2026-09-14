@echo off
setlocal
set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"
set "PYTHON=%APP_DIR%\.edge-tts-venv\Scripts\python.exe"
set "SERVER=%APP_DIR%\anjali-chatterbox-server.py"

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

REM ── Python venv ───────────────────────────────────────────────────────────
if not exist "%PYTHON%" (
  echo Creating Edge TTS Python environment...
  py -3 -m venv "%APP_DIR%\.edge-tts-venv" 2>nul || python -m venv "%APP_DIR%\.edge-tts-venv"
  if errorlevel 1 ( echo Failed to create Python environment. & pause & exit /b 1 )
)

REM ── Install edge_tts if missing ───────────────────────────────────────────
"%PYTHON%" -c "import edge_tts" >nul 2>&1
if errorlevel 1 (
  echo Installing edge_tts...
  "%PYTHON%" -m pip install edge_tts --quiet >nul 2>&1
)

REM ── Check if voice server is already running on port 8426 ─────────────────
REM A listening port is not permission to stop its owner.
powershell -NoProfile -Command "try{Invoke-RestMethod 'http://127.0.0.1:8426/health' -TimeoutSec 3|Out-Null;exit 0}catch{}; if(Get-NetTCPConnection -LocalPort 8426 -State Listen -ErrorAction SilentlyContinue){exit 2};exit 1" >nul 2>&1
if errorlevel 2 (
  echo Port 8426 is occupied but not ready. The existing process was left running.
  goto launch_electron
)
if not errorlevel 1 (
  echo Voice server already running and warm - reusing it.
  goto launch_electron
)

REM ── Start voice server as DETACHED background process ────────────────────
REM It runs independently - Electron never kills it.
echo Starting Edge TTS voice server in background...
start "Edge TTS Server" /min "%PYTHON%" "%SERVER%"

REM ── Give server a moment to begin loading before Electron opens ───────────
ping 127.0.0.1 -n 4 >nul

:launch_electron
REM ── Launch Electron detached — CMD exits immediately ─────────────────────
echo Launching Voice Presentator...
start "" "%APP_DIR%\node_modules\electron\dist\electron.exe" "%APP_DIR%"

endlocal
