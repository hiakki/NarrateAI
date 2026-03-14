@echo off
setlocal enabledelayedexpansion

:: NarrateAI — Backup and Restore (Windows)
::
:: Usage:
::   scripts\backup-restore.bat backup                     Full backup
::   scripts\backup-restore.bat backup --db-only           DB + config only
::   scripts\backup-restore.bat restore <file.tar.gz>      Restore from backup
::   scripts\backup-restore.bat restore <file.tar.gz> --yes  Skip prompts
::   scripts\backup-restore.bat list                       List backups

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

for /f "skip=1 tokens=1" %%t in ('wmic os get localdatetime 2^>nul') do if not defined _TS set "_TS=%%t"
if defined _TS (set "TIMESTAMP=!_TS:~0,8!_!_TS:~8,6!") else (set "TIMESTAMP=backup")

set "CMD=%~1"
if "%CMD%"=="" set "CMD=help"
if "%CMD%"=="--help" set "CMD=help"
if "%CMD%"=="-h" set "CMD=help"

if "%CMD%"=="help" goto :show_help
if "%CMD%"=="list" goto :do_list
if "%CMD%"=="backup" goto :pre_backup
if "%CMD%"=="restore" goto :pre_restore
echo [ERROR] Unknown command: %CMD%
exit /b 1

:: ─────────────────────────────────────────────────────────────────────────────
:show_help
echo.
echo NarrateAI Backup and Restore - Windows
echo.
echo Usage:
echo   %~nx0 backup                   Full backup
echo   %~nx0 backup --db-only         DB + config only
echo   %~nx0 restore file.tar.gz      Restore from backup
echo   %~nx0 restore file.tar.gz --yes  Skip prompts
echo   %~nx0 list                     List backups
echo.
echo Included in backup:
echo   - PostgreSQL database dump
echo   - .env, assets\fonts, public\music, public\characters
echo   - public\videos (unless --db-only), prisma\schema.prisma
echo.
echo Backups saved to: %BKP_DIR%
echo.
exit /b 0

:: ─────────────────────────────────────────────────────────────────────────────
:load_env
if not exist "%PROJECT_DIR%\.env" goto :eof
for /f "usebackq tokens=1,* delims==" %%a in ("%PROJECT_DIR%\.env") do (
    set "_K=%%a"
    if not "!_K:~0,1!"=="#" if not "!_K!"=="" (
        set "_V=%%b"
        for /f "tokens=1 delims=#" %%c in ("!_V!") do set "_V=%%c"
        set "_V=!_V:"=!"
        for /f "tokens=* delims= " %%d in ("!_V!") do set "_V=%%d"
        set "%%a=!_V!"
    )
)
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:parse_db_url
if not defined DATABASE_URL (
    echo [ERROR] DATABASE_URL is not set.
    exit /b 1
)
set "_URL=%DATABASE_URL%"
set "_URL=!_URL:*://=!"
for /f "tokens=1 delims=:" %%u in ("!_URL!") do set "DB_USER=%%u"
set "_URL=!_URL:%DB_USER%:=!"
for /f "tokens=1 delims=@" %%p in ("!_URL!") do set "DB_PASS=%%p"
set "_URL=!_URL:%DB_PASS%@=!"
for /f "tokens=1 delims=:" %%h in ("!_URL!") do set "DB_HOST=%%h"
set "_URL=!_URL:%DB_HOST%:=!"
for /f "tokens=1 delims=/" %%o in ("!_URL!") do set "DB_PORT=%%o"
set "_URL=!_URL:%DB_PORT%/=!"
for /f "tokens=1 delims=?" %%d in ("!_URL!") do set "DB_NAME=%%d"
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:check_tools
set "_MISSING="
where pg_dump >nul 2>nul || set "_MISSING=!_MISSING! pg_dump"
where psql >nul 2>nul || set "_MISSING=!_MISSING! psql"
where tar >nul 2>nul || set "_MISSING=!_MISSING! tar"
if not "!_MISSING!"=="" (
    echo [ERROR] Missing tools:!_MISSING!
    echo   Install PostgreSQL client: https://www.postgresql.org/download/windows/
    echo   To create empty tables without restoring, run: pnpm db:push
    exit /b 1
)
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:check_db
echo [INFO]  Testing database connection...
set "PGPASSWORD=%DB_PASS%"
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -c "SELECT 1;" >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Cannot connect to %DB_HOST%:%DB_PORT%/%DB_NAME%
    echo   Make sure PostgreSQL is running: docker compose up -d postgres
    exit /b 1
)
echo [ OK ]  Database connection OK
goto :eof

:: ─────────────────────────────────────────────────────────────────────────────
:pre_backup
call :load_env
call :parse_db_url
if errorlevel 1 exit /b 1
call :check_tools
if errorlevel 1 exit /b 1
call :check_db
if errorlevel 1 exit /b 1
set "DB_ONLY=0"
if "%~2"=="--db-only" set "DB_ONLY=1"
goto :do_backup

:pre_restore
call :load_env
call :parse_db_url
if errorlevel 1 exit /b 1
call :check_tools
if errorlevel 1 exit /b 1
call :check_db
if errorlevel 1 exit /b 1
set "ARCHIVE=%~2"
set "AUTO_YES=0"
if "%~3"=="--yes" set "AUTO_YES=1"
if "%~3"=="-y" set "AUTO_YES=1"
goto :do_restore

:: ─────────────────────────────────────────────────────────────────────────────
:do_backup
if not exist "%BKP_DIR%" mkdir "%BKP_DIR%"
set "WORK=%TEMP%\narrateai-bak-%RANDOM%"
mkdir "%WORK%" 2>nul

echo [INFO]  Dumping database '%DB_NAME%'...
set "PGPASSWORD=%DB_PASS%"
pg_dump -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% --no-owner --no-privileges --clean --if-exists -F p -f "%WORK%\database.sql"
if errorlevel 1 (
    echo [ERROR] pg_dump failed
    goto :bak_clean
)
echo [ OK ]  Database dumped

if exist "%PROJECT_DIR%\.env" (
    copy /y "%PROJECT_DIR%\.env" "%WORK%\dot-env" >nul
    echo [ OK ]  .env saved
)

if exist "%SCHEMA_FILE%" (
    mkdir "%WORK%\prisma" 2>nul
    copy /y "%SCHEMA_FILE%" "%WORK%\prisma\schema.prisma" >nul
    echo [ OK ]  Prisma schema saved
)

if exist "%FONTS_DIR%" (
    mkdir "%WORK%\assets-fonts" 2>nul
    xcopy /s /e /q /y "%FONTS_DIR%\*" "%WORK%\assets-fonts\" >nul 2>nul
    echo [ OK ]  Fonts saved
)

if exist "%MUSIC_DIR%" (
    mkdir "%WORK%\public-music" 2>nul
    xcopy /s /e /q /y "%MUSIC_DIR%\*" "%WORK%\public-music\" >nul 2>nul
    echo [ OK ]  Music saved
)

if exist "%CHARACTERS_DIR%" (
    mkdir "%WORK%\public-characters" 2>nul
    xcopy /s /e /q /y "%CHARACTERS_DIR%\*" "%WORK%\public-characters\" >nul 2>nul
    echo [ OK ]  Characters saved
)

> "%WORK%\backup-meta.json" echo {"app":"NarrateAI","version":"1.1","timestamp":"%TIMESTAMP%","database":"%DB_NAME%"}

if "%DB_ONLY%"=="1" (
    set "ARCHIVE_NAME=narrateai-backup-db-%TIMESTAMP%.tar.gz"
    echo [INFO]  Skipping videos
) else (
    set "ARCHIVE_NAME=narrateai-backup-full-%TIMESTAMP%.tar.gz"
    if exist "%VIDEOS_DIR%" (
        echo [INFO]  Copying videos...
        mkdir "%WORK%\videos" 2>nul
        xcopy /s /e /q /y "%VIDEOS_DIR%\*" "%WORK%\videos\" >nul 2>nul
        echo [ OK ]  Videos saved
    )
)

echo [INFO]  Creating archive...
pushd "%WORK%"
tar -czf "%BKP_DIR%\!ARCHIVE_NAME!" .
popd

echo.
echo ============================================================
echo   Backup complete!
echo ============================================================
echo   File: %BKP_DIR%\!ARCHIVE_NAME!
echo   Restore: %~nx0 restore !ARCHIVE_NAME!
echo.

:bak_clean
if exist "%WORK%" rmdir /s /q "%WORK%" 2>nul
exit /b 0

:: ─────────────────────────────────────────────────────────────────────────────
:do_restore
if "%ARCHIVE%"=="" (
    echo [ERROR] Usage: %~nx0 restore file.tar.gz [--yes]
    exit /b 1
)

if not exist "%ARCHIVE%" if exist "%BKP_DIR%\%ARCHIVE%" set "ARCHIVE=%BKP_DIR%\%ARCHIVE%"
if not exist "%ARCHIVE%" (
    echo [ERROR] Backup not found: %ARCHIVE%
    exit /b 1
)

set "WORK=%TEMP%\narrateai-rst-%RANDOM%"
mkdir "%WORK%" 2>nul

echo [INFO]  Extracting backup...
tar -xzf "%ARCHIVE%" -C "%WORK%"
if errorlevel 1 (
    echo [ERROR] tar extraction failed
    goto :rst_clean
)

if exist "%WORK%\backup-meta.json" (
    echo [INFO]  Backup metadata:
    type "%WORK%\backup-meta.json"
    echo.
)

if "%AUTO_YES%"=="0" (
    set /p "_CONFIRM=This will OVERWRITE the database. Continue? [y/N] "
    if /i not "!_CONFIRM!"=="y" (
        echo [INFO]  Cancelled.
        goto :rst_clean
    )
)

if exist "%WORK%\dot-env" (
    if not exist "%PROJECT_DIR%\.env" (
        copy /y "%WORK%\dot-env" "%PROJECT_DIR%\.env" >nul
        echo [ OK ]  .env restored
    ) else if "%AUTO_YES%"=="0" (
        set /p "_EC=.env exists. Overwrite? [y/N] "
        if /i "!_EC!"=="y" (
            copy /y "%WORK%\dot-env" "%PROJECT_DIR%\.env" >nul
            echo [ OK ]  .env restored
        ) else (
            echo [INFO]  Kept existing .env
        )
    ) else (
        echo [INFO]  Kept existing .env
    )
)

if exist "%WORK%\database.sql" (
    echo [INFO]  Restoring database...
    set "PGPASSWORD=%DB_PASS%"
    psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d postgres -t -c "SELECT 1 FROM pg_database WHERE datname = '%DB_NAME%';" 2>nul | findstr "1" >nul 2>nul
    if errorlevel 1 psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d postgres -c "CREATE DATABASE %DB_NAME%;" >nul 2>nul
    psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -f "%WORK%\database.sql" >nul 2>nul
    echo [ OK ]  Database restored
)

if exist "%WORK%\assets-fonts" (
    if not exist "%FONTS_DIR%" mkdir "%FONTS_DIR%"
    xcopy /s /e /q /y "%WORK%\assets-fonts\*" "%FONTS_DIR%\" >nul 2>nul
    echo [ OK ]  Fonts restored
)

if exist "%WORK%\public-music" (
    if not exist "%MUSIC_DIR%" mkdir "%MUSIC_DIR%"
    xcopy /s /e /q /y "%WORK%\public-music\*" "%MUSIC_DIR%\" >nul 2>nul
    echo [ OK ]  Music restored
)

if exist "%WORK%\public-characters" (
    if not exist "%CHARACTERS_DIR%" mkdir "%CHARACTERS_DIR%"
    xcopy /s /e /q /y "%WORK%\public-characters\*" "%CHARACTERS_DIR%\" >nul 2>nul
    echo [ OK ]  Characters restored
)

if exist "%WORK%\videos" (
    echo [INFO]  Restoring videos...
    if not exist "%VIDEOS_DIR%" mkdir "%VIDEOS_DIR%"
    xcopy /s /e /q /y "%WORK%\videos\*" "%VIDEOS_DIR%\" >nul 2>nul
    echo [ OK ]  Videos restored
)

if exist "%WORK%\prisma\schema.prisma" (
    if not exist "%PROJECT_DIR%\prisma" mkdir "%PROJECT_DIR%\prisma"
    copy /y "%WORK%\prisma\schema.prisma" "%SCHEMA_FILE%" >nul
    echo [ OK ]  Prisma schema restored
)

echo [INFO]  Syncing schema...
pushd "%PROJECT_DIR%"
call npx prisma db push --accept-data-loss
if errorlevel 1 (
    echo [WARN]  Schema sync failed. Run manually: pnpm db:push
) else (
    echo [ OK ]  Schema synced
)
popd

echo.
echo ============================================================
echo   Restore complete!
echo ============================================================
echo   1. Review .env and update API keys
echo   2. pnpm install
echo   3. pnpm dev:all  or  scripts\setup_prerequisites.bat
echo.

:rst_clean
if exist "%WORK%" rmdir /s /q "%WORK%" 2>nul
exit /b 0

:: ─────────────────────────────────────────────────────────────────────────────
:do_list
if not exist "%BKP_DIR%" (
    echo [INFO]  No backups in %BKP_DIR%
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
if "!_FOUND!"=="0" echo   None found.
echo.
exit /b 0
