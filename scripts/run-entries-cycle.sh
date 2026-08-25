#!/bin/bash
# Pulls whatever the cloud research routine has pushed (new adapters +
# pending-competitions.json), registers any new competitions it found,
# then runs the real entry job. Run on a schedule via systemd — see
# ~/.config/systemd/user/comps-run-entries.service.
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only

npm install --no-audit --no-fund
npm run db:push
npm run sync:competitions
npm run run:entries
