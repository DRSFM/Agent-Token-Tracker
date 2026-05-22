@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  wscript.exe "%~dp0open-source.vbs"
  exit /b 0
) else (
  echo npm was not found. Please install Node.js or run this from a terminal with npm available.
  pause
  exit /b 1
)
