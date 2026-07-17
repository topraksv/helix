-- Sync-pull indexes + server-side money bounds + cell_notes natural-key
-- uniqueness (2026-07-17 audit, package 2).
--
-- 1) Every pull runs `user_id = auth.uid() AND updated_at > cursor ORDER BY
--    updated_at, id` per table; only transactions/expected_payments had a
--    matching composite index, so the other tables seq-scanned on every sync.
-- 2) Money magnitude was enforced only client-side. A row pushed outside the
--    JS safe-integer range (2^53-1 minor units) would sync to other devices
--    and crash their display layer (assertMinor throws). These CHECKs cap
--    every money column at the app's hard invariant; sign is intentionally
--    unconstrained (refunds are signed negative by design).
-- 3) "One note per real month/category cell" was app-discipline only. The
--    dedup keeps the newest live note per cell (ties by id), tombstones the
--    rest (the set_updated_at trigger bumps updated_at, so LWW propagates the
--    tombstones to devices), then locks the invariant with a partial unique
--    index. Client write order was aligned in the same package: a legacy-note
--    tombstone is written before the canonical row so one upsert batch never
--    transiently violates the index.

-- --------------------------------------------------------------------------
-- 1. Composite (user_id, updated_at, id) index on every synced table.
-- --------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'persons','payment_sources','categories','computed_columns',
    'installment_plans','credit_card_statements','transactions',
    'subscriptions','price_history','recurring_incomes','expected_payments',
    'balance_adjustments','cell_notes','settings','fx_rates'
  ] loop
    execute format(
      'create index if not exists %I on public.%I (user_id, updated_at, id)',
      t || '_user_updated_id', t);
  end loop;
end $$;

-- Fully covered by transactions_user_updated_id above.
drop index if exists public.idx_tx_user_updated;

-- --------------------------------------------------------------------------
-- 2. Money magnitude bounds (JS safe integer, minor units) + installment_no.
--    NULLs pass a CHECK, so nullable columns need no special casing.
-- --------------------------------------------------------------------------
alter table public.transactions
  add constraint tx_amount_minor_bounds
    check (abs(amount_minor) <= 9007199254740991),
  add constraint tx_amount_try_minor_bounds
    check (abs(amount_try_minor) <= 9007199254740991),
  add constraint tx_installment_no_positive
    check (installment_no is null or installment_no >= 1);

alter table public.subscriptions
  add constraint sub_amount_minor_bounds
    check (abs(amount_minor) <= 9007199254740991);

alter table public.price_history
  add constraint price_amount_minor_bounds
    check (abs(amount_minor) <= 9007199254740991);

alter table public.recurring_incomes
  add constraint income_amount_minor_bounds
    check (abs(default_amount_minor) <= 9007199254740991);

alter table public.expected_payments
  add constraint expected_amount_minor_bounds
    check (abs(amount_minor) <= 9007199254740991);

alter table public.balance_adjustments
  add constraint adjustment_amount_minor_bounds
    check (abs(amount_minor) <= 9007199254740991);

alter table public.installment_plans
  add constraint plan_total_amount_minor_bounds
    check (abs(total_amount_minor) <= 9007199254740991),
  add constraint plan_monthly_amount_minor_bounds
    check (abs(monthly_amount_minor) <= 9007199254740991);

-- --------------------------------------------------------------------------
-- 3. cell_notes: converge duplicates, then lock the natural key.
-- --------------------------------------------------------------------------
update public.cell_notes c
set deleted_at = now()
where c.deleted_at is null
  and exists (
    select 1 from public.cell_notes k
    where k.user_id = c.user_id
      and k.month = c.month
      and k.category_id = c.category_id
      and k.deleted_at is null
      and (k.updated_at > c.updated_at
           or (k.updated_at = c.updated_at and k.id > c.id))
  );

create unique index if not exists cell_notes_natural_cell
  on public.cell_notes (user_id, month, category_id)
  where deleted_at is null;
