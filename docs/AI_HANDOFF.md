# Helix AI handoff

Short-lived state only. Git and the working tree win over this file. Stable
knowledge belongs in [`AGENTS.md`](../AGENTS.md),
[`ARCHITECTURE.md`](ARCHITECTURE.md), [`TESTING.md`](TESTING.md),
[`RELEASE.md`](RELEASE.md) and [`SECURITY.md`](SECURITY.md) — never here.
Git history owns the chronology; do not grow a log in this file.

## Current state (verified 2026-07-20, Europe/Istanbul)

- `main` = `1b5bfda` locally and on `origin` (PR #45, reproducible table
  privileges + postcss override). Pages run `29700587861` success at that SHA.
- **History is clean.** 190 commits, every one authored by Ömer Toprak Şavlı
  (`omertoprak98@gmail.com` / the GitHub noreply address); committers are the
  owner and GitHub's merge identity. Zero AI/bot authors, committers or
  co-author trailers — the only `Co-Authored-By` lines name the owner. GitHub
  Contributors returns exactly one entry: `topraksv`, 190 contributions.
- **Branch protection is in place** on `main`: required status check `quality`
  (strict), required signatures, linear history, conversation resolution,
  `enforce_admins`, force-push and deletion disabled.
- **Supabase is 9/9 synchronized.** `migration list --linked` shows the same
  local and remote version for every migration `…01`–`…09`, including
  `…08_function_search_path` and `…09_table_privileges`. `db lint --linked`
  reports **no schema errors**.
- **EAS:** channel `preview` maps unconditionally to branch `preview`
  (`branchMappingLogic: "true"`, single branch, not paused). Latest group
  `0c40a985-39a8-4800-ae86-7957d93d2b02`, runtime `1.0.0`, iOS + Android.


## Work in progress — Packages 1 + 2, uncommitted on `main`

Nothing here is stray dirty work. Package 1 (documentation) and Package 2
(code/security) are both staged in the working tree; no commit, push, PR,
deploy or OTA has happened.

**Package 1 — documentation baseline (do not discard):** `README.md`,
`AGENTS.md`, `CLAUDE.md`, `docs/AI_HANDOFF.md`, `docs/PRIVACY.md`,
`docs/RELEASE.md`, `docs/TESTING.md`, plus new `docs/ARCHITECTURE.md` and
`docs/SECURITY.md`.

**Package 2 — code changes (7 fixes, each mutation-checked):**

| File | Fix |
|---|---|
| `src/sync/status.ts`, `src/sync/engine.ts` | `sync_dead_letters` was counted with `WHERE user_id = ?` on a table that has no such column, so **every successful sync threw**: state stuck on `error`, `lastSyncAt` never advanced, infinite backoff, `syncNow` always returned `false`, and account freeze could never complete |
| `src/domain/dates.ts` | `clampDayToMonth` clamped only the upper bound and fabricated `2026-03-00` / `2026-03-NaN` / `2026-03--5` |
| `src/domain/recurrence.ts`, `expected.ts`, `installments.ts` | corrupt nominal days now fail closed instead of reaching date construction |
| `src/domain/analytics.ts` | `interval_months = 0` produced `Infinity`, which threw in `assertMinor` during render |
| `src/domain/year-columns.ts` | a non-array `column_years` entry threw "not iterable" during the Mali Tablo render |
| `src/app/_layout.tsx`, `src/ui/theme.ts`, `scripts/check-web-budget.mjs` | dropped two font faces nothing rendered; export 9,575,221 → 9,118,379 B, budgets tightened |
| `package.json`, `package-lock.json` | added `expo-constants`, a required peer of `expo-router` (expo-doctor 17/18 → 18/18) |

New tests: `tests/sync-dead-letters.test.ts`, `tests/corrupt-schedule-input.test.ts`.
Gates: typecheck clean, 51 files / 352 vitest, zero-warning lint, production
export within budget, semgrep 203 rules / 0 findings.

## Genuinely open

| Item | State |
|---|---|
| Package 2 findings recorded but not fixed | ~17 confirmed findings with file:line evidence remain — see the Package 2 report (maintenance guard, non-atomic onboarding seed, import replace downgrade, `logo.tsx` chip contrast, unowned promises, unvalidated `item.tsx` params, settings reminder overwrite, dead `tr.ts` keys, per-month rescans). None is a data-loss defect. |
| `ui/components.tsx > ui/calculator.tsx` cycle | Analysed and retained: runtime-safe in both init orders, and the lazy `require` defers evaluation rather than splitting the bundle. Breaking it means moving `Button`/`FadeIn` into a leaf module. |
| OTA for current `main` | Latest `preview` group carries `gitCommitHash 89eac46`, a pre-history-rewrite SHA no longer on `main`. |
| Physical device acceptance | Still `BLOCKED`. Matrix in `TESTING.md`. |
| Stale local branches | `fix/audit-p1-p5`, `fix/audit-p6-p7`, `fix/audit-p8`, `docs/handoff-p9-final` point at pre-rewrite commits in this clone only. |

## Next

**Package 3 — Supabase:** no migration was created or applied here, and nothing
in Package 2 requires a schema change — `sync_dead_letters` was fixed by
removing a predicate, not by adding a column.

**Package 4 — release:** commit, PR, `quality`, merge, Pages and the OTA for
Packages 1 + 2. Contributor-history cleanup and migration application are
**done** and are not future work.
