@echo off
setlocal

title Pattan Presentator - Starting...
cd /d "%~dp0"
set "APP_DIR=%~dp0"

REM Reuse only this workspace's Electron app; never terminate other programs.
powershell -NoProfile -Command "$exe=Join-Path $env:APP_DIR 'node_modules\electron\dist\electron.exe'; try { $running=Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch '(?:^|\s)--type=' }; if($running){exit 0}; exit 1 } catch { exit 2 }" >nul 2>&1
if errorlevel 2 ( echo Could not check whether Presentator is already running. No processes were changed. & exit /b 1 )
if not errorlevel 1 ( echo Presentator is already running. Use its existing window. & exit /b 0 )

cls
echo.
echo  ================================================
echo    PATTAN PRESENTATOR  ^|  Native Desktop App
echo  ================================================
echo.
echo  Existing applications and service connections will be left running.

echo  Launching Electron (all servers start automatically)...
echo.

npm.cmd start

endlocal
