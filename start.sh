#!/usr/bin/env bash
# Project Tracker - macOS / Linux start script.  Run: ./start.sh
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version (22.13 or newer) from https://nodejs.org and run this again."
  exit 1
fi
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" || {
  echo "Your Node.js version ($(node -v)) is too old. Install Node.js 22.13 or newer from https://nodejs.org"
  exit 1
}

if [ ! -d node_modules ]; then
  echo "Installing components for the first time. This takes a minute..."
  npm install --no-audit --no-fund
fi
if [ ! -f client/dist/index.html ]; then
  echo "Building the web interface..."
  npm run build
fi
exec npm start
