-- A timestamp-only LWW merge lets a stale offline client resurrect a row that
-- another device deleted: its later push receives a fresh server updated_at.
-- Carry a monotonic delete generation on every synced row. The shared trigger
-- increments it on a live -> tombstone transition, accepts an explicit undo at
-- the same observed generation, and turns writes from an older generation into
-- an acknowledgement of the current server row.

do $$
declare
  t text;
begin
  foreach t in array array[
    'persons','payment_sources','categories','computed_columns',
    'installment_plans','credit_card_statements','transactions',
    'subscriptions','price_history','recurring_incomes','expected_payments',
    'balance_adjustments','cell_notes','settings','fx_rates','category_budgets'
  ] loop
    execute format(
      'alter table public.%I add column tombstone_version bigint not null default 0',
      t
    );
    execute format(
      'alter table public.%I add constraint %I check (tombstone_version >= 0)',
      t,
      t || '_tombstone_version_nonnegative'
    );
  end loop;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null and new.tombstone_version = 0 then
      new.tombstone_version := 1;
    end if;
  else
    -- An older client did not observe the latest delete/undo generation. Keep
    -- the server row and return it through PostgREST so the client converges.
    if new.tombstone_version < old.tombstone_version then
      return old;
    end if;

    if old.deleted_at is null and new.deleted_at is not null then
      if new.tombstone_version not in (old.tombstone_version, old.tombstone_version + 1) then
        raise check_violation using message = 'invalid tombstone generation';
      end if;
      new.tombstone_version := old.tombstone_version + 1;
    elsif new.tombstone_version <> old.tombstone_version then
      raise check_violation using message = 'invalid tombstone generation';
    end if;
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
