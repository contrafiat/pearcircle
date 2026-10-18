#!/usr/bin/env bash
# Build the PearCircle watch-only desktop for Linux as an AppImage and a .deb
# (proposal 2026-10-18-watch-only-client, slice 5).
#
#   bash watch-desktop/scripts/build-linux.sh [version]
#
#   LINUX_ARCH   x86_64 | arm64   (default x86_64). arm64 is cross-built on an
#                x86_64 host, so it is build-verified only.
#
# Same recipe as the seeder launcher's Linux packaging: a bundled Node runtime
# runs the host, which spawns a bundled bare runtime on a bare-pack'd worklet
# with its native addon prebuilds staged next to it. Downloads (Node,
# appimagetool, the AppImage runtime) are cached in seeder-launcher/dist/cache,
# shared with the seeder build.
#
# Output: watch-desktop/dist/PearCircleWatch-<x86_64|aarch64>.AppImage and
#         watch-desktop/dist/pearcircle-watch_<version>_<amd64|arm64>.deb
set -euo pipefail
cd "$(dirname "$0")/.."
WD=$(pwd)
REPO=$(cd "$WD/.." && pwd)
VERSION="${1:-0.1.0}"
VERSION="${VERSION#v}"
case "${LINUX_ARCH:-x86_64}" in
  x86_64) BARE_HOST=linux-x64; NODE_ARCH=x64; AI_ARCH=x86_64; DEB_ARCH=amd64; STRIP=strip ;;
  arm64)  BARE_HOST=linux-arm64; NODE_ARCH=arm64; AI_ARCH=aarch64; DEB_ARCH=arm64; STRIP=$(command -v llvm-strip || echo aarch64-linux-gnu-strip) ;;
  *) echo "LINUX_ARCH must be x86_64 or arm64" >&2; exit 1 ;;
esac
NODE_VERSION="${NODE_VERSION:-22.20.0}"
CACHE="$REPO/seeder-launcher/dist/cache"
DIST="$WD/dist"
mkdir -p "$CACHE" "$DIST"

[ -x "$REPO/node_modules/.bin/bare-pack" ] || { echo "run npm install in $REPO first" >&2; exit 1; }

echo "=== PearCircle watcher $VERSION (linux $AI_ARCH) ==="

# --- payload: everything the app needs, in one folder ----------------------
. "$WD/scripts/stage-payload.sh"

stage_linux_payload () {
  local out="$1"
  stage_payload "$out" "$BARE_HOST"
  "$STRIP" --strip-all "$out/bare" 2>/dev/null || true

  local node_pkg="node-v${NODE_VERSION}-linux-${NODE_ARCH}"
  if [ ! -x "$CACHE/$node_pkg/bin/node" ]; then
    echo "--> downloading Node $NODE_VERSION"
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${node_pkg}.tar.xz" -o "$CACHE/${node_pkg}.tar.xz"
    tar -xJf "$CACHE/${node_pkg}.tar.xz" -C "$CACHE"
    rm "$CACHE/${node_pkg}.tar.xz"
  fi
  cp "$CACHE/$node_pkg/bin/node" "$out/node"
  chmod +x "$out/node"
  cat > "$out/pearcircle-watch" <<'WRAPPER'
#!/usr/bin/env bash
DIR=$(cd -- "$(dirname -- "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)
exec "$DIR/node" "$DIR/host-bundled.js" "$@"
WRAPPER
  chmod +x "$out/pearcircle-watch"
}

desktop_entry () {
  # $1 = Exec line
  cat <<EOF
[Desktop Entry]
Type=Application
Name=PearCircle Watcher
Comment=See your PearCircle circles on a map from this computer
Exec=$1
Icon=pearcircle-watch
Terminal=false
Categories=Network;Utility;
EOF
}

# --- AppImage ---------------------------------------------------------------
APPIMAGETOOL="$CACHE/appimagetool-x86_64.AppImage"
if [ ! -x "$APPIMAGETOOL" ]; then
  curl -fSL "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage" -o "$APPIMAGETOOL"
  chmod +x "$APPIMAGETOOL"
fi
RUNTIME="$CACHE/runtime-$AI_ARCH"
[ -f "$RUNTIME" ] || curl -fSL "https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-$AI_ARCH" -o "$RUNTIME"

APPDIR="$DIST/AppDir-$AI_ARCH"
stage_linux_payload "$APPDIR/usr/lib/pearcircle-watch"
cat > "$APPDIR/AppRun" <<'APPRUN'
#!/usr/bin/env bash
APPDIR="${APPDIR:-$(dirname "$(readlink -f "$0")")}"
exec "$APPDIR/usr/lib/pearcircle-watch/pearcircle-watch" "$@"
APPRUN
chmod +x "$APPDIR/AppRun"
desktop_entry "pearcircle-watch" > "$APPDIR/pearcircle-watch.desktop"
cp "$REPO/assets/images/icon.png" "$APPDIR/pearcircle-watch.png"
cp "$REPO/assets/images/icon.png" "$APPDIR/.DirIcon"

APPIMAGE="$DIST/PearCircleWatch-$AI_ARCH.AppImage"
rm -f "$APPIMAGE"
echo "--> appimagetool"
ARCH=$AI_ARCH VERSION="$VERSION" "$APPIMAGETOOL" --appimage-extract-and-run --runtime-file "$RUNTIME" "$APPDIR" "$APPIMAGE" >/dev/null 2>&1
chmod +x "$APPIMAGE"
echo "=== built $APPIMAGE ($(du -sh "$APPIMAGE" | cut -f1))"

# --- .deb -------------------------------------------------------------------
if command -v dpkg-deb >/dev/null 2>&1; then
  PKGROOT="$DIST/deb-$DEB_ARCH/pkgroot"
  rm -rf "$DIST/deb-$DEB_ARCH"
  mkdir -p "$PKGROOT/opt" "$PKGROOT/usr/bin" "$PKGROOT/DEBIAN"
  cp -a "$APPDIR/usr/lib/pearcircle-watch" "$PKGROOT/opt/pearcircle-watch"
  ln -s /opt/pearcircle-watch/pearcircle-watch "$PKGROOT/usr/bin/pearcircle-watch"
  mkdir -p "$PKGROOT/usr/share/applications" "$PKGROOT/usr/share/icons/hicolor/256x256/apps"
  desktop_entry "/usr/bin/pearcircle-watch" > "$PKGROOT/usr/share/applications/pearcircle-watch.desktop"
  cp "$REPO/assets/images/icon.png" "$PKGROOT/usr/share/icons/hicolor/256x256/apps/pearcircle-watch.png"
  cat > "$PKGROOT/DEBIAN/control" <<EOF
Package: pearcircle-watch
Version: $VERSION
Architecture: $DEB_ARCH
Maintainer: PeerLoom LLC <noreply@peerloomllc.com>
Installed-Size: $(du -sk "$PKGROOT" | cut -f1)
Section: net
Priority: optional
Homepage: https://peerloomllc.com
Description: PearCircle watch-only desktop
 Shows your PearCircle circles on a map from this computer. It never shares
 a location and is listed to circle members as a watcher they can remove.
EOF
  DEB="$DIST/pearcircle-watch_${VERSION}_${DEB_ARCH}.deb"
  dpkg-deb --build --root-owner-group "$PKGROOT" "$DEB" >/dev/null
  echo "=== built $DEB ($(du -sh "$DEB" | cut -f1))"
else
  echo "dpkg-deb not found, skipping the .deb"
fi
