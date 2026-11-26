@echo off
REM Makes STAGING start by itself every time you sign in to Windows (minimized), so the local app is always
REM running and always on the newest version from GitHub. Double-click once. Run again to switch it off.
setlocal
cd /d "%~dp0"
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Project Tracker STAGING.lnk"

if exist "%LINK%" (
  del "%LINK%"
  echo.
  echo  Auto-start is now OFF. Staging will no longer start when you sign in.
  echo  ^(Double-click this file again to switch it back on.^)
  echo.
  pause
  exit /b 0
)

powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LINK); $s.TargetPath='%~dp0staging.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Description='Project Tracker staging (auto-updates from GitHub)'; $s.Save()"
if not exist "%LINK%" (
  echo  Could not create the auto-start shortcut.
  pause
  exit /b 1
)
echo.
echo  Auto-start is now ON.
echo  Staging will start by itself ^(minimized^) every time you sign in to Windows,
echo  and it installs every new change from GitHub within about a minute.
echo  Open: http://localhost:4000
echo.
echo  Starting staging now...
start "Project Tracker - STAGING" /min "%~dp0staging.bat"
timeout /t 5 >nul
