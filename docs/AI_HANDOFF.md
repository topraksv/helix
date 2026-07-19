# Helix AI handoff

Compact continuity record for Codex and Claude. Git/current files override this
note; durable rules live in `AGENTS.md`. Git history owns the complete
chronology — entries older than the last five are simply dropped.

## Current state

- Updated: 2026-07-19 (Europe/Istanbul)
- Work: Claude's final authoritative closure audit from base `c149353`, on
  branch `audit/final-authoritative-closure` (PR #43).
- The previous audit (PR #42) is merged as `c149353`; its fixes were verified
  present and left alone. This pass found the defects it did not.
- Two blocking bugs, both root-caused rather than masked:
  - `useLive` carried a snapshot across a `deps` change, so `updatedAt`
    reported a completion that never happened for the new parameters. The route
    guard reads `updatedAt == null` as "still resolving", so after logout →
    login the wiped local database answered `onboarded = false` and an existing
    account was redirected to Quick Start for ~2 s. Snapshots are now dropped
    when the parameters change; `readSyncedFlag` replaces the parsing the two
    guard flags duplicated verbatim.
  - Account freeze persisted `account_frozen` before its network work but only
    cleaned up on the happy path and two returned-error paths. A rejection
    escaped into a floating `void`, leaving the account frozen and `isFreezing`
    stuck — that flag suppresses the reactivation gate, so the button appeared
    to do nothing and the next launch opened locked. Now
    `src/auth/freeze.ts` with injected effects, one rollback path, an honest
    message when even the rollback fails, and the screen's shared operation
    guard around the whole flow.
- UI: the refund row painted itself in `primarySoft`, the toggle's own active
  track colour, so the switch rendered at exactly 1.00:1. Measuring showed
  every switch sat at 1.10–1.93:1 against its surface, so `controlBorder` (long
  documented, never implemented) was added and the shared track given its own
  outline. Analysis now returns to whichever screen opened it. Categorical chart
  series reordered so green/amber/red are never adjacent.
- Security: both CodeQL alerts addressed from their real data flow — the
  unanchored E2E regex became a hostname comparison, and the `kv` clear-text
  alert was traced to the user's own id/e-mail (no session material) and pinned
  by a test. `set_updated_at` search_path migration is AUTHORED BUT NOT APPLIED;
  no CLI/Docker/psql here. Remaining Supabase lint decisions are in
  `docs/RELEASE.md`.
- Verification: typecheck clean, 49 files / 337 Vitest tests, zero-warning lint,
  15 Playwright specs, 20 visual baselines unchanged. Every fix mutation-checked.
  Measured at branch head: FCP 40 ms, route navigation median 120 ms / p95
  148 ms, month route (the deps-change path) median 119 ms, heap flat at
  149.7 MB over 40 further navigations — no bottleneck, so no optimization.


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
entries; delete the oldest when adding a sixth. Never call previous work
verified without inspecting its diff and running proportional checks.

## Recent handoffs

### 2026-07-19 — Claude · Final authoritative closure (PR #43)

- Base `c149353`; PR #43 squash-merged to main `89eac46`. Pages run
  `29694317341` success, post-merge codeql run `29694317322` success.
  EAS preview update group `0c40a985-39a8-4800-ae86-7957d93d2b02`
  (iOS `019f7b30-2821-788b-abd4-0e0bedf6a8ac`, Android
  `019f7b30-2821-747e-8892-d54bd37930f2`), runtime `1.0.0`, from `89eac46`.
  No native rebuild: app.json, package.json and package-lock.json are
  byte-identical to `c149353`.
- Root causes, not symptoms: `useLive` carried a snapshot across a deps
  change (logout→login onboarding flash) and account freeze cleaned up only
  three of its failure paths (frozen account + stuck `isFreezing` + silent
  rejection). Both extracted into testable units and mutation-checked.
- Switch boundary measured at 1.00:1 on the refund row and 1.10–1.93:1
  app-wide; `controlBorder` added and enforced. Analysis back navigation now
  resolves from the recorded source. Chart series reordered so green/amber/red
  are never adjacent.
- Code scanning on main is 0 open: the regex alert auto-closed on the fix, the
  kv alert was dismissed as a false positive after tracing every call site
  (user id/e-mail, never session material) and pinned by `tests/privacy.test.ts`.
- Gates: typecheck, 49 files / 337 Vitest, zero-warning lint, 15 Playwright,
  20 visual baselines unchanged, all five export budgets within limit.
- OPEN: `supabase/migrations/00000000000008_function_search_path.sql` is
  authored but NOT applied — no CLI/Docker/psql here, so local and remote
  migration history differ until the owner applies it (`docs/RELEASE.md`).
- OPEN: 178 of the first 187 commits carry a `Co-Authored-By: Claude` trailer,
  which is what lists the assistant under Contributors. The template that
  mandated it is removed, but rewriting that history needs `main`'s protection
  (`allow_force_pushes:false`, `enforce_admins:true`) temporarily relaxed by the
  owner. Not attempted; protection was not modified.


### 2026-07-19 — Codex · PR #40 release completion

- Independently inspected PR #40 at head `165653d`, confirmed `tr.tx.staleRate`
  remains used by the transaction form, and verified its required quality gate
  before squash-merging to main `3a04ff3`.
- Post-merge run `29676044301` passed typecheck, 296 Vitest, lint, export,
  bundle budgets and 10 Playwright flows, then deployed Pages. Live root,
  calculator and subscriptions deep links returned 200; live CSP contains the
  required `*.gstatic.com` favicon redirect allowance.
- Published EAS preview update `a20c30f9-3388-4a6f-8fb6-accb57e62ba5` for
  iOS+Android, runtime `1.0.0`, from exact commit `3a04ff3`. No native rebuild
  is required. Initial insights are 0 installs/0 failures; physical-device
  uptake remains the only release acceptance item not observed here.

### 2026-07-19 — Claude · Nine-package user audit (P1–P9)

- Base `7f2e133`; PR #36 → main `e69f386` (Pages `29658175041`, OTA
  `f82de4f5`); PR #37 → main `e66eeb3` (Pages `29666823091`, OTA
  `d3461e52`); PR #38 → main `3e30b1c` (Pages `29674652426`, OTA
  `04d8e501`).
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
