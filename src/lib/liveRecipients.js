// Who a phone sends its live position to (proposal 2026-10-18-watch-only-client
// slice 2). Before this, a phone sent to any peer that opened the live channel
// for the circle, so anyone holding an invite could watch without being listed.
// Now only current members and active watchers get it.
//
// Hidden members (proposal 2026-10-06) still get it: hiding only changes the
// list, and a hidden member who is still around rewrites their row anyway.
//
// Pure. The caller reads the rows off the view and passes plain maps.

const { memberHiddenByLeft, memberHiddenByRemoved } = require('./circleFilter')
const { watcherActive } = require('./watcher')

//   members          Map<pubkey, joinedAt>
//   leftAt           Map<pubkey, leftAt>
//   removedAt        Map<pubkey, ts>
//   watchers         Map<pubkey, ts>
//   watcherRemovedAt Map<pubkey, ts>
// Returns a Set of lower-case hex pubkeys.
function liveRecipientSet ({ members, leftAt, removedAt, watchers, watcherRemovedAt }) {
  const out = new Set()
  for (const [pubkey, joinedAt] of members || []) {
    if (memberHiddenByRemoved(removedAt?.get(pubkey), joinedAt)) continue
    if (memberHiddenByLeft(leftAt?.get(pubkey), joinedAt)) continue
    out.add(pubkey.toLowerCase())
  }
  for (const [pubkey, ts] of watchers || []) {
    if (!watcherActive(ts, watcherRemovedAt?.get(pubkey))) continue
    out.add(pubkey.toLowerCase())
  }
  return out
}

module.exports = { liveRecipientSet }
