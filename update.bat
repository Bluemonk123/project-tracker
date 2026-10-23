@echo off
REM Update Project Tracker to the latest version on GitHub. Double-click to run.
REM Your "data" folder (projects, users, files, backups) and portable Node.js are never touched.
setlocal EnableExtensions
cd /d "%~dp0"
title Project Tracker - update
set "APP=%~dp0"
set "APPDIR=%APP:~0,-1%"
set "ZIPURL=https://github.com/Bluemonk123/project-tracker/archive/refs/heads/main.zip"
set "WORK=%TEMP%\project-tracker-update"
if not defined PORT set "PORT=4000"

echo.
echo  Updating Project Tracker in %APPDIR%
echo.

REM 1. The app must be closed so files can be replaced safely.
where curl.exe >nul 2>nul
if not errorlevel 1 (
  curl.exe -s -o nul -m 3 http://localhost:%PORT%/api/setup-status
  if not errorlevel 1 (
    echo  The app is still running. Close the Project Tracker window first,
    echo  then double-click update.bat again.
    echo.
    pause
    exit /b 1
  )
)

REM 2. Download and unpack the latest version.
echo  Downloading the latest version...
if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch {}; Invoke-WebRequest -UseBasicParsing -Uri '%ZIPURL%' -OutFile '%WORK%\latest.zip'; Expand-Archive -LiteralPath '%WORK%\latest.zip' -DestinationPath '%WORK%' -Force"
if not exist "%WORK%\project-tracker-main\package.json" (
  echo  PowerShell download did not work, trying curl...
  curl.exe -L -s -o "%WORK%\latest.zip" "%ZIPURL%" && tar.exe -xf "%WORK%\latest.zip" -C "%WORK%"
)
set "SRC=%WORK%\project-tracker-main"
if not exist "%SRC%\package.json" (
  echo.
  echo  Could not download the update. Check the internet connection,
  echo  or download the ZIP from GitHub by hand.
  echo.
  pause
  exit /b 1
)

REM 3. Safety copy of the database before changing anything.
if exist "%APP%data\tracker.db" (
  echo  Backing up your data to data\backups\before-update ...
  robocopy "%APPDIR%\data" "%APPDIR%\data\backups\before-update" tracker.db tracker.db-wal tracker.db-shm /NJH /NJS /NFL /NDL /NP >nul
)

REM 4. Copy the new program files over the old ones. data, node_modules and Node.js stay as they are.
echo  Installing the new version...
robocopy "%SRC%" "%APPDIR%" /E /XD data node_modules .git /XF update.bat /NJH /NJS /NFL /NDL /NP >nul
if errorlevel 8 (
  echo  Copying the new files failed. Make sure no file in this folder is open, then try again.
  pause
  exit /b 1
)

REM 5. Replace this script last (on one line, so Windows has already read it), clean up and start the app.
echo.
echo  Update downloaded. Starting Project Tracker; it rebuilds itself on this first start.
echo.
copy /y "%SRC%\update.bat" "%~f0" >nul & rmdir /s /q "%WORK%" & start "Project Tracker" "%APP%start.bat" & exit /b 0
