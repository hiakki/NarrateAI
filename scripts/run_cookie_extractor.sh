#!/usr/bin/env bash
set -euo pipefail

# Helper wrapper to launch the interactive cookie extractor under xvfb-run on headless servers.
# Usage examples:
#   ./scripts/run_cookie_extractor.sh facebook
#   ./scripts/run_cookie_extractor.sh instagram
#   ./scripts/run_cookie_extractor.sh both
# Defaults to "both" when no argument is supplied.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COOKIE_FILE="$PROJECT_DIR/data/ytdlp-cookies.txt"

PLATFORM="${1:-both}"
case "$PLATFORM" in
  facebook|instagram|both) ;;
  *)
    echo "Unknown platform '$PLATFORM'. Use facebook | instagram | both." >&2
    exit 1
    ;;
esac

cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NarrateAI Cookie Extractor
Target platform: $PLATFORM
Output cookie file: $COOKIE_FILE

Steps:
  1. A Chrome window will launch. Sign in to the selected platform(s).
  2. Complete any 2FA / checkpoint prompts, then wait for the script to confirm cookies were saved.
  3. Download the cookie file to your workstation and upload it inside NarrateAI (Settings → Content Discovery Access).

Tip: If you're running on a machine with a graphical desktop or via SSH with X11 forwarding, the Chrome window will appear on your screen.
     On headless servers this helper uses Xvfb. If you need to interact with the browser visibly, rerun the extractor on a local machine and copy the resulting file back to the server.
EOF

declare -a run_cmd
if [[ -n "${DISPLAY:-}" ]]; then
  echo "DISPLAY detected ($DISPLAY) — launching Chrome directly so the window is visible."
  run_cmd=(pnpm tsx scripts/cookie-extract.ts "$PLATFORM")
else
  if ! command -v xvfb-run >/dev/null 2>&1; then
    echo "xvfb-run not found. Install Xvfb or rerun ./scripts/setup_prerequisites.sh --base" >&2
    exit 1
  fi
  echo "No DISPLAY detected — running the extractor inside Xvfb (headless)."
  run_cmd=(xvfb-run -s "-screen 0 1280x720x24" pnpm tsx scripts/cookie-extract.ts "$PLATFORM")
fi

cd "$PROJECT_DIR"

set +e
"${run_cmd[@]}"
status=$?
set -e

if [[ $status -eq 0 ]]; then
  if [[ -f "$COOKIE_FILE" ]]; then
    echo ""
    echo "✅ Cookies saved to: $COOKIE_FILE"
    echo "Copy the file to your local machine, for example:"
    echo "  scp user@server:$COOKIE_FILE ./ytdlp-cookies.txt"
    echo ""
    echo "Then in the NarrateAI web app: Settings → Content Discovery Access → Upload Cookie File."
    echo "Upload the downloaded ytdlp-cookies.txt to finish setup."
  else
    echo "Extractor completed but the cookie file was not found at $COOKIE_FILE. Check the extractor logs for details."
  fi
else
  echo "Cookie extractor exited with status $status."
  exit $status
fi
