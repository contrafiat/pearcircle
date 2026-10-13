// PeerLoom Seeder records (proposals/2026-10-13-peerloom-seeder.md). A member
// who paired a phone with PeerLoom Seeder (the shared seeder for every PeerLoom
// app) writes `pseeder:{seederKey}` into a circle, and every member then backs
// the circle up to that seeder.
//
//   pseeder:{seederKey} -> {
//     seederKey:  hex64  - the seeder (matches the key suffix)
//     writer:     hex64  - identity pubkey that signed this row
//     addedBy:    hex64  - identity pubkey of whoever added it; never changes
//     addedAt:    number - never changes
//     updatedAt:  number - LWW
//     revoked?:   true, with revokedAt and revokedBy (= writer)
//     v: 1, sig: hex128  - Ed25519 over canonical(rest) by `writer`
//   }
//
// A new prefix rather than `seeder:`, whose rows any member may change: here
// the first row may come from any current member (who becomes addedBy), and
// any later row (revoke, re-admit) only from the circle owner, a current
// co-owner or addedBy. Old PearCircle versions drop the unknown prefix.

const PREFIX = 'pseeder:'
const HEX64 = /^[0-9a-f]{64}$/

const recordKey = (seederKey) => PREFIX + seederKey
function parseRecordKey (key) {
  if (typeof key !== 'string' || !key.startsWith(PREFIX)) return null
  const k = key.slice(PREFIX.length)
  return HEX64.test(k) ? k : null
}

// An unsigned row; the caller signs it with signValue. `existing` keeps
// addedBy and addedAt; `revoked` true revokes, false re-admits.
function buildRecord ({ seederKey, writer, existing = null, revoked = false, now = Date.now() }) {
  const prev = existing && existing.seederKey === seederKey ? existing : null
  const row = {
    seederKey,
    writer,
    addedBy: prev ? prev.addedBy : writer,
    addedAt: prev ? prev.addedAt : now,
    updatedAt: Math.max(now, prev ? prev.updatedAt + 1 : now),
    v: 1,
  }
  if (revoked) { row.revoked = true; row.revokedAt = now; row.revokedBy = writer }
  return row
}

const isTime = (t, now, tol) => typeof t === 'number' && Number.isFinite(t) && t <= now + tol

// The apply rule. writerMember / writerRemoved: the writer's member row and
// whether a removal hides it. ownerKey: the circle row's ownerKey. coowners: a
// Set of current co-owner pubkeys. verifySig(row): signature check by `writer`.
function acceptRecord ({ key, incoming, existing = null, writerMember, writerRemoved, ownerKey, coowners, now, futureToleranceMs, verifySig }) {
  const seederKey = parseRecordKey(key)
  if (!seederKey || !incoming || typeof incoming !== 'object') return false
  if (incoming.v !== 1 || incoming.seederKey !== seederKey) return false
  if (!HEX64.test(incoming.writer || '') || !HEX64.test(incoming.addedBy || '')) return false
  if (!isTime(incoming.addedAt, now, futureToleranceMs) || !isTime(incoming.updatedAt, now, futureToleranceMs)) return false
  if (incoming.updatedAt < incoming.addedAt) return false
  if (incoming.revoked !== undefined && incoming.revoked !== true) return false
  if (incoming.revoked === true && (!isTime(incoming.revokedAt, now, futureToleranceMs) || incoming.revokedBy !== incoming.writer)) return false
  if (typeof verifySig !== 'function' || !verifySig(incoming)) return false
  if (!writerMember || writerRemoved) return false
  if (!existing) return incoming.addedBy === incoming.writer
  if (incoming.addedBy !== existing.addedBy || incoming.addedAt !== existing.addedAt) return false
  if (!(incoming.updatedAt > existing.updatedAt)) return false
  return canChange({ me: incoming.writer, existing, ownerKey, coowners })
}

// Who may change a row (`me` is an identity pubkey): anyone may add one; after
// that the owner, a current co-owner or whoever added it.
function canChange ({ me, existing, ownerKey, coowners }) {
  if (!existing) return true
  return me === ownerKey || me === existing.addedBy || !!(coowners && coowners.has(me))
}

module.exports = { PREFIX, recordKey, parseRecordKey, buildRecord, acceptRecord, canChange }
