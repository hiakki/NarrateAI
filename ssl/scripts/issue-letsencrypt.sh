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

declare -a PORT80_PIDS=()
declare -a STOPPED_SERVICES=()
declare -a KILLED_PROCS=()
declare -a RESTARTED_SERVICES=()
declare -a FAILED_RESTARTS=()

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

collect_port80_pids() {
  PORT80_PIDS=()
  local pids=()

  if command -v ss >/dev/null 2>&1; then
    local ss_output
    ss_output="$(ss -tlnp 'sport = :80' 2>/dev/null || true)"
    if [[ -n "$ss_output" ]]; then
      while IFS= read -r pid; do
        [[ -n "$pid" ]] && pids+=("$pid")
      done < <(printf '%s\n' "$ss_output" | grep -o 'pid=[0-9]*' | sed 's/pid=//' | sort -u; true)
    fi
  fi

  if [[ ${#pids[@]} -eq 0 ]] && command -v lsof >/dev/null 2>&1; then
    local lsof_output
    lsof_output="$(lsof -nP -iTCP:80 -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$lsof_output" ]]; then
      while IFS= read -r pid; do
        [[ -n "$pid" && "$pid" != "PID" ]] && pids+=("$pid")
      done < <(printf '%s\n' "$lsof_output" | awk 'NR>1 {print $2}' | sort -u; true)
    fi
  fi

  if [[ ${#pids[@]} -eq 0 ]] && command -v netstat >/dev/null 2>&1; then
    local netstat_output
    netstat_output="$(netstat -tlnp 2>/dev/null || true)"
    if [[ -n "$netstat_output" ]]; then
      while IFS= read -r pid; do
        [[ -n "$pid" ]] && pids+=("$pid")
      done < <(printf '%s\n' "$netstat_output" | awk '/:80\s/ {print $7}' | sed 's#/.*##' | sed 's/-//' | grep -E '^[0-9]+$' | sort -u; true)
    fi
  fi

  PORT80_PIDS=("${pids[@]}")
}

print_port80_processes() {
  collect_port80_pids
  if [[ ${#PORT80_PIDS[@]} -eq 0 ]]; then
    echo "No processes detected on port 80."
    return
  fi

  echo "Processes currently listening on port 80:"
  printf "  %-7s %s\n" "PID" "COMMAND"
  declare -A counts=()
  declare -A sample_pid=()
  for pid in "${PORT80_PIDS[@]}"; do
    local cmd
    cmd=$(ps -p "$pid" -o cmd= 2>/dev/null || echo "<exited>")
    ((counts["$cmd"]++))
    if [[ -z "${sample_pid[$cmd]:-}" ]]; then
      sample_pid["$cmd"]="$pid"
    fi
  done
  for cmd in "${!counts[@]}"; do
    local pid="${sample_pid[$cmd]}"
    local suffix=""
    if (( counts["$cmd"] > 1 )); then
      suffix=" (x${counts[$cmd]})"
    fi
    printf "  %-7s %s%s\n" "$pid" "$cmd" "$suffix"
  done
}

attempt_stop_port80_processes() {
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
    echo "Stopping nginx service via systemctl to free port 80..."
    if systemctl stop nginx; then
      STOPPED_SERVICES+=("systemctl start nginx")
    else
      echo "Warning: systemctl stop nginx failed." >&2
    fi
  fi

  collect_port80_pids
  local pids_to_kill=("${PORT80_PIDS[@]}")
  if [[ ${#pids_to_kill[@]} -eq 0 ]]; then
    return
  fi

  echo "Sending SIGTERM to remaining processes on port 80..."
  for pid in "${pids_to_kill[@]}"; do
    local cmd
    cmd=$(ps -p "$pid" -o cmd= 2>/dev/null || echo "<unknown>")
    KILLED_PROCS+=("$pid\t$cmd\tSIGTERM")
    kill "$pid" 2>/dev/null || true
  done
  sleep 2

  collect_port80_pids
  if [[ ${#PORT80_PIDS[@]} -eq 0 ]]; then
    return
  fi

  local stubborn=("${PORT80_PIDS[@]}")
  echo "Sending SIGKILL to stubborn processes on port 80..."
  for pid in "${stubborn[@]}"; do
    local cmd
    cmd=$(ps -p "$pid" -o cmd= 2>/dev/null || echo "<unknown>")
    KILLED_PROCS+=("$pid\t$cmd\tSIGKILL")
    kill -9 "$pid" 2>/dev/null || true
  done
  sleep 1
}

ensure_port80_clear() {
  collect_port80_pids
  if [[ ${#PORT80_PIDS[@]} -eq 0 ]]; then
    return
  fi

  print_port80_processes
  echo ""
  echo "Port 80 is in use. Attempting to free it automatically..."

  attempt_stop_port80_processes
  collect_port80_pids
  if [[ ${#PORT80_PIDS[@]} -gt 0 ]]; then
    print_port80_processes
    echo "Port 80 is still busy. Stop the remaining process(es) manually and rerun." >&2
    exit 1
  fi

  echo "Port 80 is now free."
}

restart_stopped_services() {
  if [[ ${#STOPPED_SERVICES[@]} -eq 0 ]]; then
    return
  fi

  echo ""
  echo "Restarting services that were stopped earlier..."
  declare -A seen=()
  local unique_commands=()
  for cmd in "${STOPPED_SERVICES[@]}"; do
    if [[ -z "${seen[$cmd]:-}" ]]; then
      unique_commands+=("$cmd")
      seen[$cmd]=1
    fi
  done

  for cmd in "${unique_commands[@]}"; do
    if eval "$cmd" >/dev/null 2>&1; then
      RESTARTED_SERVICES+=("$cmd")
      echo "  ✓ $cmd"
    else
      FAILED_RESTARTS+=("$cmd")
      echo "  ✗ $cmd (please restart manually)"
    fi
  done
}

print_killed_summary() {
  if [[ ${#KILLED_PROCS[@]} -eq 0 ]]; then
    return
  fi

  declare -A summary=()
  for entry in "${KILLED_PROCS[@]}"; do
    IFS=$'\t' read -r _pid cmd signal <<<"$entry"
    local key="$cmd|$signal"
    ((summary["$key"]++))
  done

  echo ""
  echo "Processes terminated while freeing port 80:"
  for key in "${!summary[@]}"; do
    local cmd="${key%|*}"
    local signal="${key##*|}"
    local count="${summary[$key]}"
    local label="$cmd"
    if (( count > 1 )); then
      label+=" (x${count})"
    fi
    echo "  $label — $signal"
  done
}

print_restart_reminders() {
  restart_stopped_services
  print_killed_summary

  if [[ ${#RESTARTED_SERVICES[@]} -gt 0 ]]; then
    echo ""
    echo "Services restarted automatically:"
    for cmd in "${RESTARTED_SERVICES[@]}"; do
      echo "  $cmd"
    done
  fi

  if [[ ${#FAILED_RESTARTS[@]} -gt 0 ]]; then
    echo ""
    echo "Unable to restart automatically—please run manually:"
    for cmd in "${FAILED_RESTARTS[@]}"; do
      echo "  $cmd"
    done
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

  ensure_port80_clear

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
    print_restart_reminders
    exit 1
  fi

  if [[ ${DRY_RUN:-false} == true ]]; then
    echo "Dry-run complete (no certificates saved)."
    print_restart_reminders
    exit 0
  fi

  local live_path="/etc/letsencrypt/live/${cert_name}"
  if [[ ! -d "$live_path" ]]; then
    echo "Unexpected: certbot ran but $live_path not found." >&2
    print_restart_reminders
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

  print_restart_reminders
}

main "$@"
