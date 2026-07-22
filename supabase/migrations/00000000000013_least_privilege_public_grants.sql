-- Migration 9 added the row-level DML grants that the client needs, but it did
-- not first remove Supabase's default authenticated grants. That left
-- REFERENCES, TRIGGER, TRUNCATE and MAINTAIN on every synced table even though
-- none is part of the client contract. Rebuild the grants from zero and prevent
-- future public-schema objects from inheriting the same broad defaults.

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
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

revoke all on table public.keep_alive from anon, authenticated;
grant all on table public.keep_alive to service_role;

-- Trigger functions execute through their installed triggers; client roles do
-- not need a directly executable public API for them. Keep the narrowly scoped
-- delete_own_account RPC unchanged.
revoke all on function public.enforce_category_kind() from public, anon, authenticated;
revoke all on function public.enforce_expected_payment_ref() from public, anon, authenticated;
revoke all on function public.enforce_expense_budget_category() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;

commit;
