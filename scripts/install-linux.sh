#!/usr/bin/env bash
set -euo pipefail

NO_START=false
NO_UDEV=false
for argument in "$@"; do
  case "$argument" in
    --no-start) NO_START=true ;;
    --no-udev) NO_UDEV=true ;;
    *) echo "Unknown option: $argument" >&2; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This installer must run on Linux." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="${NEO_AGENT_DECK_INSTALL_ROOT:-$HOME/.local/share/neo-agent-deck}"
UNIT_DIR="${NEO_AGENT_DECK_UNIT_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user}"
UNIT_FILE="$UNIT_DIR/neo-agent-deck.service"
NODE_BIN="$(command -v node)"
STAGE="${APP_DIR}.next.$$"

run_as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "sudo is required once for Linux USB support." >&2
    exit 1
  fi
}

cleanup() {
  rm -rf "$STAGE"
}
trap cleanup EXIT

if [[ "$NO_START" == false ]]; then
  if ! command -v systemctl >/dev/null 2>&1 || ! systemctl --user show-environment >/dev/null 2>&1; then
    echo "A running systemd user session is required. Log into the Linux desktop and retry." >&2
    exit 1
  fi
  systemctl --user stop neo-agent-deck.service 2>/dev/null || true
fi

cd "$ROOT"
npm run build

rm -rf "$STAGE"
mkdir -p "$STAGE"
tar \
  --exclude='./node_modules' \
  --exclude='./.git' \
  --exclude='./test' \
  --exclude='./coverage' \
  -cf - . | tar -xf - -C "$STAGE"

cd "$STAGE"
npm ci --omit=dev --ignore-scripts=false

if ! node -e "require('node-hid').devices()" >/dev/null 2>&1; then
  echo "Installing missing Linux HID runtime libraries (one sudo prompt may appear)..."
  source /etc/os-release 2>/dev/null || true
  distribution="${ID_LIKE:-} ${ID:-}"
  if [[ "$distribution" == *debian* || "$distribution" == *ubuntu* ]]; then
    run_as_root apt-get update
    run_as_root apt-get install -y libusb-1.0-0 libudev1
  elif [[ "$distribution" == *fedora* || "$distribution" == *rhel* ]]; then
    run_as_root dnf install -y libusb1 systemd-libs
  elif [[ "$distribution" == *arch* ]]; then
    run_as_root pacman -Sy --needed --noconfirm libusb systemd-libs
  elif [[ "$distribution" == *suse* ]]; then
    run_as_root zypper --non-interactive install libusb-1_0-0 systemd
  else
    echo "Install the libusb and libudev runtime packages for this distribution, then retry." >&2
    exit 1
  fi
  node -e "require('node-hid').devices()" >/dev/null
fi

mkdir -p "$(dirname "$APP_DIR")"
rm -rf "$APP_DIR"
mv "$STAGE" "$APP_DIR"

if [[ "$NO_UDEV" == false ]]; then
  RULE_SOURCE="$APP_DIR/node_modules/@elgato-stream-deck/node/udev/50-elgato-stream-deck-user.rules"
  RULE_TARGET="/etc/udev/rules.d/50-elgato-stream-deck-user.rules"

  if ! cmp -s "$RULE_SOURCE" "$RULE_TARGET" 2>/dev/null; then
    echo "Installing the Stream Deck USB permission rule (one sudo prompt may appear)..."
    run_as_root install -m 0644 "$RULE_SOURCE" "$RULE_TARGET"
    run_as_root udevadm control --reload-rules
    run_as_root udevadm trigger --subsystem-match=hidraw
  fi
fi

systemd_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//%/%%}"
  printf '%s' "$value"
}

mkdir -p "$UNIT_DIR"
NODE_UNIT="$(systemd_escape "$NODE_BIN")"
APP_UNIT="$(systemd_escape "$APP_DIR")"
HOME_UNIT="$(systemd_escape "$HOME")"
PATH_UNIT="$(systemd_escape "$PATH")"

{
  echo '[Unit]'
  echo 'Description=Neo Agent Deck'
  echo 'After=graphical-session.target'
  echo
  echo '[Service]'
  echo 'Type=simple'
  echo "ExecStart=\"$NODE_UNIT\" \"$APP_UNIT/dist/src/index.js\""
  echo "WorkingDirectory=$APP_UNIT"
  echo 'Restart=always'
  echo 'RestartSec=5'
  echo "Environment=\"HOME=$HOME_UNIT\""
  echo "Environment=\"PATH=$PATH_UNIT\""
  for name in CLAUDE_CONFIG_DIR CODEX_HOME OPENCODE_DATA_HOME NEO_AGENT_DECK_HOME; do
    value="${!name:-}"
    if [[ -n "$value" ]]; then
      echo "Environment=\"$name=$(systemd_escape "$value")\""
    fi
  done
  echo
  echo '[Install]'
  echo 'WantedBy=default.target'
} > "$UNIT_FILE"

if [[ "$NO_START" == false ]]; then
  systemctl --user daemon-reload
  systemctl --user enable --now neo-agent-deck.service
  sleep 2
  if ! systemctl --user is-active --quiet neo-agent-deck.service; then
    journalctl --user -u neo-agent-deck.service -n 40 --no-pager >&2 || true
    exit 1
  fi
fi

echo "Neo Agent Deck installed for the current Linux user."
echo "Service: $UNIT_FILE"
echo "Logs: journalctl --user -u neo-agent-deck.service -f"
if [[ "$NO_UDEV" == false ]]; then
  echo "If the Neo was already connected, unplug and reconnect it once."
fi
