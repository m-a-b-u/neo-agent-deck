#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -t 0 || ! -t 1 ]]; then
  echo "Run ./install.sh in an interactive terminal so the setup UI can guide you." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 22.13+ (Node 22) or Node.js 24+ is required: https://nodejs.org/" >&2
  exit 1
fi

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); const ok = (major === 22 && minor >= 13) || major >= 24; if (!ok) { console.error(`Node.js 22.13+ or 24+ is required (the 23.x line is unsupported); found ${process.version}`); process.exit(1); }'

echo "Installing setup dependencies..."
npm ci

echo
echo "Opening the guided Neo Agent Deck setup..."
npm run setup

case "$(uname -s)" in
  Darwin) npm run install:mac ;;
  Linux) npm run install:linux ;;
  *) echo "Use install.ps1 on Windows." >&2; exit 1 ;;
esac

echo
echo "Setup complete. Connect the Neo whenever you are ready."
