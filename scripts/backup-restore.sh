#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# NarrateAI — Backup & Restore
#
# Backs up PostgreSQL database + generated video assets (public/videos/).
# Produces a single .tar.gz that can be restored on any machine.
#
# Usage:
#   ./scripts/backup-restore.sh backup              # full backup (DB + videos)
#   ./scripts/backup-restore.sh backup --db-only     # database only
#   ./scripts/backup-restore.sh restore <file.tar.gz>
#   ./scripts/backup-restore.sh list                 # list available backups
#
# Environment variables (auto-read from .env if present):
#   DATABASE_URL  — postgres connection string
#   BACKUP_DIR    — where to store backups (default: ./backups)
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
VIDEOS_DIR="$PROJECT_DIR/public/videos"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Load .env ────────────────────────────────────────────────────────────────
load_env() {
  local envfile="$PROJECT_DIR/.env"
  if [[ -f "$envfile" ]]; then
    set +e
    while IFS='=' read -r key value; do
      key="$(echo "$key" | tr -d '[:space:]')"
      [[ -z "$key" || "$key" == \#* ]] && continue
      value="${value%%\#*}"           # strip inline comments
      value="${value#\"}" ; value="${value%\"}"  # strip surrounding quotes
      export "$key=$value" 2>/dev/null
    done < "$envfile"
    set -e
  fi
}

# ── Parse DATABASE_URL into components ───────────────────────────────────────
parse_db_url() {
  local url="${DATABASE_URL:-}"
  if [[ -z "$url" ]]; then
    err "DATABASE_URL is not set. Create a .env file or export it."
    exit 1
  fi

  # postgresql://user:pass@host:port/dbname?params
  DB_USER="$(echo "$url" | sed -E 's|.*://([^:]+):.*|\1|')"
  DB_PASS="$(echo "$url" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')"
  DB_HOST="$(echo "$url" | sed -E 's|.*@([^:]+):.*|\1|')"
  DB_PORT="$(echo "$url" | sed -E 's|.*:([0-9]+)/.*|\1|')"
  DB_NAME="$(echo "$url" | sed -E 's|.*/([^?]+).*|\1|')"
}

# ── Check prerequisites ─────────────────────────────────────────────────────
check_tools() {
  local missing=()
  local tool
  for tool in pg_dump pg_restore psql tar; do
    if ! command -v "$tool" &>/dev/null; then
      missing+=("$tool")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    err "Missing required tools: ${missing[*]}"
    echo ""
    echo "Install PostgreSQL client tools:"
    echo "  macOS:   brew install postgresql@15"
    echo "  Ubuntu:  sudo apt-get install postgresql-client-15"
    echo "  Docker:  you can also run this script inside the postgres container"
    exit 1
  fi
}

# ── Check DB connectivity ────────────────────────────────────────────────────
check_db() {
  info "Testing database connection..."
  if ! PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" &>/dev/null; then
    err "Cannot connect to database at $DB_HOST:$DB_PORT/$DB_NAME"
    echo "  Make sure PostgreSQL is running: docker compose up -d postgres"
    exit 1
  fi
  ok "Database connection OK ($DB_HOST:$DB_PORT/$DB_NAME)"
}

# ═════════════════════════════════════════════════════════════════════════════
# BACKUP
# ═════════════════════════════════════════════════════════════════════════════
do_backup() {
  local db_only=false
  [[ "${1:-}" == "--db-only" ]] && db_only=true

  mkdir -p "$BACKUP_DIR"
  local work_dir
  work_dir="$(mktemp -d)"
  trap "rm -rf '$work_dir'" EXIT

  # ── Database dump ──────────────────────────────────────────────────────
  info "Dumping database '$DB_NAME'..."
  local dump_file="$work_dir/database.sql"

  PGPASSWORD="$DB_PASS" pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
    -F p \
    -f "$dump_file"

  local dump_size
  dump_size="$(du -sh "$dump_file" | cut -f1)"
  ok "Database dump: $dump_size"

  # ── Metadata ───────────────────────────────────────────────────────────
  cat > "$work_dir/backup-meta.json" <<METAEOF
{
  "app": "NarrateAI",
  "timestamp": "$TIMESTAMP",
  "database": "$DB_NAME",
  "db_host": "$DB_HOST",
  "includes_videos": $(if $db_only; then echo "false"; else echo "true"; fi),
  "created_on": "$(uname -n)",
  "pg_version": "$(pg_dump --version | head -1)"
}
METAEOF

  # ── Video assets ───────────────────────────────────────────────────────
  local archive_name
  if $db_only; then
    archive_name="narrateai-backup-db-${TIMESTAMP}.tar.gz"
    info "Skipping video assets (--db-only)"
  else
    archive_name="narrateai-backup-full-${TIMESTAMP}.tar.gz"
    if [[ -d "$VIDEOS_DIR" ]] && [[ "$(ls -A "$VIDEOS_DIR" 2>/dev/null)" ]]; then
      info "Copying video assets..."
      cp -r "$VIDEOS_DIR" "$work_dir/videos"
      local vid_size
      vid_size="$(du -sh "$work_dir/videos" | cut -f1)"
      ok "Video assets: $vid_size"
    else
      warn "No video assets found at $VIDEOS_DIR"
      mkdir -p "$work_dir/videos"
    fi
  fi

  # ── Create archive ─────────────────────────────────────────────────────
  info "Creating archive..."
  local archive_path="$BACKUP_DIR/$archive_name"
  tar -czf "$archive_path" -C "$work_dir" .

  local total_size
  total_size="$(du -sh "$archive_path" | cut -f1)"

  echo ""
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Backup complete!${NC}"
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "  File: $archive_path"
  echo "  Size: $total_size"
  echo ""
  echo "  To restore on another machine:"
  echo "    1. Copy this file to the target machine"
  echo "    2. Run: ./scripts/backup-restore.sh restore $archive_name"
  echo ""
}

# ═════════════════════════════════════════════════════════════════════════════
# RESTORE
# ═════════════════════════════════════════════════════════════════════════════
do_restore() {
  local archive="${1:-}"
  if [[ -z "$archive" ]]; then
    err "Usage: $0 restore <backup-file.tar.gz>"
    exit 1
  fi

  # Resolve path
  if [[ ! -f "$archive" ]]; then
    if [[ -f "$BACKUP_DIR/$archive" ]]; then
      archive="$BACKUP_DIR/$archive"
    else
      err "Backup file not found: $archive"
      exit 1
    fi
  fi

  local work_dir
  work_dir="$(mktemp -d)"
  trap "rm -rf '$work_dir'" EXIT

  info "Extracting backup..."
  tar -xzf "$archive" -C "$work_dir"

  # ── Show metadata ──────────────────────────────────────────────────────
  if [[ -f "$work_dir/backup-meta.json" ]]; then
    echo ""
    info "Backup metadata:"
    cat "$work_dir/backup-meta.json" | while IFS= read -r line; do echo "    $line"; done
    echo ""
  fi

  # ── Confirm ────────────────────────────────────────────────────────────
  echo -e "${YELLOW}⚠  This will OVERWRITE the current database '$DB_NAME' and video files.${NC}"
  echo ""
  read -rp "Continue? (y/N) " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    info "Restore cancelled."
    exit 0
  fi

  # ── Restore database ──────────────────────────────────────────────────
  if [[ -f "$work_dir/database.sql" ]]; then
    info "Restoring database..."

    # Ensure the DB exists
    PGPASSWORD="$DB_PASS" psql \
      -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "postgres" \
      -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME';" | grep -q 1 || \
    PGPASSWORD="$DB_PASS" psql \
      -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "postgres" \
      -c "CREATE DATABASE $DB_NAME;"

    # Drop existing connections
    PGPASSWORD="$DB_PASS" psql \
      -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "postgres" \
      -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" &>/dev/null || true

    PGPASSWORD="$DB_PASS" psql \
      -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
      -f "$work_dir/database.sql" &>/dev/null

    ok "Database restored"
  else
    warn "No database dump found in backup"
  fi

  # ── Restore video assets ───────────────────────────────────────────────
  if [[ -d "$work_dir/videos" ]] && [[ "$(ls -A "$work_dir/videos" 2>/dev/null)" ]]; then
    info "Restoring video assets..."
    mkdir -p "$VIDEOS_DIR"
    cp -r "$work_dir/videos/"* "$VIDEOS_DIR/"
    local vid_count
    vid_count="$(find "$VIDEOS_DIR" -name '*.mp4' | wc -l | tr -d ' ')"
    ok "Video assets restored ($vid_count MP4 files)"
  else
    info "No video assets in this backup"
  fi

  # ── Run Prisma migrations ──────────────────────────────────────────────
  info "Running Prisma migrations (in case schema has changed)..."
  cd "$PROJECT_DIR"
  npx prisma migrate deploy 2>/dev/null && ok "Migrations applied" || warn "Migration skipped (may already be up to date)"

  echo ""
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Restore complete!${NC}"
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Next steps:"
  echo "    1. Update .env with your API keys if needed"
  echo "    2. Start the app:  pnpm dev"
  echo "    3. Start workers:  pnpm scheduler"
  echo ""
}

# ═════════════════════════════════════════════════════════════════════════════
# LIST
# ═════════════════════════════════════════════════════════════════════════════
do_list() {
  if [[ ! -d "$BACKUP_DIR" ]] || [[ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]]; then
    info "No backups found in $BACKUP_DIR"
    return
  fi

  echo ""
  echo -e "${CYAN}Available backups:${NC}"
  echo ""
  printf "  %-50s %10s  %s\n" "FILE" "SIZE" "DATE"
  printf "  %-50s %10s  %s\n" "────" "────" "────"

  for f in "$BACKUP_DIR"/narrateai-backup-*.tar.gz; do
    [[ -f "$f" ]] || continue
    local name size date
    name="$(basename "$f")"
    size="$(du -sh "$f" | cut -f1)"
    date="$(stat -f '%Sm' -t '%Y-%m-%d %H:%M' "$f" 2>/dev/null || stat -c '%y' "$f" 2>/dev/null | cut -d. -f1)"
    printf "  %-50s %10s  %s\n" "$name" "$size" "$date"
  done
  echo ""
}

# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════
main() {
  local cmd="${1:-help}"
  shift || true

  case "$cmd" in
    help|--help|-h)
      echo ""
      echo "NarrateAI Backup & Restore"
      echo ""
      echo "Usage:"
      echo "  $0 backup               Full backup (database + videos)"
      echo "  $0 backup --db-only     Database only (faster, smaller)"
      echo "  $0 restore <file>       Restore from a backup archive"
      echo "  $0 list                 List available backups"
      echo ""
      echo "Backups are saved to: $BACKUP_DIR"
      echo ""
      exit 0
      ;;
    list)
      do_list
      exit 0
      ;;
  esac

  load_env
  parse_db_url
  check_tools

  case "$cmd" in
    backup)
      check_db
      do_backup "$@"
      ;;
    restore)
      check_db
      do_restore "$@"
      ;;
    *)
      err "Unknown command: $cmd"
      echo "Run '$0 help' for usage."
      exit 1
      ;;
  esac
}

main "$@"
