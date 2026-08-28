#!/usr/bin/env bash
# Installs comps as *user* systemd units — no sudo, no system-level
# services. Use this when the repo already lives in the account that
# should run it (deploy/install-pi.sh is the from-scratch, system-level
# path that also installs Chromium and OS deps).
#
# Run from the repo root: bash deploy/install-user-systemd.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"

if [ "$REPO_DIR" != "$HOME/comps" ]; then
  echo "Expected the repo at \$HOME/comps (the units use %h/comps) but it's at $REPO_DIR." >&2
  exit 1
fi

mkdir -p "$UNIT_DIR"
cp "$REPO_DIR"/deploy/systemd/user/*.service "$REPO_DIR"/deploy/systemd/user/*.timer "$UNIT_DIR/"
systemctl --user daemon-reload
systemctl --user enable --now comps-worker.service
systemctl --user enable --now comps-update.timer

# Let the worker keep running when nobody is logged in. Needs one sudo,
# and is the difference between a service that survives logout and one
# that doesn't.
if ! loginctl show-user "$(whoami)" -p Linger --value 2>/dev/null | grep -q yes; then
  echo "==> Enabling linger so the worker survives logout (needs sudo)"
  sudo loginctl enable-linger "$(whoami)" || \
    echo "Could not enable linger — run: sudo loginctl enable-linger $(whoami)" >&2
fi

echo
echo "Installed. Useful commands:"
echo "  systemctl --user status comps-worker"
echo "  journalctl --user -u comps-worker -f   # if the user journal is enabled"
echo "  tail -f $REPO_DIR/data/update.log"
