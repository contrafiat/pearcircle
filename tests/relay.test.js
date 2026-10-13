// The client-side blind-relay policy (proposal 2026-07-23-blind-relay-adoption).
// Pins the direct-first escalation, the privacy toggle and the "no key baked =
// inert" behavior, so the one option the worklet adds to Hyperswarm
// (src/bare.js, member-mode swarm) can only ever do exactly this.

const b4a = require('b4a')
const { relayThroughFor, RELAY_PUBLIC_KEY, RELAY_PUBLIC_KEY_Z } = require('../src/lib/relay')

const KEY = b4a.alloc(32, 7) // a stand-in relay key

describe('relayThroughFor', () => {
  test('direct-first: no relay on the first attempt (not forced, not randomized)', () => {
    expect(relayThroughFor({ force: false, randomized: false, useRelay: true, relayKey: KEY })).toBe(null)
  })

  test('escalates to the relay once forced (a HOLEPUNCH_ABORTED set force=true)', () => {
    expect(relayThroughFor({ force: true, randomized: false, useRelay: true, relayKey: KEY })).toBe(KEY)
  })

  test('a double-randomized NAT relays from the first attempt (direct can never work)', () => {
    expect(relayThroughFor({ force: false, randomized: true, useRelay: true, relayKey: KEY })).toBe(KEY)
  })

  test('an undefined randomized flag is simply falsy (hyperdht may not expose it)', () => {
    expect(relayThroughFor({ force: false, randomized: undefined, useRelay: true, relayKey: KEY })).toBe(null)
  })

  test('the privacy toggle wins: useRelay=false never relays, even when forced', () => {
    expect(relayThroughFor({ force: true, randomized: true, useRelay: false, relayKey: KEY })).toBe(null)
  })

  test('no key baked = inert: never relays regardless of force/NAT/toggle', () => {
    expect(relayThroughFor({ force: true, randomized: true, useRelay: true, relayKey: null })).toBe(null)
  })
})

describe('the baked relay key', () => {
  test('is the shared PeerLoom relay and decodes to a 32-byte public key', () => {
    expect(typeof RELAY_PUBLIC_KEY_Z).toBe('string')
    expect(RELAY_PUBLIC_KEY_Z.length).toBeGreaterThan(0)
    expect(RELAY_PUBLIC_KEY.length).toBe(32)
  })

  test('matches the key PearTune deployed, so the suite shares one relay', () => {
    // Changing this means pointing PearCircle at a different relay node. If that
    // is intended, update peartune/protocol/relay.js in the same breath.
    expect(RELAY_PUBLIC_KEY_Z).toBe('qshao3eawtzecrt5p7buswr4meyyhw6q6b51qtxazd8wwfdp8uqy')
  })
})

// PeerLoom Seeder dials (blind-peering, pulls, requests): direct first, then
// through the relay after a failed holepunch to that key.
describe('relayingDht', () => {
  const { relayingDht } = require('../src/lib/relay')
  const EventEmitter = require('events')
  const KEY = Buffer.alloc(32, 7)
  const RELAY = Buffer.alloc(32, 9)
  function fakeDht () {
    const calls = []
    return { calls, randomized: false, other () { return 'kept' }, connect (key, opts) { const s = new EventEmitter(); calls.push({ key, opts, s }); return s } }
  }
  test('direct first, relay after a failed punch, per key', () => {
    const d = fakeDht()
    const w = relayingDht(d, { useRelay: () => true, relayKey: RELAY })
    w.connect(KEY, { keyPair: 'kp' })
    expect(d.calls[0].opts).toEqual({ keyPair: 'kp' })
    d.calls[0].s.emit('error', Object.assign(new Error('x'), { code: 'HOLEPUNCH_ABORTED' }))
    w.connect(KEY, { keyPair: 'kp' })
    expect(d.calls[1].opts).toEqual({ keyPair: 'kp', relayThrough: RELAY })
    w.connect(Buffer.alloc(32, 1), {})
    expect(d.calls[2].opts).toEqual({})
    expect(w.other()).toBe('kept')
  })
  test('the toggle off never relays', () => {
    const d = fakeDht()
    const w = relayingDht(d, { useRelay: () => false, relayKey: RELAY })
    w.connect(KEY, {})
    d.calls[0].s.emit('error', Object.assign(new Error('x'), { code: 'HOLEPUNCH_ABORTED' }))
    w.connect(KEY, {})
    expect(d.calls[1].opts).toEqual({})
  })
})
