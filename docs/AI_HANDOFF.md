# Helix AI handoff

Short-lived state only. Git and the working tree win over this file. Stable
knowledge belongs in [`AGENTS.md`](../AGENTS.md),
[`ARCHITECTURE.md`](ARCHITECTURE.md), [`TESTING.md`](TESTING.md),
[`RELEASE.md`](RELEASE.md) and [`SECURITY.md`](SECURITY.md) — never here.
Git history owns the chronology; do not grow a log in this file.

## Current state (verified 2026-07-21, Europe/Istanbul)

- `main` = `2b6791c` locally and on `origin` (PR #47, `brace-expansion`
  override). PR #46 before it merged the Package 1 documentation baseline and
  the Package 2 audit fixes as `f0b1652`. Pages run `29788832388` succeeded at
  `2b6791c`; the live smoke covered `/`, `/settings`, `/upcoming`,
  `/subscriptions` and `/calculator`.
- **History is clean.** Every commit is authored by Ömer Toprak Şavlı; both
  merge commits are `verified=true`. Zero AI/bot authors, committers or
  co-author trailers. GitHub Contributors returns exactly one entry: `topraksv`.
- **Branch protection is in place** on `main`: required status check `quality`,
  required signatures, linear history, `enforce_admins`, force-push and
  deletion disabled.
- **GitHub security on `2b6791c`:** Code Scanning 0, Dependabot 0, Secret
  Scanning 0.
- **Supabase is 9/9 synchronized.** `db lint --linked` reports no error in any
  Helix-owned schema; linked pgTAP passes 24/24 over a real postgres connection
  (the passwordless `cli_login_postgres` path cannot reach `auth` and is not
  used for this suite).
- **EAS:** channel `preview` maps unconditionally to branch `preview`. Latest
  group `57630810-415a-4c21-9462-91e1c7fe12d9`, runtime `1.0.0`, iOS
  `019f81fe-fb19-747b-b560-e27938a5522f`, Android
  `019f81fe-fb19-706a-bfda-4078f3d4378b`, at `2b6791c`. No production OTA.

## Work in progress — Phase 2 completeness closure, Packages 1/3 + 2/3

Uncommitted on `phase2/completeness-closure`, branched from `2b6791c`. A
read-only post-merge audit found that the Package 2 ledger claimed a coverage it
could not evidence: 48 of the 50 pre-existing `tests/*.ts` files were never
opened, and 23 tracked files had no disposition row. Package 1/3 closes the
repository-coverage and test-strength half of that gap.

All 63 test files are now read and dispositioned. Changes:

| File | Change |
|---|---|
| `src/ui/request-queue.ts` (new) | The dialog/prompt queue reducer, extracted. `dialog.tsx` imports react-native and cannot load under vitest, so `tests/dialog-queue.test.ts` was asserting a **copy** of the reducer declared inside the test file — it could stay green while `dialog.tsx` did anything at all. Both stores now delegate here, removing a three-way duplication and two spellings of the same advance. |
| `tests/dialog-queue.test.ts` | Drives the real module; adds non-mutation, empty-advance and resolve-opens-the-next-request cases. |
| `tests/dirty-exit.test.ts` | Fourth truth-table row; `dirty !== explicitlyAllowed` satisfies the other three and is refuted only by it. |
| `tests/csv-export-safety.test.ts` | The "cannot forge an extra column" test carried a newline, so dropping `;` from the quoting set left it green. Adds a delimiter-only payload plus lone CR/LF. |
| `src/ui/badge-color.ts`, `src/domain/route-params.ts`, `src/data/repo/onboarding.ts` | Narrowed export surface: `toLinear`, `relativeLuminance`, `MIN_YEAR`, `MAX_YEAR`, `onboardingBalanceRows` are module-internal. Knip unused exports 10 → 5. |

Gates: typecheck clean, **58 files / 448 vitest**, zero-warning lint, madge 1
justified cycle, knip's 5 remaining exports each with reachability evidence.

Seven critical invariants carry fresh mutation proof (market re-stamping,
last-known-vs-live, the 60 s conversion window, all-or-nothing JSON import,
replace-never-becomes-add, CSV formula injection, CSV column forging) — each
mutation fails its named guarding test and was reverted.

**Package 2/3 (security, supply chain, OWASP)** changed documentation only:

| File | Change |
|---|---|
| `docs/SECURITY.md` | Verification matrix rewritten — 44 rows, **`NOT ASSESSED = 0`**, each `CONTROL → APPLICABLE/N-A/DEVICE-ONLY → FILE/FLOW → EVIDENCE → RESIDUAL RISK`. Advisory disposition table added. Three limitations the matrix surfaced were added to known weaknesses: physical VoiceOver/TalkBack never run, MASVS-RESILIENCE deliberately absent, `xlsx` permanently outside npm-audit/Dependabot coverage. |

Evidence gathered in an isolated `git worktree` (the main `node_modules` was
never touched): `npm ci` exit 0 → typecheck + 448 tests + all five export
budgets pass on the clean install. The previously aggregate "20 moderate
advisories" resolved to **2 distinct advisories blamed across 20 tree nodes**,
both proven unreachable (0 files in the web export). Gitleaks v8.30.1 over the
working tree and 391 commits found **0 real secrets**. CycloneDX 1.6 SBOM:
867 components, 2482 edges, SHA-256 recorded in the ledger. Licence inventory:
18 licences, 0 material distribution risk.

## Genuinely open

| Item | State |
|---|---|
| Phase 2 completeness, Package 3/3 | Performance and accessibility: startup, route p95, heap delta, render counts, `EXPLAIN QUERY PLAN`, duplicate DB/network calls, Expo Atlas/Lighthouse, Dynamic Type, axe `wcag22aa`. Scope and evidence live in `.claude/phase-2-post-merge-matrix.md`. |
| `tests/accessibility-contract.test.ts` | Asserts source text rather than rendered output. Not fixable under vitest — RN components are unimportable and no RN test renderer is configured. Real coverage is `e2e/visual-a11y.spec.ts`. Deferred to Package 3/3. |
| `ui/components.tsx > ui/calculator.tsx` cycle | Analysed and retained: runtime-safe in both init orders, and the lazy `require` defers evaluation rather than splitting the bundle. |
| Physical device acceptance | Still `BLOCKED`. Matrix in `TESTING.md`. |

## Next

**Package 2/3 — security and supply chain.** SBOM, dependency licence
inventory, itemised `npm audit` advisories, `npm ci` reproducibility, a real
secret scanner over tracked files and history, and the `docs/SECURITY.md`
matrix. Sonar, ZAP and MobSF were explicitly removed from scope by the owner and
are not future work.
