#!/usr/bin/env bash
# Build the PearCircle watch-only desktop for macOS as a signed, notarized
# .dmg holding "PearCircle Watcher.app" (proposal 2026-10-18-watch-only-client).
#
#   bash watch-desktop/scripts/build-macos.sh [version]
#
# The payload is staged on this machine (bare-pack cross-packs, the runtime
# comes from npm pack, Node from nodejs.org). The Mac mini then compiles the
# launcher stub, makes the icon, signs everything, builds the .dmg and
# notarizes it, the same way the seeder's build-macos-remote.sh drives it.
#
# Env:
#   MAC_ARCH         arm64 | x64   (default arm64)
#   MAC_MINI_HOST    ssh target (default Tims-Mac-mini.local)
#   APP_SIGN_ID      default: the Developer ID Application identity in the
#                    Mac's buildkey keychain. "-" signs ad hoc and skips
#                    notarization.
#   NOTARY_PROFILE   default pearcircle-seeder-notary
#   SKIP_NOTARIZE=1  sign but do not notarize
#
# Output: watch-desktop/dist/PearCircleWatcher-<version>-<arm64|x64>.dmg
set -euo pipefail
cd "$(dirname "$0")/.."
WD=$(pwd)
REPO=$(cd "$WD/.." && pwd)
VERSION="${1:-0.1.0}"
VERSION="${VERSION#v}"
MAC_ARCH="${MAC_ARCH:-arm64}"
case "$MAC_ARCH" in
  arm64) CLANG_ARCH=arm64 ;;
  x64) CLANG_ARCH=x86_64 ;;
  *) echo "MAC_ARCH must be arm64 or x64" >&2; exit 1 ;;
esac
BARE_HOST="darwin-$MAC_ARCH"
NODE_VERSION="${NODE_VERSION:-22.20.0}"
MAC_HOST="${MAC_MINI_HOST:-Tims-Mac-mini.local}"
CACHE="$REPO/seeder-launcher/dist/cache"
DIST="$WD/dist"
STAGE="$DIST/macos-$MAC_ARCH"
APP="$STAGE/PearCircle Watcher.app"
DMG_NAME="PearCircleWatcher-${VERSION}-${MAC_ARCH}.dmg"
mkdir -p "$CACHE" "$DIST"

[ -x "$REPO/node_modules/.bin/bare-pack" ] || { echo "run npm install in $REPO first" >&2; exit 1; }
ssh -o ConnectTimeout=6 -o BatchMode=yes "$MAC_HOST" exit 2>/dev/null || { echo "cannot reach $MAC_HOST over key-based ssh" >&2; exit 1; }

echo "=== PearCircle watcher $VERSION (macOS $MAC_ARCH) ==="

rm -rf "$STAGE"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
. "$WD/scripts/stage-payload.sh"
stage_payload "$APP/Contents/Resources/app" "$BARE_HOST"

NODE_PKG="node-v${NODE_VERSION}-darwin-${MAC_ARCH}"
if [ ! -x "$CACHE/$NODE_PKG/bin/node" ]; then
  echo "--> downloading Node $NODE_VERSION ($BARE_HOST)"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_PKG}.tar.gz" -o "$CACHE/$NODE_PKG.tar.gz"
  tar -xzf "$CACHE/$NODE_PKG.tar.gz" -C "$CACHE"
  rm -f "$CACHE/$NODE_PKG.tar.gz"
fi
cp "$CACHE/$NODE_PKG/bin/node" "$APP/Contents/Resources/app/node"
chmod +x "$APP/Contents/Resources/app/node"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>PearCircleWatcher</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>com.pearcircle.watcher</string>
  <key>CFBundleName</key><string>PearCircle Watcher</string>
  <key>CFBundleDisplayName</key><string>PearCircle Watcher</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <!-- No Dock icon: the app has no window, the map opens in the browser. -->
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

cp "$WD/installer/macos/launcher.c" "$WD/installer/macos/entitlements.plist" "$STAGE/"
cp "$REPO/assets/images/icon.png" "$STAGE/icon.png"

echo "--> packing for $MAC_HOST"
TAR="$DIST/macos-$MAC_ARCH.tar.gz"
tar -czf "$TAR" -C "$STAGE" .
REMOTE_DIR="pearcircle-watcher-macos-$MAC_ARCH"
scp -q "$TAR" "$MAC_HOST:$REMOTE_DIR.tar.gz"
rm -f "$TAR"

echo "--> sign, package and notarize on $MAC_HOST (notarization waits on Apple)"
ssh "$MAC_HOST" "bash -lc 'cat > /tmp/$REMOTE_DIR-build.sh && bash /tmp/$REMOTE_DIR-build.sh'" <<REMOTE
set -euo pipefail
work="\$HOME/$REMOTE_DIR"
rm -rf "\$work"; mkdir -p "\$work"
tar -xzf "\$HOME/$REMOTE_DIR.tar.gz" -C "\$work"
rm -f "\$HOME/$REMOTE_DIR.tar.gz"
cd "\$work"
APP="PearCircle Watcher.app"

clang -arch $CLANG_ARCH -mmacosx-version-min=11.0 -O2 -o "\$APP/Contents/MacOS/PearCircleWatcher" launcher.c

iconset=AppIcon.iconset; mkdir -p \$iconset
for s in 16 32 128 256 512; do
  sips -z \$s \$s icon.png --out \$iconset/icon_\${s}x\${s}.png >/dev/null
  d=\$((s * 2)); sips -z \$d \$d icon.png --out \$iconset/icon_\${s}x\${s}@2x.png >/dev/null
done
iconutil -c icns \$iconset -o "\$APP/Contents/Resources/AppIcon.icns"

KEYCHAIN="\$HOME/Library/Keychains/buildkey.keychain-db"
security unlock-keychain -p "" "\$KEYCHAIN" 2>/dev/null || true
security list-keychains -s "\$KEYCHAIN" "\$HOME/Library/Keychains/login.keychain-db" /Library/Keychains/System.keychain >/dev/null 2>&1 || true
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "" "\$KEYCHAIN" >/dev/null 2>&1 || true
SIGN_ID='${APP_SIGN_ID:-}'
[ -n "\$SIGN_ID" ] || SIGN_ID=\$(security find-identity -v -p codesigning "\$KEYCHAIN" | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | head -1)
[ -n "\$SIGN_ID" ] || SIGN_ID=-
echo "    signing as: \$SIGN_ID"
if [ "\$SIGN_ID" = - ]; then
  codesign --force --deep --sign - "\$APP"
else
  # Inside out: every Mach-O addon, then node and bare (their JITs need the
  # entitlements), then the bundle. Notarization rejects any unsigned
  # nested binary.
  n=0
  while IFS= read -r f; do
    if file "\$f" | grep -q Mach-O; then
      codesign --force --options runtime --timestamp --sign "\$SIGN_ID" "\$f"; n=\$((n + 1))
    fi
  done < <(find "\$APP/Contents/Resources/app/worklet" -type f \( -name '*.node' -o -name '*.bare' -o -name '*.dylib' \))
  echo "    signed \$n addons"
  for b in node bare; do
    codesign --force --options runtime --timestamp --entitlements entitlements.plist --sign "\$SIGN_ID" "\$APP/Contents/Resources/app/\$b"
  done
  codesign --force --options runtime --timestamp --sign "\$SIGN_ID" "\$APP"
fi
codesign --verify --strict --verbose=1 "\$APP"

rm -rf dmg; mkdir dmg
cp -R "\$APP" dmg/
ln -s /Applications dmg/Applications
rm -f "$DMG_NAME"
hdiutil create -quiet -volname "PearCircle Watcher" -srcfolder dmg -ov -format UDZO "$DMG_NAME"
if [ "\$SIGN_ID" != - ]; then
  codesign --force --timestamp --sign "\$SIGN_ID" "$DMG_NAME"
  if [ '${SKIP_NOTARIZE:-0}' != 1 ]; then
    xcrun notarytool submit "$DMG_NAME" --keychain-profile '${NOTARY_PROFILE:-pearcircle-seeder-notary}' --keychain "\$KEYCHAIN" --wait
    xcrun stapler staple "$DMG_NAME"
    spctl --assess --type open --context context:primary-signature --verbose=1 "$DMG_NAME"
  fi
fi
REMOTE

scp -q "$MAC_HOST:$REMOTE_DIR/$DMG_NAME" "$DIST/$DMG_NAME"
echo "=== built $DIST/$DMG_NAME ($(du -sh "$DIST/$DMG_NAME" | cut -f1))"
