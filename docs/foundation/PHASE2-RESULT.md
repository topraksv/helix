# Phase 2 Result

Phase 2 evaluated the three source moves in `PROPOSED-MOVES.md` under the
move-only rules. No source move was executed. All three proposals are rejected
for this phase for the reasons below; this is the structural result, not an
unresolved decision.

The deletion half remains closed on the evidence supplied for this run: there
is no repository-owned dead file, empty directory, or unused dependency to
remove. The frozen baseline and the pending-proposal source were restored
byte-for-byte from `df3bfd6^` before the decisions were made.

## Proposal decisions

### 1. Put backup/restore persistence behind one data-layer interface — rejected

The proposal is an interface redesign, not a pure move. It would create
`src/data/import/`, redistribute validation and write-planning responsibilities,
and change the dependency contract. The current cross-layer imports are real:
`src/services/export-import.ts` imports repository investment validation, while
`src/data/repo/imports.ts` imports spreadsheet parsing from `services`.

Its value is also the reason it is out of scope: obtaining one deep restore
interface requires logic extraction, an explicit interface design, targeted
test work, and an architecture-contract change. A move-plus-import-only change
cannot produce that interface without pretending that relocation is design.

### 2. Move live-query internals behind the existing hooks interface — rejected

The proposed result would split the 772-line `src/data/hooks.ts` implementation
into three new private modules. That is an extraction of interdependent state,
retry, listener, registry, and projection logic rather than a whole-file move.
The file also carries incident rationales for retry-forever behavior,
parameter-owned snapshots, listener coalescing, and shared-query lifetime.

The proposal's approval condition requires targeted React subscription-identity
tests before extraction. Those tests are not present, and this phase permits no
test-logic changes. The existing integration gate cannot replace that missing
proof, so the module stays intact.

### 3. Move category-icon policy from `data` to `domain` — rejected

This is the only proposal shaped as a pure file move. The module is pure and
has thirteen source importers: eleven routes plus two repository modules.
However, no test directly references `category-icons`, `suggestCategoryIcon`,
`categoryIcon`, or `paymentSourceIcon`.

The icons are persisted defaults and therefore user-visible behavior. The
proposal explicitly requires direct, snapshot-free coverage of keyword
precedence, Turkish normalization, deterministic fallback, and payment-source
exhaustiveness before the move. Adding that coverage would be a test-logic
change outside this phase's move-plus-import-only authority. The safer decision
is to leave the correctly functioning module where it is until that
precondition can be satisfied in a separately authorized refactor.

## Gate evidence

Every commit in this run was followed by the required full gate:

```text
$ npm run control:check && npx tsc --noEmit && npx vitest run

008c09e  control: 35 skills/bridge/lock clean; tsc: exit 0
         Test Files 110 passed (110); Tests 970 passed (970); Duration 5.07s

f579cc9  control: 35 skills/bridge/lock clean; tsc: exit 0
         Test Files 110 passed (110); Tests 970 passed (970); Duration 5.06s

2db87ac  control: 35 skills/bridge/lock clean; tsc: exit 0
         Test Files 110 passed (110); Tests 970 passed (970); Duration 5.16s
```

No move commit exists, so no per-move gate was applicable. A fresh full gate is
run after this result is committed and before the branch is pushed.

## Deliberately left alone

- Nothing under `src/app/` moved; route paths and URLs are unchanged.
- `tests/architecture-contract.test.ts` was neither weakened nor edited.
- The deliberate `components → calculator → components` back-edge is unchanged.
- Backup/restore, live-query, and category-icon source remains at its current
  paths for the proposal-specific reasons above.
- The §2.7 projection defect is documented in `SPEC.md`; behavior is unchanged.
- Vendored skill bodies, dependencies, intentional duplicate assets, root tool
  entries, and gitignored local output are unchanged.
- `BASELINE.md` remains the original point-in-time measurement; it was not
  refreshed or interpreted as current performance.
