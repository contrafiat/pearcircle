// release.sh uploads the GitHub release assets several at a time as background
// jobs. These cases run the real blocks from the script against a fake curl, so
// they check concurrency, exit statuses and cleanup without uploading anything.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release.sh'), 'utf8')

function between (start, end) {
  const a = SCRIPT.indexOf(start)
  const b = SCRIPT.indexOf(end, a)
  if (a < 0 || b < 0) throw new Error(`block not found: ${start}`)
  return SCRIPT.slice(a, b)
}

const HELPERS = between('_BG_DIR=$(mktemp -d)', '# ---------------------------------------------------------------------------\n# Helper:')

function run (body, env = {}) {
  const r = spawnSync('bash', ['-c', `set -euo pipefail\n${HELPERS}\n${body}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 30000
  })
  return r
}

function tmp () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'release-par-'))
}

test('exiting the script kills background jobs and their children', () => {
  const dir = tmp()
  const pidFile = path.join(dir, 'child.pid')
  const r = run(`
job() { sleep 60 & echo $! > "${pidFile}"; wait; }
job < /dev/null &
_BG_PIDS+=("$!")
while [ ! -s "${pidFile}" ]; do sleep 0.1; done
exit 0
`)
  expect(r.status).toBe(0)
  const child = Number(fs.readFileSync(pidFile, 'utf8'))
  let alive = true
  try { process.kill(child, 0) } catch { alive = false }
  expect(alive).toBe(false)
})

const UPLOAD = between('  # --- Upload the assets, UPLOAD_JOBS', '\nelse\n  # Fallback: gh CLI')

function uploadRun (names, jobs) {
  const dir = tmp()
  const bin = path.join(dir, 'bin')
  const trace = path.join(dir, 'trace')
  fs.mkdirSync(bin)
  // Fake curl: logs start/end per upload, sleeps, and answers with an API error
  // for any asset whose name contains "bad".
  fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; http*) url="$1" ;; esac
  shift
done
name="\${url##*name=}"
echo "start $name $(date +%s.%N)" >> "${trace}"
sleep 1
echo "end $name $(date +%s.%N)" >> "${trace}"
case "$name" in *bad*) echo '{"message":"Validation Failed"}' > "$out" ;; *) echo '{"id":1}' > "$out" ;; esac
`, { mode: 0o755 })
  const assets = names.map(n => { const p = path.join(dir, n); fs.writeFileSync(p, 'x'); return `"${p}"` })
  const r = run(`
_asset_content_type() { echo application/octet-stream; }
GH_TOKEN=t; REPO_SLUG=o/r; RELEASE_TAG=v9.9.9; UPLOAD_URL=https://uploads.example/assets
EXISTING_ASSETS_JSON='{}'; UPLOAD_JOBS=${jobs}
RELEASE_ASSETS=(${assets.join(' ')})
${UPLOAD}
`, { PATH: `${bin}:${process.env.PATH}` })
  const events = fs.readFileSync(trace, 'utf8').trim().split('\n').map(l => l.split(' '))
  let running = 0; let peak = 0
  for (const [kind] of events.sort((x, y) => Number(x[2]) - Number(y[2]))) {
    running += kind === 'start' ? 1 : -1
    peak = Math.max(peak, running)
  }
  return { r, peak }
}

test('assets upload several at a time, never more than UPLOAD_JOBS', () => {
  const { r, peak } = uploadRun(['a.apk', 'a.apk.sha256', 'b.s9pk', 'b.s9pk.sha256', 'c.pkg', 'c.pkg.sha256'], 4)
  expect(r.status).toBe(0)
  expect(r.stdout).toContain('All 6 assets uploaded.')
  expect(peak).toBeGreaterThan(1)
  expect(peak).toBeLessThanOrEqual(4)
  expect(uploadRun(['a', 'b', 'c', 'd'], 2).peak).toBe(2)
})

test('a failed upload still lets the others finish, then fails the run naming it', () => {
  const { r } = uploadRun(['good.apk', 'bad.s9pk', 'good.pkg'], 4)
  expect(r.status).toBe(1)
  expect(r.stdout).toContain('Uploaded good.apk.')
  expect(r.stdout).toContain('Uploaded good.pkg.')
  expect(r.stdout).toContain('ERROR: Upload of bad.s9pk failed:')
  expect(r.stdout).toContain('1 asset(s) were not attached')
})
