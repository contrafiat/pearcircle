#!/usr/bin/env bash
# Build the PearCircle watch-only desktop for Windows x64 as an NSIS installer
# (proposal 2026-10-18-watch-only-client).
#
#   bash watch-desktop/scripts/build-windows.sh [version]
#
# A cross-build that runs on Linux, like the seeder's build-windows-local.sh:
# node.exe comes from nodejs.org, bare.exe from the bare-runtime-win32-x64 npm
# package, the worklet is packed with `bare-pack --host win32-x64` and only
# makensis compiles anything (Fedora: dnf install mingw32-nsis).
#
# Output: watch-desktop/dist/PearCircleWatcher-Setup-<version>.exe
set -euo pipefail
cd "$(dirname "$0")/.."
WD=$(pwd)
REPO=$(cd "$WD/.." && pwd)
VERSION="${1:-0.1.0}"
VERSION="${VERSION#v}"
BARE_HOST=win32-x64
NODE_VERSION="${NODE_VERSION:-22.20.0}"
CACHE="$REPO/seeder-launcher/dist/cache"
DIST="$WD/dist"
mkdir -p "$CACHE" "$DIST"

[ -x "$REPO/node_modules/.bin/bare-pack" ] || { echo "run npm install in $REPO first" >&2; exit 1; }
command -v makensis >/dev/null || { echo "makensis not found (Fedora: dnf install mingw32-nsis)" >&2; exit 1; }

echo "=== PearCircle watcher $VERSION (windows x64) ==="

STAGE="$DIST/windows"
PAYLOAD="$STAGE/payload"
mkdir -p "$STAGE"

. "$WD/scripts/stage-payload.sh"
stage_payload "$PAYLOAD" "$BARE_HOST"

NODE_PKG="node-v${NODE_VERSION}-win-x64"
if [ ! -f "$CACHE/$NODE_PKG/node.exe" ]; then
  echo "--> downloading Node $NODE_VERSION (win-x64)"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_PKG}.zip" -o "$CACHE/$NODE_PKG.zip"
  if command -v unzip >/dev/null; then unzip -q -o "$CACHE/$NODE_PKG.zip" -d "$CACHE"
  else bsdtar -xf "$CACHE/$NODE_PKG.zip" -C "$CACHE"; fi
  rm -f "$CACHE/$NODE_PKG.zip"
fi
cp "$CACHE/$NODE_PKG/node.exe" "$PAYLOAD/node.exe"

cp "$WD/installer/windows/launch.vbs" "$WD/installer/windows/stop.ps1" "$PAYLOAD/"
cp "$WD/installer/windows/AppIcon.ico" "$PAYLOAD/AppIcon.ico"
cp "$WD/installer/windows/installer.nsi" "$STAGE/installer.nsi"

echo "--> makensis"
( cd "$STAGE" && makensis -V2 "-DVERSION=$VERSION" installer.nsi )
OUT="$DIST/PearCircleWatcher-Setup-${VERSION}.exe"
mv -f "$STAGE/PearCircleWatcher-Setup-${VERSION}.exe" "$OUT"
echo "=== built $OUT ($(du -sh "$OUT" | cut -f1))"
