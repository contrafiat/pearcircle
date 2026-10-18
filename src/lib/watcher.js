// Watch-only desktop client (proposal 2026-10-18-watch-only-client).
//
// A watcher reads the circle but is never a writer, so it can't write its own
// row. It sends a `watcherHello` on the pair channel and any online member
// writes `watcher:{pubkey}` for it, signed by that member. Any member can
// write `watcherRemoved:{pubkey}`. A removal newer than (or as new as) the
// watcher row wins, and a removed watcher is never re-added from a hello.
//
// Pure helpers, no sodium: the UI imports this file for the same rules the
// worklet enforces. Signature checking is injected by the caller.

const WATCHER_LABEL_MAX = 40
const HEX_64 = /^[0-9a-f]{64}$/i

// Trimmed label, or null if it's missing, empty or too long.
function normalizeWatcherLabel (label) {
  if (typeof label !== 'string') return null
  const t = label.trim()
  if (t.length === 0 || t.length > WATCHER_LABEL_MAX) return null
  return t
}

// Shared shape check for watcher: and watcherRemoved: rows. `signerField` is
// 'addedBy' or 'removedBy'. The signer must be a member, checked by the caller
// against the view and passed in as signerIsMember.
function acceptSignedWatcherRow ({ keyPubkey, value, signerField, signerIsMember, now, futureToleranceMs, verifySig }) {
  if (!value || typeof value !== 'object') return false
  if (typeof value.pubkey !== 'string' || !HEX_64.test(value.pubkey)) return false
  if (typeof value[signerField] !== 'string') return false
  if (keyPubkey !== value.pubkey) return false
  if (value.pubkey === value[signerField]) return false
  if (typeof value.ts !== 'number') return false
  if (typeof futureToleranceMs === 'number' && value.ts > now + futureToleranceMs) return false
  if (!signerIsMember) return false
  if (typeof verifySig !== 'function' || !verifySig(value)) return false
  return true
}

function shouldAcceptWatcherRow ({ keyPubkey, value, addedByIsMember, now = Date.now(), futureToleranceMs, verifySig }) {
  if (!acceptSignedWatcherRow({ keyPubkey, value, signerField: 'addedBy', signerIsMember: addedByIsMember, now, futureToleranceMs, verifySig })) return false
  return normalizeWatcherLabel(value.label) === value.label
}

function shouldAcceptWatcherRemovedRow ({ keyPubkey, value, removedByIsMember, now = Date.now(), futureToleranceMs, verifySig }) {
  return acceptSignedWatcherRow({ keyPubkey, value, signerField: 'removedBy', signerIsMember: removedByIsMember, now, futureToleranceMs, verifySig })
}

//   addedTs non-number    - no watcher row, not a watcher
//   removedTs non-number  - never removed, active
//   removedTs >= addedTs  - removal is as new or newer, removed
function watcherActive (addedTs, removedTs) {
  if (typeof addedTs !== 'number') return false
  if (typeof removedTs !== 'number') return true
  return removedTs < addedTs
}

// Member side: decide what to do with a received watcherHello. The hello's
// pubkey must be the connection's remote key, which the Noise handshake has
// already proven, so the hello itself needs no signature.
//   { ok: true, pubkey, label } - write a watcher row
//   { ok: false, reason }       - ignore it
function checkWatcherHello ({ msg, remotePublicKey, isMember, hasActiveWatcherRow, wasRemoved }) {
  if (!msg || typeof msg !== 'object') return { ok: false, reason: 'bad_msg' }
  if (typeof msg.pubkey !== 'string' || !HEX_64.test(msg.pubkey)) return { ok: false, reason: 'bad_pubkey' }
  if (typeof remotePublicKey !== 'string' || msg.pubkey.toLowerCase() !== remotePublicKey.toLowerCase()) return { ok: false, reason: 'not_remote' }
  const label = normalizeWatcherLabel(msg.label)
  if (label === null) return { ok: false, reason: 'bad_label' }
  if (isMember) return { ok: false, reason: 'is_member' }
  if (hasActiveWatcherRow) return { ok: false, reason: 'already_watcher' }
  if (wasRemoved) return { ok: false, reason: 'removed' }
  return { ok: true, pubkey: msg.pubkey, label }
}

module.exports = {
  WATCHER_LABEL_MAX,
  normalizeWatcherLabel,
  shouldAcceptWatcherRow,
  shouldAcceptWatcherRemovedRow,
  watcherActive,
  checkWatcherHello,
}
