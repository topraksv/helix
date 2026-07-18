# Helix AI handoff

This is the living continuity record shared by Codex and Claude. It describes
the current working state, not the permanent architecture; durable rules belong
in `AGENTS.md`. Git and the current files are authoritative whenever this note
lags behind them.

## Last verified state

- Updated: 2026-07-18 (Europe/Istanbul)
- Branch: `main`
- Completed remediation package: P6; release commit: `40c0fea`
- Toolchain used: Node 22
- Verification: typecheck, full tests, zero-warning Expo lint, 53-route static
  web export, measured bundle budget, linked Supabase migration/lint/pgTAP,
  required remote quality/Pages run, live product-route HTTP 200 and EAS update
  metadata. Browser discovery returned no backend; Xcode had no simulator
  destination and the physical phone was offline, so installed-device/a11y
  delivery was not available.
- Test baseline: 48 files, 281 tests passing

## Active working tree

An eight-package remediation of Codex's independent 2026-07-17 audit is
active. P0–P6 are complete: scope registry; data integrity; CI/GitHub/EAS
release contracts; linked database/type boundaries; and architecture, measured
performance plus production diagnostics; UI/UX/a11y/privacy; product planning
and information architecture. P7 (persistent test automation, README and final
closure) is next.
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

`docs/AUDIT_TRACKER.md` is now the authoritative audit backlog. Only its five
`BACKLOG-*` items are intentionally deferred: the SDK 54 advisory chain,
unnecessary technology rewrites, calculator-tab removal without usage data,
bank/server-push/widget/multi-user expansion, and enterprise architecture
patterns. Physical VoiceOver/TalkBack/gesture/OTA acceptance still requires an
installed device; code/config work and every automatable check remain in scope.

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

### 2026-07-18 — Codex (audit remediation package 2: release contract)

- Base `965bc54`, branch `main`; release config/workflow commit `28ef0a6` and
  verified Dependabot Actions update `886daa8`.
- Pages now has one release-blocking `quality` job: Node 22 install, typecheck,
  all tests, zero-warning lint and 49-route export must succeed before the
  immutable artefact reaches `deploy`. Third-party Actions are full-SHA pinned;
  npm/Actions Dependabot schedules are checked in.
- GitHub remote verification: `main` requires an up-to-date PR and `quality`;
  admin enforcement is on, force-push/delete are off. Secret scanning, push
  protection and Dependabot security updates were enabled and read back. The
  generated SDK 57 PR was closed against `BACKLOG-SDK-01`; Actions v7 PR #2
  passed `quality` and merged through the new protection.
- `preview` channel exists and maps to `preview`. `app.json` now embeds its
  CNG request header, `eas.json` defines preview/production profiles, and the
  Android placeholder application ID is replaced by `com.toprak.helix`.
  Release/rollback steps live in `docs/RELEASE.md`; config regressions have a
  dedicated test.
- Checks: local typecheck; 28 files/227 tests; zero-warning lint; prebuild/EAS
  iOS+Android config resolution; 49-route export; remote workflow
  `29637115841` quality and deploy succeeded. Browser runtime was unavailable.
- This package changes native config, so no misleading OTA was published. The
  installed iPhone remains unverified until the user runs
  `npx expo run:ios --device`; after that build, two cold starts must prove the
  `preview` channel delivery. This is the only P2 external acceptance gap.
