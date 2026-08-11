---
name: supabase-postgres-best-practices
description: Designs or reviews Helix Supabase schema, SQL, RLS, migrations, indexes, transactions, and query plans. Use when a task changes PostgreSQL or Supabase behavior, schema, migration history, or database performance.
---

# Supabase/Postgres

## Procedure

1. Read the current migration chain, generated database types, `src/db/`,
   `src/sync/`, `src/db/relations.ts` and relevant RLS policy. Source schema
   and invariants outrank a generic rule card.
2. Keep migrations reproducible and additive unless a destructive migration is
   explicitly authorized. Preserve tombstones, account predicates, ownership,
   transaction boundaries and generated types.
3. Check query shape, indexes, pagination, N+1 behavior and lock duration with
   the actual schema/plan. Never claim linked-project evidence from a local
   mock, and never run `supabase db reset` against a linked project.
4. Run migration/pgTAP/database workflow checks and regenerate types when the
   schema changes. Record local-versus-linked limitations.

## Acceptance

The migration is reproducible, RLS/account isolation remains explicit, query
evidence matches the current schema, generated types are current, and the real
database checks pass or their blocker is reported.
