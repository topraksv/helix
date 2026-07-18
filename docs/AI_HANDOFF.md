# Helix AI handoff

This is the living continuity record shared by Codex and Claude. It describes
the current working state, not the permanent architecture; durable rules belong
in `AGENTS.md`. Git and the current files are authoritative whenever this note
lags behind them.

## Last verified state

- Updated: 2026-07-18 (Europe/Istanbul)
- Branch: `main`
- Completed remediation package: P7; release commit: `14547c8`
- Toolchain used: Node 22
- Verification: typecheck, 49 files/286 tests, zero-warning Expo lint,
  53-route static web export, measured bundle budget and 7/7 Playwright flows
  (real browser SQLite/restore/offline/deep-link, axe and 13 screenshot
  baselines). Protected PR quality and main quality→Pages passed; live static
  routes and dynamic fallback shell responded; EAS OTA metadata and initial
  insights were queried. Browser discovery returned `[]`, and no installed
  device was available, so physical screen-reader/OS/privacy/OTA acceptance is
  not claimed.
- Test baseline: 49 files, 286 Vitest tests plus 7 Playwright flows passing

## Active working tree

The eight-package remediation of Codex's independent 2026-07-17 audit is
complete and shipped. P0–P7 cover the scope registry; data integrity;
CI/GitHub/EAS release contracts; linked database/type boundaries; architecture,
measured performance and diagnostics; UI/UX/a11y/privacy; product and IA; plus
persistent browser automation and final documentation.
`docs/AUDIT_TRACKER.md` is the ID/status source of truth.

The four-package 2026-07-17 audit remediation is COMPLETE and fully deployed:
1 hygiene/docs (`98fa44f`), 2 data-layer/web hardening (`0692027`),
3 liveliness (`5ac5205`), 4 scale (`00eb8f3`) — web + mobile OTA. Supabase
migration 5 was applied by the user via `supabase db push` and independently
verified by Claude afterwards: `migration list --linked` shows 1–5 identical
on both sides and `db lint --linked` reports no errors. (The partial unique
index on cell_notes creating successfully also proves the dedup left no
conflicting live rows.) Those packages remain the trusted baseline; the newer
Codex audit found additional work now tracked by ID. The user explicitly keeps
the audit's “şimdi yapılmamalı” items and Expo SDK 54 advisories in backlog;
everything else is active scope. Always re-check `git status`; Git remains
authoritative.

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

`docs/AUDIT_TRACKER.md` is the authoritative audit backlog. Its five
`BACKLOG-*` items are intentionally deferred: the SDK 54 advisory chain,
unnecessary technology rewrites, calculator-tab removal without usage data,
bank/server-push/widget/multi-user expansion, and enterprise architecture
patterns. Five acceptance rows remain `BLOCKED` only on an installed device or
two disposable authenticated clients: account-switch late work, remote outbox
drain after offline relaunch, physical screen readers/Dynamic Type, low-memory
hostile-import stress, and OS notification/privacy behavior. No automatable P7
implementation work remains.

## Handoff update contract

At the end of each material task, replace stale information above and append a
short entry below. Keep entries factual and compact; Git history owns the full
chronology. **Keep at most the last 5 entries here** — when adding a sixth,
move the oldest into `docs/handoffs/<year-month>.md` (create it if missing).
Every entry must include:

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

Older entries are archived verbatim in `docs/handoffs/` (currently
`2026-07.md`); only the newest entries live here.

### 2026-07-18 — Codex (audit remediation package 7: automation and closure)

- Base `9e31eaa`; implementation branch `agent/p7-tests-docs`, protected PR
  #20, squash release commit `14547c8`.
- Added release-blocking browser SQLite coverage for onboarding, transaction
  add/edit/delete/undo, backup clean-context restore, relational invalid zero
  write, offline cold relaunch and deterministic deep links. Axe covers six
  primary routes; 13 versioned baselines cover 320/390/768/1440 light/dark and
  all five tabs. Ubuntu's measured 2–3% glyph-only rasterization delta has a 4%
  CI ceiling while macOS remains at 1%.
- Fixed web picked-file reading, local-only backup owner validation, decorative
  image/spinner/checked-state semantics, readable active-tab color and 320px
  full tab labels. Pages dynamic fallback now uses the root shell without React
  hydration #418. Supabase client moved to 2.110.7; SheetJS 0.20.3 remains the
  current official CDN tarball.
- README is task-first with real product screenshots and a user-facing flow;
  `TESTING.md`, `PRIVACY.md` and `RELEASE.md` now state the executable quality,
  privacy, environment, rollback and device-acceptance contracts.
- Checks: local typecheck; 49 files/286 tests; zero-warning lint; 53-route
  export; bundle budget; 7/7 Playwright. PR run `29646126353` and main
  quality→Pages run `29646280246` passed. Live root/upcoming/settings/
  diagnostics returned 200; the dynamic month URL served the expected root
  `404.html` shell. Browser discovery returned `[]`, so no live visual claim.
- EAS `preview` group `105fffc1-1ea0-4db7-bed8-ec5bc03ca930`, runtime `1.0.0`
  (iOS `019f7573-3f9e-7b34-b594-a5d55164c5bd`, Android
  `019f7573-3f9e-7d5f-ae18-ee8a9d4dc999`) published from `14547c8`. Initial
  insights showed zero installs/failures on both platforms. All automatable
  audit work is closed; five intentional backlog and five device/client-blocked
  acceptance rows remain explicitly tracked.

### 2026-07-18 — Codex (audit remediation package 6: product and IA)

- Base `3a59927`; implementation branch `agent/p6-product-ia`, protected PR
  #18, squash release commit `40c0fea`.
- Onboarding now defaults to a one-action quick start with optional balance and
  progressively disclosed advanced/import paths. Dashboard removed duplicate
  analysis; account freeze moved under Security; backup/export/restore is a
  distinct task group. Shell sync health stays quiet unless a real error or an
  outbox item has waited at least five minutes.
- Analytics gained bounded transaction search by text, period, type, category
  and payment source. A unified upcoming timeline combines subscriptions,
  recurring income, future transactions and credit-card statements with
  month groups, source drill-down and explicit stale/offline states.
- Added synced category budgets and monthly/weekly/biweekly income cadence.
  Linked migration 7 is live; local/remote versions 1–7 match, linked lint has
  zero errors and 24/24 pgTAP assertions passed in one rollback transaction.
- Checks: typecheck; 48 files/281 tests; zero-warning lint; 53-route export;
  bundle budget and diff check. PR run `29643400089` and main Pages run
  `29643476129` passed; live root/upcoming/budgets/analytics returned 200.
- EAS `preview` group `ea6a17fd-610c-4370-8ce7-91cbb753bcb4`, runtime `1.0.0`
  (iOS `019f751c-90ad-7ff5-82d3-fb4bbcdc34e3`, Android
  `019f751c-90ad-7fd6-932d-7fcac54ae74b`) published from `40c0fea`. Installed
  delivery remains unverified; P7 owns permanent E2E/SQLite/device matrices,
  README/privacy/release documentation and final tracker closure.

### 2026-07-18 — Codex (audit remediation package 5: UI, a11y and privacy)

- Base `627c297`; implementation branch `agent/p5-ui-a11y-privacy`, protected
  PR #16, squash release commit `e04fc39`.
- Shared controls now expose persistent labels, role/state/hint, announced
  errors/loading, heading focus/return for custom modals and full chart/table
  summaries. Accent fills are separate from AA foreground roles; light/dark
  contrast and no-truncation contracts are automated.
- Cash-flow keeps every feature visible at 320px with a full-width primary CTA
  and bounded tool row; payment actions stack below copy on narrow phones.
  Critical forms share a real-snapshot dirty-exit guard without prompting for
  untouched inline editors or async defaults.
- Lock-screen copy is neutral by default, financial detail requires explicit
  device-local consent, pending previews clear fail-closed, and the queue keeps
  the soonest 60. Native inactive/background and framed web states render an
  isolated sensitive-data-safe privacy modal.
- Checks: typecheck; 43 files/268 tests; zero-warning lint; 50-route export;
  bundle budget and diff check. PR run `29642256028` and main Pages run
  `29642316030` passed; live root/settings returned 200.
- Browser discovery returned `[]`; Xcode had no simulator destination and the
  physical phone was offline, so no viewport, VoiceOver/TalkBack or app-switcher
  timing claim is made. No EAS simulator session/build was started.
- EAS `preview` group `6eaac67f-9986-426a-ba39-951a49dc5489`, runtime `1.0.0`
  (iOS `019f74f5-c06d-768a-8985-5cd724369654`, Android
  `019f74f5-c06d-7c15-b3fd-55e183817336`) published from `e04fc39`. Immediate
  insights were zero installs/users/failures. P6 owns onboarding/product/IA;
  P7 owns persistent component/E2E/screenshot/device acceptance.

### 2026-07-18 — Codex (audit remediation package 4: architecture, scale and diagnostics)

- Base `c89c589`; implementation branch
  `agent/p4-architecture-performance-diagnostics`, protected PR #14, squash
  release commit `775cf9e`.
- Live SQLite snapshots now distinguish loading/refreshing/ready/stale/error,
  preserve last-good data and expose retry. Dashboard and Mali Tablo consume
  explicit state; root guard query failure cannot mount protected screens.
  Dashboard, matrix, import planner and route guard are pure models with parity
  tests; biometric/maintenance/market lifecycle left the root component.
- Ledger keeps its measured O(T+M) model but drops the normal second balance
  scan; dashboard aggregates in one pass; card splits scan once, not per month;
  long nested transaction lists render 80-row pages. The permanent benchmark
  covers 1k/10k/100k ledger plus 100k dashboard/matrix budgets.
- XLSX is a lazy web chunk and ZIP size/ratio is inspected before inflation.
  Backup exports build table-by-table; restore consumes 400-row batches in one
  transaction. Web entry measured 5.07→4.60 MB, fonts 36→8 and total export
  ~15→9.48 MB; `bundle:check` now blocks regressions in CI.
- Added a PII-free device-local diagnostics screen/export: update/runtime,
  sync/outbox age, dead-letter distribution, migration and a 12-event redacted
  ring. Market feed now states its unofficial source and exposes live/stale/
  unavailable/fallback health instead of silently disappearing.
- Checks: local typecheck; 37 files/250 tests; lint; 50-route export and bundle
  budget. PR quality run `29640068231` and final Pages run `29640137815`
  succeeded; live `/helix/` and `/helix/diagnostics` returned 200. Browser
  discovery returned no backend, so no viewport click/screenshot is claimed.
- EAS `preview` group `57ded800-43bf-444f-abf8-780d67eddd27`, runtime `1.0.0`
  (iOS `019f74b1-b48d-71eb-b5d9-cdfa5bb83bc0`, Android
  `019f74b1-b48d-79f3-bc22-539ca2e543f4`) published from `775cf9e`. Two uploads
  hit the known Google Storage `getaddrinfo` failure; a command-scoped resolver
  preload completed the unchanged third upload and was deleted. Immediate
  insights: zero installs/users/failures, so installed-device delivery remains
  unverified. P5 owns UI/a11y/privacy; P7 owns real SQLite/E2E/device matrices.

### 2026-07-18 — Codex (audit remediation package 3: DB and type boundaries)

- Base `6f16977`, branch `main`; P3 shipped through protected PRs as
  `8776f70`, `fa2988e` and `b2bd29a`.
- Enabled `noUncheckedIndexedAccess` and replaced unsafe collection access at
  UI, domain, import, sync and test boundaries with explicit guards/helpers.
  Linked Supabase types are generated in `src/sync/database.types.ts`; the
  typed client has one documented dynamic-table cast after runtime validation.
- Remote migration 6 added and validated 19 owner-aware composite FKs,
  category-kind/polymorphic-reference triggers, and 60 owner policies scoped
  to `authenticated` with init-plan `(select auth.uid())`. Its fail-safe first
  attempt rolled back on 121 legacy refund rows; anonymous aggregate evidence
  showed exactly `income + positive + expense category`. The final migration
  canonicalized them to signed expense refunds without changing balance effect.
  Post-migration aggregate: zero mismatches, 19 validated FKs, 60 authenticated
  and 60 init-plan policies.
- Remote verification: migration list local/remote 1–6 identical; linked DB
  lint zero errors; pgTAP 19/19 (`finish(true)`) covered A own CRUD, B isolation,
  owner change/cross-owner relation rejection, category/ref corruption and anon
  denial. CLI's linked runner required unavailable Docker, so the same SQL ran
  via Supabase's official Management API in one rollback transaction.
- Checks: typecheck; 28 files/227 tests; zero-warning lint; 49-route export;
  required PR quality runs `29637897894`, `29638087647`, `29638400078`; final
  Pages run `29638482754` succeeded. No browser backend was available.
- EAS `preview` group `fb85064c-5fd9-4644-b547-129562a232e5` published from
  clean commit `b2bd29a` for runtime `1.0.0` (iOS
  `019f7476-fcd4-79a8-b88c-4cb2797d6f9d`, Android
  `019f7476-fcd4-7044-84b7-4f4ef69f50f9`). Immediate insights showed zero
  users/installs. Installed-device delivery is not verified; P2's local native
  rebuild and two-cold-start requirement still applies.
