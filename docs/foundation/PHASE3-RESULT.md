# Phase 3 — Test-net hardening result

Date: 2026-08-13

Starting point: `2c60fb8`

Last measured implementation commit: `3784106`

This phase changed tests, test configuration, and defect documentation only.
It changed no production file under `src/`, no dependency, no vendored skill,
and no architecture contract. `BASELINE.md` remains byte-for-byte unchanged.

## Outcome

| Track | Status | Evidence |
| --- | --- | --- |
| Coverage expansion | **Partial** | The domain scope is 41/42 files and every scoped file clears the unchanged per-file thresholds. Persistence is only 5/18 files because twelve high-stakes repository files do not yet clear that uniform bar. |
| Mutation expansion | **Partial / gate red** | Scope grew from 3 to 59 files. The final score is 71.33% against an unchanged break threshold of 98; 856 mutants survived and 1,191 have no coverage. Domain alone is 96.95% with no uncovered mutants; persistence is 45.90%. |
| Flake and weak-assertion audit | **Done** | All 110 files that existed at the start were searched and reviewed. Real-time, unseeded-randomness, timer-turn, random-UUID, and replaceable no-throw assertions found by the audit were removed or pinned. The expanded 127-file suite also received the same final pattern scan. |

This is a materially wider net, but it is **not yet safe to simplify repository
implementations wholesale**. In particular, `src/data/repo/` remains a known
test-net boundary. The mutation command's non-zero exit is the intended honest
result; no threshold was lowered to make it green.

## 1. Coverage expansion

The enforced per-file thresholds are unchanged:

- branches: 90%
- functions: 100%
- lines: 95%
- statements: 90%

The baseline covered six files: `money.ts`, `balance.ts`,
`card-statements.ts`, `recurrence.ts`, `transaction-draft.ts`, and
`investments.ts`. Phase 3 added these 40 files:

| Reason for inclusion | Added files |
| --- | --- |
| Persistence validation and write planning | `src/data/repo/cell-notes.ts`, `src/data/repo/import-plan.ts`, `src/data/repo/investment-validation.ts`, `src/data/repo/rule-validation.ts`, `src/data/repo/settings.ts` |
| Financial totals, projections, schedules, dates, and market values | `src/domain/analytics.ts`, `balance-declaration.ts`, `budgets.ts`, `cash-flow-matrix.ts`, `computed-columns.ts`, `dashboard.ts`, `dates.ts`, `expected.ts`, `fx-provider.ts`, `fx.ts`, `installments.ts`, `investment-catalog.ts`, `investment-projection.ts`, `market.ts`, `upcoming.ts`, `year-columns.ts` |
| Input, state, and persistence-relevant decisions | `src/domain/form-state.ts`, `input.ts`, `notifications.ts`, `onboarding.ts`, `route-params.ts`, `serial-queue.ts`, `settings.ts`, `subscriptions.ts`, `transaction-search.ts`, `transactions.ts`, `undo-outcome.ts` |
| Authentication, identity, privacy, and external trust boundaries | `src/domain/app-guard.ts`, `diagnostics.ts`, `logo-domain.ts`, `privacy.ts`, `types.ts`, `user-error.ts`, `user-id.ts`, `web-security.ts` |

The final coverage scope is therefore 46 files: 41 domain files and five
repository files. A fresh final run produced:

```text
Test Files  127 passed (127)
Tests       1068 passed | 2 todo (1070)
Duration    6.58s

Statements  99.77% (1303/1306)
Branches    99.09% (1198/1209)
Functions   100%   (309/309)
Lines       100%   (1074/1074)
```

Every scoped file cleared the per-file thresholds. The aggregate is not used
as a substitute for those per-file results.

### Deliberate coverage omissions

`src/domain/matrix-preferences.ts` is the one domain omission. It selects
device-local table visibility preferences and carries no money, date,
identity, sync, or auth decision. It does not meet the phase's high-stakes
inclusion rule.

`src/data/repo/errors.ts` only declares error classes and contains no decision
logic. It is not a meaningful coverage target.

The following twelve repository files are high-stakes, but their discovery
coverage was too far below the uniform per-file thresholds to add them without
creating a large database-harness test program. They were left out rather than
lowering the bar. This is why the coverage track is partial, not done:

| File | Lines | Functions | Branches | Decision |
| --- | ---: | ---: | ---: | --- |
| `accounts.ts` | 74.07 | 80.00 | 42.71 | Excluded; identity/reference writes need direct repository fixtures. |
| `budgets.ts` | 80.95 | 74.19 | 54.02 | Excluded; cascade/reassignment persistence paths remain thin. |
| `categories.ts` | 33.33 | 15.38 | 42.85 | Excluded; CRUD/tombstone paths remain thin. |
| `computed.ts` | 40.00 | 18.18 | 41.66 | Excluded; repository validation/write branches remain thin. |
| `expected.ts` | 81.48 | 66.66 | 61.53 | Excluded; schedule materialization and update paths remain thin. |
| `imports.ts` | 52.45 | 36.00 | 32.60 | Excluded; import/remap persistence paths remain thin. |
| `installments.ts` | 31.76 | 12.50 | 36.23 | Excluded; plan lifecycle persistence paths remain thin. |
| `investments.ts` | 90.29 | 96.66 | 71.11 | Excluded; close on lines, but functions and branches still fail the bar. |
| `maintenance.ts` | 43.36 | 21.87 | 27.17 | Excluded; the maintenance orchestration surface needs its own harness. |
| `onboarding.ts` | 89.47 | 91.66 | 74.35 | Excluded; workspace construction branches remain thin. |
| `rules.ts` | 65.71 | 41.17 | 69.69 | Excluded; rule lifecycle and history writes remain thin. |
| `transactions.ts` | 66.66 | 68.18 | 70.14 | Excluded; transaction write/update/delete paths remain thin. |

These files were still placed in mutation scope so their gaps would be
measured rather than hidden.

## 2. Mutation expansion

The scope now contains 59 files:

- the 41 covered domain files;
- all 17 repository implementation files except declaration-only `errors.ts`;
- the baseline auth target `src/auth/recovery.ts`.

This includes every coverage addition and every surveyed file with financial,
date-boundary, identity, authentication, or persistence decisions. The only
surveyed source omissions are the low-stakes `matrix-preferences.ts` and the
declaration-only `repo/errors.ts` described above.

The break threshold remains 98. `ignoreStatic` is not enabled. The final full
run instrumented 7,141 mutants and ran a 1,036-test dry run successfully:

```text
Killed       5093
Timeout      1
Survived     856
No coverage  1191
Errors       0
All score    71.33%
Covered      85.61%
Threshold    98% (unchanged)
Duration     17m 12s
Exit         1 — score below break threshold
```

The one timeout is the decrement mutant at `src/domain/expected.ts:123`. It is
reported separately and is not described as a flaky normal-suite test.

### Repository mutation result

All repository survivors below are unresolved test gaps, not claimed
equivalent mutants. `Survivor lines` gives every unique source line containing
one or more survivors; `S` gives the exact mutant count, including multiple
mutants on one line.

| File | Score | K | S | NC | Survivor lines |
| --- | ---: | ---: | ---: | ---: | --- |
| `accounts.ts` | 39.39 | 130 | 81 | 119 | 38, 51, 56, 61, 88, 91, 98, 106–107, 120, 123–128, 135, 137, 150, 159, 164, 166–167, 169, 184, 191, 203, 212, 215, 218–222, 225, 241, 244–245, 247, 251, 255, 258, 269, 272–273, 275, 277, 285–286, 288–290, 294–295, 300, 302, 347–348, 354, 368, 371 |
| `budgets.ts` | 50.16 | 154 | 67 | 86 | 14, 36, 38, 45, 65, 68–69, 88, 90, 122, 126–127, 131–132, 142, 149–150, 154, 156–157, 165, 173–175, 182, 185, 189, 195, 204, 229, 235–236, 243–247, 257, 260 |
| `categories.ts` | 32.99 | 32 | 8 | 57 | 12, 16, 29, 34–35 |
| `cell-notes.ts` | 100.00 | 26 | 0 | 0 | — |
| `computed.ts` | 25.58 | 11 | 2 | 30 | 13 |
| `expected.ts` | 38.98 | 138 | 140 | 76 | 41, 56, 58–59, 66, 68, 71, 74, 77, 80–81, 86, 88, 91, 102–103, 105, 109, 123–124, 129–130, 134, 139, 142, 147, 154–155, 173, 180–181, 183–186, 192, 198–200, 203–204, 206–207, 211, 247, 252, 255, 258, 260–262, 264, 266, 272, 276, 278–279, 281, 284 |
| `import-plan.ts` | 100.00 | 69 | 0 | 0 | — |
| `imports.ts` | 37.61 | 170 | 25 | 257 | 44–45, 47–48, 59, 80, 85, 240–241, 265, 287, 289, 309 |
| `installments.ts` | 21.05 | 48 | 21 | 159 | 47–49, 52, 54, 58–60, 157, 160, 168–170, 175 |
| `investment-validation.ts` | 100.00 | 258 | 0 | 0 | — |
| `investments.ts` | 59.40 | 158 | 67 | 41 | 47–48, 54, 63, 76, 83, 88–90, 99, 107–108, 115, 127, 130, 134, 147, 179, 186–187, 208, 210, 214, 241, 259–260, 267, 278, 281, 301, 303, 342, 362 |
| `maintenance.ts` | 8.84 | 29 | 109 | 190 | 31, 36, 38–40, 46, 48, 103, 105, 128–129, 131, 157, 162, 164, 186–187, 189, 211, 217, 219, 233, 235–237, 239, 242, 244–245, 252, 254, 257, 265, 268, 271, 274, 279–281, 303–304, 307, 322, 333, 336, 363–364, 366, 378–380, 382, 385–386, 406, 408 |
| `onboarding.ts` | 37.38 | 80 | 114 | 20 | 31–41, 45–52, 76–77, 95, 99, 116, 121, 138, 143, 153, 156, 158, 168–169, 171, 173, 214, 218, 246, 250–251, 265 |
| `rule-validation.ts` | 100.00 | 13 | 0 | 0 | — |
| `rules.ts` | 51.47 | 193 | 71 | 111 | 55, 58–59, 66, 71, 74, 90–91, 106–107, 109, 111, 125, 182–184, 189, 192, 198, 204, 207, 212, 217, 219, 221, 228, 237, 269, 271, 280, 292, 297, 325–329, 333, 337 |
| `settings.ts` | 100.00 | 25 | 0 | 0 | — |
| `transactions.ts` | 55.72 | 112 | 44 | 45 | 55, 82, 108–109, 112, 125, 127–129, 142, 151, 153, 176, 180, 194–195, 199, 237, 239, 241, 245–249, 255, 269, 283, 366 |

Repository subtotal: 1,646 killed, 749 survived, 1,191 not covered;
45.90% all-mutant score and 68.73% covered-mutant score. This is the principal
reason the mutation track is incomplete.

### Domain and auth survivors

Domain has zero uncovered mutants. The table lists every domain file with a
survivor; the other 13 scoped domain files scored 100%. Reasons are based on
inspecting each replacement, its surrounding guard, and the tests Stryker said
covered it. They document why no production change was made, not permission to
delete the code later without rerunning mutation tests.

| File | S | Survivor lines | Disposition |
| --- | ---: | --- | --- |
| `analytics.ts` | 1 | 197 | Equivalent: interval 1 returns the original amount on either side of the mutated comparison. |
| `balance-declaration.ts` | 2 | 20, 22 | Redundant defensive guards; later validation yields the same result. |
| `balance.ts` | 6 | 136, 140, 142, 298 | Guard/fallback variants converge under accepted transaction invariants. |
| `card-statements.ts` | 3 | 80 | Null comparisons remain false under the validated cycle input. |
| `computed-columns.ts` | 1 | 34 | Empty-definition replacement preserves uniqueness for the only reachable definition class. |
| `dashboard.ts` | 1 | 45 | The preceding pending-item filter makes the mutated predicate invariant. |
| `dates.ts` | 1 | 111 | A negative `Array.from` length is already empty. |
| `expected.ts` | 4 | 75, 80, 103, 158 | Downstream guards or equal branch results converge; line 123 separately timed out. |
| `fx-provider.ts` | 16 | 67, 87–88, 97, 99 | Finite-number, supported-currency, and calendar guards reject the same malformed inputs downstream. |
| `installments.ts` | 1 | 115 | Null comparison is false under the validated plan input. |
| `investment-catalog.ts` | 1 | 28 | Static-initializer instrumentation survivor; exact full-catalog assertions fail against the replacement in ordinary execution. Not treated as a missing product assertion. |
| `investment-projection.ts` | 1 | 63 | `Set.has(null)` is false, matching the explicit null guard. |
| `investments.ts` | 4 | 56, 89, 109, 317 | Redundant validated-input guards, an equal tie, and a null numeric comparison converge. |
| `logo-domain.ts` | 6 | 49, 56, 64, 66 | URL normalization and the subsequent public-host/label guards reject the same inputs. |
| `money.ts` | 30 | 33, 61, 69, 93, 109–111, 170–171, 194, 196–197, 201, 203, 223–225, 228, 238, 244 | Defensive parser/formatter branches converge after character normalization, integer ceilings, or locale defaults. These are retained as defensive code. |
| `notifications.ts` | 1 | 4 | Integer validation already implies number type. |
| `onboarding.ts` | 1 | 8 | The preceding equality branch returns the same zero result. |
| `recurrence.ts` | 5 | 64, 104, 106, 109, 113 | Alignment and range filtering converge for the generated date sequence. The observable 6,000-step cap replacements are killed by direct boundary tests. |
| `route-params.ts` | 2 | 70, 74 | Regex/membership checks already reject null. |
| `serial-queue.ts` | 2 | 28, 31 | Cleanup changes preserve tested ordering but may retain settled tails. This is an unresolved resource-lifecycle observability gap, not declared equivalent. |
| `settings.ts` | 3 | 32, 56, 60 | Supported minor values imply number; absent/invalid JSON reaches the same fallback. |
| `subscriptions.ts` | 1 | 13 | Both operands use the same locale normalization, so upper/lower normalization preserves equality. |
| `transaction-draft.ts` | 4 | 73, 75, 83 | Preview and supported-amount guards converge before a write can be returned. |
| `transaction-search.ts` | 2 | 29 | An empty query is contained by every string, matching the explicit empty-query branch. |
| `upcoming.ts` | 2 | 35, 72 | `Set.has(null)` is false and a missing card is removed by the final projection. |
| `user-error.ts` | 1 | 32 | The following marker branch returns the same authored message. |
| `web-security.ts` | 1 | 3 | Falsy raw input throws in URL parsing and is caught to the same null result. |
| `year-columns.ts` | 2 | 71, 73 | Set insertion and membership filtering are idempotent for active identifiers. |

`src/auth/recovery.ts` has two survivors at lines 55 and 91 (98.31%). The
replacement URL/expiry fallbacks remain invalid and are rejected by the same
downstream validation.

Domain subtotal: 3,331 killed, one timeout, 105 survived, zero uncovered;
96.95%. Auth subtotal: 116 killed, two survived, zero uncovered; 98.31%.

### Mutation-only test exclusions

Three tests remain mandatory in the normal gate but are excluded from the
instrumented Stryker dry run for measured runner incompatibilities:

- `backup-validation.test.ts`: full instrumentation invalidates its parser
  wall-clock budget, so it measures Stryker rather than the parser.
- `locale-timezone.test.ts`: mutation worker processes do not reliably apply a
  mid-test process timezone change; deterministic calendar contracts remain.
- `performance.test.ts`: full 59-file instrumentation pushed the 100,000-row
  release-budget test past Vitest's five-second timeout. Three uninstrumented
  runs under the mutation config completed at about 0.72 seconds; functional
  analytics mutation contracts remain, and the real budget test still runs in
  the normal gate.

No source file was removed from mutation scope to address these runner effects.

## 3. Flake and weak-assertion audit

Findings and fixes:

- Every `fast-check` property now has the reproducible seed `20260812`.
- Backup round-trip generated IDs now use a deterministic, valid UUID sequence
  instead of `randomUUID()`.
- Multi-client sync uses a reset logical clock instead of the host clock.
- Investment validation pins system time with Vitest fake timers.
- Diagnostics upload and maintenance-queue tests observe writes or drain
  microtasks instead of waiting for `setTimeout(0)`.
- Replaceable “does not throw” checks now assert exact year-column output,
  non-empty migration SQL, exact month ends, queue state, and asynchronous
  haptic behavior.
- The final scan found no snapshot assertion, `Math.random`, `randomUUID`, or
  real timer in the test suite. Two `live-state` fixtures still construct the
  current time only as an opaque non-null timestamp; no asserted value or
  branch depends on that clock value. Remaining
  `not.toThrow` assertions exercise void boundary validators whose success has
  no return value; their adjacent invalid fixtures assert exact failures.
- No execution-order dependency was found. One intermediate targeted queue run
  failed 1 of 19 tests because one old `tick()` call remained; it was replaced
  immediately, after which the targeted run and every full normal gate passed.

Two factually wrong current-behavior assertions were not preserved:

- Projected balance double-counts one obligation represented as both pending
  and expected. A runnable `it.todo` specifies the correct single-count result
  and points to the existing §2.7 defect in `SPEC.md`.
- A decimal TCMB `<Unit>` is treated as the implicit unit instead of rejected.
  The defect was appended to `SPEC.md`; a runnable `it.todo` specifies the
  correct fail-closed result.

Neither production defect was fixed, and no passing test blesses the known
wrong behavior.

## Final gates

Fresh final normal completion gate after the report was written:

```text
npm run control:check
Checked 35 installed skills, the Claude bridge and the lockfile.

npx tsc --noEmit
exit 0

npx vitest run
Test Files  127 passed (127)
Tests       1068 passed | 2 todo (1070)
Duration    5.65s
```

Fresh repository completion and coverage gate:

```text
npm run verify
control:check  passed
tsc --noEmit   passed
Test Files  127 passed (127)
Tests       1068 passed | 2 todo (1070)
Statements  99.77% (1303/1306)
Branches    99.09% (1198/1209)
Functions   100%   (309/309)
Lines       100%   (1074/1074)
expo lint     passed
exit 0
```

Fresh mutation gate:

```text
npm run test:mutation
Dry run      1036 tests passed
Mutants      7141
Score        71.33% (covered 85.61%)
Threshold    98%
Duration     17m 12s
exit 1 — mutation track remains partial
```

## Deliberately left alone

- All production behavior and all files under `src/`.
- `docs/foundation/BASELINE.md`, the frozen comparison point.
- `tests/architecture-contract.test.ts`.
- The two documented production defects.
- The low-stakes local `matrix-preferences.ts` module and declaration-only
  `repo/errors.ts`.
- Performance thresholds and all coverage/mutation thresholds.
- Vendored skills, package dependencies, app routes, UI, services, sync, and
  database production code.

The mutation-oriented contract test filenames and the duplicated static file
lists in the Vitest and Stryker configs were also left in place. Renaming and
redistributing the cross-cutting contracts would not strengthen an assertion,
and centralizing two tool-discovery configs would add a config abstraction to
a phase whose priority is the test net. Both are maintenance candidates, not
evidence that the net is stronger.

The next simplification phase may rely on the scoped domain net, subject to the
explicit survivor notes above. It must not treat the repository layer as
hardened until the twelve excluded files receive direct persistence tests and
the 749 repository survivors plus 1,191 uncovered mutants are resolved.
