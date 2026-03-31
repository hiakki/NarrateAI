#!/usr/bin/env bash
# One-shot local setup: nginx (and optional mkcert), TLS certs, dirs, hosts hint, config test.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOSTS_LINE="127.0.0.1 app.narrateai.online chat.narrateai.online"

have() { command -v "$1" >/dev/null 2>&1; }

install_nginx() {
  if have nginx; then
    echo "nginx already available: $(command -v nginx)"
    return 0
  fi
  echo "Installing nginx…"
  case "$(uname -s)" in
    Darwin)
      if have brew; then
        brew install nginx
      else
        echo "Install Homebrew from https://brew.sh then re-run, or install nginx manually." >&2
        exit 1
      fi
      ;;
    Linux)
      if have apt-get; then
        sudo apt-get update -y
        sudo apt-get install -y nginx
      elif have dnf; then
        sudo dnf install -y nginx
      elif have apk; then
        sudo apk add nginx
      else
        echo "Unsupported Linux package manager; install nginx manually." >&2
        exit 1
      fi
      ;;
    *)
      echo "Unsupported OS; install nginx manually." >&2
      exit 1
      ;;
  esac
}

install_mkcert_optional() {
  have mkcert && return 0
  case "$(uname -s)" in
    Darwin)
      if have brew; then
        echo "Installing mkcert (trusted local certs)…"
        brew install mkcert
      fi
      ;;
    Linux)
      if have brew; then
        brew install mkcert
      elif have apt-get; then
        echo "mkcert not in apt by default; install from https://github.com/FiloSottile/mkcert or use OpenSSL fallback." >&2
      fi
      ;;
  esac
}

ensure_mkcert_ca() {
  if have mkcert; then
    echo "Installing mkcert local CA (may prompt for password)…"
    mkcert -install || true
  fi
}

ensure_nginx_prefix_dirs() {
  # Writable dirs under -p prefix for proxy/body buffers
  mkdir -p \
    "$ROOT/logs" \
    "$ROOT/client_body_temp" \
    "$ROOT/proxy_temp" \
    "$ROOT/fastcgi_temp" \
    "$ROOT/uwsgi_temp" \
    "$ROOT/scgi_temp"
}

stop_existing_nginx() {
  echo "Stopping any running nginx instances (system and local)…"
  if sudo nginx -p "$ROOT" -c "$ROOT/nginx.conf" -s quit 2>/dev/null; then
    sleep 1
  fi
  if sudo nginx -s quit 2>/dev/null; then
    sleep 1
  fi
  if have systemctl; then
    sudo systemctl stop nginx >/dev/null 2>&1 || true
  fi
  if have service; then
    sudo service nginx stop >/dev/null 2>&1 || true
  fi
}

maybe_add_hosts() {
  if grep -q 'app\.narrateai\.online' /etc/hosts 2>/dev/null; then
    echo "/etc/hosts already maps app.narrateai.online"
    return 0
  fi
  echo ""
  echo "Add this line to /etc/hosts (needs sudo):"
  echo "  $HOSTS_LINE"
  local ans="n"
  if [[ -t 0 ]]; then
    read -r -p "Append it now? [y/N] " ans || true
  else
    echo "(non-interactive: skipped; add manually if needed)"
  fi
  case "${ans:-}" in
    y|Y|yes|YES)
      echo "$HOSTS_LINE" | sudo tee -a /etc/hosts >/dev/null
      echo "Updated /etc/hosts."
      ;;
    *)
      echo "Skipped. Add manually when ready."
      ;;
  esac
}

main() {
  echo "==> contrib/nginx setup (root: $ROOT)"
  stop_existing_nginx
  install_nginx
  install_mkcert_optional
  ensure_mkcert_ca
  ensure_nginx_prefix_dirs
  echo "==> TLS certificates"
  "$ROOT/scripts/gen-local-ssl.sh"
  echo "==> /etc/hosts"
  maybe_add_hosts
  echo "==> nginx config test"
  nginx -t -p "$ROOT" -c "$ROOT/nginx.conf"
  echo "==> restarting nginx with local config"
  if sudo nginx -p "$ROOT" -c "$ROOT/nginx.conf" -s quit 2>/dev/null; then
    sleep 1
  fi
  sudo nginx -p "$ROOT" -c "$ROOT/nginx.conf" || {
    echo "Failed to start nginx. Check if ports 80/443 are in use." >&2
    exit 1
  }
  echo ""
  echo "Setup complete. nginx now runs in the background (daemon mode) on ports 80/443."
  echo "Stop:    sudo nginx -p \"$ROOT\" -c \"$ROOT/nginx.conf\" -s quit"
  echo "Debug:   sudo nginx -p \"$ROOT\" -c \"$ROOT/nginx.conf\" -g 'daemon off;'"
  echo "Ensure backends are running: app :3000, chat :5173"
}

main "$@"
