#!/bin/bash
# One full cycle of the service: find new competitions, enter what's due,
# subscribe to any pending newsletters, tidy up. Run on a schedule via
# systemd — see ~/.config/systemd/user/comps-run-entries.timer.
#
# Deliberately NOT `set -e` past the setup phase: this is meant to run
# unattended forever, and one failing stage (a site down, a network blip
# during git pull) must not stop the later stages from running. Each stage
# reports its own exit status instead, and the cycle's exit status is the
# worst of them so systemd still records a failure.
set -uo pipefail
cd "$(dirname "$0")/.."

# This machine's user journal retains nothing (journalctl --user reports
# "No journal files were found"), so the cycle keeps its own log instead —
# otherwise everything outside the runner's own DB-backed logging, like a
# failed git pull or npm install, would be lost. Rotated by size, single
# generation: enough to see what the last few cycles did.
LOG_DIR="data"
LOG_FILE="${LOG_DIR}/cycle.log"
mkdir -p "$LOG_DIR"
if [ -f "$LOG_FILE" ] && [ "$(stat -c %s "$LOG_FILE")" -gt $((5 * 1024 * 1024)) ]; then
  mv -f "$LOG_FILE" "${LOG_FILE}.1"
fi
exec > >(tee -a "$LOG_FILE") 2>&1

echo
echo "######## cycle started $(date -Is) ########"

worst=0

stage() {
  local name="$1"; shift
  echo "=== ${name} ==="
  if "$@"; then
    echo "--- ${name}: ok"
  else
    local code=$?
    echo "--- ${name}: FAILED (exit ${code})" >&2
    worst=1
  fi
}

# A local commit (or a dirty tree) makes --ff-only fail; that's fine and
# must not abort the cycle, so this is a stage like any other.
stage "git pull" git pull --ff-only

# Only reinstall when the lockfile actually changed — this runs hourly on a
# Raspberry Pi, and an unconditional `npm install` was most of the cycle's
# wall time and SD-card writes.
LOCK_STAMP=".npm-install-stamp"
if [ ! -f "$LOCK_STAMP" ] || [ package-lock.json -nt "$LOCK_STAMP" ]; then
  stage "npm install" npm install --no-audit --no-fund
  touch "$LOCK_STAMP"
else
  echo "=== npm install === (skipped, lockfile unchanged)"
fi

stage "db push" npm run db:push
# Candidates pushed by the cloud research routine, if any.
stage "sync competitions" npm run sync:competitions
stage "sync newsletters" npm run sync:newsletters
# Candidates this machine finds for itself, from platforms we already have
# a working adapter for.
stage "discover competitions" npm run discover:competitions
stage "enter competitions" npm run run:entries
stage "subscribe newsletters" npm run subscribe:newsletters
stage "prune" npm run prune

echo "######## cycle finished $(date -Is), status ${worst} ########"
exit "$worst"
