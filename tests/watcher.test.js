const b4a = require('b4a')
const NoiseSecretStream = require('@hyperswarm/secret-stream')
const { signValue, verifyValueWithSigner } = require('../src/lib/sign')
const { generateKeypair } = require('../src/identity')
const { buildInvite, parseInvite } = require('../src/invite')
const { setupPairChannel } = require('../src/pair')
const {
  WATCHER_LABEL_MAX,
  normalizeWatcherLabel,
  shouldAcceptWatcherRow,
  shouldAcceptWatcherRemovedRow,
  watcherActive,
  checkWatcherHello,
} = require('../src/lib/watcher')

const hex = (kp) => b4a.toString(kp.publicKey, 'hex')
const TOL = 5 * 60 * 1000

describe('normalizeWatcherLabel', () => {
  test('trims and keeps a normal label', () => {
    expect(normalizeWatcherLabel("  Tim's desktop ")).toBe("Tim's desktop")
  })
  test('rejects empty, too long and non-strings', () => {
    expect(normalizeWatcherLabel('   ')).toBeNull()
    expect(normalizeWatcherLabel('x'.repeat(WATCHER_LABEL_MAX + 1))).toBeNull()
    expect(normalizeWatcherLabel(42)).toBeNull()
  })
})

describe('shouldAcceptWatcherRow', () => {
  const member = generateKeypair()
  const watcher = generateKeypair()
  const row = (over = {}) => signValue({ pubkey: hex(watcher), label: 'Desk', addedBy: hex(member), ts: Date.now(), v: 1, ...over }, member.secretKey)
  const accept = (value, extra = {}) => shouldAcceptWatcherRow({
    keyPubkey: hex(watcher),
    value,
    addedByIsMember: true,
    futureToleranceMs: TOL,
    verifySig: (v) => verifyValueWithSigner(v, 'addedBy'),
    ...extra,
  })

  test('accepts a row signed by a member', () => {
    expect(accept(row())).toBe(true)
  })
  test('rejects a row whose signer is not a member', () => {
    expect(accept(row(), { addedByIsMember: false })).toBe(false)
  })
  test('rejects a tampered row', () => {
    expect(accept({ ...row(), label: 'Other' })).toBe(false)
  })
  test('rejects a key that does not match the pubkey', () => {
    expect(accept(row(), { keyPubkey: hex(member) })).toBe(false)
  })
  test('rejects a member adding itself', () => {
    const self = signValue({ pubkey: hex(member), label: 'Desk', addedBy: hex(member), ts: Date.now(), v: 1 }, member.secretKey)
    expect(accept(self, { keyPubkey: hex(member) })).toBe(false)
  })
  test('rejects a future ts', () => {
    expect(accept(row({ ts: Date.now() + TOL + 60000 }))).toBe(false)
  })
  test('rejects an untrimmed or missing label', () => {
    expect(accept(row({ label: ' Desk' }))).toBe(false)
    expect(accept(row({ label: undefined }))).toBe(false)
  })
})

describe('shouldAcceptWatcherRemovedRow', () => {
  const member = generateKeypair()
  const watcher = generateKeypair()
  const row = () => signValue({ pubkey: hex(watcher), removedBy: hex(member), ts: Date.now(), v: 1 }, member.secretKey)
  const verifySig = (v) => verifyValueWithSigner(v, 'removedBy')

  test('accepts a removal signed by a member', () => {
    expect(shouldAcceptWatcherRemovedRow({ keyPubkey: hex(watcher), value: row(), removedByIsMember: true, futureToleranceMs: TOL, verifySig })).toBe(true)
  })
  test('rejects a removal by a non-member', () => {
    expect(shouldAcceptWatcherRemovedRow({ keyPubkey: hex(watcher), value: row(), removedByIsMember: false, futureToleranceMs: TOL, verifySig })).toBe(false)
  })
})

describe('watcherActive', () => {
  test('no row is not a watcher', () => {
    expect(watcherActive(undefined, undefined)).toBe(false)
  })
  test('a row with no removal is active', () => {
    expect(watcherActive(1000, undefined)).toBe(true)
  })
  test('a removal as new or newer wins', () => {
    expect(watcherActive(1000, 1000)).toBe(false)
    expect(watcherActive(1000, 2000)).toBe(false)
  })
  test('a watcher row newer than the removal is active', () => {
    expect(watcherActive(2000, 1000)).toBe(true)
  })
})

describe('checkWatcherHello', () => {
  const pk = hex(generateKeypair())
  const base = { msg: { pubkey: pk, label: 'Desk' }, remotePublicKey: pk, isMember: false, hasActiveWatcherRow: false, wasRemoved: false }

  test('accepts a hello from the connected peer', () => {
    expect(checkWatcherHello(base)).toEqual({ ok: true, pubkey: pk, label: 'Desk' })
  })
  test('rejects a hello for someone other than the connected peer', () => {
    expect(checkWatcherHello({ ...base, remotePublicKey: hex(generateKeypair()) }).reason).toBe('not_remote')
  })
  test('rejects a member, an existing watcher and a removed watcher', () => {
    expect(checkWatcherHello({ ...base, isMember: true }).reason).toBe('is_member')
    expect(checkWatcherHello({ ...base, hasActiveWatcherRow: true }).reason).toBe('already_watcher')
    expect(checkWatcherHello({ ...base, wasRemoved: true }).reason).toBe('removed')
  })
  test('rejects a bad label', () => {
    expect(checkWatcherHello({ ...base, msg: { pubkey: pk, label: '' } }).reason).toBe('bad_label')
  })
})

describe('watch invites', () => {
  const args = {
    circleId: 'A'.repeat(43),
    name: 'Family',
    circleKey: 'a'.repeat(64),
    bootstrap: 'b'.repeat(64),
    inviterPublicKey: 'c'.repeat(64),
    encryptionKey: 'd'.repeat(64),
  }
  test('a normal invite parses as a member invite', () => {
    const url = buildInvite(args)
    expect(url).not.toContain('role=')
    expect(parseInvite(url).role).toBe('member')
  })
  test('a watch invite round-trips', () => {
    const parsed = parseInvite(buildInvite({ ...args, role: 'watch' }))
    expect(parsed.ok).toBe(true)
    expect(parsed.role).toBe('watch')
    expect(parsed.encryptionKey).toBe(args.encryptionKey)
  })
  test('an unknown role parses as a member invite', () => {
    expect(parseInvite(buildInvite(args) + '&role=admin').role).toBe('member')
  })
  test('buildInvite rejects an unknown role', () => {
    expect(() => buildInvite({ ...args, role: 'admin' })).toThrow(/role/)
  })
})

describe('pair channel watcherHello', () => {
  test('a watcher hello reaches the writer with the remote key', async () => {
    const memberKp = generateKeypair()
    const watcherKp = generateKeypair()
    const a = new NoiseSecretStream(true, null, { keyPair: watcherKp })
    const b = new NoiseSecretStream(false, null, { keyPair: memberKp })
    a.rawStream.pipe(b.rawStream).pipe(a.rawStream)

    const circleId = 'A'.repeat(43)
    let admitted = false
    const watcherBase = { writable: false, local: null }
    const memberBase = { writable: true, local: { key: b4a.alloc(32) }, append: async () => {} }

    const got = new Promise((resolve) => {
      setupPairChannel({
        conn: b,
        circleId,
        base: memberBase,
        onWatcherHello: async (msg, remote) => { admitted = true; resolve({ msg, remote }) },
      })
    })
    setupPairChannel({
      conn: a,
      circleId,
      base: watcherBase,
      getWatcherHello: () => (admitted ? null : { pubkey: hex(watcherKp), label: 'Desk' }),
    })

    const { msg, remote } = await got
    expect(msg).toEqual({ pubkey: hex(watcherKp), label: 'Desk' })
    expect(remote).toBe(hex(watcherKp))
    a.destroy()
    b.destroy()
  })
})
