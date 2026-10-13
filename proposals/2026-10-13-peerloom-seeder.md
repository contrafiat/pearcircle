# Move circles to PeerLoom Seeder

**Status**: Approved 2026-10-13 (Tim).
**Goal**: A PearCircle member pairs a phone with PeerLoom Seeder (the shared seeder for
every PeerLoom app) and every member of their circles backs those circles up to it;
only the circle owner or the member who added it can take it off a circle.
**Tier**: T3. A new signed circle record with its own apply rule, and a narrower rule
for who may remove a seeder (an auth gate). No change to existing rows, topics or the
wire protocol v1 records.

## Background

Tim decided on 2026-10-12 (suite `proposals/2026-10-12-peerloom-seeder-product.md`,
answer 2) that PearCircle moves to PeerLoom Seeder and that removing a seeder is
limited to the circle owner and the member who paired it. This reverses "PearCircle
keeps its own seeder" in `proposals/2026-10-12-generic-seeder.md`.

Today (`proposals/2026-05-19-blind-seeder-peers.md` and follow-ups) the seeder runs
PearCircle's own worklet in seed mode, joins the circle topic, announces on
`pearcircle/seeder-admission/2`, and any current member can admit, revoke, re-admit
or hide it through signed `seeder:{pubkey}` rows (`src/lib/seederApply.js`,
`bare.js:5020`). Circles are block-encrypted with a key separate from the topic key
(`src/circle.js:38-45`), so a blind box can hold their cores by key without reading
them or joining the topic.

## Design

1. **Pairing.** Settings > Seeders gets "Pair PeerLoom Seeder": scan the dashboard's
   QR or paste its `peerloom://seeder` link. The worklet calls `pair({ swarm, link,
   app })` from `@peerloom/seeder`'s client, copied into `src/peerloom-seeder/` by a
   vendor script, and keeps `peerloomSeeder:{seederKey}` in the local db. `app` is
   `'PearCircle'` (answer 2).
2. **Adding to circles.** After pairing, the person picks circles (all of theirs by
   default). For each, the device appends a signed row in a new namespace:
   `pseeder:{seederKey}` -> `{ seederKey, writer, addedBy, addedAt, updatedAt,
   revoked?, revokedAt?, revokedBy?, v: 1, sig }`, signed by `writer`, LWW on
   `updatedAt`. A new prefix, not `seeder:`, because the old rows carry the
   any-member rule and old peers would apply it.
3. **Apply rule** (new pure function beside `seederApply.js`): shape and signature as
   `seeder:` rows; the writer is a current, not-removed member; and
   - a first row (no existing): any current member, with `addedBy === writer`;
   - any later row (revoke, re-admit, relabel): the writer must be the circle owner
     (the circle row's `ownerKey`), a current co-owner (answer 1) or the row's
     `addedBy`; `addedBy` and `addedAt` never change.
4. **Backing up.** Every member registers the circle base with the circle's
   non-revoked `pseeder` keys through `blind-peering`
   (`addAutobaseBackground(base, { keys, pick: keys.length })`), again when a seeder
   is added or a writer joins, as `@peerloom/core`'s `src/seeding.js` does. The
   seeder never gets `circleKey` or the encryption key and never joins the topic.
5. **Removing.** Owner or adder: "Remove from circle" writes `revoked: true`; members
   stop registering it, and each device that backed the circle up asks the seeder to
   drop it (`drop` request, 7-day grace). Anyone can still stop backing up from their
   own device (local unpair). Other members see the seeder and who added it, but no
   remove button.
6. **Old seeders.** `seeder:` rows, seed mode and the launcher packages keep working.
   Settings shows once: "PeerLoom Seeder replaces the PearCircle seeder and serves all
   your PeerLoom apps" with Set up and Not now (product phase 6). Nothing is removed
   automatically.

Not in scope: retiring seed mode or its packages; changing `seeder:` rows.

## Compat

- Old PearCircle versions drop unknown prefixes in apply ("Other prefixes not yet
  wired - silently dropped", `bare.js:5085`), so they ignore `pseeder:` rows and keep
  their views consistent with each other. They do not back up to the new seeder, but
  an upgraded member's registration covers every writer core of the base.
- New peers apply the stricter rule deterministically; old peers cannot write
  `pseeder:` rows.
- Deps: add `blind-peering` (2.10.x, as `peerloom-seeder` tests) and
  `protomux-wakeup`. Spike first with autobase 7.27.3: register a circle base with a
  PeerLoom Seeder and catch up from it.
- Retention: the shared seeder keeps everything a device registers unless asked
  otherwise, so it first gets a "keep N days" request per space (answer 3), and
  PearCircle sends the circle's retention with each registration.

## Verify

- Unit tests for the `pseeder` apply rule: a stranger's row, a removed member's row,
  a non-owner non-adder revoke (refused), owner revoke and adder revoke (accepted),
  `addedBy` rewrite (refused), LWW ties.
- Spike: autobase 7.27.3 + blind-peering against PeerLoom Seeder.
- Two devices (emulator + TCL): pair one with a seeder; the dashboard shows the
  circle under its app; one shares a location and goes offline, the other catches up
  from the seeder alone; a non-adder member cannot remove it, the adder can.
- `src/lib/blindnessCheck.js` against the seeder's folder: no plaintext.
- An old-version member in the same circle keeps syncing with no errors.

## Rollback

Ship behind the Settings entry. Removing the code leaves `pseeder:` rows that old
code drops; the seeder deletes circles after the 7-day grace once nobody registers
them. The old seeder path is untouched throughout.

## Answers (Tim, 2026-10-13)

1. **Co-owners too.** The owner, any co-owner (current `coowner:` row) and the adder
   may revoke or re-admit.
2. **Send "PearCircle"** at pairing, so the dashboard shows a PearCircle section. The
   box's owner learns the app is used, never any location.
3. **Retention first.** Before PearCircle moves, PeerLoom Seeder gets a request a
   device can send for a space: keep only blocks received in the last N days (as
   PearCircle's own seeder does). PearCircle sends it with the circle's retention
   setting.
