#!/bin/bash
# Keeps a running install current: pulls code, applies any schema change,
# and registers competition/newsletter candidates that the cloud research
# routine pushed as prisma/pending-*.json. Restarts the worker only if the
# code actually changed.
#
# This does NOT run any automation — the worker (src/worker/index.ts) owns
# every recurring pass. Keeping the two separate is the point: the worker
# should stay up for weeks, and pulling code shouldn't mean an entry pass
# is skipped or run twice.
#
# Deliberately not `set -e` past setup: one failing stage (a network blip
# during git pull) must not stop the ones after it. Exit status is the
# worst of them so systemd still records a failure.
set -uo pipefail
cd "$(dirname "$0")/.."

LOG_DIR="data"
LOG_FILE="${LOG_DIR}/update.log"
mkdir -p "$LOG_DIR"
if [ -f "$LOG_FILE" ] && [ "$(stat -c %s "$LOG_FILE")" -gt $((5 * 1024 * 1024)) ]; then
  mv -f "$LOG_FILE" "${LOG_FILE}.1"
fi
exec > >(tee -a "$LOG_FILE") 2>&1

echo
echo "######## update started $(date -Is) ########"

worst=0
stage() {
  local name="$1"; shift
  echo "=== ${name} ==="
  if "$@"; then
    echo "--- ${name}: ok"
  else
    echo "--- ${name}: FAILED (exit $?)" >&2
    worst=1
  fi
}

BEFORE="$(git rev-parse HEAD)"
# A local commit or dirty tree makes --ff-only fail; that's fine and must
# not abort the update.
stage "git pull" git pull --ff-only
AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" != "$AFTER" ]; then
  stage "npm install" npm install --no-audit --no-fund
  stage "prisma generate" npm run db:generate
fi

stage "db push" npm run db:push
stage "sync competitions" npm run sync:competitions
stage "sync newsletters" npm run sync:newsletters

if [ "$BEFORE" != "$AFTER" ]; then
  echo "=== restarting worker (code changed ${BEFORE:0:7} -> ${AFTER:0:7}) ==="
  systemctl --user restart comps-worker.service 2>/dev/null \
    || sudo systemctl restart "comps-worker@$(whoami).service" 2>/dev/null \
    || echo "--- could not restart the worker automatically; restart it yourself" >&2
fi

echo "######## update finished $(date -Is), status ${worst} ########"
exit "$worst"
