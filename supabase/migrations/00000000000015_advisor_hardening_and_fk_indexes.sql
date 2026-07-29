-- Resolve the actionable Supabase Advisor findings without weakening the
-- owner-only sync contract. Foreign-key indexes lead with user_id because all
-- app queries and cascades are account-scoped.

begin;

-- Account deletion intentionally crosses into auth.users, so it must remain a
-- SECURITY DEFINER RPC. Its argument-free body can only target the JWT owner;
-- pinning both owner and search_path prevents caller-controlled resolution.
create or replace function public.delete_own_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

alter function public.delete_own_account() owner to postgres;
revoke all on function public.delete_own_account()
  from public, anon, authenticated, service_role;
grant execute on function public.delete_own_account() to authenticated;

-- service_role bypasses RLS, but an explicit policy records the only intended
-- actor and prevents keep_alive from remaining an unexplained policy-less
-- public table.
drop policy if exists keep_alive_service_role on public.keep_alive;
create policy keep_alive_service_role
  on public.keep_alive
  for all
  to service_role
  using (true)
  with check (true);

-- Composite owner relations are used for both referential checks and
-- account-scoped maintenance. Index the referencing side in FK column order.
create index if not exists category_budgets_user_category
  on public.category_budgets (user_id, category_id);
create index if not exists cell_notes_user_category
  on public.cell_notes (user_id, category_id);
create index if not exists expected_payments_user_transaction
  on public.expected_payments (user_id, transaction_id);
create index if not exists installment_plans_user_category
  on public.installment_plans (user_id, category_id);
create index if not exists installment_plans_user_person
  on public.installment_plans (user_id, person_id);
create index if not exists installment_plans_user_source
  on public.installment_plans (user_id, payment_source_id);
create index if not exists payment_sources_user_person
  on public.payment_sources (user_id, person_id);
create index if not exists price_history_user_subscription
  on public.price_history (user_id, subscription_id);
create index if not exists recurring_incomes_user_category
  on public.recurring_incomes (user_id, category_id);
create index if not exists recurring_incomes_user_person
  on public.recurring_incomes (user_id, person_id);
create index if not exists subscriptions_user_category
  on public.subscriptions (user_id, category_id);
create index if not exists subscriptions_user_person
  on public.subscriptions (user_id, person_id);
create index if not exists subscriptions_user_source
  on public.subscriptions (user_id, payment_source_id);
create index if not exists transactions_user_category
  on public.transactions (user_id, category_id);
create index if not exists transactions_user_person
  on public.transactions (user_id, person_id);
create index if not exists transactions_user_plan
  on public.transactions (user_id, installment_plan_id);
create index if not exists transactions_user_source
  on public.transactions (user_id, payment_source_id);
create index if not exists transactions_user_subscription
  on public.transactions (user_id, subscription_id);

-- The production index statistics showed zero scans for this server-side date
-- index, while every effective-date query is executed against local SQLite.
-- The sync keyset index below is the actual remote ordering path.
drop index if exists public.idx_tx_user_effective;

-- Advisor can report these as unused on empty or low-volume tables. They are
-- nevertheless required by the uniform remote pull keyset:
-- user_id + (updated_at, id), in that order, for every synced table.
comment on index public.computed_columns_user_updated_id is
  'Required by the sync pull keyset on (user_id, updated_at, id).';
comment on index public.subscriptions_user_updated_id is
  'Required by the sync pull keyset on (user_id, updated_at, id).';
comment on index public.price_history_user_updated_id is
  'Required by the sync pull keyset on (user_id, updated_at, id).';
comment on index public.recurring_incomes_user_updated_id is
  'Required by the sync pull keyset on (user_id, updated_at, id).';
comment on index public.balance_adjustments_user_updated_id is
  'Required by the sync pull keyset on (user_id, updated_at, id).';

commit;
