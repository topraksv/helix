# Phase 3B — Repository test-net closeout

Date: 2026-08-13

Track A started at `e2df16a`. The final Track B mutation measurement was made
at `6c8f4aa`, with local `HEAD` and `origin/chore/foundation-reset` equal and
the tracked worktree clean.

## Outcome

| Track | Status | Evidence |
| --- | --- | --- |
| Phase 2 record consolidation | **Done** | The Phase 2 decisions now live beside the three proposals in `PROPOSED-MOVES.md`; the redundant `PHASE2-RESULT.md` was removed only after its unique evidence was retained. |
| Category-icon move | **Done** | Eleven direct tests preceded a byte-identical `R100` move to `src/domain`, all 13 source importers moved to the new seam, and the unchanged architecture contract passed. |
| Repository hardening | **Partial** | Four repositories were newly fully hardened: `accounts.ts`, `categories.ts`, `computed.ts`, and `transactions.ts`. `budgets.ts` improved materially but remains partial. Together with five already-hardened files, 9 of 17 non-declaration repository implementation files are mutation-hardened. |
| Final broad mutation gate | **Red** | The one final 59-file run scored 79.65% against the unchanged 98 break threshold and exited 1. It had 115 timeouts, so its score is not a clean before/after comparison. |

The repository layer is **not fully hardened**. Seven eligible implementation
files were deliberately untouched, `budgets.ts` remains below both the
coverage and mutation bars, and the broad repository subtotal remains red.
`src/data/repo/errors.ts` is declaration-only and is not one of the 17
implementation files.

## Track A — decision record and dependency move

### Phase 2 documentation lifecycle

Commit `813b6f3` consolidated the Phase 2 record into
`docs/foundation/PROPOSED-MOVES.md`. Proposals 1 and 2 remain rejected because
they require interface redesign or interdependent extraction plus new proof.
Proposal 3 was first recorded as cleared pending direct tests. The former
parallel `PHASE2-RESULT.md` was deleted only after retaining the no-move
decision, deletion-sweep outcome, frozen-baseline restoration, proposal
rulings, and four pre-evidence gates. The proposal document is already in its
final lifecycle state and needed no Phase 3B edit.

### Category-icon policy lifecycle

Commit `b283a22` added 11 snapshot-free tests at the old seam before any move.
They pin keyword precedence, Turkish `tr-TR` casing and normalization, trimmed
stable fallback, stored-icon override versus suggested default, and the closed
`PaymentSourceType` icon mapping.

Commit `78574d0` then moved `src/data/category-icons.ts` to
`src/domain/category-icons.ts` as a Git `R100` rename. Both versions had
SHA-256 `0215c0ad054afeb182f07f0233acf443f11b4e692389dc1a5e969052586f7192`.
Exactly 13 source importers changed path—11 under `src/app/` and two repository
consumers—with no application file move and no policy edit. No old source
import remained. The focused post-move gate passed 2 files and 20 tests,
including the unchanged architecture contract; the full gate passed 128 files
and 1,079 tests with two todos. Proposal 3 now records the executed result.

`src/domain/category-icons.ts` is not among the 59 files in
`stryker.config.mjs`, so neither Track B nor the final broad mutation score is
presented as mutation evidence for that pure move.

## Track B — repository hardening

Hardening required both of these file-level facts:

- truthful coverage at the unchanged per-file thresholds: statements at least
  90%, branches at least 90%, functions 100%, and lines at least 95%; and
- a scoped raw mutation score at or above the unchanged 98 break threshold,
  with every survivor/no-coverage result reviewed and no reachable
  behavior-changing gap left unresolved.

Test counts below are supporting evidence only. They do not establish
hardening by themselves. Relative to Track A's 1,079 passing tests, Track B
ended with 1,154, a net addition of 75 passing test cases.

### Per-file coverage

The “before” values are each task report's fresh focused baseline, not a
reconstruction or a new Phase 3B measurement. `S/B/F/L` means statements,
branches, functions, and lines.

| File | Before S/B/F/L | After S/B/F/L | Final coverage status |
| --- | --- | --- | --- |
| `accounts.ts` | 16.92 / 5.82 / 32.00 / 16.66 | 100 / 98.05 / 100 / 100 | Enforced |
| `categories.ts` | 29.72 / 42.85 / 15.38 / 33.33 | 100 / 100 / 100 / 100 | Enforced |
| `computed.ts` | 33.33 / 41.66 / 18.18 / 40.00 | 100 / 100 / 100 / 100 | Enforced |
| `transactions.ts` | 65.04 / 70.14 / 68.18 / 66.66 | 100 / 98.50 / 100 / 100 | Enforced |
| `budgets.ts` | 83.87 / 66.66 / 90.32 / 88.57 | 100 / 89.65 / 100 / 100 | **Not enforced:** branches are below 90 |

`budgets.ts` briefly appeared to have 90.80% branch coverage, but that figure
depended on a mock which fabricated two mutually exclusive live `cell_notes`
rows with the same table-local primary key. Removing that impossible case
produced the truthful 89.65% result and commit `6c8f4aa` withdrew the file from
the critical coverage set.

### Scoped mutation progression

`K/T/S/NC` means killed, timeout, survived, and no coverage. Each final result
came from `npx stryker run --mutate "src/data/repo/<file>.ts"`; errors were zero
throughout. The table records the first useful task measurement and the final
authoritative scoped artifact reported by that task.

| File | First K/T/S/NC; score | Final K/T/S/NC; score | Verdict |
| --- | --- | --- | --- |
| `accounts.ts` | 310/0/18/2; 93.94% | 327/0/1/2; 99.09% | Hardened |
| `categories.ts` | 93/0/4/0; 95.88% | 96/0/1/0; 98.97% | Hardened |
| `computed.ts` | 11/0/2/30; 25.58% Phase 3 baseline | 43/0/0/0; 100% | Hardened |
| `transactions.ts` | 188/0/12/1; 93.53% | 198/0/3/0; 98.51% | Hardened |
| `budgets.ts` | 275/0/30/2; 89.58% | 289/0/16/2; 94.14% | **Improved-partial; red below 98** |

The Track B commits which produced that evidence are:

| File | Commits |
| --- | --- |
| `categories.ts` | `57d09e9` — real SQLite/outbox hardening and critical coverage inclusion |
| `transactions.ts` | `f6e3555` — persistence hardening; `30836b6` — exact restore outbox payloads |
| `computed.ts` | `bd336dd` — real SQLite/outbox hardening and critical coverage inclusion |
| `accounts.ts` | `03e3c45` — real SQLite/outbox hardening and critical coverage inclusion |
| `budgets.ts` | `4417626` — reachable persistence coverage; `6c8f4aa` — impossible mock removal and critical coverage withdrawal |

### Observable behavior evidence

#### Accounts

The final focused suite has 24 direct tests, replacing two identity-mock
tests. Every shipped migration and the real mutation/outbox layer are used.
The tests cover person creation/self selection, rename, tombstone/restore,
reference counts, five-table reassignment and awaited maintenance. Payment
source cases cover every supported type, ownership and cycle validation,
presentation-field preservation, statement repair, compound delete/restore,
reference counts, and clear/non-card/card reassignment. Pending card purchases
exercise purchase-date, old-period and due-date resolution; historical,
non-expense and aggregate rows retain their dates. SQLite rows, immutable
`created_at`, tombstone generations, exact outbox payloads/order, no-write
rejections, and rollback are observed directly.

#### Categories

Eight direct real-SQLite tests cover normalized create defaults and exact
outbox rows; blank/limit/kind/transfer validation; owned live updates and
investment-graph rejection; kind-scoped atomic reorder; deterministic,
idempotent templates; and a real category/budget/cell-note
delete/reassign/undo lifecycle. Three genuine initial survivors—expense
transfer defaulting, exhausted reorder slots, and template transfer
semantics—were killed by stronger assertions.

#### Computed columns

Nine real-SQLite tests cover validation before database acquisition, normalized
create/update with immutable `created_at`, ownership-safe tombstone/restore,
exact hidden-ID setting serialization, and slot-preserving reorder including
unknown IDs, empty write sets, and atomic foreign/tombstoned rejection. Every
one of the 43 scoped mutants is killed.

#### Transactions

Fourteen real-SQLite tests cover cash/income/transfer and aggregate creation,
credit-card statement creation/reuse and cycle conversion, amount/date/note
and graph validation, live-owned updates, atomic cash-to-card conversion,
multi-row rollback, tombstone delete/undo, balance reconciliation, reference
counts, and past-month bulk entry. Review added a foreign live delete/no-write
case and proved the null-source shortcut does not even acquire SQLite. A
follow-up pins the transaction and balance-adjustment restore outbox payloads,
including `deleted_at: null` and retained tombstone generation.

#### Budgets and category cascade

The final focused set has 43 tests across the real repository suite and the
existing budget/category seams, versus 18 at baseline. It covers budget CRUD,
natural IDs, immutable creation time, tombstone/restore, exact outbox writes,
all five reference tables, omitted versus explicit-null replacement, category
compatibility, transaction/rule/plan movement, cell-note creation/merge and
length limits, legacy/current undo shapes, stale/foreign/recreated state, and
forced atomic rollback. The reachable assertions materially improve the file,
but truthful branch coverage is 89.65% and the final scoped mutation score is
94.14%; **budgets is not hardened**.

### Final scoped survivor and reachability rulings

These rulings explain residual statuses; they do not turn a below-break raw
score green.

- `accounts.ts:152` and `:166` are two no-coverage object fallbacks after
  scalar aggregate `COUNT(*)` queries without `GROUP BY`; SQLite always
  returns one row, including all-zero counts. The sole survivor at `:322`
  changes a primitive-string type check to true. For a string the map lookup is
  unchanged; for schema-reachable null, `Map.get(null)` is undefined and both
  forms take the same branch.
- `categories.ts:35` replaces the expense-kind side of
  `kind === "expense" && isTransfer` with true. Prior validation rejects the
  only distinguishing input—income with `isTransfer=true`—so all accepted
  inputs persist the same value.
- `computed.ts` has no survivor, timeout, or no-coverage result.
- `transactions.ts:127` and `:128` independently allow zero in one of the two
  signed-amount checks. A lone zero fails the sign agreement and two zeros are
  rejected by the unchanged other check. At `:350`, removing optional chaining
  from `row?.n` is unreachable because SQLite's scalar `COUNT(*)` query always
  returns one row.
- `budgets.ts` has 16 scoped survivors and two no-coverage fallbacks. Mutants
  `#5/#6/#9` at `:14` are equivalent because the fixed `RELATIONS` tuples
  selected by `column === "category_id"` and `target === "categories"` are
  identical. `#28` at `:38` allows zero only after an earlier guard has already
  rejected zero/negative values. `#89` at `:142` changes an initialized list
  which is either unread or overwritten. `#105` at `:150` adds only a
  side-effect-free `id = NULL` lookup. `#181` at `:204` and `#195` at `:211`
  remove optional chaining from locally initialized arrays. `#223` at `:235`
  and `#247` at `:247` replace nullish fallback arrays which cannot execute.
  `#163` at `:189`, `#190` at `:209`, `#192` at `:210`, and
  `#224/#228/#229/#231` at `:236` alter source/target cell-note key tracking,
  optional access, or de-duplication; a real source and target cell note cannot
  share the same table-local primary key. The distinct cross-table same-ID
  mutants `#233/#234` at `:236` are reachable and were killed by a migrated-
  SQLite fixture. Finally, `#243` at `:246` adds only `Promise.all([])` on the
  legacy path.

The budgets rulings explain why no production edit was made during a test-only
task; they do not justify calling 94.14% hardened or lowering the threshold.

### Existing hardened repository ground truth

Five repository files were already hardened before Track B and were not
remeasured per-file in this closeout. Their retained coverage evidence and the
new broad JSON agree with their prior mutation ground truth:

| File | Retained coverage S/B/F/L | Final broad K/T/S/NC/errors; score |
| --- | --- | --- |
| `cell-notes.ts` | 100 / 100 / 100 / 100 | 26/0/0/0/0; 100% |
| `import-plan.ts` | 94.87 / 91.66 / 100 / 100 | 69/0/0/0/0; 100% |
| `investment-validation.ts` | 100 / 97.29 / 100 / 100 | 258/0/0/0/0; 100% |
| `rule-validation.ts` | 100 / 100 / 100 / 100 | 13/0/0/0/0; 100% |
| `settings.ts` | 100 / 100 / 100 / 100 | 25/0/0/0/0; 100% |

The four new fully hardened files plus these existing five establish the final
count: **9/17 non-declaration repository implementation files are
mutation-hardened**. A behavior-changing edit is caught for each hardened file
by its scoped mutation result: all mutants are killed in six files, while the
three other files clear 98 and retain only the exact validated equivalences or
unreachable aggregate fallbacks listed above.

### Seven deliberately untouched files

These files retain their Phase 3 discovery coverage and mutation baselines.
Coverage is `L/F/B`; mutation is `K/T/S/NC`. No current full-run timeout is
used to rewrite this baseline or claim hardening.

| File | Phase 3 coverage L/F/B | Phase 3 mutation K/T/S/NC; score | Why untouched in Track B |
| --- | --- | --- | --- |
| `expected.ts` | 81.48 / 66.66 / 61.53 | 138/0/140/76; 38.98% | Schedule materialization, guarded transitions, FX/card confirmation and revert/update persistence need their own direct harness. |
| `imports.ts` | 52.45 / 36.00 / 32.60 | 170/0/25/257; 37.61% | Import/remap, replace/add ownership and one-batch persistence paths remain thin. |
| `installments.ts` | 31.76 / 12.50 / 36.23 | 48/0/21/159; 21.05% | Plan lifecycle, generated schedules and card-statement persistence need direct fixtures. |
| `investments.ts` | 90.29 / 96.66 / 71.11 | 158/0/67/41; 59.40% | Lines were close, but functions/branches and projected graph/history writes remain below the bar. |
| `maintenance.ts` | 43.36 / 21.87 / 27.17 | 29/0/109/190; 8.84% | The cross-repository maintenance orchestration surface requires a dedicated harness. |
| `onboarding.ts` | 89.47 / 91.66 / 74.35 | 80/0/114/20; 37.38% | Workspace construction, deterministic reseeding/tombstones and balance settings remain under-observed. |
| `rules.ts` | 65.71 / 41.17 / 69.69 | 193/0/71/111; 51.47% | Rule lifecycle, history writes and expected-row integration remain thin. |

They were left visible in the broad scope rather than hidden or granted a
lower bar. The honest partial closeout prioritizes durable evidence over an
unmeasured “all repositories hardened” claim.

## Single final broad mutation run

The exact command was run once at the end of Track B and was not retried:

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npx stryker run
```

The configured scope remained 59 files: all 17 non-declaration repository
implementations, 41 domain files, and `src/auth/recovery.ts`. The config kept
`high: 99`, `low: 98`, `break: 98`, `ignoreStatic: false`, per-test coverage,
four workers and a 15-second timeout. The dry run passed 1,122 tests.

Raw result:

```text
Source files   59
Mutants        7,141
Killed         5,573
Timeout        115
Survived       595
No coverage    858
Errors         0
All score      79.65%
Covered score  90.53%
Threshold      98% (unchanged)
Stryker time   27m 28s
Wall time      1,650s (27m 30s)
Exit           1 — score below break threshold
```

Subtotals parsed deterministically from
`reports/mutation/mutation.json`:

| Surface | Killed | Timeout | Survived | No coverage | Errors | Score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Repository | 2,160 | 78 | 490 | 858 | 0 | 62.41% |
| Domain | 3,297 | 37 | 103 | 0 | 0 | 97.00% |
| Auth recovery | 116 | 0 | 2 | 0 | 0 | 98.31% |
| **Global** | **5,573** | **115** | **595** | **858** | **0** | **79.65%** |

Per-repository results from that same JSON:

| File | K | T | S | NC | Errors | Score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `accounts.ts` | 327 | 0 | 1 | 2 | 0 | 99.09% |
| `budgets.ts` | 289 | 3 | 13 | 2 | 0 | 95.11% |
| `categories.ts` | 96 | 0 | 1 | 0 | 0 | 98.97% |
| `cell-notes.ts` | 26 | 0 | 0 | 0 | 0 | 100% |
| `computed.ts` | 43 | 0 | 0 | 0 | 0 | 100% |
| `expected.ts` | 138 | 0 | 140 | 76 | 0 | 38.98% |
| `import-plan.ts` | 69 | 0 | 0 | 0 | 0 | 100% |
| `imports.ts` | 170 | 2 | 23 | 257 | 0 | 38.05% |
| `installments.ts` | 48 | 0 | 21 | 159 | 0 | 21.05% |
| `investment-validation.ts` | 258 | 0 | 0 | 0 | 0 | 100% |
| `investments.ts` | 158 | 0 | 67 | 41 | 0 | 59.40% |
| `maintenance.ts` | 29 | 0 | 109 | 190 | 0 | 8.84% |
| `onboarding.ts` | 80 | 73 | 41 | 20 | 0 | 71.50% |
| `rule-validation.ts` | 13 | 0 | 0 | 0 | 0 | 100% |
| `rules.ts` | 193 | 0 | 71 | 111 | 0 | 51.47% |
| `settings.ts` | 25 | 0 | 0 | 0 | 0 | 100% |
| `transactions.ts` | 198 | 0 | 3 | 0 | 0 | 98.51% |

Stryker counts timeouts as detected. This run timed out 115 mutants: 78 in
repositories (`budgets` 3, `imports` 2, `onboarding` 73) and 37 in domain
(`expected` 1, `investment-catalog` 35, `money` 1). Phase 4's corrected broad
run had only 14 timeouts. Therefore the raw rise from Phase 4's 71.52% to
79.65% is **not** claimed as a clean mutation-score improvement. The killed-
only share is 5,573/7,141, or 78.04%, but that is a diagnostic calculation,
not Stryker's score. The scoped, zero-timeout results above remain the basis
for the four new hardening verdicts; broad `budgets` at 95.11% is likewise not
an improvement over its 94.14% scoped result because three survivors merely
timed out.

## Newly discovered production defect

A valid migrated-SQLite budget fixture gave an `installment_plans` row and a
`cell_notes` row the same table-local ID, then wrote them at the same timestamp.
`writeRows` currently derives the unique outbox idempotency key as
`{rowId}:{updatedAt}` without the table name. The two different-table events
therefore collide; `ON CONFLICT` replaces only the payload and creation time,
leaving one outbox row and displacing the other event. This is a production
sync data-loss defect, not a test expectation or an equivalent mutant.

The valid cross-table fixture remains because it kills the real budgets
mutants which incorrectly apply same-table identity assumptions across tables.
The incorrect outbox result is not asserted as desired behavior. No production
fix was authorized in this test-only closeout; correction must include the
table in the idempotency identity and migrate or otherwise account for any
stored-key lifecycle implications before changing `src/db/mutations.ts`.

## Final normal gate

The required completion command is:

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm run control:check && npx tsc --noEmit && npx vitest run
```

Fresh result after this document was written: exit 0. The control checked 35
installed skills plus the Claude bridge and lockfile; TypeScript exited 0 with
no diagnostics; Vitest passed 131 files and 1,154 tests with exactly two todos
(1,156 total) in 6.20 seconds. The only diagnostics were the existing Node
experimental-SQLite warnings.

## Scope discipline

Track B changed tests and the critical coverage list only. Task 15 changes
this result document only. It does not change production, test, mutation or
coverage configuration, thresholds, dependencies, architecture contracts,
the frozen baseline, or either existing executable todo. It does not fix or
normalize the new outbox defect. No PR, merge, deployment, release, OTA, or
workflow dispatch is part of this result.
