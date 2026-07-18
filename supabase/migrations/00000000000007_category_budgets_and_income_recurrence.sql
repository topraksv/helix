begin;

-- Existing monthly rules remain unchanged. Weekly rules use an explicit
-- calendar-date anchor; keeping pay_day preserves compatibility with clients
-- that have not learned the new cadence yet.
alter table public.recurring_incomes
  add column recurrence text not null default 'monthly',
  add column anchor_date date,
  add constraint recurring_incomes_recurrence_check
    check (recurrence in ('monthly', 'weekly', 'biweekly')),
  add constraint recurring_incomes_anchor_check
    check (recurrence = 'monthly' or anchor_date is not null);

create table public.category_budgets (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  category_id uuid not null,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  constraint category_budgets_user_category_fk
    foreign key (user_id, category_id)
    references public.categories (user_id, id)
);

create unique index category_budgets_natural_month_category
  on public.category_budgets (user_id, month, category_id)
  where deleted_at is null;
create index category_budgets_user_updated_id
  on public.category_budgets (user_id, updated_at, id);
create index category_budgets_user_month
  on public.category_budgets (user_id, month);

create or replace function public.enforce_expense_budget_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.categories c
    where c.user_id = new.user_id
      and c.id = new.category_id
      and c.kind = 'expense'
      and c.deleted_at is null
  ) then
    raise exception 'Budget category must be a live expense category'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_expense_budget_category
before insert or update of user_id, category_id on public.category_budgets
for each row execute function public.enforce_expense_budget_category();

create trigger set_updated_at
before insert or update on public.category_budgets
for each row execute function public.set_updated_at();

alter table public.category_budgets enable row level security;
create policy category_budgets_select_own on public.category_budgets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy category_budgets_insert_own on public.category_budgets
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy category_budgets_update_own on public.category_budgets
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy category_budgets_delete_own on public.category_budgets
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.category_budgets from anon;
grant select, insert, update, delete on table public.category_budgets to authenticated;

commit;
