// A release that builds no desktop watcher installers carries the previous
// release's forward, so the website's releases/latest link keeps a desktop
// download. The helper is run for real against a fake GitHub served from
// file:// URLs, like releaseCarryApk.test.js.

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release.sh'), 'utf8')
const helper = SCRIPT.match(/^_carry_forward_watcher\(\) \{[\s\S]*?^\}$/m)[0]

const WATCHER = [
  'PearCircleWatcher-1.2.0-x86_64.AppImage',
  'pearcircle-watch_1.2.0_amd64.deb',
  'PearCircleWatcher-Setup-1.2.0.exe',
  'PearCircleWatcher-1.2.0-arm64.dmg'
]

function fakeRelease ({ names = WATCHER, badSum = null, noSum = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carryw-'))
  const files = path.join(dir, 'files')
  fs.mkdirSync(files)
  const assets = []
  const add = (name, body) => {
    fs.writeFileSync(path.join(files, name), body)
    assets.push({ name, browser_download_url: `file://${files}/${name}` })
  }
  for (const name of ['pearcircle-v1.2.0.apk', ...names]) {
    const body = Buffer.from('not really ' + name)
    add(name, body)
    if (name === noSum) continue
    const hash = name === badSum ? '0'.repeat(64) : crypto.createHash('sha256').update(body).digest('hex')
    add(name + '.sha256', `${hash}  ${name}\n`)
  }
  const api = path.join(dir, 'api', 'repos', 'o', 'r', 'releases')
  fs.mkdirSync(api, { recursive: true })
  fs.writeFileSync(path.join(api, 'latest'), JSON.stringify({ tag_name: 'v1.2.0', assets }))
  return dir
}

function carry (dir) {
  const dest = path.join(dir, 'dest')
  const r = spawnSync('bash', ['-c', `set -euo pipefail\n${helper}\n_carry_forward_watcher "" o/r "${dest}"`], {
    env: { ...process.env, GITHUB_API: `file://${dir}/api` }
  })
  assert.equal(r.status, 0, String(r.stderr))
  return String(r.stdout).split('\n').filter(Boolean).map((p) => path.basename(p))
}

test('every watcher installer and its checksum comes across, and nothing else', () => {
  const out = carry(fakeRelease())
  assert.deepEqual(out.filter((n) => !n.endsWith('.sha256')).sort(), [...WATCHER].sort())
  assert.equal(out.length, WATCHER.length * 2)
  assert.ok(!out.some((n) => n.endsWith('.apk')))
})

test('an installer with a wrong or missing checksum is left out, the rest still come', () => {
  const bad = carry(fakeRelease({ badSum: WATCHER[2] }))
  assert.ok(!bad.includes(WATCHER[2]))
  assert.equal(bad.length, (WATCHER.length - 1) * 2)
  const missing = carry(fakeRelease({ noSum: WATCHER[0] }))
  assert.ok(!missing.includes(WATCHER[0]))
  assert.equal(missing.length, (WATCHER.length - 1) * 2)
})

test('a release with no watcher installers carries nothing and does not fail the run', () => {
  assert.deepEqual(carry(fakeRelease({ names: [] })), [])
})

test('step 7 carries only when this run built no watcher installers', () => {
  assert.match(SCRIPT, /if \[ \$\{#WATCHER_ARTIFACTS\[@\]\} -eq 0 \]; then\n  _CARRIED=\$\(_carry_forward_watcher "\$GH_TOKEN" "\$REPO_SLUG"/)
})
