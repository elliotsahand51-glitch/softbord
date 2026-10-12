@echo off
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Softboard needs Node.js 22.12 or newer to serve this local copy.
  echo Install Node.js, then run this launcher again.
  pause
  exit /b 1
)
node scripts\start-local.mjs
if errorlevel 1 pause
