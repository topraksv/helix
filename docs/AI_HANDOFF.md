# Helix AI handoff

This is the living continuity record shared by Codex and Claude. It describes
the current working state, not the permanent architecture; durable rules belong
in `AGENTS.md`. Git and the current files are authoritative whenever this note
lags behind them.

## Last verified state

- Updated: 2026-07-15 (Europe/Istanbul)
- Branch: `main`
- Review base: `77a7487` (`origin/main` was at the same commit when the current
  12-item recovery task started; use `git log -1` for the resulting HEAD)
- Toolchain used: Node 22
- Verification: `npm run typecheck`, `npm test`, and `npx expo lint` all passed
- Test baseline: 11 files, 138 tests passing
- Static web export passed; headless Playwright rendered the exported sign-in
  route at 320, 390 and 1280 px without horizontal overflow or browser errors.

## Active working tree

The three pre-existing cash-flow/dashboard UI edits have been understood and
completed in the finance presentation package: mobile card wrapping was kept,
while investment/transfer was moved into a supplemental donut legend row so it
does not corrupt expense totals. Always re-check `git status`; the remaining
12-item recovery task continues in subsequent packages.

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
4. Transaction type changes still do not guarantee that the selected category
   belongs to the new type. Analytics now excludes transfers and the analysis
   screen rejects legacy type/category mismatches, but the editor invariant
   remains to be enforced separately.
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

### 2026-07-15 — Codex (finance recovery package)

- Base `77a7487`, branch `main`; preserved and completed Claude's three-file
  unstaged cash-flow/dashboard work instead of resetting it.
- Consolidated every card's earliest pending statement into one dated upcoming
  payment and excluded all card charges from the standalone list; no due day
  means no entry.
- Made expense distribution type-based and mathematically complete, including a
  safe categoryless bucket; transfer shares the legend hierarchy but is excluded
  from arcs, percentages and expense totals. Analysis charts use the same rule.
- Confirmed fixed expenses are installment/subscription-linked and ordinary
  expenses are variable; transfer/income/pending/watch-only rows are excluded.
- Made mobile month cards responsive with a common income/expense/transfer
  hierarchy. Installments now show month-only dates and share plan→note→generic
  title fallback across the installment and ledger screens.
- Checks: typecheck, 10 files/132 tests, Expo lint, static Expo web export and
  Playwright at 320/390/1280 px passed. Authenticated finance-route Playwright
  still needs a valid test session; the repo contains no E2E credential/flow.
- Shipped as `f68be7d`: pushed to `main`, GitHub `deploy-web` completed
  successfully, production returned HTTP 200, and EAS `preview` update group
  `b2d405cc-1f1e-44d2-b723-061f96ce3bb0` published for runtime `1.0.0`.

### 2026-07-15 — Codex (auth recovery package)

- Base `f68be7d`, branch `main`.
- Added Supabase's PKCE password-reset request/exchange/update flow, neutral
  account-enumeration-safe request copy, and distinct expired versus
  invalid/previously-used link screens. Web redirects keep `/helix`; native
  accepts the existing `helix://` deep-link scheme.
- Added device-local per-account login history: dashboard shows the successful
  login before the current session; failed auth, password verification and cold
  starts do not advance it. Existing mid-session users are seeded once.
- Hid the dashboard `Bekleyenler` action whenever the live overdue count is zero;
  it reappears from the same query when an item becomes late.
- Checks: typecheck, 11 files/138 tests, Expo lint and web export pass. Headless
  Playwright intercepted (did not send) a recovery request, verified its neutral
  success and `/helix/reset-password` redirect at 320 px, and rendered expired
  and used/invalid link states at 320/390 px.
- Supabase Dashboard redirect allow-list state cannot be read with the available
  credentials. README records the required production entries
  (`https://topraksv.github.io/helix/**`, `helix://**`); verify them in the
  project dashboard before a real recipient test.
- Commit/push/web/OTA state is pending at this note's write time.

### 2026-07-15 — Codex

- Completed a read-only repository-wide architecture and risk review.
- Confirmed typecheck, 124 tests, and Expo lint pass on the existing working tree.
- Added the shared Codex/Claude continuity protocol; no application code changed.
- Existing three-file UI diff remains user-owned and unmodified.
- Protocol commit `8449e9c` was pushed to `main`; the automatic Pages workflow
  may run, but there is no runtime change and no mobile OTA/native build is
  required.
