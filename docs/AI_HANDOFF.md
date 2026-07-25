# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-25, Europe/Istanbul

Packages 4B, 4C and 4D are delivered as one release candidate together with the
final consolidation pass. 4B fixed functional reliability, 4C proved the privacy
and authorization boundary, 4D closed failure handling and repository hygiene,
and the consolidation implemented the last open owner decision and corrected two
overstated privacy claims.

### What changed in the product

- **A restored market quote is no longer promoted to live by another symbol's
  tick** (4B). Live continuity is right while connected — the provider only
  re-sends a symbol whose price CHANGED — but wrong for a quote hydrated from
  disk across a gap the app did not hear. Such quotes now carry `fromSnapshot`
  and are excluded from continuity until their own symbol ticks, so the
  converter can no longer show a pre-restart rate unbadged and
  `marketSellRateTry` can no longer hand one to a ledger write.
- **The database-error retry recovers instead of pretending** (4B). wa-sqlite
  leaves a failed document in `Invalid VFS state` for its whole lifetime, so
  re-running the migration in the same page returned the identical error forever
  while a plain refresh recovered instantly. "Tekrar dene" reloads on web;
  native keeps the in-place retry, where re-opening genuinely retries.
- **Sync status, the entry form's smart defaults and the undo bar no longer
  outlive the account that produced them** (4C). All three are device-local
  state that belongs to ONE account: a sync error and quarantine count, two row
  ids in `localStorage`, and an undo action closing over the previous account's
  user id and row snapshot.
- **A failed token refresh is no longer read as a dead session** (4D).
  `tryRefreshSession` returned a bare boolean, so "the refresh token was
  revoked" and "we never reached the auth service" both told the user to sign in
  again AND stopped the retry backoff — on a device whose session was fine and
  whose only problem was no network. Only an answer from the service retires a
  session now; transport failures keep the network message and the backoff.
- **The keepalive workflow stopped printing Supabase response bodies** to a
  public Actions log (4D). Status codes and the existing content assertion
  remain; only the `cat` of the bodies is gone.
- **`3E-REVIEW-01` is decided and implemented.** A pull that replaces a row this
  device already showed now raises one quiet notice in the shared outcome bar —
  no modal, no record name, no version, no conflict vocabulary. The trigger
  (`remoteSupersededLocal`) is deliberately stricter than the merge rule, which
  accepts an equal `updated_at`; that equality is this device's own
  acknowledged push coming back, so announcing on "did the remote win?" would
  have reported the user's own save to them.
- **Two privacy statements were overstated and are corrected.** The data table
  now says authentication is run by Supabase Auth and the password is never
  stored in readable form by the application; the storage paragraph no longer
  promises that everything is unreadable while the iPhone is locked, because
  `NSFileProtectionComplete` is configured but has never been verified on real
  hardware — `SECURITY.md` already said so and `PRIVACY.md` contradicted it.

### Analysed and deliberately left unchanged

- **Freeze is a client-enforced lock.** It writes a synced setting and ends the
  session; it does not revoke tokens. Recorded in [`PRIVACY.md`](PRIVACY.md).
- **An orphaned local workspace is adopted, not wiped.** If `localStorage` is
  cleared while OPFS survives, the owner marker is gone and the next sign-in
  keeps the existing rows. Wiping instead would destroy local-only data that has
  no cloud copy, which the recovery rule forbids; the residual exposure is
  bounded (every query is owner-scoped, and foreign outbox rows are quarantined
  rather than pushed).
- **Server-rejected outbox rows retry on the capped backoff rather than being
  promoted to dead letters.** A permanently rejected row would block the queue.
  The final pass traced the divergence candidates and closed the strongest one
  on evidence: `updateCategory` accepts only `name | isColumn | isTransfer`, so
  a category's `kind` cannot change under an offline transaction and trip the
  server's `enforce_category_kind` trigger. With local validation mirroring the
  server's bounds, composite FKs blocking foreign parents and push order
  FK-safe, no reachable path was demonstrated. Recorded as a low-probability
  risk; no speculative dead-letter machinery was added.

## Validation of the combined change set

- `npm run verify:release`: typecheck, zero-warning lint, **70 Vitest files /
  534 tests**, 52-route production export, entry/total/export/font budgets with
  `sourceMapFiles 0`, and **27/27 Playwright**.
- `supabase test db` against a local stack built from the migrations: **59/59**,
  including the Package 4C cross-user matrix.
- `npx expo-doctor`: 18/18.
- Mutation proofs: the market test fails on the pre-fix `applyFeed`; the
  consistency test fails when `financialFlow` stops normalising a category/type
  mismatch; the push-order test fails when `persons` moves to the end of
  `SYNCED_TABLES`; the privacy guards fail when the undo clear or one teardown
  call is removed; dropping `cell_notes_user_category_fk` lets one account
  attach a note to another's category.
- Real-browser measurements (Chromium, the deployed build's own export): a
  double-click, two rapid clicks, three Enter presses and a double "Kaydet ve
  Yeni Ekle" each wrote exactly one row; a write is durable ~50 ms after the
  click; the blocked second tab recovers in ~5 s through the app's own retry.

## Open items

- **Device acceptance remains BLOCKED and no iPhone scenario was executed.** No
  iOS simulator runtime, no `adb`, Xcode lacks platform support for the paired
  iPhone. The matrix in [`TESTING.md`](TESTING.md) carries the outstanding rows,
  including the two added for the market snapshot after a real app kill and for
  killing the app with a pending write. **Production OTA stays withheld.**
- Cross-user isolation is proven at the database and policy layer. It was **not**
  exercised through two real signed-in accounts in the deployed web app.
- A sign-in that cannot reach the cloud falls back to the local answer after the
  8 s first-pull grace, so an existing account on a broken network can still be
  asked to set up.

## Delivery and rollback evidence

- Last delivered web release is `c46ede18cc6073e9b870c861340273e09eeed543`
  ("stop showing Quick Start to an account that already exists", PR #61).
- Last preview OTA is Package 3E group `07b13519-d3d7-4f10-a7d6-6c8cc7dc245f`,
  runtime `1.0.0`, branch `preview`, from
  `0ec54d1ce7af27f7959f1517697380bb5f1f2d51`.
- Rollback anchor is the Package 3D release: main
  `012847192cba2303bb5ff8c2f322e31325265853`, Pages run `30148599977`, OTA group
  `613cbec8-4f52-44b4-b907-0a2be3a5f938`.
- The 4B–4D diff is JS/TS, tests, docs, one workflow line and two committed
  screenshots — no `app.json`, `eas.json`, lockfile, native directory or
  Supabase **migration** change — so it needs no native rebuild and deploys no
  schema.
- `.codex/` was classified and removed: its screenshots, probe JSON and
  superseded reviews were regenerable or temporary, and the one durable item it
  still held (the open conflict-policy decision) moved into `ARCHITECTURE.md`.
  The directory is now an ignored agent workspace.

## Next exact step

`NEXT EXACT STEP = installed-device acceptance for the blocked TESTING.md rows, once real hardware is available; nothing else is pending.`
