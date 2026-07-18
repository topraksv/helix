# Helix AI handoff

This is the living continuity record shared by Codex and Claude. It describes
the current working state, not the permanent architecture; durable rules belong
in `AGENTS.md`. Git and the current files are authoritative whenever this note
lags behind them.

## Last verified state

- Updated: 2026-07-18 (Europe/Istanbul)
- Branch: `main`
- Completed remediation package: P3; release commits: `8776f70`, `fa2988e`,
  `b2bd29a`
- Toolchain used: Node 22
- Verification: typecheck, full tests, zero-warning Expo lint, 49-route static
  web export, successful required remote quality/Pages run, linked migration
  list/lint, 19-test remote pgTAP, owner-integrity catalog aggregates, generated
  DB types and EAS channel/update metadata. No browser backend or installed-
  device native rebuild was available.
- Test baseline: 28 files, 227 tests passing

## Active working tree

An eight-package remediation of Codex's independent 2026-07-17 audit is
active. P0–P3 are complete: scope registry; data integrity; CI/GitHub/EAS
release contracts; and linked database/type boundaries. P4 (architecture,
measured performance and production diagnostics) is next.
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

### 2026-07-18 — Codex (audit remediation package 1: data integrity)

- Base `f6009a5`, branch `main`; P1 shipped as `f8f536e`.
- Replaced the unsafe inner `JSON.parse` sync boundary with table-aware
  outbound validation. Malformed JSONB, unknown columns and invalid numerics
  become `invalid_row` dead letters while healthy rows in the same batch keep
  moving; rejected events no longer create a permanent retry loop.
- Added one synchronous operation guard and applied it across critical
  financial, onboarding, auth/recovery, security and settings mutations.
  Transaction/plan/bulk creates accept operation identities; bulk child rows
  and workspace template categories converge deterministically.
- Recurring income now requires a live, owner-scoped income category at the
  repository boundary. Regression tests cover poison-row isolation,
  same-tick operation locking and category ownership/kind validation.
- Checks: typecheck; 27 files/224 tests; zero-warning Expo lint; diff check;
  49-route production web export. Browser runtime discovery returned no
  available backend, so no new visual flow is claimed.
- GitHub Pages run `29636759953` succeeded. EAS `preview` update group
  `df604f34-b0e7-46b0-a190-b0cfe5e52e7a` published for runtime `1.0.0`
  (iOS `019f743f-d498-7f21-bc10-8f3da79f1164`, Android
  `019f743f-d498-73c8-ac58-aed4b37988f3`). Insights immediately after publish
  showed 0 installs/users; installed-device delivery remains unverified and is
  addressed by P2's native channel contract.

### 2026-07-18 — Codex (audit remediation package 0: scope registry)

- Base `115baf8`, branch `main`; the working tree was clean before this task.
- Recovered the previously delivered 2026-07-17 independent audit from the
  local Codex session record as `docs/HELIX_CODEX_AUDIT_2026-07-17.md`; its two
  hard-break trailing-space markers were normalized to blank Markdown lines so
  the repository's whitespace gate remains clean.
- Added `docs/AUDIT_TRACKER.md`, mapping every audit finding, refactor,
  performance task, product opportunity and required test to an ID, package,
  status and acceptance criterion. Only the audit's explicitly deferred ideas
  and Expo SDK 54 advisories are marked `BACKLOG`.
- Package 0 is documentation-only; no application code, dependency, migration,
  remote data or OTA changes. Commit/push/web state and verification are filled
  in when this package closes; the audit remains a snapshot of `115baf8`.

### 2026-07-17 — Claude (audit package 4: scale and final hardening)

- Base `9840b08`, branch `main`. Fourth and final audit-remediation package.
- Shared live queries: the eleven identity-stable hooks (persons, categories,
  transactions, settings…) now run through one reference-counted entry per
  (hook, user) — first subscriber creates it, last one tears it down, same
  debounce/backoff/retry semantics as `useLive`, which remains for parametric
  month windows. Before this, every mounted tab screen re-executed its own
  copy of the same full-table scan on every write.
- Removed all 90 `as never[]` SQL parameter casts after an experiment proved
  them cargo-cult (plain arrays typecheck). The two genuine dynamic-row
  boundaries (`writeRows` upsert args, pull-merge upsert args) each carry one
  narrow, documented `SQLiteBindValue` conversion. Five unrelated `as never`
  UI-generics casts remain (noted in the backlog).
- iOS `NSFileProtectionComplete` entitlement added to `app.json` (rationale
  and rollback trigger recorded in AGENTS.md); verified it resolves in the
  prebuild config. Activates at the next local `npx expo run:ios --device`.
- Checks: typecheck, 24 files/216 tests, zero-warning lint, 49-route export,
  sign-in smoke on the normal build. NEW: a protected-flow smoke on a
  local-only (env-less, cache-cleared) export — headless chromium completed
  onboarding via "Kaydet ve Kullanmaya Başla", reached the dashboard (shared
  hooks + ledger + hero), skipped the first-run tour, switched to Mali Tablo
  and back; zero CSP violations, zero page errors. This is the first
  authenticated-surface browser pass recorded in this repo.
- Shipped as `00eb8f3`, pushed; Pages redeploys. EAS `preview` update group
  `6d7b90e6-f511-48f8-9a6e-bbc9c90e5182` published (iOS
  `019f7014-2d9b-70f7-a9e0-2a02ac2548e5`, Android
  `019f7014-2d9b-76b4-a5b5-b4780f574c11`, runtime `1.0.0`); applies on the
  next full close + reopen.
- Addendum (same day): the user ran `supabase db push` for migration 5;
  Claude independently re-verified — `migration list --linked` 1–5 identical,
  `db lint --linked` clean. `db dump` object inspection is unavailable
  without Docker, but the transactional apply recording version 5 proves
  every statement (including the cell_notes dedup + partial unique index)
  succeeded. Production root probed 200 with the CSP meta in served HTML.
