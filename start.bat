@echo off
REM Project Tracker - Windows start script. Double-click to run.
setlocal
cd /d "%~dp0"
title Project Tracker

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed.
  echo  Download the LTS version from https://nodejs.org , install it, then run this file again.
  echo.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo.
  echo  Your Node.js version is too old. Install Node.js 22.13 or newer ^(LTS^) from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing components for the first time. This takes a minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo npm install failed. Check the internet connection and try again. & pause & exit /b 1 )
)

if not exist client\dist\index.html (
  echo Building the web interface...
  call npm run build
  if errorlevel 1 ( echo Build failed. & pause & exit /b 1 )
)

call npm start
pause
