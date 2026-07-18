-- Owner-aware relational integrity and optimized owner-only RLS.
--
-- The app is local-first, so related rows can arrive in separate sync calls.
-- SYNCED_TABLES orders parents before children; these constraints then ensure a
-- child can never point at another account's row or at a missing parent.  The
-- constraints are added NOT VALID and validated before commit so pre-existing
-- corruption aborts the complete migration instead of being rewritten.

begin;

-- Foreign keys below need a unique owner/id target. The UUID primary key is
-- globally unique already; this composite key additionally makes ownership
-- part of every relationship.
create unique index if not exists persons_user_id_id_unique
  on public.persons (user_id, id);
create unique index if not exists payment_sources_user_id_id_unique
  on public.payment_sources (user_id, id);
create unique index if not exists categories_user_id_id_unique
  on public.categories (user_id, id);
create unique index if not exists installment_plans_user_id_id_unique
  on public.installment_plans (user_id, id);
create unique index if not exists credit_card_statements_user_id_id_unique
  on public.credit_card_statements (user_id, id);
create unique index if not exists transactions_user_id_id_unique
  on public.transactions (user_id, id);
create unique index if not exists subscriptions_user_id_id_unique
  on public.subscriptions (user_id, id);
create unique index if not exists recurring_incomes_user_id_id_unique
  on public.recurring_incomes (user_id, id);

alter table public.payment_sources
  add constraint payment_sources_user_person_fk
  foreign key (user_id, person_id)
  references public.persons (user_id, id)
  on delete cascade not valid;

alter table public.credit_card_statements
  add constraint credit_card_statements_user_source_fk
  foreign key (user_id, payment_source_id)
  references public.payment_sources (user_id, id)
  on delete cascade not valid;

alter table public.installment_plans
  add constraint installment_plans_user_source_fk
  foreign key (user_id, payment_source_id)
  references public.payment_sources (user_id, id)
  on delete cascade not valid,
  add constraint installment_plans_user_person_fk
  foreign key (user_id, person_id)
  references public.persons (user_id, id)
  on delete cascade not valid,
  add constraint installment_plans_user_category_fk
  foreign key (user_id, category_id)
  references public.categories (user_id, id)
  on delete cascade not valid;

alter table public.subscriptions
  add constraint subscriptions_user_source_fk
  foreign key (user_id, payment_source_id)
  references public.payment_sources (user_id, id)
  on delete cascade not valid,
  add constraint subscriptions_user_category_fk
  foreign key (user_id, category_id)
  references public.categories (user_id, id)
  on delete cascade not valid,
  add constraint subscriptions_user_person_fk
  foreign key (user_id, person_id)
  references public.persons (user_id, id)
  on delete cascade not valid;

alter table public.transactions
  add constraint transactions_user_category_fk
  foreign key (user_id, category_id)
  references public.categories (user_id, id)
  on delete cascade not valid,
  add constraint transactions_user_source_fk
  foreign key (user_id, payment_source_id)
  references public.payment_sources (user_id, id)
  on delete cascade not valid,
  add constraint transactions_user_person_fk
  foreign key (user_id, person_id)
  references public.persons (user_id, id)
  on delete cascade not valid,
  add constraint transactions_user_plan_fk
  foreign key (user_id, installment_plan_id)
  references public.installment_plans (user_id, id)
  on delete cascade not valid,
  add constraint transactions_user_statement_fk
  foreign key (user_id, card_statement_id)
  references public.credit_card_statements (user_id, id)
  on delete cascade not valid,
  add constraint transactions_user_subscription_fk
  foreign key (user_id, subscription_id)
  references public.subscriptions (user_id, id)
  on delete cascade not valid;

alter table public.price_history
  add constraint price_history_user_subscription_fk
  foreign key (user_id, subscription_id)
  references public.subscriptions (user_id, id)
  on delete cascade not valid;

alter table public.recurring_incomes
  add constraint recurring_incomes_user_person_fk
  foreign key (user_id, person_id)
  references public.persons (user_id, id)
  on delete cascade not valid,
  add constraint recurring_incomes_user_category_fk
  foreign key (user_id, category_id)
  references public.categories (user_id, id)
  on delete cascade not valid;

alter table public.expected_payments
  add constraint expected_payments_user_transaction_fk
  foreign key (user_id, transaction_id)
  references public.transactions (user_id, id)
  on delete cascade not valid;

alter table public.cell_notes
  add constraint cell_notes_user_category_fk
  foreign key (user_id, category_id)
  references public.categories (user_id, id)
  on delete cascade not valid;

-- Validate every existing relationship before any trigger/policy change is
-- committed. A failure rolls back this entire file.
alter table public.payment_sources validate constraint payment_sources_user_person_fk;
alter table public.credit_card_statements validate constraint credit_card_statements_user_source_fk;
alter table public.installment_plans validate constraint installment_plans_user_source_fk;
alter table public.installment_plans validate constraint installment_plans_user_person_fk;
alter table public.installment_plans validate constraint installment_plans_user_category_fk;
alter table public.subscriptions validate constraint subscriptions_user_source_fk;
alter table public.subscriptions validate constraint subscriptions_user_category_fk;
alter table public.subscriptions validate constraint subscriptions_user_person_fk;
alter table public.transactions validate constraint transactions_user_category_fk;
alter table public.transactions validate constraint transactions_user_source_fk;
alter table public.transactions validate constraint transactions_user_person_fk;
alter table public.transactions validate constraint transactions_user_plan_fk;
alter table public.transactions validate constraint transactions_user_statement_fk;
alter table public.transactions validate constraint transactions_user_subscription_fk;
alter table public.price_history validate constraint price_history_user_subscription_fk;
alter table public.recurring_incomes validate constraint recurring_incomes_user_person_fk;
alter table public.recurring_incomes validate constraint recurring_incomes_user_category_fk;
alter table public.expected_payments validate constraint expected_payments_user_transaction_fk;
alter table public.cell_notes validate constraint cell_notes_user_category_fk;

-- Older clients represented a refund in an expense category as `income +A`.
-- Canonical form is `expense -A`: the balance effect remains +A while category
-- analytics can net it consistently. This is the same deterministic repair as
-- local maintenance and updates the server timestamp so every device pulls it.
update public.transactions t
set type = c.kind,
    amount_minor = -t.amount_minor,
    amount_try_minor = -t.amount_try_minor
from public.categories c
where c.user_id = t.user_id
  and c.id = t.category_id
  and t.type <> 'transfer'
  and t.type <> c.kind;

-- Anything not covered by the behavior-preserving legacy repair is not
-- rewritten. It aborts the migration so a separate explicit repair is needed.

do $$
begin
  if exists (
    select 1
    from public.transactions t
    join public.categories c on c.user_id = t.user_id and c.id = t.category_id
    where c.kind <> case when t.type = 'income' then 'income' else 'expense' end
  ) or exists (
    select 1
    from public.installment_plans p
    join public.categories c on c.user_id = p.user_id and c.id = p.category_id
    where c.kind <> 'expense'
  ) or exists (
    select 1
    from public.subscriptions s
    join public.categories c on c.user_id = s.user_id and c.id = s.category_id
    where c.kind <> 'expense'
  ) or exists (
    select 1
    from public.recurring_incomes r
    join public.categories c on c.user_id = r.user_id and c.id = r.category_id
    where c.kind <> 'income'
  ) then
    raise exception 'Existing category kind mismatch; migration aborted'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.expected_payments e
    where not (
      (e.kind = 'subscription' and exists (
        select 1 from public.subscriptions s
        where s.user_id = e.user_id and s.id = e.ref_id
      ))
      or (e.kind = 'recurring_income' and exists (
        select 1 from public.recurring_incomes r
        where r.user_id = e.user_id and r.id = e.ref_id
      ))
      or (e.kind = 'installment' and exists (
        select 1 from public.installment_plans p
        where p.user_id = e.user_id and p.id = e.ref_id
          and p.kind = 'card_installment'
      ))
      or (e.kind = 'loan' and exists (
        select 1 from public.installment_plans p
        where p.user_id = e.user_id and p.id = e.ref_id
          and p.kind = 'loan'
      ))
    )
  ) then
    raise exception 'Existing expected-payment reference mismatch; migration aborted'
      using errcode = '23514';
  end if;
end $$;

create or replace function public.enforce_category_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actual_kind text;
  required_kind text;
begin
  if new.category_id is null then
    return new;
  end if;

  select c.kind into actual_kind
  from public.categories c
  where c.user_id = new.user_id and c.id = new.category_id;

  if tg_table_name = 'transactions' then
    required_kind := case when new.type = 'income' then 'income' else 'expense' end;
  elsif tg_table_name = 'recurring_incomes' then
    required_kind := 'income';
  else
    required_kind := 'expense';
  end if;

  if actual_kind is null or actual_kind <> required_kind then
    raise exception 'Category must belong to the row owner and have kind %', required_kind
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger enforce_transaction_category_kind
before insert or update of user_id, type, category_id on public.transactions
for each row execute function public.enforce_category_kind();
create trigger enforce_plan_category_kind
before insert or update of user_id, category_id on public.installment_plans
for each row execute function public.enforce_category_kind();
create trigger enforce_subscription_category_kind
before insert or update of user_id, category_id on public.subscriptions
for each row execute function public.enforce_category_kind();
create trigger enforce_recurring_income_category_kind
before insert or update of user_id, category_id on public.recurring_incomes
for each row execute function public.enforce_category_kind();

create or replace function public.enforce_expected_payment_ref()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  valid_ref boolean;
begin
  valid_ref := case new.kind
    when 'subscription' then exists (
      select 1 from public.subscriptions s
      where s.user_id = new.user_id and s.id = new.ref_id
    )
    when 'recurring_income' then exists (
      select 1 from public.recurring_incomes r
      where r.user_id = new.user_id and r.id = new.ref_id
    )
    when 'installment' then exists (
      select 1 from public.installment_plans p
      where p.user_id = new.user_id and p.id = new.ref_id
        and p.kind = 'card_installment'
    )
    when 'loan' then exists (
      select 1 from public.installment_plans p
      where p.user_id = new.user_id and p.id = new.ref_id
        and p.kind = 'loan'
    )
    else false
  end;

  if not valid_ref then
    raise exception 'Expected payment reference does not match its owner and kind'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger enforce_expected_payment_ref
before insert or update of user_id, kind, ref_id on public.expected_payments
for each row execute function public.enforce_expected_payment_ref();

-- Restrict every owner policy to authenticated users and wrap auth.uid() in a
-- scalar subquery so PostgreSQL evaluates it once per statement instead of
-- once per row.
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
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t || '_delete_own', t);
  end loop;
end $$;

commit;
