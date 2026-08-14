# Proposed source moves

Two structural moves have been evaluated and neither is approved. This file
records what each would change and the evidence an approval must produce, so
the analysis is not repeated from scratch. Any accepted move must preserve
behavior, keep routes as leaves, retain the `src/data/repo.ts` facade, and
update `tests/architecture-contract.test.ts` in the same change when a
dependency rule changes.

| Rank | Proposal | Value | Risk |
|---|---|---|---|
| 1 | Put backup/restore persistence behind one data-layer interface | High | High |
| 2 | Move live-query internals behind the existing hooks interface | Medium–high | High |

## 1. Put backup/restore persistence behind one data-layer interface

**Current seam:** backup work crosses both directions between persistence and
integrations. `src/services/export-import.ts` opens SQLite, writes row batches,
and imports `src/data/repo/investment-validation.ts`; meanwhile
`src/data/repo/imports.ts` and `src/data/repo/import-plan.ts` import the
spreadsheet integration from `src/services/spreadsheet-import.ts`.

**Proposed move:** create a focused `src/data/import/` module that owns backup
validation, id remapping, spreadsheet write planning, and the atomic restore
interface. Keep device/browser file selection and file sharing in `services`
as adapters. Continue exposing user writes through `src/data/repo.ts`; do not
give routes raw database access.

**Value:** one interface would own the invariants that must hold before any
restore write, eliminate the `services → data/repo` dependency, and put the
backup, spreadsheet, and sync row-validation knowledge beside the persistence
shape it validates.

**Risk and approval conditions:** high. This path protects cross-account id
remapping, all-or-nothing writes, tombstones, input limits, and investment
projection. Approval should require an explicit interface sketch, a dependency
rule in the architecture contract, and unchanged backup, import, sync outbound,
investment-maintenance, privacy, and round-trip tests. File-system and browser
download code must remain outside the data interface.

**Status:** not approved. This is an interface redesign rather than a pure
move: it would create `src/data/import/`, redistribute validation and
write-planning responsibilities, and change the dependency contract. Its value
requires logic extraction, explicit interface design, targeted test work, and
an architecture-contract change.

## 2. Move live-query internals behind the existing hooks interface

**Current seam:** `src/data/hooks.ts` is 772 lines and has three independently
changing implementations: the retry/change-listener engine and shared
subscription registry, table-specific live queries, and financial projection
caches. Thirty-four source modules import its public hooks.

**Proposed move:** keep `src/data/hooks.ts` as the stable interface and move the
three implementation clusters into private files under `src/data/live/`. Do
not split the public hook names across caller-visible import paths.

**Value:** failures in subscription lifetime, table invalidation, and financial
projection would become local to separate implementations while all callers
retain one interface. This is an internal seam: no new adapter or second data
library is justified.

**Risk and approval conditions:** high. The current module contains incident
rationales for retry-forever behavior, parameter-owned snapshots, listener
coalescing, and shared-query lifetime. Those comments must move with their
implementation. Approval should require targeted lifecycle tests before the
move; the existing `live-state`, database-recovery, session, ledger, and full
integration gates alone do not prove React subscription identity.

**Status:** not approved. Splitting `hooks.ts` would extract interdependent
state, retry, listener, registry, and projection logic, not move a whole file.
The required targeted React subscription-identity tests do not exist, and the
existing integration gate cannot replace that proof.

## Deliberately not proposed

- Do not remove root route re-exports such as `src/app/analytics.tsx` and
  `src/app/budgets.tsx`. `tests/navigation.test.ts` and their incident comments
  prove that root and in-tab entry paths need different navigation stacks.
- Do not split `src/ui/charts.tsx`, `src/ui/selection-controls.tsx`, or route
  files solely because they are long. Each currently concentrates related
  behavior behind a small interface; line count alone does not establish a
  better seam.

The byte-identical asset pairs and the root-configuration location are settled
in [`ARCHITECTURE.md`](ARCHITECTURE.md); do not reopen either as a move.
