# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-25, Europe/Istanbul

- **Fixed after the 3E release: an existing account no longer sees Quick Start
  when it signs back in.** `useLive` dropped a snapshot whose parameters changed
  inside an effect, and effects run after the render that changed them — so for
  exactly one render the root guard read the signed-out query's resolved empty
  result as this account's answer, decided it was not onboarded and redirected
  to `/(onboarding)/setup` before the first-pull grace effect had started. Once
  that redirect lands, the onboarding route legitimately renders until the pull
  arrives, which is the second or two that was visible. A live snapshot is now
  reported as unresolved in the same render its parameters change
  (`snapshotForParameters`), so the guard waits instead. The same render window
  could let a previous account's `account_frozen` flag gate the next one; both
  are pinned by `tests/app-guard.test.ts`.

- Package 3E (cross-device sync and session reliability) is delivered.
  Protected main carries `0ec54d1ce7af27f7959f1517697380bb5f1f2d51` (PR #59,
  squash), Pages run `30150439790` deployed it, and the `preview` OTA was
  published from that exact commit. It adds no second sync engine, no new
  abstraction layer, no timer and no polling: the fixes are in the session layer
  that was causing the failures.
- **An ordinary sign-out no longer ends the account's other sessions.**
  `supabase.auth.signOut()` defaults to `scope: "global"`, so signing out of the
  web app revoked every refresh token: the phone's next refresh failed, Supabase
  emitted `SIGNED_OUT`, the invalidation path wiped that device — unsynced
  outbox rows included — and "Cihazlarını Güncelle" could only answer 401 until
  the user signed in again. Sign-out is now device-scoped; `global` remains for
  account deletion, where the identity itself is destroyed. Freeze is unaffected
  (it locks other devices through the synced `account_frozen` flag).
- **Sign-out will not destroy rows the cloud never received.** The flush is now
  an invariant of the session layer rather than of one screen: one bounded push
  runs first and, if rows survive it, sign-out refuses with
  `SIGN_OUT_PENDING_CHANGES`. Settings keeps the only decision a screen should
  own — whether the user accepts the loss — and re-calls with `force`.
- **A dead session no longer promises an automatic sync.** After a failed
  refresh the engine said "verilerin birazdan otomatik eşitlenecek" and kept
  retrying a revoked token on the backoff. It now states that a sign-in is
  needed and that local data is safe, and stops that backoff. A transient 401
  still refreshes and retries silently.
- Conflict policy is unchanged and deliberate: last-write-wins on the
  server-normalised `updated_at`, with delete generations dominating wall
  clocks. `3E-REVIEW-01` (telling the user when a concurrent edit was replaced)
  is recorded as `PENDING OWNER APPROVAL`; it needs a product decision and, for
  a recoverable variant, a schema change.

## Validation

- `npm run verify:release` passed: typecheck, zero-warning lint, 69 Vitest files
  / 511 tests, 52-route production export, entry/total/export/font budgets with
  `sourceMapFiles 0` and `sourceMapReferences 0`, and the full Playwright suite.
- `tests/multi-client-sync.test.ts` converges two isolated clients on the real
  migration DDL in real SQLite, driving the shipping outbound validation,
  acknowledgement rule and LWW/tombstone comparison against a PostgREST
  stand-in that implements migration 12's `set_updated_at()` trigger: create,
  edit, delete, stale-client resurrection, offline reconnect, duplicate-free
  retry, concurrent-edit convergence, foreign-row refusal and queued-row
  survival.
- Mutation proof: removing the tombstone-generation branch fails the
  resurrection assertion; restoring it passes. The sign-out scope assertions
  previously encoded the defective global default.
- Supabase schema is untouched by this package, so no migration, lint or pgTAP
  re-run was required.

## Package 3E device acceptance

- VoiceOver and TalkBack are `OWNER_NA` — explicitly excluded by owner decision.
- Dynamic Type, Reduced Motion, native modal focus, physical landscape
  calculator, haptics, notification entry, app-switcher privacy cover,
  biometric/SecureStore, low-memory large import, two installed clients, and the
  two OTA cold starts with adoption remain `DEVICE_ONLY` and **BLOCKED**: no iOS
  simulator runtime is installed (`xcrun simctl` lists no devices), Xcode 26.6
  still lacks platform support for the paired iPhone 16e on iOS 27.0, and there
  is no `adb` or Android target. No simulator evidence is claimed.
- Live two-device network convergence therefore stays unverified. The
  convergence *rules* are proven by the integration suite above; what is missing
  is an installed client on real hardware.

## Delivery and rollback evidence

- Last delivered web release is the Package 3E protected-main commit
  `0ec54d1ce7af27f7959f1517697380bb5f1f2d51`; Pages run `30150439790` and
  `github-pages` deployment `5599744549` succeeded. Live smoke passed: static
  routes 200, an unexported month URL 404 with a byte-identical root shell, no
  `sourceMappingURL` and no `.map` served.
- Last preview OTA is Package 3E group `07b13519-d3d7-4f10-a7d6-6c8cc7dc245f`;
  Android `019f9856-024d-77a8-a911-7d2d54b098ed`, iOS
  `019f9856-024d-738a-ac39-4bcf97a9adc0`, runtime `1.0.0`, branch `preview`,
  exact git commit `0ec54d1ce7af27f7959f1517697380bb5f1f2d51`, clean working
  tree, 34 assets per platform, zero source-map assets. The channel still maps
  unconditionally to the `preview` branch.
- Package 3E's diff is JS/TS, tests and documentation only — no `app.json`,
  `eas.json`, lockfile, native directory, asset or Supabase migration change —
  so no native rebuild was required. **Production OTA stays withheld** until
  installed-device cold-start and synchronisation acceptance is genuinely
  verified.
- Rollback anchor is the Package 3D release: main
  `012847192cba2303bb5ff8c2f322e31325265853`, Pages run `30148599977`, OTA group
  `613cbec8-4f52-44b4-b907-0a2be3a5f938`.

## Next exact step

`NEXT EXACT STEP = installed-device acceptance for Package 3E (two clients, two cold starts) before any production OTA.`
