-- Initial schema. Mirrors src/db/schema.ts (SQLite) with Postgres types.
-- Every user table: RLS enabled + owner-only policies. No table ships without RLS.
-- updated_at is normalized server-side so LWW merge never trusts device clocks.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Helper note: common sync columns on every user table:
--   id uuid primary key (client-generated UUIDv7)
--   user_id uuid not null default auth.uid()
--   created_at/updated_at timestamptz, deleted_at timestamptz (tombstone)
-- ---------------------------------------------------------------------------

create table public.persons (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  is_self boolean not null default false
);

create table public.payment_sources (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  type text not null check (type in ('credit_card','debit_card','cash','bank_transfer')),
  person_id uuid not null,
  due_day int,
  statement_day int,
  color text,
  logo_source text not null default 'initials' check (logo_source in ('brand','favicon','manual','initials')),
  logo_ref text,
  is_active boolean not null default true
);

create table public.categories (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  kind text not null check (kind in ('expense','income')),
  icon text,
  color text,
  sort_order int not null default 0,
  is_column boolean not null default false
);

create table public.computed_columns (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  definition jsonb not null,
  sort_order int not null default 0
);

create table public.installment_plans (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  title text not null,
  kind text not null check (kind in ('card_installment','loan')),
  total_amount_minor bigint,
  monthly_amount_minor bigint,
  installment_count int not null check (installment_count >= 1),
  currency text not null default 'TRY',
  start_month text not null check (start_month ~ '^\d{4}-\d{2}$'),
  due_day int,
  payment_source_id uuid,
  person_id uuid not null,
  category_id uuid,
  note text,
  check (total_amount_minor is not null or monthly_amount_minor is not null)
);

create table public.transactions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  type text not null check (type in ('expense','income','transfer')),
  amount_minor bigint not null,
  currency text not null default 'TRY',
  fx_rate numeric,
  amount_try_minor bigint not null,
  entry_date date not null,
  effective_date date not null,
  status text not null check (status in ('pending','realized')),
  category_id uuid,
  payment_source_id uuid,
  person_id uuid not null,
  installment_plan_id uuid,
  installment_no int,
  subscription_id uuid,
  is_aggregate boolean not null default false,
  note text
);

create index idx_tx_user_effective on public.transactions (user_id, effective_date);
create index idx_tx_user_updated on public.transactions (user_id, updated_at);

create table public.subscriptions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  amount_minor bigint not null,
  currency text not null default 'TRY',
  cycle text not null check (cycle in ('monthly','yearly','custom')),
  interval_months int not null default 1 check (interval_months >= 1),
  billing_day int not null check (billing_day between 1 and 31),
  next_due_date date not null,
  payment_source_id uuid,
  category_id uuid,
  person_id uuid not null,
  is_active boolean not null default true,
  canceled_at timestamptz,
  trial_end_date date,
  auto_pay boolean not null default false,
  website_domain text,
  logo_source text not null default 'initials' check (logo_source in ('brand','favicon','manual','initials')),
  logo_ref text,
  note text
);

create table public.price_history (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  subscription_id uuid not null,
  amount_minor bigint not null,
  currency text not null,
  effective_from date not null
);

create table public.recurring_incomes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  default_amount_minor bigint not null,
  currency text not null default 'TRY',
  pay_day int not null check (pay_day between 1 and 31),
  person_id uuid not null,
  category_id uuid,
  is_active boolean not null default true,
  note text
);

create table public.expected_payments (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  direction text not null check (direction in ('in','out')),
  kind text not null check (kind in ('subscription','installment','loan','recurring_income')),
  ref_id uuid not null,
  due_date date not null,
  amount_minor bigint not null,
  currency text not null default 'TRY',
  status text not null default 'pending' check (status in ('pending','paid','late','skipped')),
  paid_at timestamptz,
  auto_confirmed boolean not null default false,
  transaction_id uuid
);

create index idx_expected_user_status_due on public.expected_payments (user_id, status, due_date);

create table public.balance_adjustments (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  date date not null,
  amount_minor bigint not null,
  note text
);

create table public.cell_notes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  category_id uuid not null,
  body text not null
);

create table public.settings (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  key text not null,
  value text not null,
  unique (user_id, key)
);

create table public.fx_rates (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  currency text not null,
  rate_date date not null,
  rate_try numeric not null,
  unique (user_id, currency, rate_date)
);

-- Keep-alive heartbeat (GitHub Actions writes via service role; RLS blocks anon).
create table public.keep_alive (
  id int primary key,
  pinged_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS: owner-only access on every user table; keep_alive locked to service role.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'persons','payment_sources','categories','computed_columns','installment_plans',
    'transactions','subscriptions','price_history','recurring_incomes',
    'expected_payments','balance_adjustments','cell_notes','settings','fx_rates'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "%s_select_own" on public.%I for select using (auth.uid() = user_id)', t, t);
    execute format(
      'create policy "%s_insert_own" on public.%I for insert with check (auth.uid() = user_id)', t, t);
    execute format(
      'create policy "%s_update_own" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t, t);
    execute format(
      'create policy "%s_delete_own" on public.%I for delete using (auth.uid() = user_id)', t, t);
    execute format(
      'create trigger set_updated_at before insert or update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

alter table public.keep_alive enable row level security;
-- no policies on keep_alive: only the service role (bypasses RLS) may touch it
