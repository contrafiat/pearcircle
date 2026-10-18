#!/usr/bin/env bash
# Stage the platform-neutral part of the watch-only desktop payload. Sourced
# by build-linux.sh, build-windows.sh and build-macos.sh, which add the Node
# runtime and the packaging for their platform.
#
#   stage_payload <out-dir> <bare-host>     e.g. stage_payload dist/x linux-arm64
#
# Writes: host-bundled.js, bare (bare.exe on Windows), worklet/worklet.bundle
# with the addon prebuilds for <bare-host> beside it, and ui/. Expects REPO
# and WD set by the caller. Every step runs on Linux, including the foreign
# platforms: bare-pack cross-packs and the runtime comes from npm pack.

stage_payload () {
  local out="$1" host="$2"
  local exe=''
  [ "${host%%-*}" = win32 ] && exe='.exe'
  rm -rf "$out"
  mkdir -p "$out/worklet" "$out/ui"

  echo "--> ui bundle"
  ( cd "$REPO" && npm run --silent build:ui )
  cp "$REPO/src/ui/index.html" "$out/ui/index.html"
  cp "$REPO/assets/app-ui.bundle" "$out/ui/app-ui.bundle"

  echo "--> host"
  "$REPO/node_modules/.bin/esbuild" "$WD/host.js" --bundle --platform=node --target=node20 --format=cjs \
    --log-level=warning --outfile="$out/host-bundled.js"

  echo "--> bare runtime ($host)"
  # npm install only fetches the build machine's runtime, npm pack has no
  # platform check. Use the version package-lock.json pins: a newer runtime
  # cannot load a worklet packed against the locked bare-module.
  local want have dir packdir
  want=$(cd "$REPO" && node -p "require('./package-lock.json').packages['node_modules/bare-runtime-$host']?.version || ''")
  [ -n "$want" ] || { echo "package-lock.json has no bare-runtime-$host entry" >&2; return 1; }
  dir="$REPO/node_modules/bare-runtime-$host"
  have=$(node -p "require('$dir/package.json').version" 2>/dev/null || true)
  if [ "$have" != "$want" ] || [ ! -f "$dir/bin/bare$exe" ]; then
    echo "    fetching bare-runtime-$host@$want"
    packdir=$(mktemp -d)
    ( cd "$packdir" && npm pack --loglevel=error "bare-runtime-$host@$want" >/dev/null )
    rm -rf "$dir"
    mkdir -p "$dir"
    tar -xzf "$packdir"/*.tgz -C "$dir" --strip-components=1
    rm -rf "$packdir"
  fi
  cp "$dir/bin/bare$exe" "$out/bare$exe"
  chmod +x "$out/bare$exe"

  echo "--> worklet bundle"
  "$REPO/node_modules/.bin/bare-pack" --host "$host" \
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
  done < <(cd "$REPO/node_modules" && find . -type d -path "*/prebuilds/$host")
  echo "    staged $staged addon prebuild dirs"
  [ "$staged" -gt 0 ] || { echo "no $host prebuilds found" >&2; return 1; }
}
