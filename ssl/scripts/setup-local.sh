#!/usr/bin/env bash
# One-shot local setup: nginx (and optional mkcert), TLS certs, dirs, hosts hint, config test.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOSTS_LINE="127.0.0.1 app.narrateai.online chat.narrateai.online"
CERT_DIR="$ROOT/certs"
USE_PRODUCTION=false
LE_EMAIL=""
LE_CERT_NAME="narrateai-online"
LE_HELPER_SCRIPT="$ROOT/scripts/issue-letsencrypt.sh"
CERT_RENEW_THRESHOLD_SECONDS=${CERT_RENEW_THRESHOLD_SECONDS:-2592000}

have() { command -v "$1" >/dev/null 2>&1; }

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --production)
        USE_PRODUCTION=true; shift ;;
      --email)
        LE_EMAIL="${2:-}"; shift 2 ;;
      --help|-h)
        cat <<'USAGE'
Usage: ./scripts/setup-local.sh [--production] [--email you@example.com]

Options:
  --production           Obtain Let's Encrypt certificates (requires DNS + public access)
  --email <address>      Email used for Let's Encrypt registration (required with --production)
  --help                 Show this message

Without --production, mkcert/self-signed certificates are generated for local development.
USAGE
        exit 0 ;;
      *)
        echo "Unknown option: $1" >&2
        exit 1 ;;
    esac
  done
}

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

obtain_production_certs() {
  if [[ ! -x "$LE_HELPER_SCRIPT" ]]; then
    echo "Let's Encrypt helper not found: $LE_HELPER_SCRIPT" >&2
    exit 1
  fi

  if [[ -z "$LE_EMAIL" ]]; then
    if [[ -t 0 ]]; then
      read -r -p "Enter email for Let's Encrypt notifications: " LE_EMAIL || true
    fi
  fi

  if [[ -z "$LE_EMAIL" ]]; then
    echo "Email is required when using --production" >&2
    exit 1
  fi

  echo "==> Let's Encrypt (production certificates)"
  sudo "$LE_HELPER_SCRIPT" --email "$LE_EMAIL"

  # Helper restarts nginx; stop it again so we can launch with this config
  stop_existing_nginx
}

cert_needs_renewal() {
  local cert="/etc/letsencrypt/live/$LE_CERT_NAME/fullchain.pem"
  local threshold_seconds=${CERT_RENEW_THRESHOLD_SECONDS:-2592000} # 30 days

  if [[ ! -f "$cert" ]]; then
    return 0
  fi

  if ! command -v openssl >/dev/null 2>&1; then
    echo "openssl not found; assuming certificate renewal is required." >&2
    return 0
  fi

  if openssl x509 -checkend "$threshold_seconds" -noout -in "$cert" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

copy_if_changed() {
  local src="$1"
  local dest="$2"
  local perms="$3"

  if [[ ! -f "$src" ]]; then
    echo "Source certificate file missing: $src" >&2
    return 1
  fi

  if [[ -f "$dest" ]] && sudo cmp -s "$src" "$dest" 2>/dev/null; then
    return 0
  fi

  sudo cp "$src" "$dest"
  sudo chmod "$perms" "$dest"
  echo "Updated $dest"
}

copy_production_certs() {
  local live_dir="/etc/letsencrypt/live/$LE_CERT_NAME"
  local fullchain="$live_dir/fullchain.pem"
  local privkey="$live_dir/privkey.pem"

  if [[ ! -f "$fullchain" || ! -f "$privkey" ]]; then
    echo "Let's Encrypt certificates not found in $live_dir" >&2
    exit 1
  fi

  copy_if_changed "$fullchain" "$CERT_DIR/narrateai.pem" 644
  copy_if_changed "$privkey" "$CERT_DIR/narrateai-key.pem" 600
}

check_port_open() {
  local port="$1"

  if command -v ss >/dev/null 2>&1; then
    if ss -H -tln 2>/dev/null | awk '{print $4}' | grep -Eq "(:|\.)$port$"; then
      return 0
    fi
  fi

  if command -v netstat >/dev/null 2>&1; then
    if netstat -tln 2>/dev/null | awk '{print $4}' | grep -Eq "(:|\.)$port$"; then
      return 0
    fi
  fi

  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
  fi

  if command -v fuser >/dev/null 2>&1; then
    if fuser -n tcp "$port" >/dev/null 2>&1; then
      return 0
    fi
  fi

  # Fallback: attempt TCP connect
  if timeout 1 bash -c "</dev/tcp/127.0.0.1/$port" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

verify_nginx_ports() {
  local missing=()
  for port in 80 443; do
    if check_port_open "$port"; then
      echo "Port $port is listening."
    else
      missing+=("$port")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    echo "nginx is not listening on port(s): ${missing[*]}" >&2
    exit 1
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
    "$ROOT/scgi_temp" \
    "$CERT_DIR"
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
  if $USE_PRODUCTION; then
    return 0
  fi
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
  parse_args "$@"
  echo "==> contrib/nginx setup (root: $ROOT)"
  if $USE_PRODUCTION; then
    echo "Mode: production (Let's Encrypt)"
  else
    echo "Mode: local development (mkcert/self-signed)"
  fi

  stop_existing_nginx
  install_nginx
  ensure_nginx_prefix_dirs

  if $USE_PRODUCTION; then
    if cert_needs_renewal; then
      echo "Existing Let's Encrypt certificate missing or expiring soon — requesting new issuance."
      obtain_production_certs
    else
      echo "Existing Let's Encrypt certificate is valid for at least $(($CERT_RENEW_THRESHOLD_SECONDS/86400)) days; skipping issuance."
    fi
    copy_production_certs
  else
    install_mkcert_optional
    ensure_mkcert_ca
    echo "==> TLS certificates (local)"
    "$ROOT/scripts/gen-local-ssl.sh"
  fi

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

  verify_nginx_ports

  echo ""
  echo "Setup complete. nginx now runs in the background (daemon mode) on ports 80/443."
  if $USE_PRODUCTION; then
    echo "Certificates sourced from Let's Encrypt (copied into $CERT_DIR)."
    echo "Remember: renewals must copy updated certs or rerun this script after certbot renews."
  else
    echo "Certificates sourced from mkcert/self-signed under $CERT_DIR."
  fi
  echo "Stop:    sudo nginx -p \"$ROOT\" -c \"$ROOT/nginx.conf\" -s quit"
  echo "Debug:   sudo nginx -p \"$ROOT\" -c \"$ROOT/nginx.conf\" -g 'daemon off;'"
  echo "Ensure backends are running: app :3000, chat :5173"
}

main "$@"


