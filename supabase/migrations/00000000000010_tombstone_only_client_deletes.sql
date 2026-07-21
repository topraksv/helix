-- Client-side deletion is always a synced tombstone (`deleted_at`), never a
-- physical row delete. Keep hard deletion available only to service_role and
-- to the narrowly scoped delete_own_account SECURITY DEFINER function, whose
-- auth.users delete cascades the whole account atomically.

begin;

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
    execute format('revoke delete on table public.%I from authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
  end loop;
end $$;

commit;
