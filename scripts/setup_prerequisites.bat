@echo off
setlocal enabledelayedexpansion

:: NarrateAI — Setup everything and verify it works (Windows)
::
:: Use this once to install tools, start infra, build, and optionally restore.
:: To run the app afterward, use: pnpm dev:all
::
:: Usage:
::   scripts\setup_prerequisites.bat                                  Full setup + deploy
::   scripts\setup_prerequisites.bat --restore backups\backup.tar.gz   Setup + restore backup
::   scripts\setup_prerequisites.bat --skip-prereqs                   Skip tool installs
::   scripts\setup_prerequisites.bat --stop                           Stop services
::   scripts\setup_prerequisites.bat --status                          Show status

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."
set "PROJECT_DIR=%CD%"
popd

set "PM2_ECO=%PROJECT_DIR%\ecosystem.config.cjs"
if not defined PORT set "PORT=3000"
:: Node 22 LTS required (Node 24+ triggers DEP0169 url.parse() deprecation warnings)
set "NODE_MAJOR=22"
set "SKIP_PREREQS=0"
set "RESTORE_FILE="
set "ACTION=deploy"
set "ORIGINAL_PATH=%PATH%"

:parse_args
if "%~1"=="" goto :done_args
if "%~1"=="--skip-prereqs" set "SKIP_PREREQS=1" & shift & goto :parse_args
if "%~1"=="--restore" set "RESTORE_FILE=%~2" & shift & shift & goto :parse_args
if "%~1"=="--stop" set "ACTION=stop" & shift & goto :parse_args
if "%~1"=="--status" set "ACTION=status" & shift & goto :parse_args
if "%~1"=="--help" goto :show_help
if "%~1"=="-h" goto :show_help
echo [ERR ] Unknown option: %~1
exit /b 1
:done_args

if "%ACTION%"=="stop" goto :do_stop
if "%ACTION%"=="status" goto :do_status
goto :do_deploy

:show_help
echo.
echo NarrateAI - Setup everything and verify it works
echo.
echo Usage:
echo   %~nx0                       Full setup: install tools, start infra, build
echo   %~nx0 --restore file.tar.gz Setup and restore from backup
echo   %~nx0 --skip-prereqs       Skip tool installation
echo   %~nx0 --stop               Stop all services
echo   %~nx0 --status             Show status
echo.
echo After setup:
echo   Run app:           pnpm dev:all
echo   Run app + tunnel:  pnpm dev:tunnel   (public URL via cloudflared)
echo Backup/restore:      scripts\backup-restore.bat
echo.
exit /b 0

:: ─────────────────────────────────────────────────────────────────────────────
:refresh_path
:: Merge registry PATH with original session PATH so newly-installed tools
:: are found without losing entries like Docker Desktop, winget, etc.
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "_SYSPATH=%%b"
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "_USRPATH=%%b"
set "PATH=!_SYSPATH!;!_USRPATH!;!ORIGINAL_PATH!"
for /f "tokens=*" %%p in ('npm config get prefix 2^>nul') do set "PATH=%%p;!PATH!"
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:detect_pkg
set "PKG=none"
where winget >nul 2>nul
if not errorlevel 1 set "PKG=winget"
if "!PKG!"=="none" (
    where choco >nul 2>nul
    if not errorlevel 1 set "PKG=choco"
)
echo [INFO]  Package manager: !PKG!
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:install_wsl
wsl --status >nul 2>nul
if not errorlevel 1 (
    echo [ OK ]  WSL already installed
    goto :eof
)
echo [INFO]  Installing WSL 2 (required by Docker Desktop)...
wsl --install --no-distribution >nul 2>nul
if errorlevel 1 (
    echo [WARN]  WSL install may need admin rights or a reboot.
    echo [WARN]  Run "wsl --install" manually in an admin terminal if needed.
)
wsl --set-default-version 2 >nul 2>nul
echo [ OK ]  WSL 2 installed
echo [WARN]  If this is the first WSL install, you MUST REBOOT before Docker will work.
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:install_docker
where docker >nul 2>nul
if not errorlevel 1 (
    echo [ OK ]  Docker already installed
    goto :eof
)
echo [INFO]  Installing Docker Desktop...
if "!PKG!"=="winget" (
    winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
) else if "!PKG!"=="choco" (
    choco install docker-desktop -y
) else (
    echo [ERR ] Cannot auto-install Docker. Get it from https://docker.com
    exit /b 1
)
call :refresh_path
echo [WARN]  You may need to RESTART and ensure Docker Desktop is running.
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:install_node
where node >nul 2>nul
if errorlevel 1 goto :do_install_node
for /f "tokens=1 delims=.v" %%v in ('node -v 2^>nul') do set "_NV=%%v"
if !_NV! GEQ 24 (
    echo [WARN]  Node.js !_NV! detected. Node 22 LTS is recommended to avoid deprecation warnings.
    echo [INFO]  Consider installing Node %NODE_MAJOR% from https://nodejs.org/en/download
    goto :eof
)
if !_NV! GEQ %NODE_MAJOR% (
    echo [ OK ]  Node.js already installed
    goto :eof
)
echo [WARN]  Node.js too old, need v%NODE_MAJOR%+
:do_install_node
echo [INFO]  Installing Node.js %NODE_MAJOR% LTS...
if "!PKG!"=="winget" (
    winget install -e --id OpenJS.NodeJS.%NODE_MAJOR% --accept-package-agreements --accept-source-agreements
) else if "!PKG!"=="choco" (
    choco install nodejs-lts -y
) else (
    echo [ERR ] Cannot auto-install Node.js. Install v%NODE_MAJOR% from https://nodejs.org
    exit /b 1
)
call :refresh_path
echo [ OK ]  Node.js installed
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:install_pnpm
where pnpm >nul 2>nul
if not errorlevel 1 (
    echo [ OK ]  pnpm already installed
    goto :eof
)
echo [INFO]  Installing pnpm...
call corepack enable >nul 2>nul
call corepack prepare pnpm@latest --activate >nul 2>nul
where pnpm >nul 2>nul
if not errorlevel 1 goto :pnpm_done
call npm install -g pnpm >nul 2>nul
:pnpm_done
call :refresh_path
echo [ OK ]  pnpm installed
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:install_ffmpeg
where ffmpeg >nul 2>nul
if not errorlevel 1 (
    echo [ OK ]  FFmpeg already installed
    goto :eof
)
echo [INFO]  Installing FFmpeg...
if "!PKG!"=="winget" (
    winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
) else if "!PKG!"=="choco" (
    choco install ffmpeg -y
) else (
    echo [ERR ] Install FFmpeg manually from https://ffmpeg.org
    exit /b 1
)
call :refresh_path
echo [ OK ]  FFmpeg installed
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:install_ytdlp
where yt-dlp >nul 2>nul
if not errorlevel 1 (
    echo [ OK ]  yt-dlp already installed
    goto :eof
)
echo [INFO]  Installing yt-dlp...
if "!PKG!"=="winget" (
    winget install -e --id yt-dlp.yt-dlp --accept-package-agreements --accept-source-agreements
) else if "!PKG!"=="choco" (
    choco install yt-dlp -y
) else (
    where pip >nul 2>nul
    if not errorlevel 1 (
        pip install yt-dlp
    ) else (
        echo [WARN]  Install yt-dlp manually: pip install yt-dlp  or  winget install yt-dlp
        goto :eof
    )
)
call :refresh_path
where yt-dlp >nul 2>nul
if errorlevel 1 (
    echo [WARN]  yt-dlp installed but not in PATH yet. Restart your terminal after setup.
    goto :eof
)
echo [ OK ]  yt-dlp installed
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:install_pm2
where pm2 >nul 2>nul
if not errorlevel 1 (
    echo [ OK ]  PM2 already installed
    goto :eof
)
echo [INFO]  Installing PM2...
call npm install -g pm2 >nul 2>nul
call :refresh_path
echo [ OK ]  PM2 installed
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:install_cloudflared
where cloudflared >nul 2>nul
if not errorlevel 1 (
    echo [ OK ]  cloudflared already installed
    goto :eof
)
echo [INFO]  Installing cloudflared...
if "!PKG!"=="winget" (
    winget install -e --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
) else if "!PKG!"=="choco" (
    choco install cloudflared -y
) else (
    echo [WARN]  Install cloudflared manually from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    goto :eof
)
call :refresh_path
where cloudflared >nul 2>nul
if errorlevel 1 (
    echo [WARN]  cloudflared installed but not in PATH yet. Restart your terminal after setup.
    goto :eof
)
echo [ OK ]  cloudflared installed
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:install_all
echo.
echo --- Installing prerequisites ---
call :detect_pkg
call :install_wsl
call :install_docker
call :install_node
call :install_pnpm
call :install_ffmpeg
call :install_ytdlp
call :install_pm2
call :install_cloudflared
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:start_infra
echo.
echo --- Starting infrastructure ---
pushd "%PROJECT_DIR%"

where docker >nul 2>nul
if errorlevel 1 (
    echo [ERR ] Docker is not installed or not in PATH
    popd
    exit /b 1
)

:: Ensure Docker daemon is running (starts Docker Desktop if needed)
docker info >nul 2>nul
if errorlevel 1 (
    echo [INFO]  Docker daemon not running -- starting Docker Desktop...
    set "_DD="
    if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" set "_DD=C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if not defined _DD if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" set "_DD=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
    if not defined _DD (
        echo [ERR ] Cannot find Docker Desktop. Start it manually, then re-run this script.
        popd
        exit /b 1
    )
    start "" "!_DD!"
    echo [INFO]  Waiting for Docker daemon (up to 60s^)...
    set "_D=60"
    :docker_wait
    if !_D! LEQ 0 (
        echo [ERR ] Docker daemon did not start in 60s. Start Docker Desktop manually.
        popd
        exit /b 1
    )
    docker info >nul 2>nul
    if not errorlevel 1 goto :docker_ok
    set /a _D-=1
    timeout /t 1 /nobreak >nul
    goto :docker_wait
    :docker_ok
    echo [ OK ]  Docker daemon is ready
)

docker compose up -d
if errorlevel 1 (
    docker-compose up -d
    if errorlevel 1 (
        echo [ERR ] docker compose up failed. Check docker-compose.yml and Docker Desktop status.
        popd
        exit /b 1
    )
)

echo [INFO]  Waiting for PostgreSQL...
set "_R=30"
:pg_wait
if !_R! LEQ 0 (
    echo [ERR ] PostgreSQL did not start in 30s
    echo [INFO]  Check: docker compose ps / docker compose logs postgres
    popd
    exit /b 1
)
docker compose exec -T postgres pg_isready -U narrateai >nul 2>nul
if not errorlevel 1 goto :pg_ok
set /a _R-=1
timeout /t 1 /nobreak >nul
goto :pg_wait
:pg_ok
echo [ OK ]  PostgreSQL is ready

echo [INFO]  Waiting for Redis...
set "_R=15"
:redis_wait
if !_R! LEQ 0 (
    echo [ERR ] Redis did not start in 15s
    echo [INFO]  Check: docker compose ps / docker compose logs redis
    popd
    exit /b 1
)
docker compose exec -T redis redis-cli ping 2>nul | findstr "PONG" >nul 2>nul
if not errorlevel 1 goto :redis_ok
set /a _R-=1
timeout /t 1 /nobreak >nul
goto :redis_wait
:redis_ok
echo [ OK ]  Redis is ready

popd
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:setup_env
if exist "%PROJECT_DIR%\.env" (
    echo [ OK ]  .env already exists
    goto :eof
)
if exist "%PROJECT_DIR%\.env.example" (
    copy /y "%PROJECT_DIR%\.env.example" "%PROJECT_DIR%\.env" >nul
    echo [WARN]  .env created from .env.example -- edit it with your API keys
    goto :eof
)
echo [ERR ] No .env or .env.example found.
exit /b 1

:: ─────────────────────────────────────────────────────────────────────────────
:restore_backup
echo.
echo --- Restoring from backup ---
set "_RF=%RESTORE_FILE%"
if not exist "!_RF!" if exist "%PROJECT_DIR%\!_RF!" set "_RF=%PROJECT_DIR%\!_RF!"
if not exist "!_RF!" if exist "%PROJECT_DIR%\backups\!_RF!" set "_RF=%PROJECT_DIR%\backups\!_RF!"
if not exist "!_RF!" (
    echo [ERR ] Backup file not found: !_RF!
    exit /b 1
)
echo [INFO]  Restoring from: !_RF!
call "%SCRIPT_DIR%backup-restore.bat" restore "!_RF!" --yes
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:prepare_project
echo.
echo --- Preparing project (deps + schema) ---
pushd "%PROJECT_DIR%"

echo [INFO]  Installing Node.js dependencies...
call pnpm install --frozen-lockfile >nul 2>nul
if errorlevel 1 call pnpm install
echo [ OK ]  Dependencies installed

echo [INFO]  Generating Prisma client...
call pnpm db:generate
echo [ OK ]  Prisma client generated

echo [INFO]  Pushing database schema...
call pnpm db:push
if errorlevel 1 (
    echo [ERR ]  Database schema push failed. Check DATABASE_URL and that PostgreSQL is running.
    popd
    exit /b 1
)
echo [ OK ]  Database schema synced

popd
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:gen_pm2_config
set "_CWD=%PROJECT_DIR:\=/%"
> "%PM2_ECO%" (
    echo module.exports = {
    echo   apps: [
    echo     { name: "narrateai-web", script: "node_modules/.bin/next", args: "start -p %PORT%", cwd: "%_CWD%", env: { NODE_ENV: "production", PORT: "%PORT%" }, max_memory_restart: "512M" },
    echo     { name: "narrateai-worker", script: "node_modules/.bin/tsx", args: "workers/video-generation.ts", cwd: "%_CWD%", env: { NODE_ENV: "production" }, max_memory_restart: "1G" },
    echo     { name: "narrateai-scheduler", script: "node_modules/.bin/tsx", args: "workers/scheduler.ts", cwd: "%_CWD%", env: { NODE_ENV: "production" }, max_memory_restart: "256M" },
    echo   ],
    echo };
)
echo [ OK ]  PM2 config generated
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
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
if !_R! LEQ 0 (
    echo [WARN]  Web server may still be starting -- check: pm2 logs narrateai-web
    goto :web_ok
)
curl -sf "http://localhost:%PORT%" >nul 2>nul
if not errorlevel 1 goto :web_ready
set /a _R-=1
timeout /t 2 /nobreak >nul
goto :web_wait
:web_ready
echo [ OK ]  Web server is ready on port %PORT%
:web_ok

call pm2 save >nul 2>nul
popd
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:start_tunnel
echo.
echo --- Starting Cloudflare tunnel ---
call pm2 delete narrateai-tunnel >nul 2>nul

where cloudflared >nul 2>nul
if errorlevel 1 (
    echo [WARN]  cloudflared not found -- skipping tunnel
    goto :print_done
)

for /f "tokens=*" %%c in ('where cloudflared 2^>nul') do set "_CF=%%c"
call pm2 start "!_CF!" --name "narrateai-tunnel" -- tunnel --url "http://localhost:%PORT%"

echo [INFO]  Waiting for tunnel URL...
timeout /t 5 /nobreak >nul

set "_TURL="
set "_R=12"
:twait
if !_R! LEQ 0 goto :print_done
for /f "tokens=*" %%l in ('pm2 logs narrateai-tunnel --nostream --lines 30 2^>nul') do (
    echo %%l | findstr "trycloudflare.com" >nul 2>nul
    if not errorlevel 1 (
        for %%u in (%%l) do (
            echo %%u | findstr "https://" >nul 2>nul
            if not errorlevel 1 set "_TURL=%%u"
        )
    )
)
if defined _TURL goto :print_done
set /a _R-=1
timeout /t 3 /nobreak >nul
goto :twait

:print_done
call pm2 save >nul 2>nul
echo.
echo ================================================================
echo   NarrateAI is running!
echo ================================================================
echo.
echo   Local:   http://localhost:%PORT%
if defined _TURL echo   Public:  !_TURL!
if not defined _TURL echo   [WARN] Could not detect tunnel URL -- check: pm2 logs narrateai-tunnel
echo.
echo   pm2 status / pm2 logs / %~nx0 --stop
echo.
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:do_stop
echo.
echo --- Stopping NarrateAI ---
call pm2 delete narrateai-web narrateai-worker narrateai-scheduler narrateai-tunnel >nul 2>nul
echo [ OK ]  All NarrateAI processes stopped
echo   To stop Docker too: docker compose down
echo.
exit /b 0

:: ─────────────────────────────────────────────────────────────────────────────
:do_status
echo.
echo NarrateAI Process Status
echo.
call pm2 list 2>nul
echo.
echo Docker Services
echo.
pushd "%PROJECT_DIR%"
docker compose ps 2>nul
popd
echo.
exit /b 0

:: ─────────────────────────────────────────────────────────────────────────────
:do_deploy
echo.
echo +================================================+
echo     NarrateAI -- Setup Prerequisites
echo +================================================+
echo.

if "%SKIP_PREREQS%"=="1" (
    echo [INFO]  Skipping prerequisites
) else (
    call :install_all
)

call :start_infra
if errorlevel 1 exit /b 1

call :setup_env
if errorlevel 1 exit /b 1

if not "%RESTORE_FILE%"=="" (
    call :restore_backup
    if errorlevel 1 (
        echo [WARN]  Restore failed or skipped. Ensure PostgreSQL client is installed for restore.
        echo [WARN]  Videos, DB data, and other backup contents were NOT restored.
        echo [INFO]  To restore later: install PostgreSQL client, then run:
        echo         scripts\backup-restore.bat restore "%RESTORE_FILE%"
        echo [INFO]  Continuing: schema will be pushed so the app can run.
    )
)

call :prepare_project
if errorlevel 1 exit /b 1

echo.
echo ================================================================
echo   Setup complete.
echo   Run app:           pnpm dev:all
echo   Run app + tunnel:  pnpm dev:tunnel   (public URL via cloudflared)
echo   (Dev deprecation warning suppressed. Localtunnel not used.)
echo ================================================================
echo.
exit /b 0
