# Watch-only desktop client

**Status**: Approved 2026-10-18 by Tim, with open questions 1-3 resolved as proposed: any member can make a watch invite, every member is notified when a watcher is added and v1 shows positions only (no trips). Question 4 also resolved as proposed: Linux first. Amended the same day after review of the join flow: watch invites carry no one-time code (see section 2).

**Goal**: A desktop app that joins a circle and shows members on the map, the same as a phone. It never shares a location and does not appear in the member list. Every member can see that a watcher exists in a separate "Watching" list and can remove it.

**Tier**: T3. Adds a new role in the circle, a new replicated key (`watcher:{pubkey}`), a change to who phones send live positions to and a new invite flavour.

## Background

### What already works on a desktop

- **The worklet.** `src/bare.js` already runs on Linux, macOS and Windows as the seeder (`bare --seed`, launched by `seeder-launcher/`).
- **The UI.** `src/ui/` is a web app with MapLibre. It runs inside a WebView on the phone, so it runs in a desktop browser or window too. The phone shell only routes IPC between the WebView and the worklet.
- **The launcher pattern.** `seeder-launcher/host/` spawns the worklet and serves a localhost web UI over a websocket. A watcher launcher can reuse that shape. PR #251 stopped building and publishing the seeder, but the packaging scripts are still in the tree.

The seeder can't be the base for this. It is blind by design: it never gets the circle's `encryptionKey`, so it can't read locations.

### What a watcher can already do today

Anyone holding an invite link can watch a circle silently right now:

1. The invite carries `circleKey`, `bootstrap` and `encryptionKey`.
2. A client that mounts the Autobase with those and joins the swarm replicates the encrypted view and can read it. Mounting does not make it a writer. Only the pair channel's `writerHello` does that, so a client that never opens the pair channel never becomes a writer and never writes a `member:` row.
3. Phones send live positions to every connection that opens `pearcircle/live/1` for the circle (`setupLiveChannelFor`, `getOutgoing`). The sender does not check who is on the other end. Only the receiver checks membership (`handleLivePosition`), and that check protects the receiver, not the sender.

So a hidden watcher needs no protocol change at all. This proposal adds the visibility and the removal, and closes the silent path as a side effect.

Swarm connections use the identity keypair (`new Hyperswarm({ keyPair: _identity })`), so a phone knows the identity of every peer it talks to. That is what makes sender-side gating possible.

## Design

### 1. The watcher record

```
watcher:{pubkey} = {
  pubkey,      // the watcher's identity pubkey
  label,       // e.g. "Tim's desktop", set by the watcher, max 40 chars
  addedBy,     // member who wrote the row
  ts,
  v: 1,
  sig          // signature by addedBy
}
```

A watcher is not a writer, so it can't write its own row. A member writes it on its behalf, the same way a member writes `addWriter` for a joiner today.

Apply rule, next to `member:` / `left:` / `removed:` in `applyCircleNodes`:

- Verify the signature against `addedBy`, and require `addedBy` to have a `member:` row.
- Require `op.key === 'watcher:' + incoming.pubkey`.
- Reject a `ts` more than 5 min in the future.
- Last write wins on `ts`.

Removal is `watcherRemoved:{pubkey}` with the same shape (`removedBy` in place of `addedBy`). Any member can write it. A remove newer than the watcher row wins, the same LWW comparison as `memberHiddenByHide`. Phones never re-add a removed watcher from its hello, so a removed desktop stays removed. A desktop that resets and comes back with a new identity is a new watcher, and every member gets the added notice again.

Any member can remove a watcher. Watchers can see where everyone is, so each member should be able to cut one off without asking the owner.

### 2. Joining as a watcher

New pair-channel message `watcherHello { pubkey, label }`, sent by the watcher in place of `writerHello`. Any online member that receives it appends the `watcher:` row. The hello needs no signature: the member checks that `pubkey` is the connection's remote key, which the Noise handshake already proves. Older phones ignore the message, since protomux drops message types it doesn't know.

A watch invite is the normal invite plus `role=watch`. The flag only tells the joining app to join as a watcher. Older apps ignore it and join as a member.

An earlier draft added a one-time code that only the inviting phone could check. Dropped on 2026-10-18: if that phone was offline the desktop could not join, and the code protected nothing, since anyone holding any invite can already join as a full member.

Any member can make a watch invite, matching how any member can invite today (decided 2026-10-18).

### 3. Phones only send live positions to members and watchers

Change `setupLiveChannelFor` so the send side checks the remote identity before sending: send only if the remote pubkey has a `member:` row or an active `watcher:` row and is not left/removed/watcherRemoved. Re-check when those rows change, so removing a watcher stops live updates at once.

This also stops the silent watcher in "What a watcher can already do today". Phones on older versions keep sending to anyone, so the silent path only closes once every member has updated.

### 4. What removal does and doesn't do

Removing a watcher stops live positions from updated phones and hides it from the Watching list. It does **not** stop the watcher reading the replicated Autobase, because it still holds the `encryptionKey`. That means the last-known positions stored in the Autobase (legacy `lastSeen:` rows, places, transitions and shared trips) stay readable to it.

The same is true of a removed member today. The full fix is to move the circle to a new key, which `supersede:` already does. The UI should say this plainly on the remove confirm, e.g. "It will stop getting live locations. To fully lock it out, move the circle to a new invite." A new key is a bigger change and is not part of this proposal.

### 5. The UI on phones

- The member list skips anyone with only a `watcher:` row. Watchers never write `member:` rows, so this is mostly automatic.
- A new "Watching" section in circle settings lists each watcher's label, who added it and when, with a Remove button.
- One notification to all members when a watcher is added: "Tim's desktop is now watching Family". Without it, a watcher can be added without anyone noticing.
- "Create watch invite" next to the normal invite button.

### 6. The desktop app

- Worklet in a new `--watch` mode: never opens the location layer, never writes a `member:` row, never opens the pair channel as a writer, sends `watcherHello` instead of `writerHello`.
- A small host modelled on `seeder-launcher/host/`: spawns the worklet, serves the existing `src/ui/` bundle on localhost and bridges IPC over a websocket in place of the RN shell.
- The UI gets a `watchOnly` flag that hides everything that needs a phone: location sharing toggles, Places editing, trips, battery and the "me" marker.
- Packaging: reuse the seeder's AppImage / .deb / .pkg / Windows scripts.

Older phones (before this change) will show the watcher nowhere and will send it live positions anyway. That is no worse than today.

## Alternatives

- **No visibility (fully hidden watcher).** No protocol change needed. Rejected by Tim on 2026-10-18 because a watcher nobody can see is too close to stalkerware.
- **Watcher joins as a normal member with a `role: watch` flag on its `member:` row.** Easier, since it can write its own rows. But a writer is an Autobase indexer candidate and counts toward the dead-indexer problem (`project_dead_indexers`), and a desktop left off for months becomes exactly that. A reader avoids it.
- **Build it into the seeder.** The seeder is blind and must stay blind, so no.

## Slices

1. Worklet: `watcher:` / `watcherRemoved:` apply rules, `watcherHello`, watch invites. Tests.
2. Worklet: sender-side live gating. Tests, including a removed watcher losing live updates.
3. Phone UI: Watching section, Remove, notification, Create watch invite.
4. Worklet `--watch` mode + desktop host + `watchOnly` UI.
5. Packaging for Linux first, then macOS and Windows.

Test plan: one Android emulator as the member and the desktop watcher on this box. Rule 15 says two emulators don't pair, so if the emulator can't pair with a process on the same host either, use the TCL as the member.

## Open questions

1. Can any member make a watch invite, or only the owner? Proposed: any member.
2. Notify all members when a watcher is added? Proposed: yes.
3. Should the desktop be able to see shared trips, or only live and last-known positions? Proposed: positions only for v1.
4. Linux only for v1? Proposed: yes, since this box is the main desktop.
