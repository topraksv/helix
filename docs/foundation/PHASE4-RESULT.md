# Phase 4 — Hardened Domain Simplification

## Result

**Behavior was proven identical for every retained edit, while the edited
surface became modestly simpler.** Three small changes survived both the normal
gate and a non-decreasing per-file mutation comparison. Three otherwise
plausible changes were reverted when their evidence did not justify retaining
them. No test was changed to make a refactor pass.

This was deliberately not a rewrite. Most of the hardened domain was already
small, direct, and carrying non-obvious product or security rationale. Leaving
those modules alone is the safer YAGNI/KISS result.

## Scope proof

The comparison point is `35b7e922fcc5fcea51eb17b333cc649bee70d012`.
The production diff contains exactly:

```text
src/domain/analytics.ts
src/domain/card-statements.ts
src/domain/expected.ts
```

There is no Phase 4 production diff under `src/data/repo/`, `src/app/`,
`src/ui/`, `src/services/`, `src/sync/`, or `src/db/`. There is also no diff in
`src/auth/recovery.ts`, `src/domain/input.ts`,
`src/domain/matrix-preferences.ts`, tests, dependency files, or vendored skill
bodies.

## Retained simplifications

The pre-change scores come from `PHASE3-RESULT.md` and its retained mutation
artifact. The post-change scores are fresh scoped runs using
`npx stryker run --mutate "<file>"`. A timeout counts as detected in the score,
matching Stryker's report.

| File | Simplification | Before | After | Net lines |
| --- | --- | ---: | ---: | ---: |
| `analytics.ts` | Removed an obsolete one-line description that called a monthly series cumulative while the retained incident rationale and implementation say the opposite. | 99.30% (141 K, 1 S) | 99.30% (141 K, 1 S) | -1 |
| `card-statements.ts` | Collapsed a null guard plus equality return into one explicit null-safe conflict predicate. | 94.74% (54 K, 3 S) | 94.74% (54 K, 3 S) | -1 |
| `expected.ts` | Corrected the module header so it no longer claims installment plans produce expected rows; the existing rationale and implementation both materialize their transactions directly. | 97.73% (171 K, 1 T, 4 S) | 97.73% (171 K, 1 T, 4 S) | 0 |

The net production-text delta is 2 lines removed. The reduction is a side
effect; the meaningful result is that contradictory guidance and a needlessly
split null guard disappeared without weakening any observed distinction.

## Reverted candidates

### `input.ts`

Direct `for...of` code-point iteration was tried in place of manual iterator
protocol management. The normal gate passed and scoped mutation remained 100%,
but the unused loop binding introduced an `@typescript-eslint/no-unused-vars`
warning into the routine completion gate. Independent review rejected a
cleanup-induced warning as a net quality regression. The edit was fully
reverted; the warning-free Phase 3 implementation again kills all 44 mutants.

### `balance.ts`

A private helper was tried for the duplicated realized/pending month-bucket
append operation. The normal gate passed, but scoped mutation changed from
96.74% (178 K, 6 S) to 96.70% (176 K, 6 S). The helper removed two distinctions
the tests previously detected. The edit was fully reverted; no test was added
to bless it.

### `installments.ts`

A local was tried to avoid evaluating `plan.dueDay ?? 1` twice. The normal gate
passed, but scoped mutation changed from 98.90% (90 K, 1 S) to 98.89% (89 K,
1 S). The edit was fully reverted for the same reason.

These failed attempts are evidence for keeping the current implementation, not
a backlog of refactors to force through later.

## Reviewed and deliberately left alone

Every hardened in-scope file not listed in the retained table was reviewed.
The grouped reason applies to each named file.

| Files | Reason left unchanged |
| --- | --- |
| `src/auth/recovery.ts`; `app-guard.ts`; `diagnostics.ts`; `logo-domain.ts`; `privacy.ts`; `user-error.ts`; `user-id.ts`; `web-security.ts` | These are already direct authentication, trust, identity, privacy, or error-disclosure policies. Their explicit guards and fallback paths are the useful interface; collapsing them would hide security distinctions or only shorten syntax. |
| `balance-declaration.ts`; `budgets.ts`; `cash-flow-matrix.ts`; `computed-columns.ts`; `dashboard.ts`; `dates.ts`; `fx-provider.ts`; `fx.ts`; `market.ts`; `money.ts`; `recurrence.ts`; `settings.ts`; `transactions.ts` | These carry financial arithmetic, calendar boundaries, external-data validation, or synced-shape validation. The remaining branches are either observed product distinctions or Phase 3-adjudicated defensive convergence. No shallow module or single-use abstraction could be removed safely. |
| `balance.ts`; `installments.ts` | The only concrete DRY candidates failed the non-decreasing mutation rule and were reverted, as recorded above. Their repeated expressions now remain intentionally. |
| `investment-catalog.ts`; `investment-projection.ts`; `investments.ts` | Catalog identity, adapter filtering, fixed-point quote arithmetic, deterministic replay, and cash/holding invariants are cohesive. Splitting or compressing them would increase interface surface or obscure ordering guarantees. |
| `form-state.ts`; `input.ts`; `notifications.ts`; `onboarding.ts`; `route-params.ts`; `serial-queue.ts`; `subscriptions.ts`; `transaction-draft.ts`; `transaction-search.ts`; `types.ts`; `undo-outcome.ts`; `year-columns.ts` | These modules are already small policy functions or plain domain shapes. Their comments preserve incidents and edge-case rationale; further extraction would create shallower modules, while inlining would duplicate rules at callers. The only tried `input.ts` cleanup was reverted because it added a lint warning. |
| `upcoming.ts` | Its three projections share inputs but produce intentionally different output shapes. The repeated `name`/`categoryName` assignment is part of that public model; extracting or collapsing the mapping would add indirection without deleting a concept. |
| `matrix-preferences.ts` | Explicitly out of scope because Phase 3 did not harden it. It was not used as a source of “easy” cleanup. |

The out-of-scope repository and application layers were also left untouched
even where simplification opportunities may exist, because Phase 3 proved the
repository mutation net is not trustworthy enough for this work.

## Known defects

Neither deferred defect was changed:

- `projectedBalance` still receives pending transactions and expected payments
  without identity de-duplication. Neither `dashboard.ts` nor `balance.ts` has a
  retained diff.
- `parseTcmbRates` still applies the documented malformed-`Unit` behavior.
  `fx-provider.ts` has no retained diff.

`docs/SPEC.md` and both defect `todo` tests are unchanged. The final normal
suite still reports exactly 2 todo tests.

## Final normal gate

Command:

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm run control:check && npx tsc --noEmit && npx vitest run
```

Fresh result on the retained production commits:

```text
control:check  clean — 35 installed skills, Claude bridge and lockfile
tsc            clean
Test Files     127 passed (127)
Tests          1068 passed | 2 todo (1070)
Duration       5.65s
Exit           0
```

## Final 59-file mutation run

A 59-file run had already been made before independent review. Review then
required reverting the `input.ts` source edit, so that artifact no longer
described the final tree. The command was repeated on the corrected tree rather
than presenting stale evidence. This exceeded the requested once-only execution;
only the corrected-tree result below is final evidence.

Command: `npx stryker run`

```text
Source files  59
Mutants       7,141
Dry run       1,036 tests passed
Killed        5,093
Timeout       14
Survived      843
No coverage   1,191
Errors        0
All score     71.52%
Covered       85.83%
Threshold     98% (unchanged)
Duration      19m 04s
Exit          1 — score below break threshold
```

Subtotals from the generated JSON report:

| Surface | Killed | Timeout | Survived | No coverage | Score |
| --- | ---: | ---: | ---: | ---: | ---: |
| Domain | 3,331 | 1 | 105 | 0 | 96.95% |
| Auth recovery | 116 | 0 | 2 | 0 | 98.31% |
| Repository | 1,646 | 13 | 736 | 1,191 | 46.26% |

The broad score must not be read as a clean improvement over Phase 3's 71.33%:
this run timed out 14 mutants instead of 1 (3 in repository budgets, 1 in
repository imports, 9 in repository onboarding, and 1 in domain expected).
Timeouts count as detected, so they inflate the score while reducing survivor
counts. The stable evidence for Phase 4 is the fresh per-file comparison for
each retained edit; all three are non-decreasing. The unchanged global
threshold correctly keeps the full mutation command red because the repository
layer remains under-hardened.

## Routine completion gate

`npm run verify` also exited 0 after the report was updated. It repeated the
control and type checks, passed all per-file coverage thresholds, and ran Expo
lint. Coverage reported 127 passing files, 1,068 passing tests and 2 todo tests;
statements 99.76%, branches 99.08%, functions 100%, and lines 100%. Expo lint
reported 0 errors and 0 warnings on the final state.

## Conclusion

Phase 4 is complete for the authorized hardened surface. The retained changes
remove two contradictions and one needlessly split guard. Every retained file
preserved its mutation score, the normal gate is green, both known defects
remain deferred, and no unprotected production surface was touched.
