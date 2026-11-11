@echo off
rem Opens the Job Tracker: starts it first if it isn't running. The desktop shortcut runs this.
rem First start (or after an update that changed packages) it installs the packages first.
setlocal
cd /d "%~dp0"
if not defined APP_PORT set APP_PORT=5173
netstat -ano | findstr /r /c:":%APP_PORT% .*LISTENING" >nul && goto open

where node >nul 2>nul || (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org, then open the Job Tracker again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules goto install
if exist data\.needs-install goto install
goto run

:install
echo Installing the app's packages (first start, or after an update). This takes a minute...
call npm.cmd install || (
  echo npm install failed. Check your internet connection and try again.
  pause
  exit /b 1
)
if exist data\.needs-install del data\.needs-install

:run
start "Job Tracker server" /min cmd /k "npm.cmd run dev"
set /a tries=0
:wait
ping -n 2 127.0.0.1 >nul
set /a tries+=1
if %tries% GTR 120 (
  echo The Job Tracker did not start. Look at the "Job Tracker server" window for the error.
  pause
  exit /b 1
)
curl.exe -s -o nul http://localhost:%APP_PORT%/ || goto wait

:open
if defined JOBS_NO_BROWSER exit /b 0
start "" http://localhost:%APP_PORT%/
