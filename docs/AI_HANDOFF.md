# Helix AI handoff

This is the living continuity record shared by Codex and Claude. It describes
the current working state, not the permanent architecture; durable rules belong
in `AGENTS.md`. Git and the current files are authoritative whenever this note
lags behind them.

## Last verified state

- Updated: 2026-07-16 (Europe/Istanbul)
- Branch: `main`
- Review/remediation base: `22d7bfb` (use `git log -1` for resulting HEAD)
- Toolchain used: Node 22
- Verification: `npm run typecheck`, `npm test`, and `npx expo lint` all passed
- Test baseline: 22 files, 195 tests passing
- Static web export passed; headless Playwright rendered the exported sign-in
  route at 320, 390 and 1280 px without horizontal overflow or browser errors.
  Production Playwright also rendered expired and invalid password-reset states
  at 320/390 px and sign-in at 1280 px with zero browser errors.

## Active working tree

The repository-wide remediation requested on 2026-07-15 is in progress. The
account lifecycle, sync ordering, financial classification, import/restore,
derived obligations/references, credit-card statement, external-data/privacy,
navigation/UI regression, identity/relational restore, UI/table consistency and
onboarding/config consistency packages are shipped. The controlled repository
boundary split, optimization audit and final regression remain. Always re-check
`git status`; Git remains authoritative.

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

No verified P8–P10 findings remain open. The next bounded task is the
characterization-test-backed `repo.ts` boundary split; do not turn it into a
feature rewrite or broad folder migration.

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

### 2026-07-16 — Codex (onboarding and configuration consistency package)

- Base `38600ac`, branch `main`; shipped as `5f2fcb7`.
- Removing a watched person during onboarding now remaps draft payment-source
  ownership deterministically: that person's sources return to self and later
  owner indices shift with the person list. Repository seeding rejects missing,
  ambiguous or dangling owners instead of silently assigning invalid input.
- Removed duplicated Android biometric permissions from `app.json`; Expo SDK
  54's local-authentication plugin resolves each permission exactly once.
  Turkish web language/metadata, README palette/test counts, project layout and
  the onboarding manual scenario now match the implementation.
- Typecheck, 22 files/195 tests, Expo lint, resolved prebuild config and static
  web export passed. The exported HTML contains Turkish language/description
  metadata. The session exposed no controllable browser instance, so P10 did
  not add a new pixel-level Playwright result; this limitation is explicit
  rather than inferred as a pass.
- Pushed to `main`; GitHub web run `29483841037` completed successfully and the
  production Sign In and Setup routes returned HTTP 200. EAS `preview` update
  group `c701acad-7ca5-4760-a4b4-c02bb3ed40a0` was published for iOS and
  Android on runtime `1.0.0`. The Android permission-source cleanup takes
  effect in the next native Android binary; the existing binary already has
  the same required permissions and the JS functionality shipped by OTA.
- The controlled repository split, optimization/security/dead-code audit and
  P11 final regression remain.

### 2026-07-16 — Codex (UI and table consistency package)

- Base `bff7f19`, branch `main`; shipped as `2b34599`.
- Mali Tablo's modal editor now exposes ordinary and computed columns through
  one segmented surface. Computed columns gained the same drag ordering,
  edit/delete and visibility controls as categories. Imported-year membership
  now respects `isColumn=false` instead of silently re-showing a hidden column.
- Ay Başı and Güncel Bakiye are the only inert system columns. Missing/deleted
  category history remains financially visible through a compact repair row
  outside the matrix; its yearly/monthly drill-down leads to editable source
  transactions. Categoryless pending rows follow the existing table-visibility
  setting without affecting realized balances.
- Removed unused text-line caps, eliminated trailing list separators, moved
  subscription lists to `CardList`, and removed manual derivation memos now
  owned by the React Compiler. The `_layout` provider/callback stability memos
  remain intentionally because they are effect/context identities.
- Typecheck, 21 files/192 tests, Expo lint and production static export passed.
  Anonymous Playwright smoke passed at 320/390/1280 px with no overflow or
  browser errors. Both retained authenticated browser profiles had expired, so
  protected column drag/edit interaction still needs the installed-app pass.
- Pushed to `main`; GitHub web run `29481507756` completed successfully and the
  production column-editor route returned HTTP 200. EAS `preview` update group
  `d75a2be8-69fb-4402-825e-d264c539e68e` was published for iOS and Android on
  runtime `1.0.0` after two transient storage-DNS failures; no native rebuild
  was required. P10 onboarding/config, controlled repository split,
  optimization audit and P11 regression remain.

### 2026-07-16 — Codex (identity and relational-restore package)

- Base `58bec03`, branch `main`; shipped as `20f5c23`.
- Cell-note saves now use the existing deterministic month/category natural key.
  Editing a legacy random-id note atomically tombstones it while writing the
  canonical row, and the UI-only categoryless group can no longer be persisted
  as a category relation.
- JSON restore now accepts the ISO timestamps the app actually writes for paid
  and cancelled lifecycle rows, while rejecting malformed UUIDs, duplicate ids,
  mixed-account bundles, invalid computed-column definitions and dangling
  relationships. Partial backups may resolve parents already present in the
  active account; every table is read once and validation still finishes before
  the single atomic `writeRows`.
- Typecheck, 21 files/190 tests, Expo lint and production static export passed.
  Playwright rendered the exported recovery flow at 320/390/1280 px without
  overflow or browser errors. Protected restore/cell-note interaction still
  requires an authenticated installed-app pass.
- Pushed to `main`; GitHub web run `29475992198` completed successfully and the
  production Sign In route returned HTTP 200. EAS `preview` update group
  `d8a7ae31-1c5d-41eb-960f-2f53f8573cab` was published for iOS and Android on
  runtime `1.0.0`; no native rebuild was required. P9 UI/table consistency, P10
  onboarding/config, controlled repository split and final regression remain.

### 2026-07-16 — Codex (navigation and finance-card UI regression package)

- Base `34f1e83`, branch `main`; shipped as `c873ca8`.
- Every root, Settings and Cash Flow header now uses a shared safe back control;
  explicit Done/close actions use the same history-or-parent rule. Nested stacks
  have an `index` anchor. A rejected root anchor was caught by Playwright because
  it mounted authenticated hooks on Sign In, and was removed before shipping.
- Budget Summary includes positive Investment/Transfer values in donut geometry,
  percentages and the displayed total. Month cards use three equal centred
  stats. Installment progress and credit-card cycle dates use separate readable
  metadata chips instead of crowded dot-separated lines.
- Future-dated transaction settings now form one aligned list row. Subscription
  logos resolve automatically with the existing validated public-host, disk
  cache and local-fallback boundary; the technical end-user toggle was removed.
  Password recovery is a full-width Sign In action and is also available from
  Account Security. Calendar sheets use a standard Cancel action instead of a
  floating close glyph. Live Markets always lists USD and EUR, showing a dash
  only until their valid Harem quote arrives.
- Typecheck, 21 files/186 tests, Expo lint and static export passed. Playwright
  exercised the visible password-recovery action at 320/390/1280 px with no
  overflow or browser errors. Harem's live payload was independently observed
  carrying valid `USDTRY` and `EURTRY` entries. Protected finance-route visuals
  still need the installed authenticated app/device pass.
- Pushed to `main`; GitHub web run `29452873110` completed successfully and the
  production root, Settings and Cash Flow routes returned HTTP 200. EAS
  `preview` update group `e0c7aa66-d1c8-492e-a19e-84574c66c6e9` was published
  for iOS and Android on runtime `1.0.0`; no native rebuild was required.

### 2026-07-15 — Codex (external data and device privacy package)

- Base `be3ba37`, branch `main`; shipped as `b54315f`.
- FX fetches now have session cancellation, a 10-second timeout, response bounds
  and strict TCMB/Frankfurter parsing. Provider business dates are preserved,
  identical rates do not churn the outbox, caches are user-scoped, historical
  confirmations use historical rates and unsafe conversions are rejected.
- Foreign subscriptions without a rate are explicitly excluded from personal
  and watched totals instead of being counted as TRY. Live market quotes carry
  a local receipt time, expire after 60 seconds and the socket closes while the
  app is backgrounded, locked or signed out.
- Notifications and remote logos are device-local opt-ins. Permission is only
  requested from Settings; disabled/sign-out/account-switch flows clear account
  notifications. Logos default to local marks; enabled favicon URLs accept only
  validated public hostnames and use disk caching/fallback.
- Typecheck, 20 files/183 tests, Expo lint and static export passed. Playwright
  rendered sign-in/recovery at 320/390/1280 px without browser errors or
  horizontal overflow. Physical permission prompts, Notification Center cleanup
  and socket background behavior still require the installed app/device pass.
- Pushed to `main`; GitHub web run `29446420883` completed successfully and the
  production root and Subscriptions routes returned HTTP 200. EAS `preview`
  update group `83ec6197-ac26-4d00-a46a-45eec9486385` was published for iOS and
  Android on runtime `1.0.0`; no native rebuild was required.

### 2026-07-15 — Codex (credit-card statement periods package)

- Base `7dc353b`, branch `main`; shipped as `79a6a21`.
- Added synced, immutable card statement periods plus separate purchase and
  ledger-effective dates. New/onboarding/imported cards require cut-off and due
  days in both UI and repository validation. Single charges, installments and
  card-paid subscriptions link to deterministic statements; the dashboard
  groups only persisted periods and never derives a date from today.
- Existing ambiguous one-off history is not guessed or moved. Configured
  pending installments are repaired to the real due day, while realized plan
  rows remain immutable. Plan edits cannot delete/rewrite paid installments;
  plan deletion is atomic. Source reassignment requires a configured card when
  card plans depend on it and preserves realized accounting dates.
- SQLite/Drizzle and Supabase migrations add the statement table and transaction
  links. JSON backup validation, CSV export, Excel cycle capture, statement
  history UI and shared date display were updated. Pure cycle/date tests cover
  cut-off boundaries, cross-month due dates and short months.
- Typecheck, 19 files/173 tests, Expo lint and static export passed. Playwright
  rendered the exported sign-in route at 320/390/1280 px without browser errors
  or horizontal overflow. Supabase migrations 2–4 were applied and the linked
  local/remote migration histories match.
- Pushed to `main`; GitHub web run `29441674489` succeeded and production
  payment-source settings returned HTTP 200. EAS preview update group
  `439e0192-2dc5-4277-a35e-6aa2e84b7957` was published for iOS and Android.

### 2026-07-15 — Codex (expected lifecycle and references package)

- Base `8e76ffb`, branch `main`.
- Watch-only subscriptions/incomes no longer generate dashboard obligations;
  maintenance tombstones legacy unpaid watch-only derivatives. Personal and
  watched subscription/installment totals now render separately and watched
  totals explicitly stay outside balance/analytics.
- Subscription/income upserts atomically reconcile today's/future pending rows,
  preserve overdue obligations for active rules and preserve paid/skipped
  history. Inactive/delete flows remove unpaid derivatives; undo restores the
  root and exact expected snapshots. Expected lookup is user-scoped, state
  transitions are guarded and paid undo tombstones its transaction atomically.
  Trial schedules cannot charge before the trial boundary.
- Person/payment-source deletion now blocks on live references, shows per-domain
  counts and offers explicit reassignment (or nullable source clearing). Root
  tombstones and every referencing row move in one `writeRows`; duplicate-self
  maintenance repair is atomic too.
- Typecheck, 17 files/164 tests and Expo lint pass. Static export, browser smoke
  and shipping follow this package's commit.

### 2026-07-15 — Codex (atomic import and restore package)

- Base `a1e9b39`, branch `main`.
- JSON backups now have byte/row/text bounds and reject the entire file on a
  bad required field, unsafe integer, enum, calendar date or settings JSON.
  Accepted rows across every table are committed by one `writeRows`, with
  table-level LWW lookups replacing the former row-by-row queries.
- Excel parsing has byte/sheet/row/column/cell/text bounds, validates numeric
  month ranges and rejects money outside safe minor-unit integers. Re-import
  replacement now commits prior tombstones, new categories/transactions/notes,
  reconstructed plans, column membership, batch metadata and opening settings
  atomically. Batch v2 owns plan/generated-row ids; deterministic detection
  safely upgrades legacy import batches. Category matching normalizes whitespace
  and includes category kind; add-mode column membership is a union.
- Typecheck, 17 files/161 tests, Expo lint, static export and Playwright sign-in
  smoke at 320/390/1280 px passed. Shipped as `8e76ffb`: GitHub web run
  `29431713083` succeeded and EAS preview update group
  `a56c022b-6cff-46c9-aae4-8ea3d82ec260` was published after transient DNS
  upload retries.

### 2026-07-15 — Codex (financial classification package)

- Base `95edde9`, branch `main`.
- Canonical refunds/reversals now keep the original category/type and store a
  signed negative amount. A shared domain normalizer gives legacy mismatches the
  same cash effect immediately; maintenance persists their equivalent canonical
  form without changing any balance.
- Transaction UI/repository enforce category-kind parity, expose a clear refund
  control, and retain the applied FX rate. Ledger cells, expense distribution,
  fixed/variable totals, forecasts and search display use the same flow rule.
- Donuts keep positive arc geometry, list refunds separately and display the net
  ledger-compatible expense total. Manual bulk history is now past-month only.
- Typecheck, 16 files/157 tests, Expo lint, static export and Playwright sign-in
  smoke at 320/390/1280 px passed. Shipped as `a1e9b39`: GitHub web run
  `29430809369` succeeded and EAS preview update group
  `a465ab48-5d4c-4831-9704-f944b8c73ff7` was published.

### 2026-07-15 — Codex (server-authoritative sync package)

- Base `5f5a625`, branch `main`.
- Pushes now request the server-normalized row and repair the local LWW clock
  only when no newer local edit arrived during the request. Pull validates the
  complete page before merge/cursor advancement; corrupt local timestamps no
  longer reject a valid remote row forever.
- Malformed/cross-account outbox entries move to the new local-only
  `sync_dead_letters` migration instead of being silently deleted. Exact event
  ids are removed only after push acknowledgement/quarantine commits.
- Added pure conflict/batch tests. Typecheck, 15 files/153 tests, lint, static
  export and Playwright smoke passed. Shipped as `95edde9`: GitHub web run
  `29422395799` succeeded and EAS preview update group
  `a7abf127-ca58-40e9-a185-e2b87223f34c` was published after a transient DNS
  upload retry.

### 2026-07-15 — Codex (account lifecycle safety package)

- Base `22d7bfb`, branch `main`.
- Added a user-scoped session epoch: sync requests are abortable, late responses
  cannot clear outbox/merge rows after an account switch, and sign-out waits for
  registered maintenance/FX/notification work before wiping SQLite.
- Sign-out now keeps the authenticated workspace open and reports an error when
  the local wipe fails. Freeze now requires a successful outbox flush and rolls
  its flag back instead of destroying offline changes.
- SecureStore token replacement removes obsolete chunks; logout also purges
  orphan chunks left by older versions.
- Typecheck, 14 files/150 tests, Expo lint, static web export and Playwright
  sign-in/recovery smoke at mobile and desktop widths passed. Shipped as
  `5f5a625`: pushed to `main`, GitHub web run `29418964753` succeeded, and EAS
  preview update group `8911df9e-2122-4143-b474-f9b4448ef74d` was published.

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

### 2026-07-15 — Codex (balance reconciliation completion)

- Base `0491cf7`, branch `main`.
- Preserved Claude's `04d09b9` design: today's deterministic
  `balance_adjustments` row stores real minus computed balance, so neither the
  configured opening nor earlier months are rewritten and analytics remains
  free of fake income/expense.
- Completed the missing product surface: live adjustments are listed with date,
  note and amount in the editor, can be tombstoned with undo, and also appear as
  a separate line in the affected month summary. Re-correcting the same day
  replaces one row; returning to the unadjusted total tombstones the zero row.
- Prevented the async ledger's pre-load state from appearing as a real zero.
  Repo lookup now scopes by user. Because payment sources have no independent
  opening/current balances in the data model, reconciliation intentionally
  targets the aggregate Helix balance and the UI states that limitation.
- Checks: typecheck, 13 files/147 tests, Expo lint and static web export pass.
  Tests cover same-day convergence, zero removal math, signed adjustments, and
  exact preservation of January/opening/all months before the correction.
  Playwright sign-in regression passed at 320/390/1280 px without overflow or browser
  errors; the protected balance screen still lacks a repository E2E credential.
- Shipped as `011dbbc`: pushed to `main`, GitHub `deploy-web` run
  `29407854836` completed successfully, production root and balance routes
  returned HTTP 200, and EAS `preview` update group
  `57c127c3-e8fd-4315-8c5f-75f3f5463b72` published for iOS and Android.

### 2026-07-15 — Codex (final upcoming-payment regression)

- Base `704bc20`, branch `main`.
- Final cross-feature review found the statement-collapse filter also excluded
  genuine bank/cash loan installments. Card-sourced rows still collapse into
  one statement, while non-card installments now remain standalone obligations
  on their explicit dates; month-only aggregates remain excluded.
- Typecheck, 13 files/147 tests, Expo lint and static web export pass. Shipped as
  `f8f1b68`: pushed to `main`, GitHub `deploy-web` run `29408095598` completed
  successfully, production returned HTTP 200, and EAS `preview` update group
  `119fe6db-9092-497a-be1b-e376786fd2c0` published for iOS and Android.

### 2026-07-15 — Codex (final analytics regression)

- Base `3b3feb3`, branch `main`.
- Final chart review found that the analysis screen's aggregate period and
  monthly charts still applied category-kind parity before calling the shared
  distribution logic. A legacy expense assigned to a stale income category
  could therefore disappear even though its transaction type was authoritative.
- Aggregate charts now use every eligible transaction and let
  `distributionForRange` classify by type; category-kind parity remains limited
  to category-detail rows.
- Typecheck, 13 files/147 tests, Expo lint, static web export and Playwright
  sign-in regression at 320/390/1280 px passed without overflow or browser
  errors. Shipped as `d8b762f`: pushed to `main`, GitHub `deploy-web` run
  `29408718295` completed successfully, and EAS `preview` update group
  `71bef391-16d6-43f6-b14e-92558d8d8617` published for iOS and Android.

### 2026-07-15 — Codex

- Completed a read-only repository-wide architecture and risk review.
- Confirmed typecheck, 124 tests, and Expo lint pass on the existing working tree.
- Added the shared Codex/Claude continuity protocol; no application code changed.
- Existing three-file UI diff remains user-owned and unmodified.
- Protocol commit `8449e9c` was pushed to `main`; the automatic Pages workflow
  may run, but there is no runtime change and no mobile OTA/native build is
  required.
