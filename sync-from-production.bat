@echo off
REM Copies the LIVE data (database and uploaded files) from production into STAGING on this computer.
REM Staging (staging.bat) must be running. Your current local data is backed up first.
REM The code is not copied: staging already runs the newest code from GitHub.
REM   sync-from-production.bat --reset   asks again for the live address and the sync key
setlocal
cd /d "%~dp0"
set "PORTABLE_NODE="
if exist "%~dp0node\node.exe" set "PORTABLE_NODE=%~dp0node"
if not defined PORTABLE_NODE (
  for /d %%D in ("%~dp0node-v*-win-x64") do if exist "%%~fD\node.exe" set "PORTABLE_NODE=%%~fD"
)
if defined PORTABLE_NODE set "PATH=%PORTABLE_NODE%;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Start staging.bat once first.
  pause
  exit /b 1
)
echo.
echo  This replaces ALL data in your local staging copy with the live data.
echo  Your current local data is saved in data\backups first.
echo.
choice /m " Continue"
if errorlevel 2 exit /b 0
node scripts\sync-from-production.js %*
echo.
pause
