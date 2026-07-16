#!/usr/bin/env bash
set -euo pipefail

NO_STOP=false
for argument in "$@"; do
  case "$argument" in
    --no-stop) NO_STOP=true ;;
    *) echo "Unknown option: $argument" >&2; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This uninstaller must run on Linux." >&2
  exit 1
fi

APP_DIR="${NEO_AGENT_DECK_INSTALL_ROOT:-$HOME/.local/share/neo-agent-deck}"
UNIT_DIR="${NEO_AGENT_DECK_UNIT_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user}"
UNIT_FILE="$UNIT_DIR/neo-agent-deck.service"

if [[ "$NO_STOP" == false ]] && command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now neo-agent-deck.service 2>/dev/null || true
fi

rm -f "$UNIT_FILE"
rm -rf "$APP_DIR"

if [[ "$NO_STOP" == false ]] && command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload 2>/dev/null || true
fi

echo "Neo Agent Deck has been removed from the Linux user service."
echo "Preferences and the shared Stream Deck udev rule were kept."
