#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$HOME/.local/share/neo-agent-deck"
PLIST="$HOME/Library/LaunchAgents/com.neo-agent-deck.plist"
NODE_BIN="$(command -v node)"

cd "$ROOT"
npm run build

mkdir -p "$APP_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
rsync -a --delete --exclude node_modules --exclude .git --exclude test --exclude coverage "$ROOT/" "$APP_DIR/"
cd "$APP_DIR"
npm ci --omit=dev --ignore-scripts=false

pkill -x "Stream Deck" 2>/dev/null || true
launchctl bootout "gui/$UID/com.neo-agent-deck" 2>/dev/null || true
rm -f "$HOME/Library/Logs/NeoAgentDeck.log" "$HOME/Library/Logs/NeoAgentDeck.error.log"

rm -f "$PLIST"
plutil -create xml1 "$PLIST"
/usr/libexec/PlistBuddy -c "Add :Label string com.neo-agent-deck" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :ProgramArguments array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :ProgramArguments:0 string $NODE_BIN" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :ProgramArguments:1 string $APP_DIR/dist/src/index.js" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :RunAtLoad bool true" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :KeepAlive bool true" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :ProcessType string Interactive" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :StandardOutPath string $HOME/Library/Logs/NeoAgentDeck.log" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :StandardErrorPath string $HOME/Library/Logs/NeoAgentDeck.error.log" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables dict" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:HOME string $HOME" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:PATH string /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" "$PLIST"

plutil -lint "$PLIST"
if ! launchctl bootstrap "gui/$UID" "$PLIST" 2>/dev/null; then
  sleep 1
  launchctl bootstrap "gui/$UID" "$PLIST"
fi
launchctl kickstart -k "gui/$UID/com.neo-agent-deck"

sleep 2
service_state="$(launchctl print "gui/$UID/com.neo-agent-deck" 2>/dev/null || true)"
if ! printf '%s' "$service_state" | grep -q "state = running"; then
  echo "Neo Agent Deck did not stay running. Recent errors:" >&2
  tail -n 40 "$HOME/Library/Logs/NeoAgentDeck.error.log" 2>/dev/null >&2 || true
  exit 1
fi

echo "Neo Agent Deck installed and started."
echo "Logs: $HOME/Library/Logs/NeoAgentDeck.log"
