#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# NarrateAI — Setup Prerequisites & Deploy
#
# Takes a server from zero to a fully running NarrateAI instance.
# Installs all prerequisites, starts infrastructure, optionally restores
# from a backup, builds the app, and exposes it via Cloudflare tunnel.
#
# Usage:
#   ./scripts/setup_prerequisites.sh                                        # fresh deploy
#   ./scripts/setup_prerequisites.sh --restore backups/full-backup.tar.gz   # deploy + restore
#   ./scripts/setup_prerequisites.sh --skip-prereqs                         # skip installs
#   ./scripts/setup_prerequisites.sh --skip-prereqs --restore backup.tar.gz
#   ./scripts/setup_prerequisites.sh --stop                                 # stop all services
#   ./scripts/setup_prerequisites.sh --status                               # show running status
#
# Supports: Ubuntu/Debian (apt), macOS (brew)
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$PROJECT_DIR/deploy.log"
PM2_ECOSYSTEM="$PROJECT_DIR/ecosystem.config.cjs"
PORT="${PORT:-3000}"
NODE_MAJOR=22

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERR ]${NC} $*" >&2; }
step()  { echo ""; echo -e "${BOLD}━━━ $* ━━━${NC}"; }

# ── OS detection ─────────────────────────────────────────────────────────────
detect_os() {
  OS="unknown"
  PKG="unknown"
  if [[ "$(uname)" == "Darwin" ]]; then
    OS="macos"
    PKG="brew"
  elif [[ -f /etc/os-release ]]; then
    . /etc/os-release
    case "$ID" in
      ubuntu|debian|pop|linuxmint) OS="debian"; PKG="apt" ;;
      fedora|rhel|centos|rocky|alma) OS="rhel"; PKG="dnf" ;;
      *) OS="linux-other"; PKG="unknown" ;;
    esac
  fi
  info "Detected OS: $OS (package manager: $PKG)"
}

# ── Prerequisite: Docker ─────────────────────────────────────────────────────
install_docker() {
  if command -v docker &>/dev/null; then
    ok "Docker already installed ($(docker --version | head -1))"
    return
  fi

  info "Installing Docker..."
  case "$PKG" in
    apt)
      sudo apt-get update -qq
      sudo apt-get install -y -qq ca-certificates curl gnupg
      sudo install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
      sudo chmod a+r /etc/apt/keyrings/docker.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
      sudo apt-get update -qq
      sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
      sudo usermod -aG docker "$USER" 2>/dev/null || true
      ;;
    brew)
      brew install --cask docker 2>/dev/null || warn "Docker Desktop may need manual install from docker.com"
      ;;
    dnf)
      sudo dnf install -y dnf-plugins-core
      sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
      sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
      sudo systemctl start docker
      sudo systemctl enable docker
      sudo usermod -aG docker "$USER" 2>/dev/null || true
      ;;
    *)
      err "Cannot auto-install Docker on this OS. Install it manually: https://docs.docker.com/get-docker/"
      exit 1
      ;;
  esac
  ok "Docker installed"
}

# ── Prerequisite: Node.js ────────────────────────────────────────────────────
install_node() {
  if command -v node &>/dev/null; then
    local ver
    ver="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [[ "$ver" -ge "$NODE_MAJOR" ]]; then
      ok "Node.js already installed ($(node -v))"
      return
    fi
    warn "Node.js $(node -v) found, need v${NODE_MAJOR}+. Upgrading..."
  fi

  info "Installing Node.js ${NODE_MAJOR}..."
  case "$PKG" in
    apt)
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash - 2>/dev/null
      sudo apt-get install -y -qq nodejs
      ;;
    brew)
      brew install "node@${NODE_MAJOR}" 2>/dev/null || brew upgrade "node@${NODE_MAJOR}" 2>/dev/null || true
      brew link --force --overwrite "node@${NODE_MAJOR}" 2>/dev/null || true
      ;;
    dnf)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | sudo bash - 2>/dev/null
      sudo dnf install -y nodejs
      ;;
    *)
      err "Cannot auto-install Node.js. Install v${NODE_MAJOR}+ manually: https://nodejs.org"
      exit 1
      ;;
  esac
  ok "Node.js installed ($(node -v))"
}

# ── Prerequisite: pnpm ───────────────────────────────────────────────────────
install_pnpm() {
  if command -v pnpm &>/dev/null; then
    ok "pnpm already installed ($(pnpm -v))"
    return
  fi

  info "Installing pnpm..."
  if command -v corepack &>/dev/null; then
    sudo corepack enable 2>/dev/null || corepack enable 2>/dev/null || true
    corepack prepare pnpm@latest --activate 2>/dev/null || true
  fi

  if ! command -v pnpm &>/dev/null; then
    npm install -g pnpm 2>/dev/null
  fi
  ok "pnpm installed ($(pnpm -v))"
}

# ── Prerequisite: FFmpeg ─────────────────────────────────────────────────────
install_ffmpeg() {
  if command -v ffmpeg &>/dev/null && command -v ffprobe &>/dev/null; then
    ok "FFmpeg already installed ($(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f1-3))"
    return
  fi

  info "Installing FFmpeg..."
  case "$PKG" in
    apt)  sudo apt-get install -y -qq ffmpeg ;;
    brew) brew install ffmpeg ;;
    dnf)  sudo dnf install -y ffmpeg ;;
    *)    err "Install FFmpeg manually: https://ffmpeg.org/download.html"; exit 1 ;;
  esac
  ok "FFmpeg installed"
}

# ── Prerequisite: PM2 ───────────────────────────────────────────────────────
install_pm2() {
  if command -v pm2 &>/dev/null; then
    ok "PM2 already installed ($(pm2 -v))"
    return
  fi

  info "Installing PM2..."
  npm install -g pm2 2>/dev/null
  ok "PM2 installed"
}

# ── Prerequisite: cloudflared ────────────────────────────────────────────────
install_cloudflared() {
  if command -v cloudflared &>/dev/null; then
    ok "cloudflared already installed ($(cloudflared --version 2>&1 | head -1))"
    return
  fi

  info "Installing cloudflared..."
  case "$PKG" in
    apt)
      curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
      echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
      sudo apt-get update -qq && sudo apt-get install -y -qq cloudflared
      ;;
    brew)
      brew install cloudflare/cloudflare/cloudflared
      ;;
    dnf)
      sudo rpm -i "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm" 2>/dev/null || true
      ;;
    *)
      err "Install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
      exit 1
      ;;
  esac
  ok "cloudflared installed"
}

# ── Install all prerequisites ────────────────────────────────────────────────
install_all_prereqs() {
  step "Installing prerequisites"
  detect_os
  install_docker
  install_node
  install_pnpm
  install_ffmpeg
  install_pm2
  install_cloudflared
}

# ── Start infrastructure (Postgres + Redis) ──────────────────────────────────
start_infra() {
  step "Starting infrastructure (PostgreSQL + Redis)"
  cd "$PROJECT_DIR"

  if ! command -v docker &>/dev/null; then
    err "Docker is not installed or not in PATH"
    exit 1
  fi

  docker compose up -d 2>/dev/null || docker-compose up -d 2>/dev/null

  info "Waiting for PostgreSQL to be ready..."
  local retries=30
  while [[ $retries -gt 0 ]]; do
    if docker compose exec -T postgres pg_isready -U narrateai &>/dev/null 2>&1; then
      ok "PostgreSQL is ready"
      break
    fi
    retries=$((retries - 1))
    sleep 1
  done
  if [[ $retries -eq 0 ]]; then
    err "PostgreSQL did not become ready in 30s"
    exit 1
  fi

  info "Waiting for Redis to be ready..."
  retries=15
  while [[ $retries -gt 0 ]]; do
    if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
      ok "Redis is ready"
      break
    fi
    retries=$((retries - 1))
    sleep 1
  done
  if [[ $retries -eq 0 ]]; then
    err "Redis did not become ready in 15s"
    exit 1
  fi
}

# ── Setup .env ───────────────────────────────────────────────────────────────
setup_env() {
  if [[ -f "$PROJECT_DIR/.env" ]]; then
    ok ".env already exists"
    return
  fi

  if [[ -f "$PROJECT_DIR/.env.example" ]]; then
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    warn ".env created from .env.example — edit it with your API keys before use"
  else
    err "No .env or .env.example found. Create .env with required variables."
    exit 1
  fi
}

# ── Restore from backup ─────────────────────────────────────────────────────
restore_backup() {
  local archive="$1"
  step "Restoring from backup"

  if [[ ! -f "$archive" ]]; then
    if [[ -f "$PROJECT_DIR/$archive" ]]; then
      archive="$PROJECT_DIR/$archive"
    elif [[ -f "$PROJECT_DIR/backups/$archive" ]]; then
      archive="$PROJECT_DIR/backups/$archive"
    else
      err "Backup file not found: $archive"
      exit 1
    fi
  fi

  info "Restoring from: $archive"
  bash "$SCRIPT_DIR/backup-restore.sh" restore "$archive" --yes
}

# ── Install dependencies + build ─────────────────────────────────────────────
build_app() {
  step "Installing dependencies and building"
  cd "$PROJECT_DIR"

  info "Installing Node.js dependencies..."
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  ok "Dependencies installed"

  info "Generating Prisma client..."
  pnpm db:generate
  ok "Prisma client generated"

  info "Pushing database schema..."
  pnpm db:push 2>/dev/null || warn "Schema push had warnings (may already be up to date)"
  ok "Database schema synced"

  info "Building Next.js application..."
  pnpm build
  ok "Build complete"
}

# ── Generate PM2 ecosystem config ────────────────────────────────────────────
generate_pm2_config() {
  cat > "$PM2_ECOSYSTEM" <<PMEOF
module.exports = {
  apps: [
    {
      name: "narrateai-web",
      script: "node_modules/.bin/next",
      args: "start -p ${PORT}",
      cwd: "${PROJECT_DIR}",
      env: { NODE_ENV: "production", PORT: "${PORT}" },
      max_memory_restart: "512M",
    },
    {
      name: "narrateai-worker",
      script: "node_modules/.bin/tsx",
      args: "workers/video-generation.ts",
      cwd: "${PROJECT_DIR}",
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
    },
    {
      name: "narrateai-scheduler",
      script: "node_modules/.bin/tsx",
      args: "workers/scheduler.ts",
      cwd: "${PROJECT_DIR}",
      env: { NODE_ENV: "production" },
      max_memory_restart: "256M",
    },
  ],
};
PMEOF
  ok "PM2 ecosystem config generated"
}

# ── Start application ────────────────────────────────────────────────────────
start_app() {
  step "Starting NarrateAI"
  cd "$PROJECT_DIR"
  generate_pm2_config

  pm2 delete narrateai-web narrateai-worker narrateai-scheduler 2>/dev/null || true
  pm2 start "$PM2_ECOSYSTEM"
  ok "Application started via PM2"

  info "Waiting for web server on port ${PORT}..."
  local retries=30
  while [[ $retries -gt 0 ]]; do
    if curl -sf "http://localhost:${PORT}" >/dev/null 2>&1; then
      ok "Web server is ready on port ${PORT}"
      break
    fi
    retries=$((retries - 1))
    sleep 2
  done
  if [[ $retries -eq 0 ]]; then
    warn "Web server may still be starting — check: pm2 logs narrateai-web"
  fi

  pm2 save 2>/dev/null || true
}

# ── Start Cloudflare tunnel ──────────────────────────────────────────────────
start_tunnel() {
  step "Starting Cloudflare tunnel"

  pm2 delete narrateai-tunnel 2>/dev/null || true

  local cf_path
  cf_path="$(command -v cloudflared)"

  pm2 start "$cf_path" \
    --name "narrateai-tunnel" \
    -- tunnel --url "http://localhost:${PORT}" \
    2>/dev/null

  info "Waiting for tunnel URL..."
  sleep 5

  local tunnel_url=""
  local retries=12
  while [[ $retries -gt 0 ]]; do
    tunnel_url="$(pm2 logs narrateai-tunnel --nostream --lines 30 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
    if [[ -n "$tunnel_url" ]]; then
      break
    fi
    retries=$((retries - 1))
    sleep 3
  done

  pm2 save 2>/dev/null || true

  echo ""
  echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  NarrateAI is running!${NC}"
  echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${BOLD}Local:${NC}   http://localhost:${PORT}"
  if [[ -n "$tunnel_url" ]]; then
    echo -e "  ${BOLD}Public:${NC}  ${CYAN}${tunnel_url}${NC}"
  else
    warn "  Could not detect tunnel URL — check: pm2 logs narrateai-tunnel"
  fi
  echo ""
  echo "  Useful commands:"
  echo "    pm2 status                    — see all processes"
  echo "    pm2 logs                      — tail all logs"
  echo "    pm2 logs narrateai-web        — web server logs"
  echo "    pm2 logs narrateai-worker     — video worker logs"
  echo "    pm2 logs narrateai-scheduler  — scheduler logs"
  echo "    pm2 logs narrateai-tunnel     — tunnel logs"
  echo "    pm2 restart all               — restart everything"
    echo "    ./scripts/setup_prerequisites.sh --stop    — stop all services"
  echo ""
}

# ── Stop all services ────────────────────────────────────────────────────────
do_stop() {
  step "Stopping NarrateAI"
  pm2 delete narrateai-web narrateai-worker narrateai-scheduler narrateai-tunnel 2>/dev/null || true
  ok "All NarrateAI processes stopped"
  echo ""
  echo "  Infrastructure (Postgres/Redis) is still running in Docker."
  echo "  To stop everything:  docker compose down"
  echo ""
}

# ── Show status ──────────────────────────────────────────────────────────────
do_status() {
  echo ""
  echo -e "${BOLD}NarrateAI Process Status${NC}"
  echo ""
  pm2 list 2>/dev/null || warn "PM2 not running"

  echo ""
  echo -e "${BOLD}Docker Services${NC}"
  echo ""
  cd "$PROJECT_DIR"
  docker compose ps 2>/dev/null || docker-compose ps 2>/dev/null || warn "Docker Compose not available"
  echo ""
}

# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════
main() {
  local skip_prereqs=false
  local restore_file=""
  local action="deploy"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skip-prereqs) skip_prereqs=true; shift ;;
      --restore)      restore_file="${2:-}"; shift 2 ;;
      --stop)         action="stop"; shift ;;
      --status)       action="status"; shift ;;
      --help|-h)
        echo ""
        echo "NarrateAI Deployment Script"
        echo ""
        echo "Usage:"
        echo "  $0                                      Fresh deployment"
        echo "  $0 --restore <backup.tar.gz>            Deploy and restore from backup"
        echo "  $0 --skip-prereqs                       Skip prerequisite installation"
        echo "  $0 --skip-prereqs --restore <file>      Restore without installing"
        echo "  $0 --stop                               Stop all NarrateAI services"
        echo "  $0 --status                             Show running status"
        echo ""
        echo "Prerequisites installed automatically:"
        echo "  Docker, Node.js ${NODE_MAJOR}, pnpm, FFmpeg, PM2, cloudflared"
        echo ""
        echo "Environment:"
        echo "  PORT     Web server port (default: 3000)"
        echo ""
        exit 0
        ;;
      *) err "Unknown option: $1"; echo "Run '$0 --help' for usage."; exit 1 ;;
    esac
  done

  case "$action" in
    stop)   do_stop; exit 0 ;;
    status) do_status; exit 0 ;;
  esac

  echo ""
  echo -e "${BOLD}${CYAN}╔════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${CYAN}║         NarrateAI — Deployment Script         ║${NC}"
  echo -e "${BOLD}${CYAN}╚════════════════════════════════════════════════╝${NC}"
  echo ""

  # 1. Prerequisites
  if $skip_prereqs; then
    info "Skipping prerequisite installation (--skip-prereqs)"
    detect_os
  else
    install_all_prereqs
  fi

  # 2. Start infrastructure
  start_infra

  # 3. Setup .env (before restore, so restore can overwrite)
  setup_env

  # 4. Restore from backup if provided
  if [[ -n "$restore_file" ]]; then
    restore_backup "$restore_file"
  fi

  # 5. Build
  build_app

  # 6. Start app
  start_app

  # 7. Tunnel
  start_tunnel
}

main "$@"
