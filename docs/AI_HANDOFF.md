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
- Test baseline: 13 files, 145 tests passing
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
- Shipped as `3105c93`: pushed to `main`, GitHub `deploy-web` completed
  successfully, production reset route returned HTTP 200, and EAS `preview`
  update group `75caa841-4976-4ea3-81f6-e678700a65fd` published.

### 2026-07-15 — Codex (subscription/import package)

- Base `3105c93`, branch `main`.
- New or edited subscriptions cannot be persisted without a live expense
  category; repo validation protects non-UI callers. A missing category now
  offers a compact `Abonelikler` create-and-save action, reuses normalized live
  matches, or creates/revives one deterministic category. Declining stays in
  the form for manual selection; old categoryless rows still render.
- Excel picker, duplicate-year check and actual import now share a synchronous
  ref-backed operation gate, preventing double starts even before React state
  paints. Only a resolved import shows the green success row/button; exceptions
  retain the error state. The shared Screen exposes its ScrollView ref and the
  success transition animates to the top.
- Checks: typecheck, 12 files/140 tests, Expo lint, static web export and
  Playwright sign-in regression at 320/390/1280 px passed. Protected import and
  subscription screens still lack a repository E2E credential.
- Subscription commit `68b163d` and import commit `a98232d` were pushed to
  `main`. GitHub `deploy-web` run `29406641921` completed successfully and the
  production import route returned HTTP 200. EAS `preview` update group
  `ee73862e-d2c0-4e49-bf09-d19c18db7210` published for iOS and Android.

### 2026-07-15 — Codex (haptic completion package)

- Base `751335b`, branch `main`.
- Preserved the haptic architecture introduced by `099b52b`; completed its
  missing semantics instead of adding a second abstraction. Active tab/chip/
  segment re-taps stay quiet, while real selection changes retain feedback.
- Calculator digit entry is quiet; operator, clear, valid result, divide-by-zero
  and result-apply actions use selection/impact/success/error appropriately.
  Mali Tablo cells and category expansion now give one navigation/selection
  cue. Existing drag start and slot-crossing feedback remains unchanged.
- `src/ui/haptics.ts` now owns all impact/selection/notification dispatch,
  catches unavailable-device failures and stays a no-op outside iOS. Undo
  outcomes use success for confirmations and warning for deletions; delete
  controls suppress their earlier impact so one action does not double-fire.
- Checks: typecheck, 13 files/145 tests, Expo lint and static web export passed.
  Haptic tests cover Android no-op, unchanged-selection suppression, one native
  notification per outcome, unavailable-device fallback and calculator
  semantics. Playwright sign-in regression passed at 320/390/1280 px with no
  overflow or browser errors. Physical Taptic Engine feel still requires a real
  iPhone; browser/Android intentionally cannot exercise it.
- Shipped as `7e2e0c3`: pushed to `main`, GitHub `deploy-web` run
  `29407342257` completed successfully, production returned HTTP 200, and EAS
  `preview` update group `a19b7bb8-9d0d-487c-ab4f-01e667cda956` published for
  iOS and Android.

### 2026-07-15 — Codex

- Completed a read-only repository-wide architecture and risk review.
- Confirmed typecheck, 124 tests, and Expo lint pass on the existing working tree.
- Added the shared Codex/Claude continuity protocol; no application code changed.
- Existing three-file UI diff remains user-owned and unmodified.
- Protocol commit `8449e9c` was pushed to `main`; the automatic Pages workflow
  may run, but there is no runtime change and no mobile OTA/native build is
  required.
