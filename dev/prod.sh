#!/usr/bin/env bash
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$DEV_DIR/.." && pwd)"
LOG_FILE="$DEV_DIR/prod.log"

: > "$LOG_FILE"

cd "$APP_DIR"

echo "=== git add $(date -u +"%Y-%m-%dT%H:%M:%SZ") ===" | tee -a "$LOG_FILE"
git add -A 2>&1 | tee -a "$LOG_FILE"

if ! git diff --cached --quiet; then
  read -r -p "Commit message: " commit_msg
  if [[ -z "${commit_msg// /}" ]]; then
    echo "Commit message is required." | tee -a "$LOG_FILE"
    exit 1
  fi
  echo "=== git commit $(date -u +"%Y-%m-%dT%H:%M:%SZ") ===" | tee -a "$LOG_FILE"
  git commit -m "$commit_msg" 2>&1 | tee -a "$LOG_FILE"
else
  echo "No changes to commit." | tee -a "$LOG_FILE"
fi

{
  echo "=== git push $(date -u +"%Y-%m-%dT%H:%M:%SZ") ==="
  git push
  echo ""
  echo "=== npm run deploy $(date -u +"%Y-%m-%dT%H:%M:%SZ") ==="
  npm run deploy
} 2>&1 | tee -a "$LOG_FILE"
