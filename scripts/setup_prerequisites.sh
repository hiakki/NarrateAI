#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# NarrateAI — Setup everything and verify it works
#
# Use once to install tools, start infra (Docker Postgres + Redis), build,
# and optionally restore from backup. After setup, run the app with: pnpm dev:all
#
# Usage:
#   ./scripts/setup_prerequisites.sh              # full setup (base + build + deploy)
#   ./scripts/setup_prerequisites.sh --base       # install tools, start infra, prepare .env
#   ./scripts/setup_prerequisites.sh --build      # install deps, prisma, optional restore
#   ./scripts/setup_prerequisites.sh --deploy     # start PM2 processes only
#   ./scripts/setup_prerequisites.sh --restore backup.tar.gz  # restore during build step
#   ./scripts/setup_prerequisites.sh --skip-prereqs           # skip tool installs (base phase)
#   ./scripts/setup_prerequisites.sh --stop       # stop all services
#   ./scripts/setup_prerequisites.sh --status     # show status
#
# Run the app locally: pnpm dev:all   |   Backup/restore only: scripts/backup-restore.sh
# Supports: Ubuntu/Debian (apt), macOS (brew)
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$PROJECT_DIR/deploy.log"
PM2_ECOSYSTEM="$PROJECT_DIR/ecosystem.config.cjs"
PORT="${PORT:-3000}"
# Node 22 LTS required (Node 24+ triggers DEP0169 url.parse() deprecation warnings)
NODE_MAJOR=22
prisma_accept_data_loss=false

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

# ── Prerequisite: Node.js (22 LTS; avoid 24+ due to DEP0169) ───────────────────
install_node() {
  if command -v node &>/dev/null; then
    local ver
    ver="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [[ "$ver" -ge 24 ]]; then
      warn "Node.js $(node -v) detected. Node 22 LTS is recommended to avoid deprecation warnings (DEP0169)."
      info "Install Node 22: brew install node@22 (macOS) or https://nodejs.org/en/download"
      return
    fi
    if [[ "$ver" -ge "$NODE_MAJOR" ]]; then
      ok "Node.js already installed ($(node -v))"
      return
    fi
    warn "Node.js $(node -v) found, need v${NODE_MAJOR}+. Installing..."
  fi

  info "Installing Node.js ${NODE_MAJOR} LTS..."
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
      err "Cannot auto-install Node.js. Install v${NODE_MAJOR} LTS manually: https://nodejs.org"
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

# ── Prerequisite: yt-dlp (for clip-repurpose pipeline) ─────────────────────
install_ytdlp() {
  if command -v yt-dlp &>/dev/null; then
    ok "yt-dlp already installed ($(yt-dlp --version 2>/dev/null))"
    return
  fi

  info "Installing yt-dlp..."
  case "$PKG" in
    apt)  sudo apt-get install -y -qq yt-dlp 2>/dev/null || pip3 install --break-system-packages yt-dlp ;;
    brew) brew install yt-dlp ;;
    dnf)  sudo dnf install -y yt-dlp 2>/dev/null || pip3 install yt-dlp ;;
    *)    pip3 install yt-dlp ;;
  esac
  ok "yt-dlp installed"
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

# ── Prerequisite: Chrome/Chromium (for Puppeteer workflows) ──────────────────
install_chromium() {
  local chrome_bin=""
  for candidate in \
    "${CHROME_PATH:-}" \
    "$(command -v google-chrome 2>/dev/null)" \
    "$(command -v google-chrome-stable 2>/dev/null)" \
    "$(command -v chromium-browser 2>/dev/null)" \
    "$(command -v chromium 2>/dev/null)" \
    "/usr/bin/google-chrome" \
    "/usr/bin/google-chrome-stable" \
    "/usr/bin/chromium-browser" \
    "/usr/bin/chromium"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      chrome_bin="$candidate"
      break
    fi
  done

  if [[ -n "$chrome_bin" ]]; then
    ok "Chromium-based browser available ($("$chrome_bin" --version 2>/dev/null | head -1))"
    return
  fi

  info "Installing headless Chrome/Chromium..."
  case "$PKG" in
    apt)
      curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-linux.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/google-linux.gpg] https://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list >/dev/null
      sudo apt-get update -qq
      sudo apt-get install -y -qq google-chrome-stable || sudo apt-get install -y -qq chromium-browser chromium || true
      ;;
    brew)
      brew install --cask google-chrome 2>/dev/null || warn "Install Google Chrome manually from https://www.google.com/chrome/"
      ;;
    dnf)
      sudo dnf install -y google-chrome-stable 2>/dev/null || sudo dnf install -y chromium 2>/dev/null || true
      ;;
    *)
      warn "Cannot auto-install Chrome on this OS. Install Google Chrome or Chromium manually and set CHROME_PATH."
      return
      ;;
  esac

  if command -v google-chrome &>/dev/null; then
    ok "Google Chrome installed ($(google-chrome --version 2>/dev/null | head -1))"
  elif command -v google-chrome-stable &>/dev/null; then
    ok "Google Chrome installed ($(google-chrome-stable --version 2>/dev/null | head -1))"
  elif command -v chromium-browser &>/dev/null; then
    ok "Chromium installed ($(chromium-browser --version 2>/dev/null | head -1))"
  elif command -v chromium &>/dev/null; then
    ok "Chromium installed ($(chromium --version 2>/dev/null | head -1))"
  else
    warn "Chrome/Chromium install attempted but not detected. Install manually and set CHROME_PATH before using clip workflows."
  fi
}

install_xvfb() {
  if [[ "$(uname)" != "Linux" ]]; then
    return
  fi

  if command -v Xvfb &>/dev/null; then
    ok "Xvfb already installed"
    return
  fi

  if [[ "$PKG" == "apt" ]]; then
    info "Installing Xvfb for headless Chrome..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq xvfb || warn "Failed to install Xvfb automatically. Install manually if you plan to run cookie extraction."
    return
  fi

  if [[ "$PKG" == "dnf" ]]; then
    info "Installing Xvfb for headless Chrome..."
    sudo dnf install -y xorg-x11-server-Xvfb || warn "Failed to install Xvfb automatically. Install manually if you plan to run cookie extraction."
    return
  fi

  warn "Xvfb not installed automatically on this platform. Install it manually if you plan to run cookie extraction."
}

# ── Install all prerequisites ────────────────────────────────────────────────
install_all_prereqs() {
  step "Installing prerequisites"
  detect_os
  install_docker
  install_node
  install_pnpm
  install_ffmpeg
  install_ytdlp
  install_pm2
  install_cloudflared
  install_chromium
  install_xvfb

  if [[ "$(uname)" == "Linux" ]]; then
    if ! command -v Xvfb &>/dev/null; then
      warn "Xvfb not available — Chrome-based flows may require running under xvfb-run."
    else
      ok "Xvfb available — use 'xvfb-run -s "-screen 0 1280x720x24" pnpm tsx scripts/cookie-extract.ts' for interactive cookie setup."
    fi
  fi
}

# ── Start infrastructure (Postgres + Redis) ──────────────────────────────────
start_infra() {
  step "Starting infrastructure (PostgreSQL + Redis)"
  cd "$PROJECT_DIR"

  if ! command -v docker &>/dev/null; then
    err "Docker is not installed or not in PATH"
    exit 1
  fi

  # Ensure Docker daemon is running
  if ! docker info &>/dev/null; then
    info "Docker daemon not running — attempting to start..."
    if [[ "$(uname)" == "Darwin" ]]; then
      open -a "Docker" 2>/dev/null || true
    elif command -v systemctl &>/dev/null; then
      sudo systemctl start docker 2>/dev/null || true
    fi

    info "Waiting for Docker daemon (up to 60s)..."
    local d_retries=60
    while [[ $d_retries -gt 0 ]]; do
      if docker info &>/dev/null; then
        ok "Docker daemon is ready"
        break
      fi
      d_retries=$((d_retries - 1))
      sleep 1
    done
    if [[ $d_retries -eq 0 ]]; then
      err "Docker daemon did not start in 60s. Start Docker Desktop / dockerd manually."
      exit 1
    fi
  fi

  if ! docker compose up -d 2>/dev/null; then
    if ! docker-compose up -d 2>/dev/null; then
      err "docker compose up failed. Check docker-compose.yml and Docker status."
      exit 1
    fi
  fi

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
    info "Check: docker compose ps / docker compose logs postgres"
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
    info "Check: docker compose ps / docker compose logs redis"
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

# ── Prepare project (deps + schema) ───────────────────────────────────────────
prepare_project() {
  step "Preparing project (dependencies + schema)"
  cd "$PROJECT_DIR"

  info "Installing Node.js dependencies..."
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  ok "Dependencies installed"

  info "Generating Prisma client..."
  pnpm db:generate
  ok "Prisma client generated"

  info "Pushing database schema..."
  local push_cmd=(pnpm db:push)
  if $prisma_accept_data_loss; then
    push_cmd+=(--accept-data-loss)
  fi
  if ! "${push_cmd[@]}"; then
    err "Database schema push failed. Check DATABASE_URL and that PostgreSQL is running."
    exit 1
  fi
  ok "Database schema synced"

  info "Building Next.js production bundle..."
  if ! pnpm build; then
    err "Next.js build failed. Check logs above for details."
    exit 1
  fi
  ok "Next.js production build ready"
}

# ── Generate PM2 ecosystem config ────────────────────────────────────────────
generate_pm2_config() {
  cat > "$PM2_ECOSYSTEM" <<PMEOF
module.exports = {
  apps: [
    {
      name: "narrateai-web",
      script: "/bin/bash",
      args: "-lc 'cd ${PROJECT_DIR} && pnpm start'",
      env: { NODE_ENV: "production", PORT: "${PORT}", NEXT_TELEMETRY_DISABLED: "1" },
      max_memory_restart: "512M",
    },
    {
      name: "narrateai-worker",
      script: "/bin/bash",
      args: "-lc 'cd ${PROJECT_DIR} && pnpm worker'",
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
    },
    {
      name: "narrateai-clip-worker",
      script: "/bin/bash",
      args: "-lc 'cd ${PROJECT_DIR} && pnpm worker:clip'",
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
    },
    {
      name: "narrateai-scheduler",
      script: "/bin/bash",
      args: "-lc 'cd ${PROJECT_DIR} && pnpm scheduler'",
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

  pm2 delete narrateai-web narrateai-worker narrateai-clip-worker narrateai-scheduler 2>/dev/null || true
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
  echo "    pm2 logs narrateai-web          — web server logs"
  echo "    pm2 logs narrateai-worker       — video worker logs"
  echo "    pm2 logs narrateai-clip-worker  — clip repurpose worker logs"
  echo "    pm2 logs narrateai-scheduler    — scheduler logs"
  echo "    pm2 logs narrateai-tunnel       — tunnel logs"
  echo "    pm2 restart all               — restart everything"
    echo "    ./scripts/setup_prerequisites.sh --stop    — stop all services"
  echo ""
}

# ── Stop all services ────────────────────────────────────────────────────────
do_stop() {
  step "Stopping NarrateAI"
  pm2 delete narrateai-web narrateai-worker narrateai-clip-worker narrateai-scheduler narrateai-tunnel 2>/dev/null || true
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
  local action="setup"
  local run_base=false
  local run_build=false
  local run_deploy=false
  local any_phase=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skip-prereqs) skip_prereqs=true; shift ;;
      --restore)      restore_file="${2:-}"; shift 2 ;;
      --stop)         action="stop"; shift ;;
      --status)       action="status"; shift ;;
      --base)         run_base=true; any_phase=true; shift ;;
      --build)        run_build=true; any_phase=true; shift ;;
      --deploy)       run_deploy=true; any_phase=true; shift ;;
      --accept-data-loss) prisma_accept_data_loss=true; shift ;;
      --help|-h)
        cat <<USAGE

NarrateAI Setup Script

Usage:
  $0                        Full setup (base + build + deploy)
  $0 --base                 Install tools, start infra, create .env
  $0 --build                Install deps, run Prisma, optional restore
  $0 --deploy               Start PM2 processes only
  $0 --restore <file>       Restore backup during build step
  $0 --skip-prereqs         Skip prerequisite installation (base phase)
  $0 --accept-data-loss     Allow Prisma schema push to drop data
  $0 --stop                 Stop all NarrateAI services
  $0 --status               Show running status

Prerequisites installed automatically:
  Docker, Node.js ${NODE_MAJOR}, pnpm, FFmpeg, yt-dlp, PM2, cloudflared

Environment:
  PORT     Web server port (default: 3000)

USAGE
        exit 0
        ;;
      *) err "Unknown option: $1"; echo "Run '$0 --help' for usage."; exit 1 ;;
    esac
  done

  if ! $any_phase; then
    run_base=true
    run_build=true
    run_deploy=true
  fi

  if $run_base && $skip_prereqs; then
    info "Skipping prerequisite installation (--skip-prereqs)"
    detect_os
  elif $run_base; then
    install_all_prereqs
    start_infra
    setup_env
  fi

  if $run_build; then
    if $run_base; then
      : # already handled infra and .env above
    else
      start_infra
      setup_env
    fi
    if [[ -n "$restore_file" ]]; then
      restore_backup "$restore_file" || warn "Restore failed or skipped."
    fi
    prepare_project
  fi

  if $run_deploy; then
    start_app
  fi

  if ! $run_base && ! $run_build && ! $run_deploy; then
    echo ""
    echo "  Production:     $0 --deploy"
    echo "  Stop:           $0 --stop"
    echo ""
  fi
  return

  case "$action" in
    stop)   do_stop; exit 0 ;;
    status) do_status; exit 0 ;;
  esac

  echo ""
  echo -e "${BOLD}${CYAN}╔════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${CYAN}║       NarrateAI — Setup Prerequisites         ║${NC}"
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
    if ! restore_backup "$restore_file"; then
      warn "Restore failed or skipped. Ensure PostgreSQL client is installed for restore."
      warn "Videos, DB data, and other backup contents were NOT restored."
      info "To restore later: install PostgreSQL client, then run:"
      echo "    scripts/backup-restore.sh restore $restore_file"
      info "Continuing: schema will be pushed so the app can run."
    fi
  fi

  # 5. Prepare project (deps + schema only; no build, no PM2)
  prepare_project

  # 6. Optional: FB/IG cookie setup for clip repurposing
  if [[ ! -f "data/ytdlp-cookies.txt" ]] && [[ -z "${YTDLP_COOKIES_FILE:-}" ]]; then
    echo ""
    info "FB/IG Content Discovery (optional)"
    info "To discover and clip trending videos from Facebook and Instagram,"
    info "you can log in now. A browser window will open — just sign in."
    echo ""
    read -rp "  Set up Facebook/Instagram access now? [y/N] " cookie_answer
    if [[ "${cookie_answer,,}" == "y" ]]; then
      info "Opening browser for Facebook login..."
      npx tsx -e "
        const { extractPlatformCookies } = require('./src/lib/cookie-extract');
        extractPlatformCookies('facebook').then(r => {
          console.log(r.success ? 'Cookies saved: ' + r.cookieCount + ' entries' : 'Skipped: ' + r.message);
          process.exit(r.success ? 0 : 1);
        });
      " 2>/dev/null || warn "Cookie setup skipped. You can do this later from Settings > Content Discovery Access."
    else
      info "Skipped. You can set this up later from Settings > Content Discovery Access."
    fi
  else
    info "Platform cookies already configured."
  fi

  echo ""
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Setup complete.${NC}"
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Development:    pnpm dev:all"
  if $run_deploy || (! $any_phase && ! $run_base && ! $run_build); then
    start_app
  fi

  echo "  Production:     ./scripts/setup_prerequisites.sh --deploy"
  echo "  Stop:           ./scripts/setup_prerequisites.sh --stop"
  echo ""
}

main "$@"
