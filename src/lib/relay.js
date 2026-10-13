// The PeerLoom blind relay - client-side constant + policy.
// Proposal: proposals/2026-07-23-blind-relay-adoption.md (T3).
//
// Deliberately mirrors peartune/protocol/relay.js so the two apps cannot drift.
// The relay is one public hyperdht node running a blind-relay.Server: when two
// peers cannot hole-punch, both dial it and it pairs their half-connections by
// token and forwards bytes. It holds no key to the Noise session, so it carries
// ciphertext only, and stores nothing.

const z32 = require('z32')
const b4a = require('b4a')

// The deployed PeerLoom relay's public key (DigitalOcean droplet, 2026-07-23,
// provisioned for PearTune). App-agnostic: a blind byte-forwarder does not know
// which app's bytes it carries, so PearCircle shares the same node. Its private
// seed lives only on the relay box and in Tim's password manager.
const RELAY_PUBLIC_KEY_Z = 'qshao3eawtzecrt5p7buswr4meyyhw6q6b51qtxazd8wwfdp8uqy'

const RELAY_PUBLIC_KEY = RELAY_PUBLIC_KEY_Z ? z32.decode(RELAY_PUBLIC_KEY_Z) : null

// The direct-first relay policy - what Hyperswarm calls per outbound connect.
// It accepts `relayThrough` as either a key or a `(force, swarm) => key|null`
// fn; we pass the fn so the toggle applies live, without a reconnect.
// Returns the relay key to route through, or null for a direct-only attempt.
//
//   force      - Hyperswarm sets peerInfo.forceRelaying=true after a
//                HOLEPUNCH_ABORTED / HOLEPUNCH_DOUBLE_RANDOMIZED_NATS /
//                REMOTE_NOT_HOLEPUNCHABLE, i.e. the direct punch already failed
//                for this peer. This is what makes us direct-FIRST: null on the
//                normal attempt, the key only after a failure.
//   randomized - this device's own NAT is double-randomized, so a direct punch
//                can never work; relay from the first attempt. Matches
//                Hyperswarm's own default gate (`force || swarm.dht.randomized`).
//                Undefined on hyperdht builds that do not expose it, which just
//                means this early-out never fires.
//   useRelay   - the user's privacy toggle (Settings, default true). Off means
//                pure peer-to-peer: never touch PeerLoom's relay, and accept
//                that a 0%-punch network simply will not connect.
//   relayKey   - the baked relay key, or null when no relay is configured.
//
// Order matters: the toggle and the "is a relay even configured" check gate
// first, so a user who opted out never relays regardless of NAT.
function relayThroughFor ({ force, randomized, useRelay, relayKey }) {
  if (!useRelay || !relayKey) return null
  return (force || randomized) ? relayKey : null
}

// The errors after which a direct connection will not work: Hyperswarm's own
// list (hyperswarm/index.js shouldForceRelaying).
const PUNCH_FAILED = new Set(['HOLEPUNCH_ABORTED', 'HOLEPUNCH_DOUBLE_RANDOMIZED_NATS', 'REMOTE_NOT_HOLEPUNCHABLE'])

// PeerLoom Seeder traffic (blind-peering backups, pulls, requests) dials with
// dht.connect outside Hyperswarm, where a relay key means "relay from the
// first attempt". This wraps the DHT so those dials are direct first too, per
// remote key: after a failed holepunch to a key, later dials to it relay.
// A seeder on a Start9 is reachable from a phone on the same network only
// through the relay. From PearOffice's src/worklet/relay.js.
//   useRelay - () => the live toggle; relayKey - as above.
function relayingDht (dht, { useRelay, relayKey }) {
  const failed = new Set()
  function connect (remotePublicKey, opts = {}) {
    const key = b4a.toString(remotePublicKey, 'hex')
    const relayThrough = relayThroughFor({ force: failed.has(key), randomized: !!dht.randomized, useRelay: useRelay(), relayKey })
    const socket = dht.connect(remotePublicKey, relayThrough ? { ...opts, relayThrough } : opts)
    socket.on('error', (err) => { if (err && PUNCH_FAILED.has(err.code)) failed.add(key) })
    return socket
  }
  return new Proxy(dht, {
    get (target, prop) {
      if (prop === 'connect') return connect
      const v = Reflect.get(target, prop, target)
      return typeof v === 'function' ? v.bind(target) : v
    }
  })
}

module.exports = { RELAY_PUBLIC_KEY, RELAY_PUBLIC_KEY_Z, relayThroughFor, relayingDht, PUNCH_FAILED }
