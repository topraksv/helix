# Proposed Source Moves

Proposal only. Nothing in this document was executed during the foundation
reset. Any accepted move must preserve behavior, keep routes as leaves, retain
the `src/data/repo.ts` facade, and update
`tests/architecture-contract.test.ts` in the same change when a dependency rule
changes.

## Ranking

| Rank | Proposal | Value | Risk |
|---|---|---|---|
| 1 | Put backup/restore persistence behind one data-layer interface | High | High |
| 2 | Move live-query internals behind the existing hooks interface | Medium–high | High |
| 3 | Move category-icon policy from `data` to `domain` | Medium | Low–medium |

## Phase 2 decision record

Phase 2 executed no source moves. Its deletion sweep found no
repository-owned dead file, empty directory, or unused dependency to remove.
Before these decisions, the frozen baseline and this pending-proposal source
were restored byte-for-byte from `df3bfd6^`.

Four pre-evidence full gates passed: `npm run control:check`,
`npx tsc --noEmit`, and `npx vitest run` reported 35 installed skills with a
clean bridge and lockfile, type-check exit 0, and 110 passing test files with
970 passing tests. No per-move gate applied because no move was made.

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

**Status:** Rejected for Phase 2. This is an interface redesign rather than a
pure move: it would create `src/data/import/`, redistribute validation and
write-planning responsibilities, and change the dependency contract. Its value
requires logic extraction, explicit interface design, targeted test work, and
an architecture-contract change, none of which fit move-plus-import-only
authority.

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

**Status:** Rejected for Phase 2. Splitting `hooks.ts` would extract
interdependent state, retry, listener, registry, and projection logic, not move
a whole file. The required targeted React subscription-identity tests were not
present, and the phase allowed no test-logic changes; the existing integration
gate cannot replace that proof.

## 3. Move category-icon policy from `data` to `domain`

**Current seam:** `src/data/category-icons.ts` is a pure deterministic product
policy. Routes use it for display, while category/import repositories use the
same suggestion to persist a default. It performs no query, mutation, or I/O,
so its current `data` location does not describe its dependencies.

**Proposed move:** move the module to `src/domain/category-icons.ts` without
renaming its exports. Update its thirteen source importers and add direct tests
for keyword precedence, Turkish normalization, deterministic fallback, and
payment-source exhaustiveness before moving it.

**Value:** the dependency direction becomes explicit: both routes and data can
consume one pure rule without making presentation code look like repository
infrastructure.

**Risk and approval conditions:** low–medium. Runtime behavior is simple, but
the visual defaults are persisted and therefore user-visible. Approval should
require snapshot-free behavioral tests and the architecture gate; no icon,
keyword order, or fallback pool may change in the move.

**Status:** Phase 2 cleared the move pending direct behavior tests; it did not
execute while that proof was missing. Track A later added snapshot-free tests
for `suggestCategoryIcon`, `categoryIcon`, and `paymentSourceIcon`, satisfying
the condition, then executed the unchanged move to
`src/domain/category-icons.ts`. All thirteen source importers use that seam.

## Deliberately not proposed

- Do not merge the byte-identical splash and brand symbol pairs. Their
  native-rebuild and OTA lifecycles are intentionally different and documented
  in `docs/ARCHITECTURE.md`.
- Do not remove root route re-exports such as `src/app/analytics.tsx` and
  `src/app/budgets.tsx`. `tests/navigation.test.ts` and their incident comments
  prove that root and in-tab entry paths need different navigation stacks.
- Do not split `src/ui/charts.tsx`, `src/ui/selection-controls.tsx`, or route
  files solely because they are long. Each currently concentrates related
  behavior behind a small interface; line count alone does not establish a
  better seam.
- Do not move required root configuration into a tooling directory.
  `docs/ARCHITECTURE.md` records that Expo, Metro, Babel, Drizzle, TypeScript,
  ESLint, Vitest, and Playwright discover it at the root.
