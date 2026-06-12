@echo off
setlocal

chcp 65001 >nul
cd /d "%~dp0"

set "PATH=C:\Program Files\nodejs;C:\Users\lijialin08\AppData\Roaming\npm;%PATH%"

if "%~1"=="--check" (
  where node >nul 2>nul || exit /b 1
  where pnpm >nul 2>nul || exit /b 1
  exit /b 0
)

echo Starting Kimix from %CD%
echo.
echo Cleaning old Kimix dev processes and cache before starting.
echo.

PowerShell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restart-kimix-dev.ps1"

echo.
echo Kimix dev process exited. Press any key to close this window.
pause >nul
