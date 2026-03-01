@echo off
setlocal enabledelayedexpansion

:: ─────────────────────────────────────────────────────────────────────────────
:: NarrateAI — Backup ^& Restore (Windows)
::
:: Usage:
::   scripts\backup-restore.bat backup                     Full backup
::   scripts\backup-restore.bat backup --db-only           DB + config only
::   scripts\backup-restore.bat restore <file.tar.gz>      Restore from backup
::   scripts\backup-restore.bat restore <file.tar.gz> --yes  Skip prompts
::   scripts\backup-restore.bat list                       List backups
:: ─────────────────────────────────────────────────────────────────────────────

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."
set "PROJECT_DIR=%CD%"
popd

if defined BACKUP_DIR (set "BKP_DIR=%BACKUP_DIR%") else (set "BKP_DIR=%PROJECT_DIR%\backups")
set "VIDEOS_DIR=%PROJECT_DIR%\public\videos"
set "CHARACTERS_DIR=%PROJECT_DIR%\public\characters"
set "MUSIC_DIR=%PROJECT_DIR%\public\music"
set "FONTS_DIR=%PROJECT_DIR%\assets\fonts"
set "SCHEMA_FILE=%PROJECT_DIR%\prisma\schema.prisma"

for /f "tokens=1-6 delims=/: " %%a in ("%date% %time%") do (
    set "TIMESTAMP=%%c%%a%%b_%%d%%e%%f"
)
:: fallback: use wmic for consistent format
for /f "skip=1 tokens=1" %%t in ('wmic os get localdatetime 2^>nul') do (
    if not defined _TS set "_TS=%%t"
)
if defined _TS set "TIMESTAMP=%_TS:~0,8%_%_TS:~8,6%"

set "CMD=%~1"
if "%CMD%"=="" set "CMD=help"
if "%CMD%"=="--help" set "CMD=help"
if "%CMD%"=="-h" set "CMD=help"

if "%CMD%"=="help" goto :show_help
if "%CMD%"=="list" goto :do_list
if "%CMD%"=="backup" goto :pre_backup
if "%CMD%"=="restore" goto :pre_restore

echo [ERROR] Unknown command: %CMD%
echo Run: %~nx0 help
exit /b 1

:: ═════════════════════════════════════════════════════════════════════════════
:: HELP
:: ═════════════════════════════════════════════════════════════════════════════
:show_help
echo.
echo NarrateAI Backup ^& Restore (Windows)
echo.
echo Usage:
echo   %~nx0 backup                   Full backup (DB + videos + config + assets)
echo   %~nx0 backup --db-only         Database + config only (no videos)
echo   %~nx0 restore ^<file^>           Restore from a backup archive
echo   %~nx0 restore ^<file^> --yes     Skip confirmation prompts
echo   %~nx0 list                     List available backups
echo.
echo Included in backup:
echo   - PostgreSQL database dump
echo   - .env (environment config with API keys)
echo   - assets\fonts\ (caption fonts for FFmpeg)
echo   - public\music\ (background music tracks)
echo   - public\characters\ (character preview images)
echo   - public\videos\ (generated videos, unless --db-only)
echo   - prisma\schema.prisma
echo.
echo Backups are saved to: %BKP_DIR%
echo.
exit /b 0

:: ═════════════════════════════════════════════════════════════════════════════
:: LOAD .env
:: ═════════════════════════════════════════════════════════════════════════════
:load_env
if not exist "%PROJECT_DIR%\.env" goto :eof
for /f "usebackq tokens=1,* delims==" %%a in ("%PROJECT_DIR%\.env") do (
    set "_K=%%a"
    if not "!_K:~0,1!"=="#" (
        if not "!_K!"=="" (
            set "_V=%%b"
            for /f "tokens=1 delims=#" %%c in ("!_V!") do set "_V=%%c"
            set "_V=!_V:"=!"
            for /f "tokens=* delims= " %%d in ("!_V!") do set "_V=%%d"
            set "%%a=!_V!"
        )
    )
)
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: PARSE DATABASE_URL
:: ═════════════════════════════════════════════════════════════════════════════
:parse_db_url
if not defined DATABASE_URL (
    echo [ERROR] DATABASE_URL is not set. Create a .env file or export it.
    exit /b 1
)
set "_URL=%DATABASE_URL%"

:: Strip protocol  postgres://user:pass@host:port/dbname
set "_URL=!_URL:*://=!"

:: Extract user
for /f "tokens=1 delims=:" %%u in ("!_URL!") do set "DB_USER=%%u"
:: Strip user:
set "_URL=!_URL:%DB_USER%:=!"
:: Extract pass (up to @)
for /f "tokens=1 delims=@" %%p in ("!_URL!") do set "DB_PASS=%%p"
:: Strip pass@
set "_URL=!_URL:%DB_PASS%@=!"
:: Extract host
for /f "tokens=1 delims=:" %%h in ("!_URL!") do set "DB_HOST=%%h"
:: Strip host:
set "_URL=!_URL:%DB_HOST%:=!"
:: Extract port
for /f "tokens=1 delims=/" %%o in ("!_URL!") do set "DB_PORT=%%o"
:: Strip port/
set "_URL=!_URL:%DB_PORT%/=!"
:: Extract dbname (strip query params)
for /f "tokens=1 delims=?" %%d in ("!_URL!") do set "DB_NAME=%%d"
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: CHECK TOOLS
:: ═════════════════════════════════════════════════════════════════════════════
:check_tools
set "_MISSING="
where pg_dump >nul 2>nul || set "_MISSING=!_MISSING! pg_dump"
where psql >nul 2>nul || set "_MISSING=!_MISSING! psql"
where tar >nul 2>nul || set "_MISSING=!_MISSING! tar"
if not "!_MISSING!"=="" (
    echo [ERROR] Missing required tools:!_MISSING!
    echo.
    echo Install PostgreSQL client tools:
    echo   https://www.postgresql.org/download/windows/
    echo   Or: winget install PostgreSQL.PostgreSQL
    exit /b 1
)
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: CHECK DB
:: ═════════════════════════════════════════════════════════════════════════════
:check_db
echo [INFO]  Testing database connection...
set "PGPASSWORD=%DB_PASS%"
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -c "SELECT 1;" >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Cannot connect to database at %DB_HOST%:%DB_PORT%/%DB_NAME%
    echo   Make sure PostgreSQL is running: docker compose up -d postgres
    exit /b 1
)
echo [ OK ]  Database connection OK (%DB_HOST%:%DB_PORT%/%DB_NAME%)
goto :eof

:: ═════════════════════════════════════════════════════════════════════════════
:: PRE-FLIGHT (load env, parse, check)
:: ═════════════════════════════════════════════════════════════════════════════
:pre_backup
call :load_env
call :parse_db_url || exit /b 1
call :check_tools || exit /b 1
call :check_db || exit /b 1

set "DB_ONLY=0"
if "%~2"=="--db-only" set "DB_ONLY=1"
goto :do_backup

:pre_restore
call :load_env
call :parse_db_url || exit /b 1
call :check_tools || exit /b 1
call :check_db || exit /b 1

set "ARCHIVE=%~2"
set "AUTO_YES=0"
if "%~3"=="--yes" set "AUTO_YES=1"
if "%~3"=="-y" set "AUTO_YES=1"
goto :do_restore

:: ═════════════════════════════════════════════════════════════════════════════
:: BACKUP
:: ═════════════════════════════════════════════════════════════════════════════
:do_backup
if not exist "%BKP_DIR%" mkdir "%BKP_DIR%"

set "WORK=%TEMP%\narrateai-bak-%RANDOM%"
mkdir "%WORK%" 2>nul

:: Database dump
echo [INFO]  Dumping database '%DB_NAME%'...
set "PGPASSWORD=%DB_PASS%"
pg_dump -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% --no-owner --no-privileges --clean --if-exists -F p -f "%WORK%\database.sql"
if errorlevel 1 (
    echo [ERROR] pg_dump failed
    goto :backup_cleanup
)
echo [ OK ]  Database dumped

:: .env
if exist "%PROJECT_DIR%\.env" (
    copy /y "%PROJECT_DIR%\.env" "%WORK%\dot-env" >nul
    echo [ OK ]  .env saved (WARNING: contains API keys and secrets^)
) else (
    echo [WARN]  No .env file found
)

:: Prisma schema
if exist "%SCHEMA_FILE%" (
    mkdir "%WORK%\prisma" 2>nul
    copy /y "%SCHEMA_FILE%" "%WORK%\prisma\schema.prisma" >nul
    echo [ OK ]  Prisma schema saved
)

:: Fonts
if exist "%FONTS_DIR%" (
    mkdir "%WORK%\assets-fonts" 2>nul
    xcopy /s /e /q /y "%FONTS_DIR%\*" "%WORK%\assets-fonts\" >nul 2>nul
    echo [ OK ]  Fonts saved
)

:: Music
if exist "%MUSIC_DIR%" (
    mkdir "%WORK%\public-music" 2>nul
    xcopy /s /e /q /y "%MUSIC_DIR%\*" "%WORK%\public-music\" >nul 2>nul
    echo [ OK ]  Music saved
)

:: Characters
if exist "%CHARACTERS_DIR%" (
    mkdir "%WORK%\public-characters" 2>nul
    xcopy /s /e /q /y "%CHARACTERS_DIR%\*" "%WORK%\public-characters\" >nul 2>nul
    echo [ OK ]  Characters saved
)

:: Metadata
(
    echo {"app":"NarrateAI","version":"1.1","timestamp":"%TIMESTAMP%","database":"%DB_NAME%","db_host":"%DB_HOST%"}
) > "%WORK%\backup-meta.json"

:: Videos
if "%DB_ONLY%"=="1" (
    set "ARCHIVE_NAME=narrateai-backup-db-%TIMESTAMP%.tar.gz"
    echo [INFO]  Skipping video assets (--db-only^)
) else (
    set "ARCHIVE_NAME=narrateai-backup-full-%TIMESTAMP%.tar.gz"
    if exist "%VIDEOS_DIR%" (
        echo [INFO]  Copying video assets...
        mkdir "%WORK%\videos" 2>nul
        xcopy /s /e /q /y "%VIDEOS_DIR%\*" "%WORK%\videos\" >nul 2>nul
        echo [ OK ]  Videos saved
    )
)

:: Create archive
echo [INFO]  Creating archive...
pushd "%WORK%"
tar -czf "%BKP_DIR%\!ARCHIVE_NAME!" .
popd
if errorlevel 1 (
    echo [ERROR] tar failed
    goto :backup_cleanup
)

echo.
echo ============================================================
echo   Backup complete!
echo ============================================================
echo.
echo   File: %BKP_DIR%\!ARCHIVE_NAME!
echo   To restore: %~nx0 restore !ARCHIVE_NAME!
echo.

:backup_cleanup
if exist "%WORK%" rmdir /s /q "%WORK%" 2>nul
exit /b 0

:: ═════════════════════════════════════════════════════════════════════════════
:: RESTORE
:: ═════════════════════════════════════════════════════════════════════════════
:do_restore
if "%ARCHIVE%"=="" (
    echo [ERROR] Usage: %~nx0 restore ^<backup-file.tar.gz^> [--yes]
    exit /b 1
)

:: Resolve archive path
if not exist "%ARCHIVE%" (
    if exist "%BKP_DIR%\%ARCHIVE%" (
        set "ARCHIVE=%BKP_DIR%\%ARCHIVE%"
    ) else (
        echo [ERROR] Backup file not found: %ARCHIVE%
        exit /b 1
    )
)

set "WORK=%TEMP%\narrateai-rst-%RANDOM%"
mkdir "%WORK%" 2>nul

echo [INFO]  Extracting backup...
tar -xzf "%ARCHIVE%" -C "%WORK%"
if errorlevel 1 (
    echo [ERROR] tar extraction failed
    goto :restore_cleanup
)

:: Show metadata
if exist "%WORK%\backup-meta.json" (
    echo.
    echo [INFO]  Backup metadata:
    type "%WORK%\backup-meta.json"
    echo.
)

:: Confirm
if "%AUTO_YES%"=="0" (
    echo.
    echo   This will OVERWRITE the current database and restore all assets.
    echo.
    set /p "_CONFIRM=Continue? (y/N) "
    if /i not "!_CONFIRM!"=="y" (
        echo [INFO]  Restore cancelled.
        goto :restore_cleanup
    )
)

:: Restore .env
if exist "%WORK%\dot-env" (
    if exist "%PROJECT_DIR%\.env" (
        if "%AUTO_YES%"=="0" (
            set /p "_ENVCONF=.env already exists. Overwrite? (y/N) "
            if /i "!_ENVCONF!"=="y" (
                copy /y "%WORK%\dot-env" "%PROJECT_DIR%\.env" >nul
                echo [ OK ]  .env restored
            ) else (
                echo [INFO]  Kept existing .env
            )
        ) else (
            echo [INFO]  Kept existing .env (use manual copy if needed^)
        )
    ) else (
        copy /y "%WORK%\dot-env" "%PROJECT_DIR%\.env" >nul
        echo [ OK ]  .env restored
    )
)

:: Restore database
if exist "%WORK%\database.sql" (
    echo [INFO]  Restoring database...
    set "PGPASSWORD=%DB_PASS%"

    psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d postgres -t -c "SELECT 1 FROM pg_database WHERE datname = '%DB_NAME%';" 2>nul | findstr "1" >nul 2>nul
    if errorlevel 1 (
        psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d postgres -c "CREATE DATABASE %DB_NAME%;" >nul 2>nul
    )

    psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%DB_NAME%' AND pid <> pg_backend_pid();" >nul 2>nul
    psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -f "%WORK%\database.sql" >nul 2>nul
    echo [ OK ]  Database restored
) else (
    echo [WARN]  No database dump found in backup
)

:: Restore fonts
if exist "%WORK%\assets-fonts" (
    if not exist "%FONTS_DIR%" mkdir "%FONTS_DIR%"
    xcopy /s /e /q /y "%WORK%\assets-fonts\*" "%FONTS_DIR%\" >nul 2>nul
    echo [ OK ]  Fonts restored
)

:: Restore music
if exist "%WORK%\public-music" (
    if not exist "%MUSIC_DIR%" mkdir "%MUSIC_DIR%"
    xcopy /s /e /q /y "%WORK%\public-music\*" "%MUSIC_DIR%\" >nul 2>nul
    echo [ OK ]  Music restored
)

:: Restore characters
if exist "%WORK%\public-characters" (
    if not exist "%CHARACTERS_DIR%" mkdir "%CHARACTERS_DIR%"
    xcopy /s /e /q /y "%WORK%\public-characters\*" "%CHARACTERS_DIR%\" >nul 2>nul
    echo [ OK ]  Characters restored
)

:: Restore videos
if exist "%WORK%\videos" (
    echo [INFO]  Restoring video assets...
    if not exist "%VIDEOS_DIR%" mkdir "%VIDEOS_DIR%"
    xcopy /s /e /q /y "%WORK%\videos\*" "%VIDEOS_DIR%\" >nul 2>nul
    echo [ OK ]  Video assets restored
)

:: Restore Prisma schema
if exist "%WORK%\prisma\schema.prisma" (
    if not exist "%PROJECT_DIR%\prisma" mkdir "%PROJECT_DIR%\prisma"
    copy /y "%WORK%\prisma\schema.prisma" "%SCHEMA_FILE%" >nul
    echo [ OK ]  Prisma schema restored
)

:: Sync schema
echo [INFO]  Syncing database schema...
pushd "%PROJECT_DIR%"
call npx prisma db push --accept-data-loss >nul 2>nul && (
    echo [ OK ]  Schema synced
) || (
    echo [WARN]  Schema sync skipped (may already be up to date^)
)
popd

echo.
echo ============================================================
echo   Restore complete!
echo ============================================================
echo.
echo   Next steps:
echo     1. Review .env and update API keys if needed
echo     2. Run: pnpm install
echo     3. Run: pnpm dev:all   (or use scripts\setup_prerequisites.bat^)
echo.

:restore_cleanup
if exist "%WORK%" rmdir /s /q "%WORK%" 2>nul
exit /b 0

:: ═════════════════════════════════════════════════════════════════════════════
:: LIST
:: ═════════════════════════════════════════════════════════════════════════════
:do_list
if not exist "%BKP_DIR%" (
    echo [INFO]  No backups found in %BKP_DIR%
    exit /b 0
)

echo.
echo Available backups in %BKP_DIR%:
echo.
set "_FOUND=0"
for %%f in ("%BKP_DIR%\narrateai-backup-*.tar.gz") do (
    set "_FOUND=1"
    echo   %%~nxf    %%~zf bytes    %%~tf
)
if "!_FOUND!"=="0" echo [INFO]  No backups found
echo.
exit /b 0
