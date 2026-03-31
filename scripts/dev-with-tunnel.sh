#!/usr/bin/env bash
# Run pnpm dev:all + Cloudflare tunnel. PORT from .env or 3000.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# PORT from .env or default 3000 (simple: no comments in PORT= line)
if [[ -f .env ]] && grep -qE '^PORT=' .env 2>/dev/null; then
  PORT="$(grep -E '^PORT=' .env | head -1 | cut -d= -f2- | tr -d '\r\n' | xargs)"
fi
PORT="${PORT:-3000}"
export PORT

if ! command -v cloudflared &>/dev/null; then
  echo "[ERROR] cloudflared not found. Install it first:"
  echo "  brew install cloudflare/cloudflare/cloudflared   # macOS"
  echo "  Or run: ./scripts/setup_prerequisites.sh"
  exit 1
fi

echo "[INFO] Starting app + tunnel (PORT=$PORT). Public URL will appear below."
echo ""
exec pnpm exec concurrently -n dev,tunnel -c blue,magenta "pnpm dev:all" "cloudflared tunnel --url http://localhost:${PORT}"
