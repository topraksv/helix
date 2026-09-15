-- 1.8.0: payments made against a card statement, dated balance declarations,
-- early loan closure, and the link from a refund to the expense it returns.
--
-- Every change is additive and nullable or defaulted, so a client that
-- predates it keeps writing valid rows -- the forward-only, backward-compatible
-- rule in docs/RELEASE.md. Publish it BEFORE the client that writes these
-- columns: the outbound sync policy derives its columns from the local schema,
-- and a push naming a column this database lacks is refused for its whole
-- batch.

begin;

-- A declaration states the balance at the end of its day rather than moving
-- it. `amount_minor` keeps the difference the declaration made when it was
-- written, which is all a client without declarations can read.
alter table public.balance_adjustments
  add column if not exists declared_minor bigint
    constraint balance_adjustments_declared_minor_bounds
    check (declared_minor is null or declared_minor between -99999999999999 and 99999999999999);

-- An early closure shortens the plan to the instalments due by `closed_on` and
-- keeps the count it had, so the closure can be undone.
alter table public.installment_plans
  add column if not exists closed_on date
    constraint installment_plans_closed_on_finite
    check (closed_on is null or (pg_catalog.isfinite(closed_on) and closed_on between date '0001-01-01' and date '9999-12-31')),
  add column if not exists original_installment_count integer
    constraint installment_plans_original_count_bounds
    check (original_installment_count is null or original_installment_count between 1 and 600);

-- The expense a refund returns. No foreign key, on purpose: the refund and the
-- expense are rows of the same table and a push can carry them in different
-- batches, so a refund whose expense has not arrived must still be accepted.
-- The client reads a link to a row it does not hold as no link.
alter table public.transactions
  add column if not exists refund_of_transaction_id uuid
    constraint transactions_refund_of_not_self
    check (refund_of_transaction_id is null or refund_of_transaction_id <> id);

create index if not exists transactions_user_refund_of
  on public.transactions (user_id, refund_of_transaction_id)
  where refund_of_transaction_id is not null;

-- A payment the owner made against one statement. A statement with none is
-- paid in full on its due date; one with any is settled by them instead.
create table if not exists public.card_statement_payments (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  statement_id uuid not null,
  paid_on date not null
    constraint card_statement_payments_paid_on_finite
    check (pg_catalog.isfinite(paid_on) and paid_on between date '0001-01-01' and date '9999-12-31'),
  amount_minor bigint not null
    constraint card_statement_payments_amount_bounds
    check (amount_minor between 1 and 99999999999999),
  kind text not null
    constraint card_statement_payments_kind_check
    check (kind in ('full','minimum','partial')),
  note text
    constraint card_statement_payments_note_length
    check (note is null or char_length(note) <= 1000),
  constraint card_statement_payments_user_statement_fk
    foreign key (user_id, statement_id)
    references public.credit_card_statements (user_id, id)
    on delete cascade
);

create index if not exists card_statement_payments_user_updated_id
  on public.card_statement_payments (user_id, updated_at, id);
create index if not exists card_statement_payments_user_statement
  on public.card_statement_payments (user_id, statement_id);

alter table public.card_statement_payments enable row level security;

create policy "card_statement_payments_select_own" on public.card_statement_payments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "card_statement_payments_insert_own" on public.card_statement_payments
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "card_statement_payments_update_own" on public.card_statement_payments
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create trigger set_updated_at before insert or update on public.card_statement_payments
  for each row execute function public.set_updated_at();

revoke all on table public.card_statement_payments from public, anon;
grant select, insert, update on table public.card_statement_payments to authenticated;

-- The change probe reports one keyset head per synced table; a table missing
-- from it is pulled on every sync instead of only when it moved.
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
  select 'card_statement_payments'::text, k.updated_at, k.id
    from (select 1) probe
    left join lateral (
      select h.updated_at, h.id from public.card_statement_payments h
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

revoke all on function public.sync_cursors() from public, anon;
grant execute on function public.sync_cursors() to authenticated;

commit;
