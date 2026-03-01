#Requires -Version 5.1
<#
.SYNOPSIS
    NarrateAI — Setup Prerequisites & Deploy (Windows)

.DESCRIPTION
    Takes a Windows machine from zero to a fully running NarrateAI instance.
    Installs all prerequisites, starts infrastructure, optionally restores
    from a backup, builds the app, and exposes it via Cloudflare tunnel.

.EXAMPLE
    .\scripts\setup_prerequisites.ps1                                         # fresh deploy
    .\scripts\setup_prerequisites.ps1 -Restore backups\full-backup.tar.gz     # deploy + restore
    .\scripts\setup_prerequisites.ps1 -SkipPrereqs                            # skip installs
    .\scripts\setup_prerequisites.ps1 -SkipPrereqs -Restore backup.tar.gz
    .\scripts\setup_prerequisites.ps1 -Stop                                   # stop all services
    .\scripts\setup_prerequisites.ps1 -Status                                 # show running status
#>

param(
    [switch]$SkipPrereqs,
    [string]$Restore,
    [switch]$Stop,
    [switch]$Status,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$PM2Ecosystem = Join-Path $ProjectDir "ecosystem.config.cjs"
$Port = if ($env:PORT) { $env:PORT } else { "3000" }
$NodeMajor = 22

function Write-Info  { param([string]$Msg) Write-Host "[INFO]  $Msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$Msg) Write-Host "[ OK ]  $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host "[WARN]  $Msg" -ForegroundColor Yellow }
function Write-Err   { param([string]$Msg) Write-Host "[ERR ]  $Msg" -ForegroundColor Red }
function Write-Step  { param([string]$Msg) Write-Host ""; Write-Host "--- $Msg ---" -ForegroundColor White }

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-CommandExists {
    param([string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

# ═════════════════════════════════════════════════════════════════════════════
# HELP
# ═════════════════════════════════════════════════════════════════════════════
if ($Help) {
    Write-Host ""
    Write-Host "NarrateAI Deployment Script (Windows)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Usage:"
    Write-Host "  .\deploy.ps1                                      Fresh deployment"
    Write-Host "  .\deploy.ps1 -Restore <backup.tar.gz>             Deploy and restore from backup"
    Write-Host "  .\deploy.ps1 -SkipPrereqs                         Skip prerequisite installation"
    Write-Host "  .\deploy.ps1 -SkipPrereqs -Restore <file>         Restore without installing"
    Write-Host "  .\deploy.ps1 -Stop                                Stop all NarrateAI services"
    Write-Host "  .\deploy.ps1 -Status                              Show running status"
    Write-Host ""
    Write-Host "Prerequisites installed automatically (via winget/choco):"
    Write-Host "  Docker Desktop, Node.js $NodeMajor, pnpm, FFmpeg, PM2, cloudflared"
    Write-Host ""
    Write-Host "Environment:"
    Write-Host "  PORT     Web server port (default: 3000)"
    Write-Host ""
    exit 0
}

# ═════════════════════════════════════════════════════════════════════════════
# PREREQUISITE INSTALLERS
# ═════════════════════════════════════════════════════════════════════════════

function Get-PackageManager {
    if (Test-CommandExists "winget") { return "winget" }
    if (Test-CommandExists "choco")  { return "choco" }
    return "none"
}

function Install-Docker {
    if (Test-CommandExists "docker") {
        $ver = & docker --version 2>$null
        Write-Ok "Docker already installed ($ver)"
        return
    }

    Write-Info "Installing Docker Desktop..."
    $pkgMgr = Get-PackageManager
    switch ($pkgMgr) {
        "winget" { & winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements }
        "choco"  { & choco install docker-desktop -y }
        default  {
            Write-Err "Cannot auto-install Docker. Install manually: https://docs.docker.com/desktop/install/windows-install/"
            Write-Err "Or install winget/chocolatey first."
            exit 1
        }
    }
    Write-Warn "Docker Desktop installed. You may need to RESTART your computer and ensure Docker Desktop is running."
    Write-Ok "Docker installed"
}

function Install-Node {
    if (Test-CommandExists "node") {
        $ver = (& node -v) -replace 'v', '' -split '\.' | Select-Object -First 1
        if ([int]$ver -ge $NodeMajor) {
            Write-Ok "Node.js already installed (v$(& node -v))"
            return
        }
        Write-Warn "Node.js v$(& node -v) found, need v${NodeMajor}+. Upgrading..."
    }

    Write-Info "Installing Node.js ${NodeMajor}..."
    $pkgMgr = Get-PackageManager
    switch ($pkgMgr) {
        "winget" { & winget install -e --id OpenJS.NodeJS --version "${NodeMajor}.0.0" --accept-package-agreements --accept-source-agreements 2>$null; if ($LASTEXITCODE -ne 0) { & winget install -e --id OpenJS.NodeJS --accept-package-agreements --accept-source-agreements } }
        "choco"  { & choco install nodejs --version="${NodeMajor}.0.0" -y 2>$null; if ($LASTEXITCODE -ne 0) { & choco install nodejs -y } }
        default  {
            Write-Err "Cannot auto-install Node.js. Install v${NodeMajor}+ from https://nodejs.org"
            exit 1
        }
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Write-Ok "Node.js installed ($(& node -v))"
}

function Install-Pnpm {
    if (Test-CommandExists "pnpm") {
        Write-Ok "pnpm already installed ($(& pnpm -v))"
        return
    }

    Write-Info "Installing pnpm..."
    try {
        & corepack enable 2>$null
        & corepack prepare pnpm@latest --activate 2>$null
    } catch {}

    if (-not (Test-CommandExists "pnpm")) {
        & npm install -g pnpm 2>$null
    }
    Write-Ok "pnpm installed ($(& pnpm -v))"
}

function Install-FFmpeg {
    if ((Test-CommandExists "ffmpeg") -and (Test-CommandExists "ffprobe")) {
        $ver = (& ffmpeg -version 2>$null) -split "`n" | Select-Object -First 1
        Write-Ok "FFmpeg already installed ($ver)"
        return
    }

    Write-Info "Installing FFmpeg..."
    $pkgMgr = Get-PackageManager
    switch ($pkgMgr) {
        "winget" { & winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements }
        "choco"  { & choco install ffmpeg -y }
        default  {
            Write-Err "Install FFmpeg manually: https://ffmpeg.org/download.html#build-windows"
            exit 1
        }
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Write-Ok "FFmpeg installed"
}

function Install-PM2 {
    if (Test-CommandExists "pm2") {
        Write-Ok "PM2 already installed ($(& pm2 -v))"
        return
    }

    Write-Info "Installing PM2..."
    & npm install -g pm2 2>$null
    Write-Ok "PM2 installed"
}

function Install-Cloudflared {
    if (Test-CommandExists "cloudflared") {
        $ver = (& cloudflared --version 2>&1) -split "`n" | Select-Object -First 1
        Write-Ok "cloudflared already installed ($ver)"
        return
    }

    Write-Info "Installing cloudflared..."
    $pkgMgr = Get-PackageManager
    switch ($pkgMgr) {
        "winget" { & winget install -e --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements }
        "choco"  { & choco install cloudflared -y }
        default  {
            Write-Err "Install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
            exit 1
        }
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Write-Ok "cloudflared installed"
}

function Install-AllPrereqs {
    Write-Step "Installing prerequisites"

    $pkgMgr = Get-PackageManager
    Write-Info "Detected package manager: $pkgMgr"

    if ($pkgMgr -eq "none") {
        Write-Warn "Neither winget nor chocolatey found."
        Write-Warn "Install winget (App Installer from Microsoft Store) or chocolatey (https://chocolatey.org/install)"
        Write-Warn "Attempting to continue — some installs may fail."
    }

    Install-Docker
    Install-Node
    Install-Pnpm
    Install-FFmpeg
    Install-PM2
    Install-Cloudflared
}

# ═════════════════════════════════════════════════════════════════════════════
# INFRASTRUCTURE
# ═════════════════════════════════════════════════════════════════════════════

function Start-Infra {
    Write-Step "Starting infrastructure (PostgreSQL + Redis)"
    Push-Location $ProjectDir

    if (-not (Test-CommandExists "docker")) {
        Write-Err "Docker is not installed or not in PATH"
        Pop-Location
        exit 1
    }

    try {
        & docker compose up -d 2>$null
        if ($LASTEXITCODE -ne 0) { & docker-compose up -d }
    } catch {
        & docker-compose up -d
    }

    Write-Info "Waiting for PostgreSQL to be ready..."
    $retries = 30
    while ($retries -gt 0) {
        $ready = & docker compose exec -T postgres pg_isready -U narrateai 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "PostgreSQL is ready"
            break
        }
        $retries--
        Start-Sleep -Seconds 1
    }
    if ($retries -eq 0) {
        Write-Err "PostgreSQL did not become ready in 30s"
        Pop-Location
        exit 1
    }

    Write-Info "Waiting for Redis to be ready..."
    $retries = 15
    while ($retries -gt 0) {
        $pong = & docker compose exec -T redis redis-cli ping 2>$null
        if ($pong -match "PONG") {
            Write-Ok "Redis is ready"
            break
        }
        $retries--
        Start-Sleep -Seconds 1
    }
    if ($retries -eq 0) {
        Write-Err "Redis did not become ready in 15s"
        Pop-Location
        exit 1
    }

    Pop-Location
}

# ═════════════════════════════════════════════════════════════════════════════
# SETUP .env
# ═════════════════════════════════════════════════════════════════════════════

function Initialize-Env {
    $envFile = Join-Path $ProjectDir ".env"
    if (Test-Path $envFile) {
        Write-Ok ".env already exists"
        return
    }

    $exampleFile = Join-Path $ProjectDir ".env.example"
    if (Test-Path $exampleFile) {
        Copy-Item $exampleFile $envFile
        Write-Warn ".env created from .env.example -- edit it with your API keys before use"
    } else {
        Write-Err "No .env or .env.example found. Create .env with required variables."
        exit 1
    }
}

# ═════════════════════════════════════════════════════════════════════════════
# RESTORE FROM BACKUP
# ═════════════════════════════════════════════════════════════════════════════

function Invoke-RestoreBackup {
    param([string]$ArchiveFile)
    Write-Step "Restoring from backup"

    if (-not (Test-Path $ArchiveFile)) {
        $candidate = Join-Path $ProjectDir $ArchiveFile
        if (Test-Path $candidate) {
            $ArchiveFile = $candidate
        } else {
            $candidate2 = Join-Path $ProjectDir "backups\$ArchiveFile"
            if (Test-Path $candidate2) {
                $ArchiveFile = $candidate2
            } else {
                Write-Err "Backup file not found: $ArchiveFile"
                exit 1
            }
        }
    }

    Write-Info "Restoring from: $ArchiveFile"
    $backupScript = Join-Path $ScriptDir "backup-restore.ps1"
    & powershell -ExecutionPolicy Bypass -File $backupScript restore -Archive $ArchiveFile -Yes
}

# ═════════════════════════════════════════════════════════════════════════════
# BUILD
# ═════════════════════════════════════════════════════════════════════════════

function Build-App {
    Write-Step "Installing dependencies and building"
    Push-Location $ProjectDir

    Write-Info "Installing Node.js dependencies..."
    try {
        & pnpm install --frozen-lockfile 2>$null
    } catch {
        & pnpm install
    }
    Write-Ok "Dependencies installed"

    Write-Info "Generating Prisma client..."
    & pnpm db:generate
    Write-Ok "Prisma client generated"

    Write-Info "Pushing database schema..."
    try {
        & pnpm db:push 2>$null
        Write-Ok "Database schema synced"
    } catch {
        Write-Warn "Schema push had warnings (may already be up to date)"
    }

    Write-Info "Building Next.js application..."
    & pnpm build
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
    Write-Ok "Build complete"

    Pop-Location
}

# ═════════════════════════════════════════════════════════════════════════════
# PM2 CONFIG & START
# ═════════════════════════════════════════════════════════════════════════════

function New-PM2Config {
    $config = @"
module.exports = {
  apps: [
    {
      name: "narrateai-web",
      script: "node_modules/.bin/next",
      args: "start -p $Port",
      cwd: "$($ProjectDir -replace '\\', '/')",
      env: { NODE_ENV: "production", PORT: "$Port" },
      max_memory_restart: "512M",
    },
    {
      name: "narrateai-worker",
      script: "node_modules/.bin/tsx",
      args: "workers/video-generation.ts",
      cwd: "$($ProjectDir -replace '\\', '/')",
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
    },
    {
      name: "narrateai-scheduler",
      script: "node_modules/.bin/tsx",
      args: "workers/scheduler.ts",
      cwd: "$($ProjectDir -replace '\\', '/')",
      env: { NODE_ENV: "production" },
      max_memory_restart: "256M",
    },
  ],
};
"@
    Set-Content -Path $PM2Ecosystem -Value $config
    Write-Ok "PM2 ecosystem config generated"
}

function Start-App {
    Write-Step "Starting NarrateAI"
    Push-Location $ProjectDir
    New-PM2Config

    & pm2 delete narrateai-web narrateai-worker narrateai-scheduler 2>$null
    & pm2 start $PM2Ecosystem
    Write-Ok "Application started via PM2"

    Write-Info "Waiting for web server on port $Port..."
    $retries = 30
    while ($retries -gt 0) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$Port" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                Write-Ok "Web server is ready on port $Port"
                break
            }
        } catch {}
        $retries--
        Start-Sleep -Seconds 2
    }
    if ($retries -eq 0) {
        Write-Warn "Web server may still be starting -- check: pm2 logs narrateai-web"
    }

    & pm2 save 2>$null

    Pop-Location
}

# ═════════════════════════════════════════════════════════════════════════════
# CLOUDFLARE TUNNEL
# ═════════════════════════════════════════════════════════════════════════════

function Start-Tunnel {
    Write-Step "Starting Cloudflare tunnel"

    & pm2 delete narrateai-tunnel 2>$null

    $cfPath = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if (-not $cfPath) {
        Write-Warn "cloudflared not found in PATH — skipping tunnel"
        return
    }

    & pm2 start $cfPath --name "narrateai-tunnel" -- tunnel --url "http://localhost:$Port"

    Write-Info "Waiting for tunnel URL..."
    Start-Sleep -Seconds 5

    $tunnelUrl = ""
    $retries = 12
    while ($retries -gt 0) {
        $logs = & pm2 logs narrateai-tunnel --nostream --lines 30 2>$null
        $match = ($logs | Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches |
            ForEach-Object { $_.Matches } | Select-Object -Last 1)
        if ($match) {
            $tunnelUrl = $match.Value
            break
        }
        $retries--
        Start-Sleep -Seconds 3
    }

    & pm2 save 2>$null

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "  NarrateAI is running!" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Local:   http://localhost:$Port" -ForegroundColor White
    if ($tunnelUrl) {
        Write-Host "  Public:  $tunnelUrl" -ForegroundColor Cyan
    } else {
        Write-Warn "  Could not detect tunnel URL -- check: pm2 logs narrateai-tunnel"
    }
    Write-Host ""
    Write-Host "  Useful commands:"
    Write-Host "    pm2 status                    -- see all processes"
    Write-Host "    pm2 logs                      -- tail all logs"
    Write-Host "    pm2 logs narrateai-web        -- web server logs"
    Write-Host "    pm2 logs narrateai-worker     -- video worker logs"
    Write-Host "    pm2 logs narrateai-scheduler  -- scheduler logs"
    Write-Host "    pm2 logs narrateai-tunnel     -- tunnel logs"
    Write-Host "    pm2 restart all               -- restart everything"
    Write-Host "    .\scripts\setup_prerequisites.ps1 -Stop    -- stop all services"
    Write-Host ""
}

# ═════════════════════════════════════════════════════════════════════════════
# STOP / STATUS
# ═════════════════════════════════════════════════════════════════════════════

function Stop-AllServices {
    Write-Step "Stopping NarrateAI"
    & pm2 delete narrateai-web narrateai-worker narrateai-scheduler narrateai-tunnel 2>$null
    Write-Ok "All NarrateAI processes stopped"
    Write-Host ""
    Write-Host "  Infrastructure (Postgres/Redis) is still running in Docker."
    Write-Host "  To stop everything:  docker compose down"
    Write-Host ""
}

function Show-Status {
    Write-Host ""
    Write-Host "NarrateAI Process Status" -ForegroundColor White
    Write-Host ""
    try { & pm2 list } catch { Write-Warn "PM2 not running" }

    Write-Host ""
    Write-Host "Docker Services" -ForegroundColor White
    Write-Host ""
    Push-Location $ProjectDir
    try {
        & docker compose ps 2>$null
        if ($LASTEXITCODE -ne 0) { & docker-compose ps }
    } catch {
        Write-Warn "Docker Compose not available"
    }
    Pop-Location
    Write-Host ""
}

# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════

if ($Stop) {
    Stop-AllServices
    exit 0
}

if ($Status) {
    Show-Status
    exit 0
}

Write-Host ""
Write-Host "+================================================+" -ForegroundColor Cyan
Write-Host "|         NarrateAI -- Deployment Script          |" -ForegroundColor Cyan
Write-Host "+================================================+" -ForegroundColor Cyan
Write-Host ""

# 1. Prerequisites
if ($SkipPrereqs) {
    Write-Info "Skipping prerequisite installation (-SkipPrereqs)"
} else {
    Install-AllPrereqs
}

# 2. Start infrastructure
Start-Infra

# 3. Setup .env
Initialize-Env

# 4. Restore from backup if provided
if ($Restore) {
    Invoke-RestoreBackup -ArchiveFile $Restore
}

# 5. Build
Build-App

# 6. Start app
Start-App

# 7. Tunnel
Start-Tunnel
