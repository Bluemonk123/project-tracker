@echo off
REM Get the latest version from GitHub and rebuild. Your data folder is not touched.
setlocal
cd /d "%~dp0"
set "PORTABLE_NODE="
if exist "%~dp0node\node.exe" set "PORTABLE_NODE=%~dp0node"
if not defined PORTABLE_NODE (
  for /d %%D in ("%~dp0node-v*-win-x64") do if exist "%%~fD\node.exe" set "PORTABLE_NODE=%%~fD"
)
if defined PORTABLE_NODE set "PATH=%PORTABLE_NODE%;%PATH%"
where git >nul 2>nul
if errorlevel 1 ( echo Git is not installed. Download the new ZIP from GitHub instead and copy your "data" folder into it. & pause & exit /b 1 )
git pull
call npm install --no-audit --no-fund
call npm run build
echo.
echo Updated. Close the running Project Tracker window ^(if any^) and run start.bat again.
pause
