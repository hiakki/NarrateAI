#!/usr/bin/env bash
# Obtain production TLS certificates from Let's Encrypt using certbot.
# Requires the domains to resolve to this server and TCP/80 reachable from the internet.
# For nginx-based setups, certbot's nginx plugin is used to solve the HTTP-01 challenge.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (sudo)." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_DOMAINS=("app.narrateai.online" "chat.narrateai.online" "narrateai.online" "www.narrateai.online")
DEFAULT_CERT_NAME="narrateai-online"

print_banner() {
  cat <<'BANNER'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 NarrateAI — Let's Encrypt certificate helper
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BANNER
}

join_by() {
  local IFS="$1"; shift
  echo "$*"
}

ensure_certbot() {
  if command -v certbot >/dev/null 2>&1; then
    return
  fi

  echo "certbot not found — attempting to install via package manager..."
  if [[ -f /etc/debian_version ]]; then
    apt-get update -qq
    apt-get install -y certbot python3-certbot-nginx
  elif [[ -f /etc/redhat-release ]] || command -v dnf >/dev/null 2>&1; then
    dnf install -y certbot python3-certbot-nginx || yum install -y certbot python3-certbot-nginx
  elif command -v brew >/dev/null 2>&1; then
    brew install certbot
  else
    echo "Unsupported OS for automatic install. Install certbot manually first." >&2
    exit 1
  fi
}

main() {
  print_banner

  local cert_name="$DEFAULT_CERT_NAME"
  local email=""
  local domains=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -d|--domain)
        domains+=("$2"); shift 2 ;;
      --cert-name)
        cert_name="$2"; shift 2 ;;
      -m|--email)
        email="$2"; shift 2 ;;
      --dry-run)
        DRY_RUN=true; shift ;;
      --help|-h)
        cat <<USAGE
Usage: sudo $0 [options]

Options:
  -d, --domain <domain>   Add a domain (may be repeated). Defaults: ${DEFAULT_DOMAINS[*]}
  -m, --email <email>     Email address used for Let's Encrypt registration (required)
  --cert-name <name>      Certbot certificate name (default: $DEFAULT_CERT_NAME)
  --dry-run               Perform a dry-run against Let's Encrypt staging CA
  -h, --help              Show this help

Examples:
  sudo $0 --email admin@example.com
  sudo $0 -d api.example.com -d www.example.com --email ops@example.com --cert-name example-cert

USAGE
        exit 0 ;;
      *)
        echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  if [[ ${#domains[@]} -eq 0 ]]; then
    domains=("${DEFAULT_DOMAINS[@]}")
  fi

  if [[ -z "$email" ]]; then
    read -rp "Enter email for Let's Encrypt expiry notices: " email
  fi
  if [[ -z "$email" ]]; then
    echo "Email is required." >&2
    exit 1
  fi

  echo "Certificate name : $cert_name"
  echo "Domains          : $(join_by ', ' "${domains[@]}")"
  echo "Email            : $email"
  echo "Root config dir  : $ROOT"
  echo ""
  echo "Prerequisites:" 
  echo "  • DNS for each domain must point to this server's public IP"
  echo "  • Port 80 must be open to the internet (HTTP-01 challenge)"
  echo ""

  read -rp "Proceed with these settings? [y/N] " confirm
  if [[ "${confirm,,}" != "y" ]]; then
    echo "Aborted."
    exit 0
  fi

  ensure_certbot

  if ! command -v nginx >/dev/null 2>&1; then
    echo "nginx binary not found. certbot's nginx plugin won't work." >&2
    echo "Either install nginx or re-run with certbot manually (e.g., standalone or DNS challenge)." >&2
    exit 1
  fi

  if ! nginx -t >/dev/null 2>&1; then
    echo "nginx configuration test failed. Ensure nginx installs cleanly before running certbot." >&2
    exit 1
  fi

  local certbot_args=(
    certbot certonly --non-interactive --agree-tos --no-eff-email
    --email "$email"
    --cert-name "$cert_name"
    --nginx
  )

  for d in "${domains[@]}"; do
    certbot_args+=( -d "$d" )
  done

  if [[ ${DRY_RUN:-false} == true ]]; then
    certbot_args+=( --dry-run )
    echo "Running Let's Encrypt dry-run..."
  else
    echo "Requesting production certificate from Let's Encrypt..."
  fi

  if ! "${certbot_args[@]}"; then
    echo "certbot failed. Review the output above." >&2
    exit 1
  fi

  if [[ ${DRY_RUN:-false} == true ]]; then
    echo "Dry-run complete (no certificates saved)."
    exit 0
  fi

  local live_path="/etc/letsencrypt/live/${cert_name}"
  if [[ ! -d "$live_path" ]]; then
    echo "Unexpected: certbot ran but $live_path not found." >&2
    exit 1
  fi

  echo ""
  echo "Success! Certificates stored under: $live_path"
  echo "  fullchain.pem → ${live_path}/fullchain.pem"
  echo "  privkey.pem   → ${live_path}/privkey.pem"
  echo ""
  echo "Update your nginx config (contrib/NarrateAI/ssl/nginx.conf) to use these paths, for example:"
  cat <<'NGINX'
ssl_certificate     /etc/letsencrypt/live/NAME/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/NAME/privkey.pem;
NGINX
  echo "Replace NAME with $cert_name."
  echo ""
  echo "To verify renewal pipeline:"
  echo "  sudo certbot renew --dry-run"
  echo ""
  echo "Remember to set up a cron/systemd timer for certbot renew (if not already provided by the package)."
}

main "$@"
