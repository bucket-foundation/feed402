#!/usr/bin/env bash
# feed402 — end-to-end demo
#
# Boots the reference server, runs the reference agent, shows the receipt,
# shuts the server down.
#
# Prereqs: node >= 20, npm install has been run once.
# Usage: ./demo.sh

set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8787}"
export FEED402_BASE_URL="http://localhost:${PORT}"

if [ ! -d node_modules ]; then
  echo "→ installing dependencies (first run only)…"
  npm install --silent
fi

echo "→ booting reference provider on :${PORT}"
npm run dev -- --silent &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

# Wait for the manifest to come up
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "${FEED402_BASE_URL}/.well-known/feed402.json" > /dev/null; then
    break
  fi
  sleep 0.3
done

echo
echo "→ running reference agent"
echo "-------------------------------------------"
npm run agent --silent
echo "-------------------------------------------"
echo "✓ demo complete"
