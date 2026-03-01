@echo off
setlocal enabledelayedexpansion

:: ─────────────────────────────────────────────────────────────────────────────
:: NarrateAI — Setup Prerequisites ^& Deploy (Windows)
::
:: Usage:
::   scripts\setup_prerequisites.bat                                  Fresh deploy
::   scripts\setup_prerequisites.bat --restore backups\backup.tar.gz  Deploy + restore
::   scripts\setup_prerequisites.bat --skip-prereqs                   Skip installs
::   scripts\setup_prerequisites.bat --stop                           Stop services
::   scripts\setup_prerequisites.bat --status                         Show status
:: ─────────────────────────────────────────────────────────────────────────────

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."
set "PROJECT_DIR=%CD%"
popd

set "PM2_ECO=%PROJECT_DIR%\ecosystem.config.cjs"
if not defined PORT set "PORT=3000"
set "NODE_MAJOR=22"
set "SKIP_PREREQS=0"
set "RESTORE_FILE="
set "ACTION=deploy"

:: ═════════════════════════════════════════════════════════════════════════════
:: PARSE ARGUMENTS
:: ═════════════════════════════════════════════════════════════════════════════
:parse_args
if "%~1"=="" goto :run_action
if "%~1"=="--skip-prereqs" (set "SKIP_PREREQS=1" & shift & goto :parse_args)
if "%~1"=="--restore" (set "RESTORE_FILE=%~2" & shift & shift & goto :parse_args)
if "%~1"=="--stop" (set "ACTION=stop" & shift & goto :parse_args)
if "%~1"=="--status" (set "ACTION=status" & shift & goto :parse_args)
if "%~1"=="--help" goto :show_help
if "%~1"=="-h" goto :show_help
echo [ERR ]  Unknown option: %~1
echo Run: %~nx0 --help
exit /b 1

:run_action
if "%ACTION%"=="stop" goto :do_stop
if "%ACTION%"=="status" goto :do_status
goto :do_deploy

:: ═════════════════════════════════════════════════════════════════════════════
:: HELP
:: ═════════════════════════════════════════════════════════════════════════════
:show_help
echo.
echo NarrateAI Setup Prerequisites ^& Deploy (Windows)
echo.
echo Usage:
echo   %~nx0                                       Fresh deployment
echo   %~nx0 --restore ^<backup.tar.gz^>             Deploy and restore from backup
echo   %~nx0 --skip-prereqs                         Skip prerequisite installation
echo   %~nx0 --skip-prereqs --restore ^<file^>        Restore without installing
echo   %~nx0 --stop                                 Stop all NarrateAI services
echo   %~nx0 --status                               Show running status
echo.
echo Prerequisites installed automatically (via winget/choco):
echo   Docker Desktop, Node.js %NODE_MAJOR%, pnpm, FFmpeg, PM2, cloudflared
echo.
echo Environment:
echo   PORT     Web server port (default: 3000)
echo.
exit /b 0

:: ═════════════════════════════════════════════════════════════════════════════
:: DETECT PACKAGE MANAGER
:: ═════════════════════════════════════════════════════════════════════════════
:detect_pkg
set "PKG=none"
where winget >nul 2>nul && set "PKG=winget"
if "%PKG%"=="none" where choco >nul 2>nul && set "PKG=choco"
echo [INFO]  Detected package manager: %PKG%
if "%PKG%"=="none" (
    echo [WARN]  Neither winget nor chocolatey found.
    echo [WARN]  Install winget (App Installer from Microsoft Store) or chocolatey.
)
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: INSTALL DOCKER
:: ═════════════════════════════════════════════════════════════════════════════
:install_docker
where docker >nul 2>nul && (
    for /f "tokens=*" %%v in ('docker --version 2^>nul') do echo [ OK ]  Docker already installed (%%v^)
    goto :eof
)
echo [INFO]  Installing Docker Desktop...
if "%PKG%"=="winget" (
    winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
) else if "%PKG%"=="choco" (
    choco install docker-desktop -y
) else (
    echo [ERR ]  Cannot auto-install Docker. Install manually: https://docs.docker.com/desktop/install/windows-install/
    exit /b 1
)
echo [WARN]  Docker Desktop installed. You may need to RESTART and ensure Docker Desktop is running.
echo [ OK ]  Docker installed
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: INSTALL NODE.JS
:: ═════════════════════════════════════════════════════════════════════════════
:install_node
where node >nul 2>nul && (
    for /f "tokens=1 delims=." %%v in ('node -v 2^>nul') do (
        set "_NV=%%v"
        set "_NV=!_NV:v=!"
        if !_NV! GEQ %NODE_MAJOR% (
            for /f "tokens=*" %%a in ('node -v') do echo [ OK ]  Node.js already installed (%%a^)
            goto :eof
        )
    )
    echo [WARN]  Node.js found but too old, upgrading...
)
echo [INFO]  Installing Node.js %NODE_MAJOR%...
if "%PKG%"=="winget" (
    winget install -e --id OpenJS.NodeJS --accept-package-agreements --accept-source-agreements
) else if "%PKG%"=="choco" (
    choco install nodejs -y
) else (
    echo [ERR ]  Cannot auto-install Node.js. Install v%NODE_MAJOR%+ from https://nodejs.org
    exit /b 1
)
call :refresh_path
echo [ OK ]  Node.js installed
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: INSTALL PNPM
:: ═════════════════════════════════════════════════════════════════════════════
:install_pnpm
where pnpm >nul 2>nul && (
    for /f "tokens=*" %%v in ('pnpm -v 2^>nul') do echo [ OK ]  pnpm already installed (%%v^)
    goto :eof
)
echo [INFO]  Installing pnpm...
call corepack enable >nul 2>nul
call corepack prepare pnpm@latest --activate >nul 2>nul
where pnpm >nul 2>nul || call npm install -g pnpm >nul 2>nul
call :refresh_path
echo [ OK ]  pnpm installed
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: INSTALL FFMPEG
:: ═════════════════════════════════════════════════════════════════════════════
:install_ffmpeg
where ffmpeg >nul 2>nul && where ffprobe >nul 2>nul && (
    echo [ OK ]  FFmpeg already installed
    goto :eof
)
echo [INFO]  Installing FFmpeg...
if "%PKG%"=="winget" (
    winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
) else if "%PKG%"=="choco" (
    choco install ffmpeg -y
) else (
    echo [ERR ]  Install FFmpeg manually: https://ffmpeg.org/download.html#build-windows
    exit /b 1
)
call :refresh_path
echo [ OK ]  FFmpeg installed
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: INSTALL PM2
:: ═════════════════════════════════════════════════════════════════════════════
:install_pm2
where pm2 >nul 2>nul && (
    for /f "tokens=*" %%v in ('pm2 -v 2^>nul') do echo [ OK ]  PM2 already installed (%%v^)
    goto :eof
)
echo [INFO]  Installing PM2...
call npm install -g pm2 >nul 2>nul
call :refresh_path
where pm2 >nul 2>nul || (
    :: Add npm global prefix to PATH as fallback
    for /f "tokens=*" %%p in ('npm config get prefix 2^>nul') do set "PATH=%%p;!PATH!"
)
echo [ OK ]  PM2 installed
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: INSTALL CLOUDFLARED
:: ═════════════════════════════════════════════════════════════════════════════
:install_cloudflared
where cloudflared >nul 2>nul && (
    echo [ OK ]  cloudflared already installed
    goto :eof
)
echo [INFO]  Installing cloudflared...
if "%PKG%"=="winget" (
    winget install -e --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
) else if "%PKG%"=="choco" (
    choco install cloudflared -y
) else (
    echo [ERR ]  Install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    exit /b 1
)
call :refresh_path
echo [ OK ]  cloudflared installed
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: REFRESH PATH (pick up newly installed tools)
:: ═════════════════════════════════════════════════════════════════════════════
:refresh_path
:: Reload system + user PATH from registry
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "_SYSPATH=%%b"
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "_USRPATH=%%b"
set "PATH=!_SYSPATH!;!_USRPATH!"
:: Also ensure npm global bin is on PATH
for /f "tokens=*" %%p in ('npm config get prefix 2^>nul') do (
    echo !PATH! | findstr /i "%%p" >nul 2>nul || set "PATH=%%p;!PATH!"
)
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: ALL PREREQUISITES
:: ═════════════════════════════════════════════════════════════════════════════
:install_all
echo.
echo --- Installing prerequisites ---
call :detect_pkg
call :install_docker
call :install_node
call :install_pnpm
call :install_ffmpeg
call :install_pm2
call :install_cloudflared
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: START INFRASTRUCTURE
:: ═════════════════════════════════════════════════════════════════════════════
:start_infra
echo.
echo --- Starting infrastructure (PostgreSQL + Redis) ---
pushd "%PROJECT_DIR%"

where docker >nul 2>nul || (
    echo [ERR ]  Docker is not installed or not in PATH
    popd & exit /b 1
)

docker compose up -d 2>nul || docker-compose up -d 2>nul
if errorlevel 1 (
    echo [ERR ]  Failed to start Docker containers
    popd & exit /b 1
)

echo [INFO]  Waiting for PostgreSQL to be ready...
set "_R=30"
:pg_wait
if %_R% LEQ 0 (
    echo [ERR ]  PostgreSQL did not become ready in 30s
    popd & exit /b 1
)
docker compose exec -T postgres pg_isready -U narrateai >nul 2>nul && (
    echo [ OK ]  PostgreSQL is ready
    goto :pg_done
)
set /a _R-=1
timeout /t 1 /nobreak >nul
goto :pg_wait
:pg_done

echo [INFO]  Waiting for Redis to be ready...
set "_R=15"
:redis_wait
if %_R% LEQ 0 (
    echo [ERR ]  Redis did not become ready in 15s
    popd & exit /b 1
)
docker compose exec -T redis redis-cli ping 2>nul | findstr "PONG" >nul 2>nul && (
    echo [ OK ]  Redis is ready
    goto :redis_done
)
set /a _R-=1
timeout /t 1 /nobreak >nul
goto :redis_wait
:redis_done

popd
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: SETUP .env
:: ═════════════════════════════════════════════════════════════════════════════
:setup_env
if exist "%PROJECT_DIR%\.env" (
    echo [ OK ]  .env already exists
    goto :eof
)
if exist "%PROJECT_DIR%\.env.example" (
    copy /y "%PROJECT_DIR%\.env.example" "%PROJECT_DIR%\.env" >nul
    echo [WARN]  .env created from .env.example -- edit it with your API keys
) else (
    echo [ERR ]  No .env or .env.example found. Create .env with required variables.
    exit /b 1
)
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: RESTORE FROM BACKUP
:: ═════════════════════════════════════════════════════════════════════════════
:restore_backup
echo.
echo --- Restoring from backup ---

set "_RFILE=%RESTORE_FILE%"
if not exist "!_RFILE!" (
    if exist "%PROJECT_DIR%\!_RFILE!" (
        set "_RFILE=%PROJECT_DIR%\!_RFILE!"
    ) else if exist "%PROJECT_DIR%\backups\!_RFILE!" (
        set "_RFILE=%PROJECT_DIR%\backups\!_RFILE!"
    ) else (
        echo [ERR ]  Backup file not found: !_RFILE!
        exit /b 1
    )
)

echo [INFO]  Restoring from: !_RFILE!
call "%SCRIPT_DIR%backup-restore.bat" restore "!_RFILE!" --yes
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: BUILD APP
:: ═════════════════════════════════════════════════════════════════════════════
:build_app
echo.
echo --- Installing dependencies and building ---
pushd "%PROJECT_DIR%"

echo [INFO]  Installing Node.js dependencies...
call pnpm install --frozen-lockfile 2>nul || call pnpm install
echo [ OK ]  Dependencies installed

echo [INFO]  Generating Prisma client...
call pnpm db:generate
echo [ OK ]  Prisma client generated

echo [INFO]  Pushing database schema...
call pnpm db:push 2>nul && (
    echo [ OK ]  Database schema synced
) || (
    echo [WARN]  Schema push had warnings (may already be up to date^)
)

echo [INFO]  Building Next.js application...
call pnpm build
if errorlevel 1 (
    echo [ERR ]  Build failed
    popd & exit /b 1
)
echo [ OK ]  Build complete

popd
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: GENERATE PM2 CONFIG
:: ═════════════════════════════════════════════════════════════════════════════
:gen_pm2_config
set "_CWD=%PROJECT_DIR:\=/%"
(
    echo module.exports = {
    echo   apps: [
    echo     {
    echo       name: "narrateai-web",
    echo       script: "node_modules/.bin/next",
    echo       args: "start -p %PORT%",
    echo       cwd: "%_CWD%",
    echo       env: { NODE_ENV: "production", PORT: "%PORT%" },
    echo       max_memory_restart: "512M",
    echo     },
    echo     {
    echo       name: "narrateai-worker",
    echo       script: "node_modules/.bin/tsx",
    echo       args: "workers/video-generation.ts",
    echo       cwd: "%_CWD%",
    echo       env: { NODE_ENV: "production" },
    echo       max_memory_restart: "1G",
    echo     },
    echo     {
    echo       name: "narrateai-scheduler",
    echo       script: "node_modules/.bin/tsx",
    echo       args: "workers/scheduler.ts",
    echo       cwd: "%_CWD%",
    echo       env: { NODE_ENV: "production" },
    echo       max_memory_restart: "256M",
    echo     },
    echo   ],
    echo };
) > "%PM2_ECO%"
echo [ OK ]  PM2 ecosystem config generated
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: START APP
:: ═════════════════════════════════════════════════════════════════════════════
:start_app
echo.
echo --- Starting NarrateAI ---
pushd "%PROJECT_DIR%"
call :gen_pm2_config

call pm2 delete narrateai-web narrateai-worker narrateai-scheduler >nul 2>nul
call pm2 start "%PM2_ECO%"
echo [ OK ]  Application started via PM2

echo [INFO]  Waiting for web server on port %PORT%...
set "_R=30"
:web_wait
if %_R% LEQ 0 (
    echo [WARN]  Web server may still be starting -- check: pm2 logs narrateai-web
    goto :web_done
)
curl -sf "http://localhost:%PORT%" >nul 2>nul && (
    echo [ OK ]  Web server is ready on port %PORT%
    goto :web_done
)
set /a _R-=1
timeout /t 2 /nobreak >nul
goto :web_wait
:web_done

call pm2 save >nul 2>nul
popd
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: START TUNNEL
:: ═════════════════════════════════════════════════════════════════════════════
:start_tunnel
echo.
echo --- Starting Cloudflare tunnel ---

call pm2 delete narrateai-tunnel >nul 2>nul

where cloudflared >nul 2>nul || (
    echo [WARN]  cloudflared not found in PATH -- skipping tunnel
    goto :eof
)

for /f "tokens=*" %%c in ('where cloudflared 2^>nul') do set "_CF=%%c"
call pm2 start "!_CF!" --name "narrateai-tunnel" -- tunnel --url "http://localhost:%PORT%"

echo [INFO]  Waiting for tunnel URL...
timeout /t 5 /nobreak >nul

set "_TURL="
set "_R=12"
:tunnel_wait
if %_R% LEQ 0 goto :tunnel_done
for /f "tokens=*" %%l in ('pm2 logs narrateai-tunnel --nostream --lines 30 2^>nul ^| findstr "trycloudflare.com"') do (
    set "_LINE=%%l"
    for %%u in (!_LINE!) do (
        echo %%u | findstr "https://.*trycloudflare.com" >nul 2>nul && set "_TURL=%%u"
    )
)
if defined _TURL goto :tunnel_done
set /a _R-=1
timeout /t 3 /nobreak >nul
goto :tunnel_wait
:tunnel_done

call pm2 save >nul 2>nul

echo.
echo ================================================================
echo   NarrateAI is running!
echo ================================================================
echo.
echo   Local:   http://localhost:%PORT%
if defined _TURL (
    echo   Public:  !_TURL!
) else (
    echo   [WARN]  Could not detect tunnel URL -- check: pm2 logs narrateai-tunnel
)
echo.
echo   Useful commands:
echo     pm2 status                    -- see all processes
echo     pm2 logs                      -- tail all logs
echo     pm2 logs narrateai-web        -- web server logs
echo     pm2 logs narrateai-worker     -- video worker logs
echo     pm2 logs narrateai-scheduler  -- scheduler logs
echo     pm2 logs narrateai-tunnel     -- tunnel logs
echo     pm2 restart all               -- restart everything
echo     %~nx0 --stop                  -- stop all services
echo.
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: STOP
:: ═════════════════════════════════════════════════════════════════════════════
:do_stop
echo.
echo --- Stopping NarrateAI ---
call pm2 delete narrateai-web narrateai-worker narrateai-scheduler narrateai-tunnel >nul 2>nul
echo [ OK ]  All NarrateAI processes stopped
echo.
echo   Infrastructure (Postgres/Redis) is still running in Docker.
echo   To stop everything: docker compose down
echo.
exit /b 0

:: ═════════════════════════════════════════════════════════════════════════════
:: STATUS
:: ═════════════════════════════════════════════════════════════════════════════
:do_status
echo.
echo NarrateAI Process Status
echo.
call pm2 list 2>nul || echo [WARN]  PM2 not running
echo.
echo Docker Services
echo.
pushd "%PROJECT_DIR%"
docker compose ps 2>nul || docker-compose ps 2>nul || echo [WARN]  Docker Compose not available
popd
echo.
exit /b 0

:: ═════════════════════════════════════════════════════════════════════════════
:: MAIN DEPLOY FLOW
:: ═════════════════════════════════════════════════════════════════════════════
:do_deploy
echo.
echo +================================================+
echo ^|    NarrateAI -- Setup Prerequisites ^& Deploy    ^|
echo +================================================+
echo.

:: 1. Prerequisites
if "%SKIP_PREREQS%"=="1" (
    echo [INFO]  Skipping prerequisite installation (--skip-prereqs^)
) else (
    call :install_all
)

:: 2. Start infrastructure
call :start_infra || exit /b 1

:: 3. Setup .env
call :setup_env || exit /b 1

:: 4. Restore from backup if provided
if not "%RESTORE_FILE%"=="" call :restore_backup || exit /b 1

:: 5. Build
call :build_app || exit /b 1

:: 6. Start app
call :start_app

:: 7. Tunnel
call :start_tunnel

exit /b 0
