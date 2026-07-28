---
name: financial-data-integrity
description: Protects Helix's ledger, money, sync, import/export, backup, recovery, and reconciliation invariants. Use for changes to amounts, dates, categories, statements, derived rows, repository writes, outbox/pull logic, migrations, file parsing, or any calculation that can silently corrupt financial history.
---

# Financial Data Integrity

## Overview

Make invalid financial states unrepresentable at the repository boundary and
prove transformations over adversarial inputs. The canonical rules live in
`AGENTS.md` and `docs/ARCHITECTURE.md`; this skill supplies the workflow, not a
duplicate specification.

## Route the Task

- Use `property-based-testing` for parsers, round trips, normalization,
  reconciliation, ordering, and serialization invariants.
- Use `supabase-postgres-best-practices` for schema, RLS, constraints, indexes,
  and query work.
- Use `security-and-hardening` for ownership, session, import, backup, and
  external-data trust boundaries.
- Use `systematic-debugging` for a defect and `tdd` when test-first work is
  requested.

## Workflow

1. Name the user's unit and the invariant at risk: amount, entry, month,
   statement, account, file, or sync event.
2. Trace every read and write call site from UI input or remote row through the
   stable repository facade to SQLite/Supabase and back.
3. Define valid, boundary, legacy, malformed, duplicate, reordered, retry, and
   interrupted cases before changing code.
4. Keep calculation and persistence exact: integer minor units, ISO domain
   dates, deterministic identities, transactional writes, tombstones, and
   server-authoritative sync as required by the canonical documents.
5. Test public outcomes and preservation properties. Prefer roundtrip,
   idempotence, conservation, monotonic cursor, and retry-equivalence
   properties where they express the real contract.
6. Prove failure atomicity: no partial import, orphaned reference, deleted
   history, advanced cursor, removed outbox event, or stale-session write.
7. Search every call site for the same class of defect.
8. Run focused tests, `npm run verify`, and linked database/import/device
   acceptance named by `docs/TESTING.md`.

## Review Questions

- Can a negative, overflowed, rounded, mismatched, or foreign amount enter?
- Can planned and realized totals be paired from different bases?
- Can retries, reordering, duplicate events, or account switching change the
  final state?
- Can a valid legacy backup become unrecoverable because of a new input limit?
- Can malformed data advance progress or cursor state?
- Does the repair preserve immutable paid/skipped history and references?

Never “repair” data by weakening validation, synthesizing ambiguous facts, or
trading atomicity for batching.
