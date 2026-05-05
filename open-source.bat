@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  echo Starting Agent Token Tracker...
  npm run dev
) else (
  echo npm was not found. Please install Node.js or run this from a terminal with npm available.
  pause
  exit /b 1
)

pause
