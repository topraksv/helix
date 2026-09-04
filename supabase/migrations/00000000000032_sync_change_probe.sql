-- One round trip that answers "which of my tables changed?".
--
-- `pullAndMerge` walked all 21 synced tables and issued a PostgREST GET for
-- each one, whether or not anything had moved. A sync therefore cost 21
-- sequential round trips — and `scheduleSync` fires 1.5s after every write, so
-- the steady state of an app that is fully in sync was 21 requests that all
-- came back empty. On a phone at 150ms RTT that is three seconds of radio per
-- keystroke-sized edit.
--
-- PostgREST cannot read two tables in one request, so the batch has to be a
-- function. This one returns the greatest (updated_at, id) each table holds for
-- the caller: exactly the keyset the pull already pages on, so the client can
-- compare it against its stored cursor and pull only the tables that are
-- actually behind. Fully-synced devices go from 21 requests to 1.
--
-- SECURITY INVOKER (the default, stated for the reader): RLS applies as it does
-- to any other read, so this function can never widen what a caller can see.
-- `delete_own_account` needs SECURITY DEFINER because it reaches auth.users;
-- this one reads only the caller's own public tables and must not.
--
-- The explicit `user_id = auth.uid()` is redundant with the RLS predicate and
-- is there for the planner: it makes the (user_id, updated_at, id) index from
-- migration 5 a one-row backward index scan instead of a filter over the owner
-- partition. Every one of the 21 tables carries that index — 5 created 15 of
-- them, 7/15/16/30 the rest.
--
-- WRITTEN OUT rather than looped, and this is the second version. The first
-- built each branch with `format('%I', t)` inside a `foreach` over a literal
-- array, which runs correctly and does not survive review by a machine:
-- `supabase db lint` runs `plpgsql_check`, which analyses a function without
-- executing it, cannot fold the loop variable, and read the whole array as one
-- relation name — `relation "public.{persons,categories,...}" does not exist`.
-- The repository lints with `--fail-on warning`, so that is a failing gate.
--
-- Spelling the branches out is better than silencing the lint, because it buys
-- the thing dynamic SQL costs: every table reference below is now checked when
-- the function is created, so a name that is wrong or a table that has been
-- dropped is an error at migration time instead of at the first sync. It is
-- `language sql` for the same reason — no procedural body to be unable to
-- check, and the planner sees the whole statement.
--
-- `tests/relations-contract.test.ts` holds this list equal to `SYNCED_TABLES`,
-- which is what makes the repetition safe to maintain.
--
-- LEFT JOIN LATERAL, not a bare SELECT ... LIMIT 1: every table must come back
-- as a row even when it holds nothing for this caller. The client reads an
-- ABSENT table as "the probe does not cover this one, pull it" and a PRESENT
-- row with a null head as "the server has nothing here, skip it". Collapsing
-- those two would make a table added to SYNCED_TABLES but not to this function
-- silently un-pullable forever, which is the one failure it must not cause.
--
-- Applied to the linked project; the speedup is live. It was safe to ship the
-- client ahead of it and remains safe to run against a database that does not
-- have it: PostgREST answers a missing function with `PGRST202`, which the
-- engine reads as "probe unavailable" and falls back to the per-table walk for
-- the rest of the session. That fallback is why this file could be written
-- before the migration was pushed, and why it stays correct if it is ever
-- replayed against an older database.

create or replace function public.sync_cursors()
returns table (table_name text, max_updated_at timestamptz, max_id uuid)
language sql
security invoker
stable
set search_path = ''
as $$
  select 'persons'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.persons h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'categories'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.categories h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'category_budgets'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.category_budgets h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'investment_profiles'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.investment_profiles h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'investment_products'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.investment_products h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'payment_sources'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.payment_sources h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'computed_columns'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.computed_columns h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'installment_plans'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.installment_plans h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'credit_card_statements'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.credit_card_statements h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'subscriptions'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.subscriptions h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'transactions'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.transactions h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'attachments'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.attachments h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'matrix_colors'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.matrix_colors h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'investment_operations'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.investment_operations h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'price_history'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.price_history h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'recurring_incomes'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.recurring_incomes h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'expected_payments'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.expected_payments h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'balance_adjustments'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.balance_adjustments h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'cell_notes'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.cell_notes h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'settings'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.settings h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
  union all
  select 'fx_rates'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.fx_rates h
       where h.user_id = auth.uid()
       order by h.updated_at desc, h.id desc limit 1
    ) k on true
$$;

-- Same posture as delete_own_account: a signed-in caller only, and the body
-- carries no argument that could name another account.
revoke all on function public.sync_cursors() from public, anon;
grant execute on function public.sync_cursors() to authenticated;

comment on function public.sync_cursors() is
  'Per-table keyset head (max updated_at, id) for the calling user. Lets the '
  'sync pull skip tables that have not changed, replacing 21 round trips with 1.';
