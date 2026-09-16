#!/usr/bin/env bash
set -euo pipefail

# Turbopack currently walks the local Python virtual environment even though
# it is excluded from the deployed server. A normal venv contains interpreter
# symlinks outside the repository, which makes Turbopack panic before it can
# build the web app. Keep the venv outside the project only while Next builds,
# and restore it on success, failure, or interruption.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$ROOT/ml-service/venv.nosync"
HOLD_DIR=""

restore_venv() {
  if [ -n "$HOLD_DIR" ] && { [ -e "$HOLD_DIR/venv.nosync" ] || [ -L "$HOLD_DIR/venv.nosync" ]; }; then
    mv "$HOLD_DIR/venv.nosync" "$VENV_DIR"
    rmdir "$HOLD_DIR" 2>/dev/null || true
  fi
}

trap restore_venv EXIT HUP INT TERM

if [ -e "$VENV_DIR" ] || [ -L "$VENV_DIR" ]; then
  HOLD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mongolz-next-build.XXXXXX")"
  mv "$VENV_DIR" "$HOLD_DIR/venv.nosync"
fi

cd "$ROOT"
next build "$@"
