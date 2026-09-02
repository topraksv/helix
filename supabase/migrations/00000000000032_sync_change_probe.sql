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
-- Dynamic SQL rather than 21 hand-written UNION branches: the table list is a
-- literal in this body (never caller input), `format('%I')` quotes it, and
-- EXECUTE takes no PL/pgSQL variable substitution, so the OUT parameter names
-- below cannot capture a column reference the way they could in a static query.
--
-- NOT YET APPLIED to the linked project, on the same terms as migration 8:
-- applying a migration to the live database is a separately authorized step.
-- The client treats a missing function as "probe unavailable" and falls back to
-- the per-table walk, so shipping this ahead of the migration is safe and the
-- speedup simply switches on when the migration lands.

create or replace function public.sync_cursors()
returns table (table_name text, max_updated_at timestamptz, max_id uuid)
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  t text;
begin
  foreach t in array array[
    'persons','categories','category_budgets','investment_profiles',
    'investment_products','payment_sources','computed_columns',
    'installment_plans','credit_card_statements','subscriptions',
    'transactions','attachments','matrix_colors','investment_operations',
    'price_history','recurring_incomes','expected_payments',
    'balance_adjustments','cell_notes','settings','fx_rates'
  ] loop
    -- LEFT JOIN LATERAL, not a bare SELECT ... LIMIT 1: every table must come
    -- back as a row even when it holds nothing for this caller. The client
    -- reads an ABSENT table as "the probe does not cover this one, pull it"
    -- and a PRESENT row with a null head as "the server has nothing here,
    -- skip it". Collapsing those two would make a table added to
    -- SYNCED_TABLES but not to the list above silently un-pullable forever,
    -- which is the one failure this whole function must not be able to cause.
    return query execute format(
      'select %L::text, k.updated_at, k.id
         from (select 1) probe
         left join lateral (
           select h.updated_at, h.id
             from public.%I h
            where h.user_id = auth.uid()
            order by h.updated_at desc, h.id desc
            limit 1
         ) k on true',
      t, t);
  end loop;
end $$;

-- Same posture as delete_own_account: a signed-in caller only, and the body
-- carries no argument that could name another account.
revoke all on function public.sync_cursors() from public, anon;
grant execute on function public.sync_cursors() to authenticated;

comment on function public.sync_cursors() is
  'Per-table keyset head (max updated_at, id) for the calling user. Lets the '
  'sync pull skip tables that have not changed, replacing 21 round trips with 1.';
