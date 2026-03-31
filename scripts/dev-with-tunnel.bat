@echo off
setlocal enabledelayedexpansion
:: Run pnpm dev:all + Cloudflare tunnel. Set PORT in .env or here (default 3000).
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."

if not defined PORT set "PORT=3000"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    set "_K=%%a"
    if "!_K!"=="PORT" set "PORT=%%b"
  )
)

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [ERROR] cloudflared not found. Install it first:
  echo   winget install Cloudflare.cloudflared
  echo   Or: scripts\setup_prerequisites.bat
  popd
  exit /b 1
)

echo [INFO] Starting app + tunnel (PORT=%PORT%). Public URL will appear below.
echo.
call pnpm exec concurrently -n dev,tunnel -c blue,magenta "pnpm dev:all" "cloudflared tunnel --url http://localhost:%PORT%"
popd
