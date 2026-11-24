@echo off
REM Project Tracker STAGING - runs the app and keeps it on the newest version from GitHub (main). Double-click to run.
REM Use this instead of start.bat on the testing computer. Close the window to stop.
setlocal
cd /d "%~dp0"
title Project Tracker - STAGING

REM Use a portable Node.js if one was unzipped into this folder (no admin rights needed),
REM e.g. ProjectTracker\node\node.exe or ProjectTracker\node-v24.11.0-win-x64\node.exe
set "PORTABLE_NODE="
if exist "%~dp0node\node.exe" set "PORTABLE_NODE=%~dp0node"
if not defined PORTABLE_NODE (
  for /d %%D in ("%~dp0node-v*-win-x64") do if exist "%%~fD\node.exe" set "PORTABLE_NODE=%%~fD"
)
if defined PORTABLE_NODE (
  set "PATH=%PORTABLE_NODE%;%PATH%"
  echo Using portable Node.js from "%PORTABLE_NODE%"
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js was not found.
  echo.
  echo  With admin rights: install the LTS version from https://nodejs.org
  echo.
  echo  Without admin rights: download the Windows ZIP from
  echo    https://nodejs.org/dist/latest-v24.x/   ^(the file ending in -win-x64.zip^)
  echo  and unzip it INTO this folder, so that this file exists:
  echo    %~dp0node-v...-win-x64\node.exe
  echo  Then run start.bat again.
  echo.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo.
  echo  Your Node.js version is too old. Use Node.js 22.13 or newer ^(LTS^) from https://nodejs.org
  echo.
  pause
  exit /b 1
)

:run
node scripts\staging-runner.js
if errorlevel 3 if not errorlevel 4 goto run
pause
