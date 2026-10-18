const { liveRecipientSet } = require('../src/lib/liveRecipients')

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const W = 'c'.repeat(64)

const m = (entries) => new Map(entries)

describe('liveRecipientSet', () => {
  test('current members get live positions', () => {
    const set = liveRecipientSet({ members: m([[A, 1000], [B, 1000]]) })
    expect([...set].sort()).toEqual([A, B])
  })

  test('a peer with no member or watcher row gets nothing', () => {
    const set = liveRecipientSet({ members: m([[A, 1000]]) })
    expect(set.has(W)).toBe(false)
  })

  test('left and removed members get nothing', () => {
    const set = liveRecipientSet({
      members: m([[A, 1000], [B, 1000]]),
      leftAt: m([[A, 2000]]),
      removedAt: m([[B, 2000]]),
    })
    expect(set.size).toBe(0)
  })

  test('a member who rejoined after leaving gets it again', () => {
    const set = liveRecipientSet({ members: m([[A, 3000]]), leftAt: m([[A, 2000]]) })
    expect(set.has(A)).toBe(true)
  })

  test('an active watcher gets it, a removed one does not', () => {
    expect(liveRecipientSet({ watchers: m([[W, 1000]]) }).has(W)).toBe(true)
    expect(liveRecipientSet({ watchers: m([[W, 1000]]), watcherRemovedAt: m([[W, 1000]]) }).has(W)).toBe(false)
  })

  test('pubkeys come out lower case', () => {
    const set = liveRecipientSet({ members: m([[A.toUpperCase(), 1000]]) })
    expect(set.has(A)).toBe(true)
  })
})
