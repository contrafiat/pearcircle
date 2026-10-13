// PeerLoom Seeder records (proposals/2026-10-13-peerloom-seeder.md): shape,
// signature, LWW, and that only the owner, a co-owner or whoever added a
// seeder may change its row. Also checks the vendored client matches
// ../peerloom-seeder.

const fs = require('fs')
const path = require('path')
const b4a = require('b4a')
const { recordKey, parseRecordKey, buildRecord, acceptRecord, canChange } = require('../src/lib/peerloomSeeder')
const { signValue, verifyValueWithSigner } = require('../src/lib/sign')
const { generateKeypair } = require('../src/identity')

const TOL = 5 * 60 * 1000
const NOW = 1_800_000_000_000
const SEEDER = 'e'.repeat(64)
const KEY = recordKey(SEEDER)

function person () {
  const kp = generateKeypair()
  return { pk: b4a.toString(kp.publicKey, 'hex'), sk: kp.secretKey }
}
const owner = person()
const coowner = person()
const adder = person()
const other = person()
const stranger = person()
const members = new Set([owner.pk, coowner.pk, adder.pk, other.pk])

const row = (p, opts = {}) => signValue(buildRecord({ seederKey: SEEDER, writer: p.pk, now: NOW, ...opts }), p.sk)
const accept = (incoming, existing = null, { now = NOW, removed = false, key = KEY } = {}) => acceptRecord({
  key,
  incoming,
  existing,
  writerMember: members.has(incoming.writer) ? { pubkey: incoming.writer } : null,
  writerRemoved: removed,
  ownerKey: owner.pk,
  coowners: new Set([coowner.pk]),
  now,
  futureToleranceMs: TOL,
  verifySig: (v) => verifyValueWithSigner(v, 'writer'),
})

test('keys', () => {
  expect(parseRecordKey(KEY)).toBe(SEEDER)
  expect(parseRecordKey('pseeder:short')).toBe(null)
  expect(parseRecordKey('seeder:' + SEEDER)).toBe(null)
})

test('any current member may add a seeder, as themselves', () => {
  expect(accept(row(adder))).toBe(true)
  expect(accept(row(stranger))).toBe(false)
  expect(accept(row(adder), null, { removed: true })).toBe(false)
  const forged = signValue({ ...buildRecord({ seederKey: SEEDER, writer: other.pk, now: NOW }), addedBy: adder.pk }, other.sk)
  expect(accept(forged)).toBe(false)
})

test('signatures and shape are checked', () => {
  const r = row(adder)
  expect(accept({ ...r, updatedAt: r.updatedAt + 1 })).toBe(false)
  expect(accept({ ...r, sig: row(other).sig })).toBe(false)
  expect(accept(r, null, { key: recordKey('f'.repeat(64)) })).toBe(false)
  expect(accept(row(adder, { now: NOW + 3600e3 }))).toBe(false)
  expect(accept(signValue({ ...buildRecord({ seederKey: SEEDER, writer: adder.pk, now: NOW }), revoked: true, revokedAt: NOW, revokedBy: other.pk }, adder.sk))).toBe(false)
})

test('only the owner, a co-owner or the adder may revoke or re-admit', () => {
  const added = row(adder)
  expect(accept(row(other, { existing: added, revoked: true, now: NOW + 1000 }), added)).toBe(false)
  const byAdder = row(adder, { existing: added, revoked: true, now: NOW + 1000 })
  expect(accept(byAdder, added)).toBe(true)
  expect(byAdder.addedBy).toBe(adder.pk)
  expect(accept(row(coowner, { existing: added, revoked: true, now: NOW + 1000 }), added)).toBe(true)
  const byOwner = row(owner, { existing: added, revoked: true, now: NOW + 1000 })
  expect(accept(byOwner, added)).toBe(true)
  const readmit = row(owner, { existing: byOwner, now: NOW + 2000 })
  expect(accept(readmit, byOwner)).toBe(true)
  expect(readmit.revoked).toBeUndefined()
  expect(accept(row(other, { existing: byOwner, now: NOW + 2000 }), byOwner)).toBe(false)
})

test('a removed adder can no longer change the row', () => {
  const added = row(adder)
  expect(accept(row(adder, { existing: added, revoked: true, now: NOW + 1000 }), added, { removed: true })).toBe(false)
})

test('addedBy and addedAt never change, and older rows lose', () => {
  const added = row(adder)
  const fresh = row(owner, { now: NOW + 1000 })
  expect(accept(fresh, added)).toBe(false)
  const later = row(adder, { existing: added, revoked: true, now: NOW + 1000 })
  expect(accept(added, later)).toBe(false)
  expect(accept(later, later)).toBe(false)
})

test('canChange', () => {
  const added = row(adder)
  const c = (me) => canChange({ me, existing: added, ownerKey: owner.pk, coowners: new Set([coowner.pk]) })
  expect(canChange({ me: other.pk, existing: null, ownerKey: owner.pk, coowners: new Set() })).toBe(true)
  expect(c(adder.pk)).toBe(true)
  expect(c(owner.pk)).toBe(true)
  expect(c(coowner.pk)).toBe(true)
  expect(c(other.pk)).toBe(false)
})

const sibling = path.join(__dirname, '..', '..', 'peerloom-seeder')
;(fs.existsSync(sibling) ? test : test.skip)('the vendored client matches ../peerloom-seeder', () => {
  for (const f of ['client.js', 'protocol.js']) {
    expect(fs.readFileSync(path.join(__dirname, '..', 'src', 'peerloom-seeder', f), 'utf8'))
      .toBe(fs.readFileSync(path.join(sibling, 'src', f), 'utf8'))
  }
})
