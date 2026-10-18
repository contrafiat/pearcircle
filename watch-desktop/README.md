# PearCircle watch-only desktop

Shows a circle's members on a map from a computer. It never shares a location
and is not listed as a member. Members see it under Watching in Settings >
Circles and can remove it. Design: `proposals/2026-10-18-watch-only-client.md`.

## Install it (Linux x86_64)

Build the packages:

```
bash watch-desktop/scripts/build-linux.sh 0.1.0
```

That writes `watch-desktop/dist/PearCircleWatch-x86_64.AppImage` (any distro,
run it directly) and `watch-desktop/dist/pearcircle-watch_0.1.0_amd64.deb`
(Debian / Ubuntu). Each bundles Node, the bare runtime and the native addons,
so nothing else needs installing.

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
`--data-dir DIR` (default `~/.local/share/pearcircle-watch`), `--port N`
(default 8743), `--no-open`.

## How it works

`host.js` runs `src/bare.js` under the bare runtime with `init { mode: 'watch' }`
and serves `assets/app-ui.bundle` on 127.0.0.1. A small bridge script in the
page stands in for the phone shell's WebView bridge over a websocket. The
host answers the `shell:*` calls the UI makes; the rest go to the worklet.
