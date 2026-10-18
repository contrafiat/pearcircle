#!/usr/bin/env node
// PearCircle watch-only desktop (proposal 2026-10-18-watch-only-client).
//
// Runs src/bare.js under the bare runtime in watch mode and serves the normal
// PearCircle UI to a browser tab on 127.0.0.1. The tab talks to this host
// over a websocket, which stands in for the phone shell: worklet calls pass
// straight through and the few shell:* calls the UI makes are answered here.
//
//   node watch-desktop/host.js [--data-dir DIR] [--port N] [--label NAME] [--bare PATH] [--no-open]
//
// The URL carries a random token so other users on this machine can't open
// the map. Only this host's own loopback listener serves it.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { WebSocketServer } = require('ws')
const { Worklet } = require('../seeder-launcher/host/worklet.js')

// Two layouts. Packaged (AppImage / .deb, built by scripts/build-linux.sh):
// host-bundled.js sits next to bare, worklet/worklet.bundle and ui/. From a
// checkout: this file is in watch-desktop/ and everything comes from the repo.
const PACKAGED = fs.existsSync(path.join(__dirname, 'worklet', 'worklet.bundle'))
const ROOT = PACKAGED ? __dirname : path.resolve(__dirname, '..')
const PATHS = PACKAGED
  ? {
      bare: path.join(ROOT, 'bare'),
      bundle: path.join(ROOT, 'worklet', 'worklet.bundle'),
      indexHtml: path.join(ROOT, 'ui', 'index.html'),
      uiBundle: path.join(ROOT, 'ui', 'app-ui.bundle'),
    }
  : {
      bare: path.join(ROOT, 'node_modules', 'bare-runtime-linux-x64', 'bin', 'bare'),
      bundle: path.join(ROOT, 'src', 'bare.js'),
      indexHtml: path.join(ROOT, 'src', 'ui', 'index.html'),
      uiBundle: path.join(ROOT, 'assets', 'app-ui.bundle'),
    }

function parseArgs (argv) {
  const out = {
    dataDir: path.join(os.homedir(), '.local', 'share', 'pearcircle-watch'),
    port: 8743,
    label: os.hostname().slice(0, 40),
    bare: PATHS.bare,
    open: true,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--data-dir') out.dataDir = argv[++i]
    else if (a === '--port') out.port = Number(argv[++i])
    else if (a === '--label') out.label = argv[++i]
    else if (a === '--bare') out.bare = argv[++i]
    else if (a === '--no-open') out.open = false
  }
  return out
}

// Desktop answers to the shell:* calls the UI makes. Display settings persist
// to a small JSON file; everything phone-only reports unsupported.
function makeShell (settingsPath) {
  let settings = {}
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) } catch {}
  const save = () => { try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2)) } catch {} }
  const setKey = (k, v) => { settings[k] = v; save(); return { ok: true } }
  return {
    'shell:onboarding:get': () => ({ complete: true, tourPending: false }),
    'shell:onboarding:set': () => ({ ok: true }),
    'shell:permission:status': () => ({ status: 'always' }),
    'shell:battery:isExempt': () => ({ supported: false, exempt: false }),
    'shell:location:networkEnabled': () => ({ enabled: true }),
    'shell:theme:get': () => ({ theme: settings.theme === 'light' ? 'light' : 'dark' }),
    'shell:theme:set': (a) => setKey('theme', a?.theme === 'light' ? 'light' : 'dark'),
    'shell:tileStyle:get': () => ({ url: typeof settings.tileStyle === 'string' ? settings.tileStyle : null }),
    'shell:tileStyle:set': (a) => setKey('tileStyle', typeof a?.url === 'string' && a.url ? a.url : null),
    'shell:distanceUnit:get': () => ({ unit: settings.distanceUnit === 'miles' ? 'miles' : 'km' }),
    'shell:distanceUnit:set': (a) => setKey('distanceUnit', a?.unit === 'miles' ? 'miles' : 'km'),
    'shell:notif:mute:list': () => ({ mutes: [] }),
    'shell:haptic': () => ({ ok: true }),
    'shell:statusBar:set': () => ({ ok: true }),
  }
}

// The UI's index.html with the bridge loaded ahead of the bundle.
function pageHtml () {
  const html = fs.readFileSync(PATHS.indexHtml, 'utf8')
  return html.replace('<script src="app-ui.bundle"></script>', '<script src="bridge.js"></script>\n    <script src="app-ui.bundle"></script>')
}

// Runs in the page. Stands in for window.ReactNativeWebView and relays
// responses and events the way the phone shell's injectJavaScript does.
const BRIDGE_JS = `(() => {
  window.__pearWatchOnly = true
  const token = new URLSearchParams(location.search).get('t') || ''
  const queue = []
  let ws = null
  function connect () {
    ws = new WebSocket('ws://' + location.host + '/ws?t=' + encodeURIComponent(token))
    ws.onopen = () => { while (queue.length) ws.send(queue.shift()) }
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'response') window.__pearResponse(msg.id, msg.result)
      else if (msg.type === 'event') window.__pearEvent(msg.name, msg.data)
    }
    ws.onclose = () => setTimeout(connect, 1000)
  }
  connect()
  window.ReactNativeWebView = {
    postMessage (str) {
      if (ws && ws.readyState === 1) ws.send(str)
      else queue.push(str)
    },
  }
})()`

async function main () {
  const opts = parseArgs(process.argv.slice(2))
  fs.mkdirSync(opts.dataDir, { recursive: true })
  const openLink = (link) => {
    if (!opts.open) return
    try { spawn('xdg-open', [link], { stdio: 'ignore', detached: true }).unref() } catch {}
  }
  const tokenPath = path.join(opts.dataDir, 'auth.token')
  let token
  try { token = fs.readFileSync(tokenPath, 'utf8').trim() } catch {}
  if (!token) {
    token = crypto.randomBytes(16).toString('hex')
    fs.writeFileSync(tokenPath, token, { mode: 0o600 })
  }
  const shell = makeShell(path.join(opts.dataDir, 'watch-settings.json'))
  const logPath = path.join(opts.dataDir, 'watch.log')
  const log = (kind, text) => { try { fs.appendFileSync(logPath, '[' + kind + '] ' + String(text).trimEnd() + '\n') } catch {} }

  const worklet = new Worklet({
    barePath: opts.bare,
    bundleEntry: PATHS.bundle,
    dataDir: opts.dataDir,
    args: [],
    initArgs: { mode: 'watch', label: opts.label },
    onLog: log,
  })

  const clients = new Set()
  // The app has no window of its own, so when it opened the browser itself
  // it quits a while after the last tab closes. A reload reconnects within a
  // second. With --no-open (run as a service or from a script) it stays up.
  let idleTimer = null
  const IDLE_EXIT_MS = 60 * 1000
  const FIRST_TAB_GRACE_MS = 3 * 60 * 1000
  const armIdleExit = (ms) => {
    if (!opts.open || idleTimer) return
    idleTimer = setTimeout(async () => {
      log('host', 'no open tabs, quitting')
      await worklet.stop()
      process.exit(0)
    }, ms)
  }
  const cancelIdleExit = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null } }
  worklet.on('event', ({ name, data }) => {
    const line = JSON.stringify({ type: 'event', name, data })
    for (const ws of clients) { try { ws.send(line) } catch {} }
  })
  worklet.on('exit', ({ code, signal }) => {
    log('host', 'worklet exited code=' + code + ' signal=' + signal)
    console.error('PearCircle watcher stopped unexpectedly. See ' + logPath)
    process.exit(1)
  })
  // Already running (the app launched twice from the menu): open the
  // running one's page and leave. Checked before starting a second worklet,
  // which would fail on the store lock anyway.
  const busy = await new Promise((resolve) => {
    const probe = http.get({ host: '127.0.0.1', port: opts.port, path: '/bridge.js', timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200) })
    probe.on('error', () => resolve(false))
    probe.on('timeout', () => { probe.destroy(); resolve(false) })
  })
  if (busy) {
    const link = 'http://127.0.0.1:' + opts.port + '/?t=' + token
    console.log('PearCircle watcher is already running. Open: ' + link)
    openLink(link)
    process.exit(0)
  }

  await worklet.start()

  const uiBundle = PATHS.uiBundle
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (url.searchParams.get('t') !== token) { res.writeHead(401); res.end('Open the link printed by the watcher.'); return }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(pageHtml())
    } else if (url.pathname === '/bridge.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end(BRIDGE_JS)
    } else if (url.pathname === '/app-ui.bundle') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' })
      fs.createReadStream(uiBundle).pipe(res)
    } else {
      res.writeHead(404); res.end()
    }
  })

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname !== '/ws' || url.searchParams.get('t') !== token) { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws)
      cancelIdleExit()
      ws.on('close', () => { clients.delete(ws); if (clients.size === 0) armIdleExit(IDLE_EXIT_MS) })
      ws.on('message', async (raw) => {
        let msg
        try { msg = JSON.parse(raw.toString()) } catch { return }
        if (typeof msg?.id !== 'number' || typeof msg.method !== 'string') return
        let result
        if (msg.method.startsWith('shell:')) {
          const fn = shell[msg.method]
          result = fn ? fn(msg.args) : { ok: false, supported: false, error: 'not available on the desktop' }
        } else {
          // Same shape the phone shell gives the UI: errors come back as
          // { ok: false, error } instead of a rejected call.
          try { result = await worklet.call(msg.method, msg.args, { timeoutMs: 30000 }) } catch (e) { result = { ok: false, error: e?.message ?? String(e) } }
        }
        try { ws.send(JSON.stringify({ type: 'response', id: msg.id, result: result ?? null })) } catch {}
      })
    })
  })

  server.listen(opts.port, '127.0.0.1', () => {
    const link = 'http://127.0.0.1:' + opts.port + '/?t=' + token
    console.log('PearCircle watcher is running as "' + opts.label + '".')
    console.log('Open: ' + link)
    openLink(link)
    armIdleExit(FIRST_TAB_GRACE_MS)
  })

  const stop = async () => { await worklet.stop(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch((e) => { console.error(e?.stack || e); process.exit(1) })
