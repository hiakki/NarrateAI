#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# NarrateAI — Backup & Restore
#
# Backs up PostgreSQL database, generated videos, environment config,
# fonts, music, characters, and Prisma schema into a single .tar.gz.
#
# Usage:
#   ./scripts/backup-restore.sh backup              # full backup (DB + all assets)
#   ./scripts/backup-restore.sh backup --db-only    # database + config only
#   ./scripts/backup-restore.sh restore <file.tar.gz>
#   ./scripts/backup-restore.sh restore <file.tar.gz> --yes   # skip confirmation
#   ./scripts/backup-restore.sh list                # list available backups
#
# Environment variables (auto-read from .env if present):
#   DATABASE_URL  — postgres connection string
#   BACKUP_DIR    — where to store backups (default: ./backups)
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
VIDEOS_DIR="$PROJECT_DIR/public/videos"
CHARACTERS_DIR="$PROJECT_DIR/public/characters"
MUSIC_DIR="$PROJECT_DIR/public/music"
FONTS_DIR="$PROJECT_DIR/assets/fonts"
SCHEMA_FILE="$PROJECT_DIR/prisma/schema.prisma"
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
      value="${value%%\#*}"
      value="${value#\"}" ; value="${value%\"}"
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

# ── Helper: copy dir if non-empty ────────────────────────────────────────────
copy_dir_if_exists() {
  local src="$1" dest="$2" label="$3"
  if [[ -d "$src" ]] && [[ "$(ls -A "$src" 2>/dev/null)" ]]; then
    mkdir -p "$dest"
    cp -r "$src/"* "$dest/"
    local sz
    sz="$(du -sh "$dest" | cut -f1)"
    ok "$label: $sz"
  else
    warn "No $label found at $src"
  fi
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

  # ── .env (contains secrets — warn user) ────────────────────────────────
  if [[ -f "$PROJECT_DIR/.env" ]]; then
    cp "$PROJECT_DIR/.env" "$work_dir/dot-env"
    ok ".env saved (WARNING: contains API keys and secrets)"
  else
    warn "No .env file found"
  fi

  # ── Prisma schema ──────────────────────────────────────────────────────
  if [[ -f "$SCHEMA_FILE" ]]; then
    mkdir -p "$work_dir/prisma"
    cp "$SCHEMA_FILE" "$work_dir/prisma/schema.prisma"
    ok "Prisma schema saved"
  fi

  # ── Fonts ──────────────────────────────────────────────────────────────
  copy_dir_if_exists "$FONTS_DIR" "$work_dir/assets-fonts" "Fonts"

  # ── Music ──────────────────────────────────────────────────────────────
  copy_dir_if_exists "$MUSIC_DIR" "$work_dir/public-music" "Music"

  # ── Characters ─────────────────────────────────────────────────────────
  copy_dir_if_exists "$CHARACTERS_DIR" "$work_dir/public-characters" "Characters"

  # ── Metadata ───────────────────────────────────────────────────────────
  cat > "$work_dir/backup-meta.json" <<METAEOF
{
  "app": "NarrateAI",
  "version": "1.1",
  "timestamp": "$TIMESTAMP",
  "database": "$DB_NAME",
  "db_host": "$DB_HOST",
  "includes_videos": $(if $db_only; then echo "false"; else echo "true"; fi),
  "includes_env": $(if [[ -f "$PROJECT_DIR/.env" ]]; then echo "true"; else echo "false"; fi),
  "includes_fonts": $(if [[ -d "$FONTS_DIR" ]]; then echo "true"; else echo "false"; fi),
  "includes_music": $(if [[ -d "$MUSIC_DIR" ]]; then echo "true"; else echo "false"; fi),
  "includes_characters": $(if [[ -d "$CHARACTERS_DIR" ]]; then echo "true"; else echo "false"; fi),
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
    copy_dir_if_exists "$VIDEOS_DIR" "$work_dir/videos" "Videos"
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
  echo "  Contains: DB$(if ! $db_only; then echo " + videos"; fi) + .env + fonts + music + characters + schema"
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
  local auto_yes=false
  [[ "${2:-}" == "--yes" || "${2:-}" == "-y" ]] && auto_yes=true

  if [[ -z "$archive" ]]; then
    err "Usage: $0 restore <backup-file.tar.gz> [--yes]"
    exit 1
  fi

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
    while IFS= read -r line; do echo "    $line"; done < "$work_dir/backup-meta.json"
    echo ""
  fi

  # ── Confirm ────────────────────────────────────────────────────────────
  if ! $auto_yes; then
    echo -e "${YELLOW}  This will OVERWRITE the current database and restore all assets.${NC}"
    echo ""
    read -rp "Continue? (y/N) " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
      info "Restore cancelled."
      exit 0
    fi
  fi

  # ── Restore .env ───────────────────────────────────────────────────────
  if [[ -f "$work_dir/dot-env" ]]; then
    if [[ -f "$PROJECT_DIR/.env" ]]; then
      if ! $auto_yes; then
        read -rp ".env already exists. Overwrite? (y/N) " env_confirm
        if [[ "$env_confirm" == "y" || "$env_confirm" == "Y" ]]; then
          cp "$work_dir/dot-env" "$PROJECT_DIR/.env"
          ok ".env restored"
        else
          info "Kept existing .env"
        fi
      else
        info "Kept existing .env (use manual copy if needed)"
      fi
    else
      cp "$work_dir/dot-env" "$PROJECT_DIR/.env"
      ok ".env restored"
    fi
  fi

  # ── Restore database ──────────────────────────────────────────────────
  if [[ -f "$work_dir/database.sql" ]]; then
    info "Restoring database..."

    PGPASSWORD="$DB_PASS" psql \
      -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "postgres" \
      -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME';" | grep -q 1 || \
    PGPASSWORD="$DB_PASS" psql \
      -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "postgres" \
      -c "CREATE DATABASE $DB_NAME;"

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

  # ── Restore fonts ──────────────────────────────────────────────────────
  if [[ -d "$work_dir/assets-fonts" ]] && [[ "$(ls -A "$work_dir/assets-fonts" 2>/dev/null)" ]]; then
    mkdir -p "$FONTS_DIR"
    cp -r "$work_dir/assets-fonts/"* "$FONTS_DIR/"
    ok "Fonts restored"
  fi

  # ── Restore music ──────────────────────────────────────────────────────
  if [[ -d "$work_dir/public-music" ]] && [[ "$(ls -A "$work_dir/public-music" 2>/dev/null)" ]]; then
    mkdir -p "$MUSIC_DIR"
    cp -r "$work_dir/public-music/"* "$MUSIC_DIR/"
    ok "Music restored"
  fi

  # ── Restore characters ─────────────────────────────────────────────────
  if [[ -d "$work_dir/public-characters" ]] && [[ "$(ls -A "$work_dir/public-characters" 2>/dev/null)" ]]; then
    mkdir -p "$CHARACTERS_DIR"
    cp -r "$work_dir/public-characters/"* "$CHARACTERS_DIR/"
    ok "Characters restored"
  fi

  # ── Restore videos ─────────────────────────────────────────────────────
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

  # ── Restore Prisma schema + push ───────────────────────────────────────
  if [[ -f "$work_dir/prisma/schema.prisma" ]]; then
    mkdir -p "$PROJECT_DIR/prisma"
    cp "$work_dir/prisma/schema.prisma" "$SCHEMA_FILE"
    ok "Prisma schema restored"
  fi

  info "Syncing database schema..."
  cd "$PROJECT_DIR"
  npx prisma db push --accept-data-loss 2>/dev/null && ok "Schema synced" || warn "Schema sync skipped (may already be up to date)"

  echo ""
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Restore complete!${NC}"
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Next steps:"
  echo "    1. Review .env and update API keys if needed"
  echo "    2. Run: pnpm install"
  echo "    3. Run: pnpm dev:all   (or use scripts/setup_prerequisites.sh)"
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
      echo "  $0 backup               Full backup (DB + videos + config + assets)"
      echo "  $0 backup --db-only     Database + config only (no videos)"
      echo "  $0 restore <file>       Restore from a backup archive"
      echo "  $0 restore <file> --yes Skip confirmation prompts"
      echo "  $0 list                 List available backups"
      echo ""
      echo "Included in backup:"
      echo "  - PostgreSQL database dump"
      echo "  - .env (environment config with API keys)"
      echo "  - assets/fonts/ (caption fonts for FFmpeg)"
      echo "  - public/music/ (background music tracks)"
      echo "  - public/characters/ (character preview images)"
      echo "  - public/videos/ (generated videos, unless --db-only)"
      echo "  - prisma/schema.prisma"
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
