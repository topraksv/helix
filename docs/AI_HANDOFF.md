# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-22, Europe/Istanbul

- Package 2A is complete on the single `package-2-security-hardening` branch,
  started from Package 1 main `06406662e7b27163bcc6dfe85bb0bd4a9aa7c77b`.
- Exact recovery-target validation, failed-global-sign-out local revoke,
  remote `SIGNED_OUT` workspace cleanup, local owner-safe conflict upserts,
  import self-owner validation and owner-safe export/notification joins are
  implemented and adversarially tested.
- Timestamp-only delete convergence was replaced with monotonic
  `tombstone_version` across all 16 synced SQLite/Supabase tables. Stale lower
  generations ACK the current server tombstone; explicit same-generation undo
  remains supported. Legacy backups default the field to generation zero.
- Linked Supabase migrations `…01`–`…12` have exact local/remote parity. Public
  schema lint is clean; linked rollback pgTAP passes 45/45 assertions covering
  RLS/policy/grant inventory, A/B isolation, tombstone generations and scoped
  account deletion. Linked database types were regenerated verbatim.
- All eight required security mutations were run, each target test failed, each
  mutation was reverted, and every target passed again: owner filter,
  `WITH CHECK`, session epoch, tombstone resurrection, import fail-closed,
  recovery host/scheme, notification redaction and outbox owner isolation.
- Commit gate passed with Node 22: `npm run verify` = 63 Vitest files / 472
  tests, typecheck clean and zero-warning Expo lint. Browser E2E passed 21/21,
  including real SQLite CRUD/restore, hostile routes, offline reload and a11y/
  visual baselines. No screenshot baseline changed.
- Physical OS validation remains device-only: lock-screen notification content,
  app-switcher snapshot timing, biometric/Keychain behavior and two-installed-
  client sync. No code-level critical/high security defect remains open.
- Package 2A did not open a PR, merge, deploy Pages, publish OTA or create a
  native build. The untracked `.codex/package-2-ledger.md` is intentionally not
  part of the checkpoint.

## Rollback evidence

- Last code-bearing release commit: `408c098`; successful Pages run
  `29871029794`. Later Package 1 handoff/test sync Pages run `29873521094` also
  passed.
- Last preview OTA group:
  `40d1d11d-1d30-4d93-91c4-670df321b198`; Android update
  `019f86bd-0c1f-76c5-b5c4-121b5d03f396`, iOS update
  `019f86bd-0c1f-70d3-8142-6f2284e10bb2`, runtime `1.0.0`.
- Supabase migration 12 is already linked and additive. Do not remove the
  column/function behavior while any Package 2A client can sync; use a forward
  corrective migration if a defect is found.

## Next package

Run Package 2B from the latest signed checkpoint without repeating Package 2A.
