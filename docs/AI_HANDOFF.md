# Helix AI handoff

Compact continuity record for Codex and Claude. Git/current files override this
note; durable rules live in `AGENTS.md`. Git history owns the complete
chronology — entries older than the last five are simply dropped.

## Current state

- Updated: 2026-07-19 (Europe/Istanbul)
- Work: Claude's nine-package user audit. P1–5 merged as PR #36 (`e69f386`),
  P6–7 as PR #37 (`e66eeb3`); the P8/P9 branch `fix/audit-p8` starts from
  `e66eeb3`.
- Outcome highlights: logout→login no longer flashes onboarding (grace waits
  for the post-sync onboarded re-read); verifyPassword recovers the e-mail
  after offline bootstrap instead of "Supabase yapılandırılmadı"; semantic
  palette is green income / red expense / amber warning with a hue-contract
  test (purple banned); markets keep a device-local snapshot + dated FX
  fallback (no "—" placeholders) and the converter refreshes stale rates on
  focus; cash-flow phone tools gained captions; subscriptions/incomes share
  the new RuleRow; category deletion cascades to budgets atomically (hook
  inner-joins live categories, maintenance cleans provable orphans only);
  inert operationId layer removed; month detail/cell editor/analysis search
  are real FlatLists (1.200-row scenario: ~160 ms open, ~116 mounted rows);
  README rebuilt with real data screenshots; tsconfig excludes build output.
- Local verification: strict typecheck; 47 files/293 Vitest; zero-warning
  Expo lint; production export within all bundle budgets; 10/10 Playwright
  incl. axe and visual baselines (one cash-flow baseline intentionally
  regenerated for the captioned toolbar); 1.200-transaction virtualization
  measured on the static export. SDK 54 advisories remain `BACKLOG-SDK-01`.
- Release: PR #36 quality + main Pages run `29658175041` (live 200) and OTA
  group `f82de4f5-2e28-468d-9ec8-0ad3f06db24d`; PR #37 quality + OTA group
  `d3461e52-9dfd-436a-8bcd-051d7543e879` (commit `e66eeb3`), Pages run
  `29666823091`. Runtime `1.0.0`, channel `preview`, iOS+Android; no native
  config changed. Installed delivery remains unverified.

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

### 2026-07-19 — Claude · Nine-package user audit (P1–P8)

- Base `7f2e133`; PR #36 → main `e69f386` (Pages `29658175041`, OTA
  `f82de4f5`); PR #37 → main `e66eeb3` (Pages `29666823091`, OTA
  `d3461e52`); P8/P9 continues on `fix/audit-p8`.
- Auth flash/error mapping, semantic palette contract, markets snapshot +
  converter focus refresh, captioned cash-flow tools, shared RuleRow,
  budget cascade on category delete, operationId removal, FlatList
  virtualization, README/tsconfig/docs cleanup.
- Full local gates + protected PR quality passed; 1.200-row virtualization
  measured on the static export. Physical native acceptance still open.

### 2026-07-18 — Codex · P11 simplicity and UI regression

- Base `5c2304b`; implementation PR #34; main `93e12ab`; Pages run
  `29655797800`; EAS group `5abb5e1b-f99a-47da-9e63-ceeab5a864de`.
- Removed dead API/dependency/assets and duplicate chart/header logic; exact
  Claude palette and quieter shared controls; corrected back/tab routing,
  forecast visibility and Summary charts.
- Local, protected PR and main gates passed; live routes and EAS commit/runtime/
  platform metadata match. Physical native acceptance remains outstanding.

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

