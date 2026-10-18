#!/usr/bin/env bash
# Build the PearCircle watch-only desktop for Linux x86_64 as an AppImage and a
# .deb (proposal 2026-10-18-watch-only-client, slice 5).
#
#   bash watch-desktop/scripts/build-linux.sh [version]
#
# Same recipe as the seeder launcher's Linux packaging: a bundled Node runtime
# runs the host, which spawns a bundled bare runtime on a bare-pack'd worklet
# with its native addon prebuilds staged next to it. Downloads (Node,
# appimagetool, the AppImage runtime) are cached in seeder-launcher/dist/cache,
# shared with the seeder build.
#
# Output: watch-desktop/dist/PearCircleWatch-x86_64.AppImage and
#         watch-desktop/dist/pearcircle-watch_<version>_amd64.deb
set -euo pipefail
cd "$(dirname "$0")/.."
WD=$(pwd)
REPO=$(cd "$WD/.." && pwd)
VERSION="${1:-0.1.0}"
VERSION="${VERSION#v}"
BARE_HOST=linux-x64
NODE_VERSION="${NODE_VERSION:-22.20.0}"
CACHE="$REPO/seeder-launcher/dist/cache"
DIST="$WD/dist"
mkdir -p "$CACHE" "$DIST"

[ -x "$REPO/node_modules/.bin/bare-pack" ] || { echo "run npm install in $REPO first" >&2; exit 1; }

echo "=== PearCircle watcher $VERSION (linux x86_64) ==="

# --- payload: everything the app needs, in one folder ----------------------
stage_payload () {
  local out="$1"
  rm -rf "$out"
  mkdir -p "$out/worklet" "$out/ui"

  echo "--> ui bundle"
  ( cd "$REPO" && npm run --silent build:ui )
  cp "$REPO/src/ui/index.html" "$out/ui/index.html"
  cp "$REPO/assets/app-ui.bundle" "$out/ui/app-ui.bundle"

  echo "--> host"
  "$REPO/node_modules/.bin/esbuild" "$WD/host.js" --bundle --platform=node --target=node20 --format=cjs \
    --log-level=warning --outfile="$out/host-bundled.js"

  local node_pkg="node-v${NODE_VERSION}-linux-x64"
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

  echo "--> bare runtime"
  local bare_src="$REPO/node_modules/bare-runtime-$BARE_HOST/bin/bare"
  if [ ! -f "$bare_src" ]; then
    local ver
    ver=$(node -p "require('$REPO/node_modules/bare-runtime/package.json').version" 2>/dev/null || true)
    echo "    fetching bare-runtime-$BARE_HOST${ver:+@$ver}"
    local packdir
    packdir=$(mktemp -d)
    ( cd "$packdir" && npm pack --loglevel=error "bare-runtime-$BARE_HOST${ver:+@$ver}" >/dev/null )
    mkdir -p "$REPO/node_modules/bare-runtime-$BARE_HOST"
    tar -xzf "$packdir"/*.tgz -C "$REPO/node_modules/bare-runtime-$BARE_HOST" --strip-components=1
    rm -rf "$packdir"
  fi
  cp "$bare_src" "$out/bare"
  chmod +x "$out/bare"
  if command -v strip >/dev/null 2>&1; then strip --strip-all "$out/bare" 2>/dev/null || cp "$bare_src" "$out/bare"; chmod +x "$out/bare"; fi

  echo "--> worklet bundle"
  "$REPO/node_modules/.bin/bare-pack" --host "$BARE_HOST" \
    --base "$REPO/worklet" --defer fs --defer path \
    "$REPO/src/bare.js" -o "$out/worklet/worklet.bundle"

  echo "--> worklet addon prebuilds"
  local staged=0 d rel
  while read -r d; do
    [ -z "$d" ] && continue
    rel="${d#./}"
    mkdir -p "$out/worklet/node_modules/$(dirname "$rel")"
    cp -R "$REPO/node_modules/$rel" "$out/worklet/node_modules/$(dirname "$rel")/"
    staged=$((staged + 1))
  done < <(cd "$REPO/node_modules" && find . -type d -path "*/prebuilds/$BARE_HOST")
  echo "    staged $staged addon prebuild dirs"
  [ "$staged" -gt 0 ] || { echo "no $BARE_HOST prebuilds found" >&2; exit 1; }
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
RUNTIME="$CACHE/runtime-x86_64"
[ -f "$RUNTIME" ] || curl -fSL "https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64" -o "$RUNTIME"

APPDIR="$DIST/AppDir"
stage_payload "$APPDIR/usr/lib/pearcircle-watch"
cat > "$APPDIR/AppRun" <<'APPRUN'
#!/usr/bin/env bash
APPDIR="${APPDIR:-$(dirname "$(readlink -f "$0")")}"
exec "$APPDIR/usr/lib/pearcircle-watch/pearcircle-watch" "$@"
APPRUN
chmod +x "$APPDIR/AppRun"
desktop_entry "pearcircle-watch" > "$APPDIR/pearcircle-watch.desktop"
cp "$REPO/assets/images/icon.png" "$APPDIR/pearcircle-watch.png"
cp "$REPO/assets/images/icon.png" "$APPDIR/.DirIcon"

APPIMAGE="$DIST/PearCircleWatch-x86_64.AppImage"
rm -f "$APPIMAGE"
echo "--> appimagetool"
ARCH=x86_64 VERSION="$VERSION" "$APPIMAGETOOL" --appimage-extract-and-run --runtime-file "$RUNTIME" "$APPDIR" "$APPIMAGE" >/dev/null 2>&1
chmod +x "$APPIMAGE"
echo "=== built $APPIMAGE ($(du -sh "$APPIMAGE" | cut -f1))"

# --- .deb -------------------------------------------------------------------
if command -v dpkg-deb >/dev/null 2>&1; then
  PKGROOT="$DIST/deb/pkgroot"
  rm -rf "$DIST/deb"
  mkdir -p "$PKGROOT/opt" "$PKGROOT/usr/bin" "$PKGROOT/DEBIAN"
  cp -a "$APPDIR/usr/lib/pearcircle-watch" "$PKGROOT/opt/pearcircle-watch"
  ln -s /opt/pearcircle-watch/pearcircle-watch "$PKGROOT/usr/bin/pearcircle-watch"
  mkdir -p "$PKGROOT/usr/share/applications" "$PKGROOT/usr/share/icons/hicolor/256x256/apps"
  desktop_entry "/usr/bin/pearcircle-watch" > "$PKGROOT/usr/share/applications/pearcircle-watch.desktop"
  cp "$REPO/assets/images/icon.png" "$PKGROOT/usr/share/icons/hicolor/256x256/apps/pearcircle-watch.png"
  cat > "$PKGROOT/DEBIAN/control" <<EOF
Package: pearcircle-watch
Version: $VERSION
Architecture: amd64
Maintainer: PeerLoom LLC <noreply@peerloomllc.com>
Installed-Size: $(du -sk "$PKGROOT" | cut -f1)
Section: net
Priority: optional
Homepage: https://peerloomllc.com
Description: PearCircle watch-only desktop
 Shows your PearCircle circles on a map from this computer. It never shares
 a location and is listed to circle members as a watcher they can remove.
EOF
  DEB="$DIST/pearcircle-watch_${VERSION}_amd64.deb"
  dpkg-deb --build --root-owner-group "$PKGROOT" "$DEB" >/dev/null
  echo "=== built $DEB ($(du -sh "$DEB" | cut -f1))"
else
  echo "dpkg-deb not found, skipping the .deb"
fi
