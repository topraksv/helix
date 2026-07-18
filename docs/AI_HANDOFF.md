# Helix AI handoff

This is the living continuity record shared by Codex and Claude. It describes
the current working state, not the permanent architecture; durable rules belong
in `AGENTS.md`. Git and the current files are authoritative whenever this note
lags behind them.

## Last verified state

- Updated: 2026-07-18 (Europe/Istanbul)
- Branch: `main`
- Completed remediation package: P1; application commit: `f8f536e`
- Toolchain used: Node 22
- Verification: typecheck, full tests, zero-warning Expo lint, 49-route static
  web export, successful Pages deploy and published iOS/Android EAS update.
  No browser backend or installed-device delivery was available.
- Test baseline: 27 files, 224 tests passing

## Active working tree

An eight-package remediation of Codex's independent 2026-07-17 audit is
active. P0 (scope registry) and P1 (sync poison-row isolation, mutation
locking/idempotency and recurring-income category boundary) are complete.
P2 (CI, GitHub protection and EAS channel/native release contract) is next.
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

### 2026-07-17 — Claude (audit package 3: liveliness and perceived stability)

- Base `b1d886a`, branch `main`. Third audit-remediation package.
- Markets: the 3 s throttle defers a burst payload to the trailing edge
  (payloads merge, later entries win) instead of dropping it — the provider
  re-sends a symbol only on price change, so a dropped payload froze that
  symbol until its next move. Deferred state clears on disconnect; fake-timer
  test added. The card's green dot now claims liveness only in "live" status.
- Hooks: removed the dead `LiveResult.error` surface (zero consumers; the
  promised retry affordance never existed). Retry-forever kept deliberately;
  comments now match behavior. `updatedAt === undefined` is the documented
  loading signal.
- Dashboard: hero balance shows placeholder bars until the ledger loads (no
  transient "₺0"), and the markets card renders full-height with per-symbol
  dashes while connecting instead of popping in (CLS).
- Theme: shared `TAB_BAR` metrics + `tabBarHeight()` now feed both the tab
  layout and the undo snackbar (previously a drifting hardcoded `bottom: 96`);
  new `overlayShadow` token replaces the snackbar's hand-rolled `#000` shadow;
  markets column widths are named constants; sticky-table keyboard steps
  derive from the real `rowHeight`/`cellWidth` props.
- Imports: legacy batch-upgrade SHA-256 digests compute via `Promise.all`.
  Service worker prunes cached assets above 120 entries during an online
  navigation (content-hashed names grew the cache by one build per deploy).
- Checks: typecheck, 24 files/216 tests, zero-warning lint, 49-route export,
  headless smoke (sign-in reached, zero CSP violations, zero console errors).
- Shipped as `5ac5205`, pushed; Pages redeploys. EAS `preview` update group
  `85069d45-a2f1-4e85-b8bf-cc8c5c2d9059` published (iOS
  `019f7006-acdf-77a7-a3e7-2f591d54b7e7`, Android
  `019f7006-acdf-7c92-b7a3-cca4f389d55e`, runtime `1.0.0`); applies on the
  next full close + reopen. Physical feel of the snackbar clearance and the
  hero skeleton still deserve one installed-device glance.

### 2026-07-17 — Claude (audit package 2: data-layer and web hardening)

- Base `4e77a04`, branch `main`. Second audit-remediation package.
- Supabase migration `00000000000005_sync_indexes_and_bounds.sql`: composite
  `(user_id, updated_at, id)` pull index on all 15 synced tables (13 had none
  and seq-scanned every sync; the covered `idx_tx_user_updated` is dropped),
  safe-integer magnitude CHECKs on every money column (blocks rows that would
  crash other devices' `assertMinor`), `installment_no >= 1`, and the
  cell_notes one-live-note-per-cell partial unique index preceded by a
  deterministic keep-newest dedup (tombstones, so LWW propagates them).
  **NOT yet applied remotely** — `supabase db push` was permission-blocked in
  this session (list --linked verified 1–4 in sync, 5 local-only). Applying
  later is safe: the new client write order is harmless against the old
  server schema, only the reverse order was dangerous.
- `saveCellNote` writes the legacy tombstone BEFORE the canonical row so one
  push batch never transiently violates the new index. Local unique mirrors
  were deliberately rejected (documented in the schema header): pulled rows
  sharing one server `updated_at` arrive id-ordered, so a local index could
  wedge the merge.
- Sync pull now requires UUID-shaped server row ids (`isUuidShaped` in
  merge-policy + test) before they become the keyset cursor interpolated into
  the PostgREST `.or()` filter.
- `verifyPassword` returns an error string (null = ok) like every other
  session method: precise wrong-password copy, honest network errors (a
  network failure used to display "Şifre hatalı"), and a local 5-failure/30 s
  cooldown because each verify is a real sign-in against the shared rate
  limit. Both caller screens updated.
- Web shell: CSP meta (connect-src pinned to Supabase/Frankfurter/Harem/self;
  script-src keeps 'unsafe-inline' because the export emits per-build inline
  bootstraps, 'wasm-unsafe-eval' + worker-src keep sqlite booting) and the
  `maximum-scale=1` pinch-zoom lock removed (WCAG 1.4.4).
- Checks: typecheck, 24 files/215 tests, zero-warning lint, 49-route export.
  Headless chromium against the served export under `/helix/`: sign-in screen
  reached (sqlite WASM worker booted), zero CSP violations, zero console
  errors. FX/socket hosts in connect-src were verified against the source
  constants; live post-auth traffic still deserves one installed/web pass.
- Shipped as `0692027`, pushed; Pages redeploys. EAS `preview` update group
  `cf25c807-47d9-4f9e-b818-c981451f6d93` published (iOS
  `019f6f34-547d-7109-af99-1218082e000c`, Android
  `019f6f34-547d-7c1d-8de4-e7a7d4e48163`, runtime `1.0.0`); applies on the
  next full close + reopen. Remaining risk: until migration 5 is applied, the
  new indexes/bounds simply don't exist yet — no behavioral mismatch.
