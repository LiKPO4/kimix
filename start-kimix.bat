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
if "%~1"=="--clean" (
  echo Cleaning cache and doing a full rebuild.
) else if "%~1"=="--dev" (
  echo Starting Kimix in hot-reload dev mode.
) else if "%~1"=="--fast" (
  echo Launching existing built output without checking for source changes.
) else (
  echo Auto mode: rebuilds if source changed/out missing, otherwise launches directly.
  echo Use --dev for hot reload, --clean for full rebuild, --fast to skip rebuild.
)
echo.

PowerShell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restart-kimix-dev.ps1" %*

echo.
echo Kimix dev process exited. Press any key to close this window.
pause >nul
