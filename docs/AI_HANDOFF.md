# Helix AI handoff

Compact continuity record for Codex and Claude. Git/current files override this
note; durable rules live in `AGENTS.md`, finding status in `AUDIT_TRACKER.md`,
and old chronology in `docs/handoffs/`.

## Current state

- Updated: 2026-07-18 (Europe/Istanbul)
- Work: branch `agent/simplicity-ui-fixes`, base/main `5c2304b`; P11 release is
  not committed or deployed yet.
- Outcome: exact requested light/dark palette; shared quiet controls; standard
  44×44 back; nested tab reset; always-visible month-end forecast; current-month
  donut/bar chart on Summary; unused exports/dependency/assets removed. Current
  diff is net 1.000+ lines smaller.
- Local verification: strict unused typecheck; 48 files/290 Vitest tests;
  zero-warning Expo lint; Expo dependency check; 52-route web export; 10/10
  Playwright flows, axe and 20 responsive light/dark baselines; production
  export/bundle and diff checks. SDK 54 still has 17 moderate transitive
  advisories; its only offered audit fix jumps to SDK 57 and remains
  `BACKLOG-SDK-01`.
- Pending: protected PR/main Pages, live probes and EAS `preview` OTA. No native
  config changed, so no rebuild is expected.

## Stable system and open limits

Expo SDK 54 runs on Node 22. SQLite is async/local-first; writes use atomically
paired outbox rows and Supabase owner-only RLS. Money is integer minor units,
dates are ISO, UI text is centralized in `tr.ts`, and routes consume the stable
`repo.ts` facade. Read `AGENTS.md` before code changes.

Intentionally deferred: SDK/toolchain upgrade, unproven technology rewrites,
calculator relocation, bank/server-push/widget/multi-user expansion and
enterprise patterns. Installed-device/two-client acceptance is still required
for late account switching, remote outbox drain, Face ID, iOS edge-swipe,
VoiceOver/TalkBack/Dynamic Type, OS notification/privacy and low-memory import.

## Update contract

At task end update current branch/base, outcome, changed areas, checks,
commit/push/web/OTA/native state and remaining risks. Keep only five recent
entries; archive the oldest as a compact row. Never call previous work verified
without inspecting its diff and running proportional checks.

## Recent handoffs

### 2026-07-18 — Codex · P11 simplicity and UI regression

- Base `5c2304b`; branch `agent/simplicity-ui-fixes`; release pending.
- Removed dead API/dependency/assets and duplicate chart/header logic; exact
  Claude palette and quieter shared controls; corrected back/tab routing,
  forecast visibility and Summary charts.
- Local gates listed under Current state pass. Physical native acceptance and
  protected release remain outstanding.

### 2026-07-18 — Codex · P8–P10 follow-up

- Base `6b85f1c`; PR #32; main `a249492`; Pages run `29653031390`; EAS group
  `1d2ed181-0dcd-48be-abae-3985d414854b`.
- Removed user diagnostics/global health UI; fixed payment/Analytics/month-end,
  Harem lifecycle, sync polling, back/auth privacy; audit §12 and tracker added.
- 48/289 tests, 9 Playwright, 21 baselines, linked migrations 1–7/lint/24 pgTAP
  passed. Native/two-client checks remained blocked.

### 2026-07-18 — Codex · SDK 54 dependency policy

- PRs #23/#24/#29; final main `8164caa`; Pages run `29648089748`; EAS group
  `885cbc8e-47b3-4bfb-bc31-389379d1a76f`.
- Rejected incompatible Dependabot SDK-stack/invalid-lockfile changes; kept
  security updates open; applied compatible ESLint and Lucide updates. SDK 57
  stayed in `BACKLOG-SDK-01`; full gates passed.

### 2026-07-18 — Codex · P7 automation and docs

- Base `9e31eaa`; PR #20; main `14547c8`; Pages `29646280246`; EAS group
  `105fffc1-1ea0-4db7-bed8-ec5bc03ca930`.
- Added browser SQLite core/restore/offline/deep-link, axe and responsive visual
  gates; fixed web picked-file/backup/a11y/tab issues; task-first README plus
  testing/privacy/release contracts. Full local/remote gates passed.

### 2026-07-18 — Codex · P6 product and IA

- Base `3a59927`; PR #18; main `40c0fea`; Pages `29643476129`; EAS group
  `ea6a17fd-610c-4370-8ce7-91cbb753bcb4`.
- Added transaction search, upcoming timeline, synced budgets and weekly/
  biweekly income; simplified onboarding/IA. Migration 7, 24 pgTAP and full
  gates passed; installed delivery remained unverified.
