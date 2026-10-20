# PearCircle watch-only desktop

Shows a circle's members on a map from a computer. It never shares a location
and is not listed as a member. Members see it under Watching in Settings >
Circles and can remove it. Design: `proposals/2026-10-18-watch-only-client.md`.

## Build the installers

Every build runs from this Linux box. Each package bundles Node, the bare
runtime and the native addons, so nothing else needs installing.

| Platform | Command | Output in `watch-desktop/dist/` |
| --- | --- | --- |
| Linux x86_64 | `bash watch-desktop/scripts/build-linux.sh 0.1.0` | `PearCircleWatcher-0.1.0-x86_64.AppImage`, `pearcircle-watch_0.1.0_amd64.deb` |
| Linux arm64 | `LINUX_ARCH=arm64 bash watch-desktop/scripts/build-linux.sh 0.1.0` | `PearCircleWatcher-0.1.0-aarch64.AppImage`, `pearcircle-watch_0.1.0_arm64.deb` |
| Windows x64 | `bash watch-desktop/scripts/build-windows.sh 0.1.0` | `PearCircleWatcher-Setup-0.1.0.exe` |
| macOS | `bash watch-desktop/scripts/build-macos.sh 0.1.0` | `PearCircleWatcher-0.1.0-arm64.dmg` |

- **Linux arm64** is cross-built and has not been run on arm64 hardware.
- **Windows** needs `makensis` (Fedora: `dnf install mingw32-nsis`). The
  installer asks "just me" (no admin rights, defaults to
  `%LOCALAPPDATA%\Programs`) or "everyone on this PC" (admin prompt, defaults
  to Program Files), then lets the user change the folder. It always installs
  into a `PearCircle Watcher` subfolder of the chosen folder. Silent installs
  take `/S /CurrentUser` or `/S /AllUsers`, plus `/D=<folder>`. It adds a Start
  Menu entry, and uninstalling keeps the data folder
  (`%LOCALAPPDATA%\PearCircle Watcher`).
- **macOS** stages the app here, then signs, notarizes and builds the .dmg on
  the Mac mini over ssh. `MAC_ARCH=x64` builds for Intel Macs (not tested).
  The app has no Dock icon. Its log is `~/Library/Logs/PearCircle Watcher.log`
  and its data is in `~/Library/Application Support/PearCircle Watcher`.

`scripts/stage-payload.sh` holds the steps the three scripts share.

`scripts/release.sh` builds all of them in the background and attaches them
to the GitHub release. With `--skip-desktop`, or if every build fails, the
release carries the previous release's installers forward.

Launching it again while it runs just reopens the page. When it opened the
browser itself, it quits a minute after the last tab closes. With
`--no-open` it keeps running.

## Run it (Linux, from a checkout)

```
npm i --no-save bare-runtime-linux-x64 && chmod +x node_modules/bare-runtime-linux-x64/bin/bare && npm run build:ui && npm run watch:desktop
```

It prints a link and opens it in the browser. The link carries a token, so
only someone with the link can open the map.

To join a circle, ask someone in it for an invite with **Desktop watcher**
selected (the circle's share button), then use **+ Join Circle** in the menu.
The desktop shows as waiting until a member's phone with PearCircle open adds
it, which happens on its own within a few seconds.

Options: `--label NAME` (what members see, default the computer's name),
`--data-dir DIR` (default `~/.local/share/pearcircle-watch` on Linux), `--port N`
(default 8743), `--no-open`.

## How it works

`host.js` runs `src/bare.js` under the bare runtime with `init { mode: 'watch' }`
and serves `assets/app-ui.bundle` on 127.0.0.1. A small bridge script in the
page stands in for the phone shell's WebView bridge over a websocket. The
host answers the `shell:*` calls the UI makes; the rest go to the worklet.
