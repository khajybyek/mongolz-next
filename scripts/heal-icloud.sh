#!/usr/bin/env bash
# Heal iCloud Drive damage to local node_modules / .next / venv.
#
# Why this exists
# ---------------
# This repo lives under ~/Desktop which (by default) is synced to
# iCloud Drive. When iCloud sees two files with the same name in
# different "places" — common with npm linking + hard-links — it
# silently creates "Filename 2.ext" duplicates. That leaves
# node_modules in a state where `next`, `tsc`, and `jest` randomly
# can't be found.
#
# The macOS-documented fix is to put the offending directory at a
# path ending in `.nosync` — the iCloud file provider treats that
# suffix as "don't touch". We mirror it under the normal name with
# a symlink so npm / Next.js / tools find everything as usual.
#
# Idempotent — re-run after any npm install that clobbers the symlink.
# Wired as `postinstall` in package.json so a fresh `npm install`
# self-heals; CI (Vercel/Railway) is Linux and short-circuits below.

set -euo pipefail

# Guard: iCloud Drive only exists on macOS. On Linux build agents
# (Vercel, Railway) this script no-ops so postinstall stays a tax-free
# default. Without the guard we'd be renaming node_modules in CI for
# no benefit — and a symlinked node_modules trips some buildpacks.
if [ "$(uname -s)" != "Darwin" ]; then
  echo "heal:icloud: $(uname -s) host, skipping (macOS-only)"
  exit 0
fi

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

reroute() {
  local dir="$1"
  local nosync="${dir}.nosync"

  if [ -L "$dir" ]; then
    echo "✓ $dir already a symlink — nothing to do"
    return
  fi

  if [ -d "$dir" ] && [ ! -d "$nosync" ]; then
    echo "→ moving $dir → $nosync"
    mv "$dir" "$nosync"
  elif [ -d "$dir" ] && [ -d "$nosync" ]; then
    echo "! $dir and $nosync both exist — merging $dir into $nosync"
    rsync -a --remove-source-files "$dir/" "$nosync/" 2>/dev/null || cp -R "$dir/" "$nosync/"
    rm -rf "$dir"
  elif [ ! -d "$nosync" ]; then
    echo "→ creating empty $nosync"
    mkdir -p "$nosync"
  fi

  ln -snf "$(basename "$nosync")" "$dir"
  echo "✓ $dir → $(readlink "$dir")"
}

echo "Healing $ROOT …"
reroute "node_modules"
reroute ".next"

if [ -d "ml-service" ]; then
  cd ml-service
  reroute "venv"
  cd "$ROOT"
fi

echo ""
echo "Done. Re-run anytime npm install clobbers a symlink."
