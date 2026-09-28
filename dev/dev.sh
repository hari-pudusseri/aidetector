#!/usr/bin/env bash
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$DEV_DIR/.." && pwd)"
LOG_FILE="$DEV_DIR/dev.log"
PID_FILE="$DEV_DIR/dev.pid"

TAIL_PID=""

# Kill leftover preview/workerd processes for this app. `npm run preview`
# spawns npm -> opennext -> wrangler -> workerd; killing only the recorded
# pid can leave an orphaned workerd holding the port.
kill_strays() {
  pkill -f "${APP_DIR}/node_modules/@cloudflare/workerd" 2>/dev/null || true
  pkill -f "${APP_DIR}/node_modules/.bin/opennextjs-cloudflare" 2>/dev/null || true
  pkill -f "${APP_DIR}/node_modules/wrangler" 2>/dev/null || true
  pkill -f "${APP_DIR}/node_modules/next/dist/bin/next" 2>/dev/null || true
  pkill -f "next build" 2>/dev/null || true
}

# Stale Next lock + half-written OpenNext output make preview spin forever.
clear_stale_build_state() {
  rm -f "${APP_DIR}/.next/lock"
  if [[ -d "${APP_DIR}/.open-next" ]] && [[ ! -f "${APP_DIR}/.open-next/worker.js" ]]; then
    echo "Removing incomplete .open-next output..."
    rm -rf "${APP_DIR}/.open-next"
  fi
}

stop_dev() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping preview server (pid $pid)..."
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
      fi
    fi
    rm -f "$PID_FILE"
  fi

  if [[ -n "$TAIL_PID" ]] && kill -0 "$TAIL_PID" 2>/dev/null; then
    kill "$TAIL_PID" 2>/dev/null || true
  fi

  kill_strays
}

stop_dev
sleep 1
clear_stale_build_state

: > "$LOG_FILE"

cd "$APP_DIR"

if [[ ! -f "$APP_DIR/.dev.vars" ]]; then
  echo "Missing .dev.vars. Copy .dev.vars.example and set MUSE_API_KEY." | tee -a "$LOG_FILE"
  exit 1
fi

trap stop_dev EXIT INT TERM

echo "Starting npm run preview (pid file: $PID_FILE, log: $LOG_FILE)..."
set -m
npm run preview >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

tail -f "$LOG_FILE" &
TAIL_PID=$!

wait "$(cat "$PID_FILE")"
