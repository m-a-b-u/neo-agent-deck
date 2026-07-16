#!/bin/bash
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/com.neo-agent-deck.plist"
APP_DIR="$HOME/.local/share/neo-agent-deck"

launchctl bootout "gui/$UID/com.neo-agent-deck" 2>/dev/null || true
rm -f "$PLIST"
rm -rf "$APP_DIR"

echo "Neo Agent Deck has been removed. Preferences and logs were kept."
echo "You can reopen the Elgato Stream Deck app to return control to it."
