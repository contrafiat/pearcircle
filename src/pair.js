// Per-circle pairing protomux channel.
// Runs over the same Hyperswarm connection that carries corestore replication;
// they coexist on one protomux because corestore reuses stream.userData.
//
// Wire: protocol 'pearcircle/pair/1', id = utf-8(circleId).
// Joiner-side (we are not yet a writer) sends a writerHello with our local
// Autobase writer-core public key. Any writer on the receiving side appends
// { type: 'addWriter', pubkey } to the per-circle Autobase, which the apply
// branch turns into a base.addWriter call. Replication then flips the
// joiner's base.writable to true.
//
// A watch-only desktop (proposal 2026-10-18-watch-only-client) sends a
// watcherHello { pubkey, label } in place of the writerHello and never
// becomes a writer. A member hands it to onWatcherHello, which writes the
// watcher: row. Older peers ignore the second message type (protomux drops
// message types it doesn't know).

const Protomux = require('protomux')
const c = require('compact-encoding')
const b4a = require('b4a')

const PAIR_PROTOCOL = 'pearcircle/pair/1'
const HEX_64 = /^[0-9a-f]{64}$/i
// Re-advertise the writerHello on this cadence while we are not yet a writer
// (proposal 2026-06-03c). A single onopen hello can be missed or raced, and a
// rebuilt base (circle:repair changes the local writer key) MUST re-advertise
// the new key to get re-admitted — otherwise the device stays read-only.
const PAIR_HELLO_RETRY_MS = 5000

function setupPairChannel ({ conn, circleId, base, onWriterAdded, getWatcherHello, onWatcherHello, mark }) {
  const mux = Protomux.from(conn)
  let writerHello
  let watcherHello
  let helloTimer = null
  const addedWriters = new Set() // writer keys already addWriter'd on this channel (idempotency)
  const cidShort = circleId.slice(0, 8)
  const trace = (name, extra) => { if (typeof mark === 'function') try { mark(name, { cid: cidShort, ...(extra || {}) }) } catch {} }

  const stopHelloRetry = () => { if (helloTimer) { clearInterval(helloTimer); helloTimer = null } }
  // Watcher side: getWatcherHello returns the hello to send, or null once
  // our watcher: row has landed.
  const watcherHelloValue = () => (typeof getWatcherHello === 'function' ? getWatcherHello() : null)
  const wantsHello = () => (typeof getWatcherHello === 'function' ? !!watcherHelloValue() : !base.writable)
  const sendHello = () => {
    if (typeof getWatcherHello === 'function') {
      const hello = watcherHelloValue()
      if (!hello || !watcherHello) return false
      try {
        watcherHello.send(hello)
        trace('pair:watcher-hello-sent')
        return true
      } catch (e) {
        trace('pair:watcher-hello-send-failed', { err: e?.message ?? String(e) })
        return false
      }
    }
    if (base.writable || !base.local || !writerHello) return false
    try {
      writerHello.send({ writerKey: b4a.toString(base.local.key, 'hex') })
      trace('pair:hello-sent')
      return true
    } catch (e) {
      trace('pair:hello-send-failed', { err: e?.message ?? String(e) })
      return false
    }
  }

  const channel = mux.createChannel({
    protocol: PAIR_PROTOCOL,
    id: b4a.from(circleId),
    onopen () {
      trace('pair:onopen', { writable: !!base.writable, hasLocal: !!base.local })
      // Both sides matched. If we are not yet a writer, advertise our key and
      // keep re-advertising until we become one (or the channel closes).
      sendHello()
      if (wantsHello() && !helloTimer) {
        helloTimer = setInterval(() => {
          if (!wantsHello()) { stopHelloRetry(); return }
          sendHello()
        }, PAIR_HELLO_RETRY_MS)
        if (typeof helloTimer.unref === 'function') helloTimer.unref()
      }
    },
    onclose () { stopHelloRetry(); trace('pair:onclose') },
  })
  if (!channel) {
    trace('pair:create-failed')
    return null
  }

  writerHello = channel.addMessage({
    encoding: c.json,
    onmessage: async (msg) => {
      trace('pair:hello-received', { writable: !!base.writable, valid: !!(msg && typeof msg.writerKey === 'string' && HEX_64.test(msg.writerKey)) })
      // Only writers can satisfy a writerHello.
      if (!base.writable) return
      if (!msg || typeof msg.writerKey !== 'string' || !HEX_64.test(msg.writerKey)) return
      // Idempotent: the joiner re-advertises on a timer, so ignore a key we
      // have already added on this channel (avoids redundant addWriter ops).
      if (addedWriters.has(msg.writerKey)) return
      addedWriters.add(msg.writerKey)
      try {
        await base.append({ type: 'addWriter', pubkey: msg.writerKey })
        trace('pair:addwriter-appended', { pubkey: msg.writerKey.slice(0, 8) })
        if (onWriterAdded) onWriterAdded(msg.writerKey)
      } catch (e) {
        addedWriters.delete(msg.writerKey) // allow a retry on the next hello
        trace('pair:addwriter-failed', { err: e?.message ?? String(e) })
      }
    },
  })

  watcherHello = channel.addMessage({
    encoding: c.json,
    onmessage: async (msg) => {
      trace('pair:watcher-hello-received', { writable: !!base.writable })
      // Only writers can write the watcher: row.
      if (!base.writable || typeof onWatcherHello !== 'function') return
      const remote = conn.remotePublicKey ? b4a.toString(conn.remotePublicKey, 'hex') : null
      try {
        await onWatcherHello(msg, remote)
      } catch (e) {
        trace('pair:watcher-add-failed', { err: e?.message ?? String(e) })
      }
    },
  })

  channel.open()
  trace('pair:channel-opened')
  return channel
}

module.exports = { setupPairChannel, PAIR_PROTOCOL }
