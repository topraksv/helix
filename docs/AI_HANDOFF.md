# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-25, Europe/Istanbul

- Package 3E (cross-device sync and session reliability) is implemented on
  `package-3e-device-sync`. It adds no second sync engine, no new abstraction
  layer, no timer and no polling: the fixes are in the session layer that was
  causing the failures.
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

- Last delivered web release is the Package 3D protected-main commit
  `012847192cba2303bb5ff8c2f322e31325265853`; Pages run `30148599977` and
  `github-pages` deployment `5599398668` succeeded. The documentation-only
  commit `f498dc724ca31d60b258ada7c1e8c5a0f5f4a355` redeployed the same
  application bundle and carries no OTA of its own.
- Last preview OTA is Package 3D group `613cbec8-4f52-44b4-b907-0a2be3a5f938`;
  Android `019f981e-e55d-7bdd-806a-13b6db63386c`, iOS
  `019f981e-e55d-7f6d-a931-4d8506d8d556`, runtime `1.0.0`, branch `preview`,
  exact git commit `012847192cba2303bb5ff8c2f322e31325265853`, zero source-map
  assets.
- Package 3E is JS/TS, tests and documentation only, so it needs no native
  rebuild. Production OTA stays withheld until installed-device cold-start and
  synchronisation acceptance is genuinely verified.

## Next exact step

`NEXT EXACT STEP = installed-device acceptance for Package 3E (two clients, two cold starts) before any production OTA.`
