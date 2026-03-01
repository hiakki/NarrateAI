#Requires -Version 5.1
<#
.SYNOPSIS
    NarrateAI — Backup & Restore (Windows)

.DESCRIPTION
    Backs up PostgreSQL database, generated videos, environment config,
    fonts, music, characters, and Prisma schema into a single .tar.gz.

.EXAMPLE
    .\scripts\backup-restore.ps1 backup
    .\scripts\backup-restore.ps1 backup -DbOnly
    .\scripts\backup-restore.ps1 restore -Archive backups\full-backup.tar.gz
    .\scripts\backup-restore.ps1 restore -Archive backups\full-backup.tar.gz -Yes
    .\scripts\backup-restore.ps1 list
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet("backup", "restore", "list", "help")]
    [string]$Command = "help",

    [Alias("File")]
    [string]$Archive,

    [switch]$DbOnly,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$BackupDir = if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { Join-Path $ProjectDir "backups" }
$VideosDir = Join-Path $ProjectDir "public\videos"
$CharactersDir = Join-Path $ProjectDir "public\characters"
$MusicDir = Join-Path $ProjectDir "public\music"
$FontsDir = Join-Path $ProjectDir "assets\fonts"
$SchemaFile = Join-Path $ProjectDir "prisma\schema.prisma"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

function Write-Info  { param([string]$Msg) Write-Host "[INFO]  $Msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$Msg) Write-Host "[ OK ]  $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host "[WARN]  $Msg" -ForegroundColor Yellow }
function Write-Err   { param([string]$Msg) Write-Host "[ERROR] $Msg" -ForegroundColor Red }

function Format-Size {
    param([long]$Bytes)
    if ($Bytes -ge 1GB) { return "{0:N1}G" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N1}M" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N1}K" -f ($Bytes / 1KB) }
    return "$Bytes B"
}

function Get-DirSize {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return 0 }
    (Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
}

# ── Load .env ─────────────────────────────────────────────────────────────────
function Import-EnvFile {
    $envFile = Join-Path $ProjectDir ".env"
    if (-not (Test-Path $envFile)) { return }
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line -split "=", 2
            if ($parts.Count -eq 2) {
                $key = $parts[0].Trim()
                $val = $parts[1].Trim() -replace '#.*$', '' -replace '^"', '' -replace '"$', ''
                [Environment]::SetEnvironmentVariable($key, $val, "Process")
            }
        }
    }
}

# ── Parse DATABASE_URL ────────────────────────────────────────────────────────
function Get-DbParams {
    $url = $env:DATABASE_URL
    if (-not $url) {
        Write-Err "DATABASE_URL is not set. Create a .env file or set it."
        exit 1
    }

    if ($url -match 'postgres(?:ql)?://([^:]+):([^@]+)@([^:]+):(\d+)/([^?]+)') {
        return @{
            User = $Matches[1]
            Pass = $Matches[2]
            Host = $Matches[3]
            Port = $Matches[4]
            Name = $Matches[5]
        }
    }
    Write-Err "Could not parse DATABASE_URL: $url"
    exit 1
}

# ── Check prerequisites ──────────────────────────────────────────────────────
function Test-Tools {
    $missing = @()
    foreach ($tool in @("pg_dump", "psql", "tar")) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            $missing += $tool
        }
    }
    if ($missing.Count -gt 0) {
        Write-Err "Missing required tools: $($missing -join ', ')"
        Write-Host ""
        Write-Host "Install PostgreSQL client tools:"
        Write-Host "  Windows: https://www.postgresql.org/download/windows/"
        Write-Host "           (select 'Command Line Tools' during install)"
        Write-Host "  Or use: winget install PostgreSQL.PostgreSQL"
        Write-Host ""
        Write-Host "Install tar (included in Windows 10 1803+, or use 7-Zip)"
        exit 1
    }
}

# ── Check DB connectivity ────────────────────────────────────────────────────
function Test-DbConnection {
    param([hashtable]$Db)
    Write-Info "Testing database connection..."
    $env:PGPASSWORD = $Db.Pass
    try {
        $null = & psql -h $Db.Host -p $Db.Port -U $Db.User -d $Db.Name -c "SELECT 1;" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Connection failed" }
        Write-Ok "Database connection OK ($($Db.Host):$($Db.Port)/$($Db.Name))"
    } catch {
        Write-Err "Cannot connect to database at $($Db.Host):$($Db.Port)/$($Db.Name)"
        Write-Host "  Make sure PostgreSQL is running: docker compose up -d postgres"
        exit 1
    }
}

# ── Copy directory if non-empty ──────────────────────────────────────────────
function Copy-DirIfExists {
    param([string]$Src, [string]$Dest, [string]$Label)
    if ((Test-Path $Src) -and (Get-ChildItem $Src -ErrorAction SilentlyContinue).Count -gt 0) {
        New-Item -ItemType Directory -Path $Dest -Force | Out-Null
        Copy-Item -Path "$Src\*" -Destination $Dest -Recurse -Force
        $sz = Format-Size (Get-DirSize $Dest)
        Write-Ok "$Label`: $sz"
    } else {
        Write-Warn "No $Label found at $Src"
    }
}

# ═════════════════════════════════════════════════════════════════════════════
# BACKUP
# ═════════════════════════════════════════════════════════════════════════════
function Invoke-Backup {
    param([hashtable]$Db, [switch]$DbOnly)

    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    $workDir = Join-Path ([System.IO.Path]::GetTempPath()) "narrateai-bak-$(Get-Random)"
    New-Item -ItemType Directory -Path $workDir -Force | Out-Null

    try {
        # ── Database dump ──────────────────────────────────────────────
        Write-Info "Dumping database '$($Db.Name)'..."
        $dumpFile = Join-Path $workDir "database.sql"
        $env:PGPASSWORD = $Db.Pass
        & pg_dump -h $Db.Host -p $Db.Port -U $Db.User -d $Db.Name `
            --no-owner --no-privileges --clean --if-exists -F p -f $dumpFile
        if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
        $dumpSize = Format-Size (Get-Item $dumpFile).Length
        Write-Ok "Database dump: $dumpSize"

        # ── .env ──────────────────────────────────────────────────────
        $envPath = Join-Path $ProjectDir ".env"
        if (Test-Path $envPath) {
            Copy-Item $envPath (Join-Path $workDir "dot-env")
            Write-Ok ".env saved (WARNING: contains API keys and secrets)"
        } else {
            Write-Warn "No .env file found"
        }

        # ── Prisma schema ─────────────────────────────────────────────
        if (Test-Path $SchemaFile) {
            $prismaDir = Join-Path $workDir "prisma"
            New-Item -ItemType Directory -Path $prismaDir -Force | Out-Null
            Copy-Item $SchemaFile (Join-Path $prismaDir "schema.prisma")
            Write-Ok "Prisma schema saved"
        }

        # ── Assets ────────────────────────────────────────────────────
        Copy-DirIfExists $FontsDir (Join-Path $workDir "assets-fonts") "Fonts"
        Copy-DirIfExists $MusicDir (Join-Path $workDir "public-music") "Music"
        Copy-DirIfExists $CharactersDir (Join-Path $workDir "public-characters") "Characters"

        # ── Metadata ──────────────────────────────────────────────────
        $hasEnv = (Test-Path $envPath).ToString().ToLower()
        $hasFonts = (Test-Path $FontsDir).ToString().ToLower()
        $hasMusic = (Test-Path $MusicDir).ToString().ToLower()
        $hasChars = (Test-Path $CharactersDir).ToString().ToLower()
        $includesVideos = (-not $DbOnly).ToString().ToLower()
        $pgVer = (& pg_dump --version 2>$null) -replace '\n.*', ''

        @{
            app                = "NarrateAI"
            version            = "1.1"
            timestamp          = $Timestamp
            database           = $Db.Name
            db_host            = $Db.Host
            includes_videos    = -not $DbOnly
            includes_env       = Test-Path $envPath
            includes_fonts     = Test-Path $FontsDir
            includes_music     = Test-Path $MusicDir
            includes_characters = Test-Path $CharactersDir
            created_on         = $env:COMPUTERNAME
            pg_version         = $pgVer
        } | ConvertTo-Json | Set-Content (Join-Path $workDir "backup-meta.json")

        # ── Video assets ──────────────────────────────────────────────
        if ($DbOnly) {
            $archiveName = "narrateai-backup-db-$Timestamp.tar.gz"
            Write-Info "Skipping video assets (--DbOnly)"
        } else {
            $archiveName = "narrateai-backup-full-$Timestamp.tar.gz"
            Copy-DirIfExists $VideosDir (Join-Path $workDir "videos") "Videos"
        }

        # ── Create archive ────────────────────────────────────────────
        Write-Info "Creating archive..."
        $archivePath = Join-Path $BackupDir $archiveName
        Push-Location $workDir
        & tar -czf $archivePath .
        Pop-Location
        if ($LASTEXITCODE -ne 0) { throw "tar failed" }

        $totalSize = Format-Size (Get-Item $archivePath).Length

        Write-Host ""
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
        Write-Host "  Backup complete!" -ForegroundColor Green
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
        Write-Host ""
        Write-Host "  File: $archivePath"
        Write-Host "  Size: $totalSize"
        $contains = "DB"
        if (-not $DbOnly) { $contains += " + videos" }
        Write-Host "  Contains: $contains + .env + fonts + music + characters + schema"
        Write-Host ""
        Write-Host "  To restore on another machine:"
        Write-Host "    1. Copy this file to the target machine"
        Write-Host "    2. Run: .\scripts\backup-restore.ps1 restore -Archive $archiveName"
        Write-Host ""
    } finally {
        Remove-Item -Path $workDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ═════════════════════════════════════════════════════════════════════════════
# RESTORE
# ═════════════════════════════════════════════════════════════════════════════
function Invoke-Restore {
    param([hashtable]$Db, [string]$ArchivePath, [switch]$AutoYes)

    if (-not $ArchivePath) {
        Write-Err "Usage: .\backup-restore.ps1 restore -Archive <backup-file.tar.gz> [-Yes]"
        exit 1
    }

    if (-not (Test-Path $ArchivePath)) {
        $candidate = Join-Path $BackupDir $ArchivePath
        if (Test-Path $candidate) {
            $ArchivePath = $candidate
        } else {
            Write-Err "Backup file not found: $ArchivePath"
            exit 1
        }
    }

    $workDir = Join-Path ([System.IO.Path]::GetTempPath()) "narrateai-rst-$(Get-Random)"
    New-Item -ItemType Directory -Path $workDir -Force | Out-Null

    try {
        Write-Info "Extracting backup..."
        & tar -xzf $ArchivePath -C $workDir
        if ($LASTEXITCODE -ne 0) { throw "tar extraction failed" }

        # ── Show metadata ─────────────────────────────────────────────
        $metaFile = Join-Path $workDir "backup-meta.json"
        if (Test-Path $metaFile) {
            Write-Host ""
            Write-Info "Backup metadata:"
            Get-Content $metaFile | ForEach-Object { Write-Host "    $_" }
            Write-Host ""
        }

        # ── Confirm ───────────────────────────────────────────────────
        if (-not $AutoYes) {
            Write-Host "  This will OVERWRITE the current database and restore all assets." -ForegroundColor Yellow
            Write-Host ""
            $confirm = Read-Host "Continue? (y/N)"
            if ($confirm -ne "y" -and $confirm -ne "Y") {
                Write-Info "Restore cancelled."
                return
            }
        }

        # ── Restore .env ──────────────────────────────────────────────
        $dotEnvBackup = Join-Path $workDir "dot-env"
        $dotEnvTarget = Join-Path $ProjectDir ".env"
        if (Test-Path $dotEnvBackup) {
            if (Test-Path $dotEnvTarget) {
                if (-not $AutoYes) {
                    $envConfirm = Read-Host ".env already exists. Overwrite? (y/N)"
                    if ($envConfirm -eq "y" -or $envConfirm -eq "Y") {
                        Copy-Item $dotEnvBackup $dotEnvTarget -Force
                        Write-Ok ".env restored"
                    } else {
                        Write-Info "Kept existing .env"
                    }
                } else {
                    Write-Info "Kept existing .env (use manual copy if needed)"
                }
            } else {
                Copy-Item $dotEnvBackup $dotEnvTarget
                Write-Ok ".env restored"
            }
        }

        # ── Restore database ─────────────────────────────────────────
        $dumpFile = Join-Path $workDir "database.sql"
        if (Test-Path $dumpFile) {
            Write-Info "Restoring database..."
            $env:PGPASSWORD = $Db.Pass

            $dbExists = & psql -h $Db.Host -p $Db.Port -U $Db.User -d "postgres" `
                -t -c "SELECT 1 FROM pg_database WHERE datname = '$($Db.Name)';" 2>$null
            if (-not ($dbExists -match "1")) {
                & psql -h $Db.Host -p $Db.Port -U $Db.User -d "postgres" `
                    -c "CREATE DATABASE $($Db.Name);" 2>$null
            }

            & psql -h $Db.Host -p $Db.Port -U $Db.User -d "postgres" `
                -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$($Db.Name)' AND pid <> pg_backend_pid();" 2>$null

            & psql -h $Db.Host -p $Db.Port -U $Db.User -d $Db.Name `
                -f $dumpFile 2>$null
            Write-Ok "Database restored"
        } else {
            Write-Warn "No database dump found in backup"
        }

        # ── Restore assets ────────────────────────────────────────────
        $fontsBackup = Join-Path $workDir "assets-fonts"
        if ((Test-Path $fontsBackup) -and (Get-ChildItem $fontsBackup -ErrorAction SilentlyContinue).Count -gt 0) {
            New-Item -ItemType Directory -Path $FontsDir -Force | Out-Null
            Copy-Item "$fontsBackup\*" $FontsDir -Recurse -Force
            Write-Ok "Fonts restored"
        }

        $musicBackup = Join-Path $workDir "public-music"
        if ((Test-Path $musicBackup) -and (Get-ChildItem $musicBackup -ErrorAction SilentlyContinue).Count -gt 0) {
            New-Item -ItemType Directory -Path $MusicDir -Force | Out-Null
            Copy-Item "$musicBackup\*" $MusicDir -Recurse -Force
            Write-Ok "Music restored"
        }

        $charsBackup = Join-Path $workDir "public-characters"
        if ((Test-Path $charsBackup) -and (Get-ChildItem $charsBackup -ErrorAction SilentlyContinue).Count -gt 0) {
            New-Item -ItemType Directory -Path $CharactersDir -Force | Out-Null
            Copy-Item "$charsBackup\*" $CharactersDir -Recurse -Force
            Write-Ok "Characters restored"
        }

        # ── Restore videos ────────────────────────────────────────────
        $videosBackup = Join-Path $workDir "videos"
        if ((Test-Path $videosBackup) -and (Get-ChildItem $videosBackup -ErrorAction SilentlyContinue).Count -gt 0) {
            Write-Info "Restoring video assets..."
            New-Item -ItemType Directory -Path $VideosDir -Force | Out-Null
            Copy-Item "$videosBackup\*" $VideosDir -Recurse -Force
            $vidCount = (Get-ChildItem $VideosDir -Recurse -Filter "*.mp4").Count
            Write-Ok "Video assets restored ($vidCount MP4 files)"
        } else {
            Write-Info "No video assets in this backup"
        }

        # ── Restore Prisma schema + push ──────────────────────────────
        $schemaBackup = Join-Path $workDir "prisma\schema.prisma"
        if (Test-Path $schemaBackup) {
            $prismaDir = Join-Path $ProjectDir "prisma"
            New-Item -ItemType Directory -Path $prismaDir -Force | Out-Null
            Copy-Item $schemaBackup $SchemaFile -Force
            Write-Ok "Prisma schema restored"
        }

        Write-Info "Syncing database schema..."
        Push-Location $ProjectDir
        try {
            & npx prisma db push --accept-data-loss 2>$null
            Write-Ok "Schema synced"
        } catch {
            Write-Warn "Schema sync skipped (may already be up to date)"
        }
        Pop-Location

        Write-Host ""
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
        Write-Host "  Restore complete!" -ForegroundColor Green
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Next steps:"
        Write-Host "    1. Review .env and update API keys if needed"
        Write-Host "    2. Run: pnpm install"
        Write-Host "    3. Run: pnpm dev:all   (or use scripts\setup_prerequisites.ps1)"
        Write-Host ""
    } finally {
        Remove-Item -Path $workDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ═════════════════════════════════════════════════════════════════════════════
# LIST
# ═════════════════════════════════════════════════════════════════════════════
function Invoke-List {
    if (-not (Test-Path $BackupDir)) {
        Write-Info "No backups found in $BackupDir"
        return
    }

    $files = Get-ChildItem $BackupDir -Filter "narrateai-backup-*.tar.gz" -ErrorAction SilentlyContinue
    if ($files.Count -eq 0) {
        Write-Info "No backups found in $BackupDir"
        return
    }

    Write-Host ""
    Write-Host "Available backups:" -ForegroundColor Cyan
    Write-Host ""
    "{0,-50} {1,10}  {2}" -f "FILE", "SIZE", "DATE" | Write-Host
    "{0,-50} {1,10}  {2}" -f "----", "----", "----" | Write-Host

    foreach ($f in $files | Sort-Object LastWriteTime) {
        $sz = Format-Size $f.Length
        $dt = $f.LastWriteTime.ToString("yyyy-MM-dd HH:mm")
        "{0,-50} {1,10}  {2}" -f $f.Name, $sz, $dt | Write-Host
    }
    Write-Host ""
}

# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════
switch ($Command) {
    "help" {
        Write-Host ""
        Write-Host "NarrateAI Backup & Restore (Windows)" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Usage:"
        Write-Host "  .\backup-restore.ps1 backup                  Full backup (DB + videos + config + assets)"
        Write-Host "  .\backup-restore.ps1 backup -DbOnly          Database + config only (no videos)"
        Write-Host "  .\backup-restore.ps1 restore -Archive <file>  Restore from a backup archive"
        Write-Host "  .\backup-restore.ps1 restore -Archive <file> -Yes  Skip confirmation prompts"
        Write-Host "  .\backup-restore.ps1 list                    List available backups"
        Write-Host ""
        Write-Host "Included in backup:"
        Write-Host "  - PostgreSQL database dump"
        Write-Host "  - .env (environment config with API keys)"
        Write-Host "  - assets\fonts\ (caption fonts for FFmpeg)"
        Write-Host "  - public\music\ (background music tracks)"
        Write-Host "  - public\characters\ (character preview images)"
        Write-Host "  - public\videos\ (generated videos, unless -DbOnly)"
        Write-Host "  - prisma\schema.prisma"
        Write-Host ""
        Write-Host "Backups are saved to: $BackupDir"
        Write-Host ""
    }
    "list" {
        Invoke-List
    }
    "backup" {
        Import-EnvFile
        $Db = Get-DbParams
        Test-Tools
        Test-DbConnection $Db
        Invoke-Backup -Db $Db -DbOnly:$DbOnly
    }
    "restore" {
        Import-EnvFile
        $Db = Get-DbParams
        Test-Tools
        Test-DbConnection $Db
        Invoke-Restore -Db $Db -ArchivePath $Archive -AutoYes:$Yes
    }
}
