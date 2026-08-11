---
name: financial-data-integrity
description: Protects Helix money, date, ledger, import, backup, recurrence, and reconciliation semantics. Use when a task changes financial calculations, persistence, restore, sync, expected payments, or account-bound data.
---

# Financial data integrity

## Procedure

1. Read the relevant `.ai/INVARIANTS.md` section and every caller of the
   changed domain/repository function. Identify the source of truth for amount,
   date, category, ownership and lifecycle.
2. Keep money in integer minor units, dates strict, signs/types meaningful,
   references live and account ownership fail-closed. Preserve tombstones,
   atomic writes, session scoping and legacy backup recoverability.
3. Build a small independent oracle or property/regression case for the changed
   rule. Do not accept a snapshot or UI-only assertion as a financial oracle.
4. Run the relevant focused tests, then `npm run verify:full` for a finished
   data/financial slice. Inspect restore/pull/push and route callers before
   declaring the rule complete.

## Required evidence

Every changed invariant names its source/test anchor, boundary validation,
positive and invalid cases, account-isolation behavior and command output.
Mutation survivors or unavailable native/database checks remain reported.

## Acceptance

The financial meaning is unchanged or explicitly specified, all writes remain
atomic and owner-bound, invalid input fails closed, and a regression/property
test plus the required full gate pass.
