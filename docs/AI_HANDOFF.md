# Helix AI handoff

This is the living continuity record shared by Codex and Claude. It describes
the current working state, not the permanent architecture; durable rules belong
in `AGENTS.md`. Git and the current files are authoritative whenever this note
lags behind them.

## Last verified state

- Updated: 2026-07-15 (Europe/Istanbul)
- Branch: `main`
- Review base: `e22b792` (`origin/main` was at the same commit before this
  documentation task; use `git log -1` for the resulting HEAD)
- Toolchain used: Node 22
- Verification: `npm run typecheck`, `npm test`, and `npx expo lint` all passed
- Test baseline: 9 files, 124 tests passing
- This handoff/protocol task changes documentation only. A push to `main` may
  still run the Pages workflow, but no mobile OTA or native build is required.

## Active working tree

The following pre-existing, user-owned UI changes were present before the
continuity protocol was added. Do not overwrite or fold them into unrelated
work without inspecting the live diff first:

- `src/app/(tabs)/cash-flow/[month].tsx`
- `src/app/(tabs)/cash-flow/index.tsx`
- `src/app/(tabs)/index.tsx`

They adjust cash-flow/dashboard wrapping and investment presentation. Always
re-check `git status` because this list is a snapshot, not a lock.

## Current architecture summary

- Expo SDK 54 / React Native / Expo Router; Node 22 is required locally.
- Local-first async SQLite through Drizzle's `sqlite-proxy`; never restore the
  synchronous bridge.
- User mutations go through `writeRows`; deletes are synced tombstones.
- Supabase sync uses an outbox, server RLS, and LWW merging.
- Money is integer minor units; dates/months are ISO strings.
- Pure business logic lives in `src/domain` and receives unit tests.
- Shared UI primitives and tokens live in `src/ui`; Turkish strings live in
  `src/i18n/tr.ts`.
- Web ships from `main`; app-code changes also require an EAS Update to the
  `preview` branch unless a native rebuild condition applies.

Read `AGENTS.md` for the complete, canonical rules and shipping procedure.

## Open audit backlog

These are static-analysis findings from the 2026-07-15 repository review. They
have not yet been implemented or runtime-reproduced; verify each against the
current code before fixing it.

1. Account freeze can sign out and wipe the local outbox after a failed/offline
   sync because `syncNow` handles errors internally and resolves.
2. Client-clock timestamps can remain ahead of the server-normalized timestamp;
   pull LWW may then reject legitimate remote updates while advancing its cursor.
3. Editing/deleting subscriptions or recurring incomes does not reconcile their
   already-generated `expected_payments`, leaving stale or orphaned items.
4. Transaction type changes do not guarantee that the selected category belongs
   to the new type; analytics also aggregates by category without respecting the
   transaction type, so transfers or mismatched categories can be misclassified.
5. Cell-note editors use random ids despite the existing deterministic natural
   key. The month-detail pseudo-category `uncategorized` can also be written into
   a UUID-shaped remote `category_id`.
6. `Logo` claims fully local rendering but defaults to Google's favicon service;
   no settings toggle currently supplies `allowRemote=false`.
7. Several `numberOfLines` uses, special/non-editable table columns, trailing
   dividers, and manual derivation memos conflict with the UI/Compiler rules in
   `AGENTS.md` and need an app-wide sweep.
8. Foreign subscription totals fall back to treating an unavailable FX amount
   as TRY; JSON restore validation does not validate enums, ranges, dates, or
   relational integrity; person/source deletion can leave orphan references.
9. Onboarding person deletion does not remap draft source `personIndex` values.
10. README/testing counts and the README palette are stale; web HTML language is
    `en`, and Android biometric permissions are duplicated in `app.json`.

## Handoff update contract

At the end of each material task, replace stale information above and append a
short entry below. Keep entries factual and compact; Git history owns the full
chronology. Every entry must include:

- date and agent (`Codex` or `Claude`);
- branch and the pre-change/base commit (the resulting HEAD comes from Git);
- outcome and why;
- files or subsystems changed;
- checks actually run and their results;
- commit/push/web/OTA/native-build state;
- remaining work, risks, or decisions needed.

Never mark another agent's work confirmed without independently inspecting the
diff and running checks proportionate to the change.

## Recent handoffs

### 2026-07-15 — Codex

- Completed a read-only repository-wide architecture and risk review.
- Confirmed typecheck, 124 tests, and Expo lint pass on the existing working tree.
- Added the shared Codex/Claude continuity protocol; no application code changed.
- Existing three-file UI diff remains user-owned and unmodified.
- Runtime deployment: not required for this documentation-only change.
