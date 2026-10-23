#!/usr/bin/env bash
# Update Project Tracker to the latest version on GitHub, then start it.
# Your "data" folder (projects, users, files, backups) is never touched.
set -e
cd "$(dirname "$0")"
APP="$(pwd)"
PORT="${PORT:-4000}"
ZIPURL="https://github.com/Bluemonk123/project-tracker/archive/refs/heads/main.zip"

echo
echo "  Updating Project Tracker in $APP"
echo

if curl -s -o /dev/null -m 3 "http://localhost:$PORT/api/setup-status"; then
  echo "  The app is still running. Stop it first (Ctrl + C in its window, or close that window),"
  echo "  then run the update again."
  echo
  exit 1
fi

if [ -f data/tracker.db ]; then
  echo "  Backing up your data to data/backups/before-update ..."
  mkdir -p data/backups/before-update
  cp -f data/tracker.db* data/backups/before-update/ 2>/dev/null || true
fi

if [ -d .git ] && command -v git >/dev/null 2>&1; then
  echo "  Downloading the latest version..."
  git fetch --quiet origin main
  # data/ and node_modules/ are not tracked by git, so this only replaces program files
  git reset --quiet --hard origin/main
else
  echo "  Downloading the latest version (ZIP)..."
  WORK="$(mktemp -d)"
  curl -sSL -o "$WORK/latest.zip" "$ZIPURL"
  unzip -q "$WORK/latest.zip" -d "$WORK"
  rsync -a --exclude data --exclude node_modules --exclude .git "$WORK/project-tracker-main/" "$APP/"
  rm -rf "$WORK"
fi
chmod +x start.sh update.sh start.command update.command 2>/dev/null || true

echo "  Updated. Starting Project Tracker; it rebuilds itself if anything changed."
echo
exec ./start.sh
