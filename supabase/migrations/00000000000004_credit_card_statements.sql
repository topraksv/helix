-- Persist real credit-card statement periods and distinguish purchase date
-- from the due date that affects the ledger. Existing rows remain unchanged;
-- clients backfill/link them only when a card has an explicitly configured
-- cycle, so this migration never invents dates.

alter table public.payment_sources
  drop constraint if exists payment_sources_due_day_check;
alter table public.payment_sources
  add constraint payment_sources_due_day_check
  check (due_day is null or due_day between 1 and 31);

alter table public.payment_sources
  drop constraint if exists payment_sources_statement_day_check;
alter table public.payment_sources
  add constraint payment_sources_statement_day_check
  check (statement_day is null or statement_day between 1 and 31);

create table public.credit_card_statements (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  payment_source_id uuid not null,
  period_month text not null check (period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  statement_date date not null,
  due_date date not null,
  unique (user_id, payment_source_id, period_month),
  check (due_date >= statement_date)
);

create index idx_card_statement_user_source_period
  on public.credit_card_statements (user_id, payment_source_id, period_month);
create index idx_card_statement_user_due
  on public.credit_card_statements (user_id, due_date);

alter table public.transactions add column purchase_date date;
alter table public.transactions add column card_statement_id uuid;
create index idx_tx_user_card_statement
  on public.transactions (user_id, card_statement_id);

alter table public.credit_card_statements enable row level security;
create policy "credit_card_statements_select_own"
  on public.credit_card_statements for select using (auth.uid() = user_id);
create policy "credit_card_statements_insert_own"
  on public.credit_card_statements for insert with check (auth.uid() = user_id);
create policy "credit_card_statements_update_own"
  on public.credit_card_statements for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "credit_card_statements_delete_own"
  on public.credit_card_statements for delete using (auth.uid() = user_id);

create trigger set_updated_at before insert or update
  on public.credit_card_statements for each row
  execute function public.set_updated_at();
