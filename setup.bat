@echo off
rem One-time setup on Windows: installs the app's packages and puts a "Job Tracker" shortcut (with its icon) on your desktop.
setlocal
cd /d "%~dp0"

where node >nul 2>nul || (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org, then run setup.bat again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo The Job Tracker needs Node.js 20 or newer. You have:
  node -v
  echo Install the LTS version from https://nodejs.org, then run setup.bat again.
  pause
  exit /b 1
)

echo Installing the app's packages. This takes a minute...
call npm.cmd install || (
  echo npm install failed. Check your internet connection and try again.
  pause
  exit /b 1
)
if exist data\.needs-install del data\.needs-install

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\make-shortcut.ps1" || (
  echo Could not create the desktop shortcut. You can still open the app by double-clicking start.bat.
  pause
  exit /b 1
)
echo.
echo All set. Open the Job Tracker from the "Job Tracker" icon on your desktop.
pause
