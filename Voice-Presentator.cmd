@echo off
setlocal EnableDelayedExpansion

set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"
set "PYTHON_VENV=%APP_DIR%\.voiceclone-venv\Scripts\python.exe"
set "SINGING_PYTHON=%APP_DIR%\.singing-venv\Scripts\python.exe"
set "ELECTRON=%APP_DIR%\node_modules\electron\dist\electron.exe"

REM ---- Load private Groq key (never committed to Git) ----
if exist "%APP_DIR%\.groq_api_key" (
  set /p GROQ_API_KEY=<"%APP_DIR%\.groq_api_key"
)

title Voice Presentator
cd /d "%APP_DIR%"

REM Reuse this workspace's app without interrupting other Electron programs.
powershell -NoProfile -Command "$exe=Join-Path $env:APP_DIR 'node_modules\electron\dist\electron.exe'; try { $running=Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch '(?:^|\s)--type=' }; if($running){exit 0}; exit 1 } catch { exit 2 }" >nul 2>&1
if errorlevel 2 ( echo Could not check whether Presentator is already running. No processes were changed. & exit /b 1 )
if not errorlevel 1 ( echo Presentator is already running. Use its existing window. & exit /b 0 )

REM ---- Install Electron if missing ----
if not exist "%ELECTRON%" (
  echo Installing Node dependencies...
  call npm install --cache "%APP_DIR%\.npm-cache"
  if errorlevel 1 ( echo Failed to install. & pause & exit /b 1 )
)

REM ---- Install Whisper transcription dependency if missing ----
if exist "%PYTHON_VENV%" (
  "%PYTHON_VENV%" -c "import faster_whisper" >nul 2>&1
  if errorlevel 1 (
    echo Installing Whisper transcription dependency...
    "%PYTHON_VENV%" -m pip install faster-whisper
    if errorlevel 1 ( echo Failed to install faster-whisper. & pause & exit /b 1 )
  )
)

REM ---- Start SC3 Chatterbox in a visible terminal window ----
REM Keep healthy or loading servers intact; report an occupied port instead.
powershell -NoProfile -Command "try{Invoke-RestMethod 'http://127.0.0.1:8426/health' -TimeoutSec 2|Out-Null;exit 0}catch{}; if(Get-NetTCPConnection -LocalPort 8426 -State Listen -ErrorAction SilentlyContinue){exit 2};exit 1" >nul 2>&1
if errorlevel 2 (
  echo Port 8426 is occupied but not ready. The existing process was left running.
) else if errorlevel 1 (
  if exist "%PYTHON_VENV%" (
    start "SC3 Chatterbox Python" cmd /k ""%PYTHON_VENV%" -u "%APP_DIR%\anjali-chatterbox-server.py""
  )
) else (
  echo SC3 Chatterbox is already ready - reusing it.
)

REM ---- Edge TTS server (port 8427) ----
powershell -NoProfile -Command "try{Invoke-RestMethod 'http://127.0.0.1:8427/health' -TimeoutSec 2|Out-Null;exit 0}catch{}; if(Get-NetTCPConnection -LocalPort 8427 -State Listen -ErrorAction SilentlyContinue){exit 2};exit 1" >nul 2>&1
if errorlevel 2 (
  echo Port 8427 is occupied but not ready. The existing process was left running.
) else if errorlevel 1 (
  if exist "%PYTHON_VENV%" (
    start "EdgeTTS Python" cmd /k ""%PYTHON_VENV%" -u "%APP_DIR%\timed-voiceover-server.py""
  )
)

REM ---- Start SC3 Singing Server (port 8431) for Hindi/Telugu voice conversion ----
powershell -NoProfile -Command "try{Invoke-RestMethod 'http://127.0.0.1:8431/health' -TimeoutSec 2|Out-Null;exit 0}catch{}; if(Get-NetTCPConnection -LocalPort 8431 -State Listen -ErrorAction SilentlyContinue){exit 2};exit 1" >nul 2>&1
if errorlevel 2 (
  echo Port 8431 is occupied but not ready. The existing process was left running.
) else if errorlevel 1 (
  if exist "%SINGING_PYTHON%" (
    start "SC3 Singing Python" cmd /k ""%SINGING_PYTHON%" -u "%APP_DIR%\sc3-singing-server.py""
  ) else if exist "%PYTHON_VENV%" (
    start "SC3 Singing Python" cmd /k ""%PYTHON_VENV%" -u "%APP_DIR%\sc3-singing-server.py""
  )
)

REM ---- Caption translation server (port 8434) ----
REM Caption Burner requires this before processing so the selected output
REM language is translated instead of silently retaining the source captions.
powershell -NoProfile -Command "try{Invoke-RestMethod 'http://127.0.0.1:8434/health' -TimeoutSec 2|Out-Null;exit 0}catch{}; if(Get-NetTCPConnection -LocalPort 8434 -State Listen -ErrorAction SilentlyContinue){exit 2};exit 1" >nul 2>&1
if errorlevel 2 (
  echo Port 8434 is occupied but not ready. The existing process was left running.
) else if errorlevel 1 (
  if exist "%PYTHON_VENV%" (
    start "Caption Translation Python" cmd /k ""%PYTHON_VENV%" -u "%APP_DIR%\translate-server.py""
  )
)

REM ---- Self-healing Electron restart loop ----
REM Electron is launched WITH /wait so we know when it exits.
REM Exit code 0 = user closed intentionally -> stop loop.
REM Any other code = crash -> restart automatically.

set RESTART_COUNT=0
:LAUNCH
set /a RESTART_COUNT+=1

if %RESTART_COUNT% GTR 1 (
  echo [Voice Presentator] Restart attempt %RESTART_COUNT% - waiting 2 seconds...
  ping 127.0.0.1 -n 3 >nul
)

REM Restart only the app launched below; leave all other processes untouched.

REM Launch with /wait - CMD blocks here until Electron exits
start /wait "" "%ELECTRON%" "%APP_DIR%"
set EXIT_CODE=%ERRORLEVEL%

REM Exit code 0 = user closed app normally -> done
if %EXIT_CODE% EQU 0 (
  echo [Voice Presentator] App closed normally.
  exit /b 0
)

REM Exit codes 1-5 are also sometimes normal Electron shutdowns
if %EXIT_CODE% LEQ 5 (
  echo [Voice Presentator] App exited (code %EXIT_CODE%) - restarting...
  goto LAUNCH
)

REM Unknown exit code - still restart but log it
echo [Voice Presentator] Unexpected exit code %EXIT_CODE% - restarting...
goto LAUNCH
