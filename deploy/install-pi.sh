#!/usr/bin/env bash
# One-time setup for running comps unattended on a Raspberry Pi (Raspberry
# Pi OS / Debian). Run as the user that should own the service, from the
# repo root: bash deploy/install-pi.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_USER="$(whoami)"

if [ "$REPO_DIR" != "/home/$SERVICE_USER/comps" ]; then
  echo "Warning: expected the repo at /home/$SERVICE_USER/comps (the systemd" >&2
  echo "unit files hardcode that path) but it's at $REPO_DIR." >&2
  echo "Either move the repo there, or edit deploy/systemd/*.service before installing." >&2
fi

echo "==> Installing Node dependencies"
cd "$REPO_DIR"
npm ci

echo "==> Installing Chromium + OS deps for Playwright (needs sudo)"
sudo npx playwright install-deps chromium
npx playwright install chromium

if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example — edit DATABASE_URL/intervals as needed"
  cp .env.example .env
fi

echo "==> Setting up the database"
npm run db:push
npm run db:seed

echo "==> Building the dashboard"
npm run build

echo "==> Installing systemd services (needs sudo)"
sudo cp deploy/systemd/comps-worker@.service deploy/systemd/comps-web@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now "comps-worker@${SERVICE_USER}.service"
sudo systemctl enable --now "comps-web@${SERVICE_USER}.service"

echo
echo "Done. Dashboard: http://<pi-hostname-or-ip>:3000"
echo "Worker logs:    journalctl -u comps-worker@${SERVICE_USER} -f"
echo "Web logs:       journalctl -u comps-web@${SERVICE_USER} -f"
