-- Investments V1: one owner-scoped cash wallet, stable products and an
-- immutable-style operation journal. Money remains integer TRY minor units;
-- fractional quantities are canonical decimal text so sync never crosses a
-- floating-point boundary.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.investment_profiles (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  started_on date not null,
  opening_cash_minor bigint not null
    check (opening_cash_minor between 0 and 99999999999999),
  setup_completed boolean not null default false,
  unique (user_id)
);

create table public.investment_products (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  asset_type text not null
    check (asset_type in ('metal','currency','equity','fund','crypto','pension')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  market_code text check (market_code is null or char_length(market_code) between 1 and 40),
  note text check (note is null or char_length(note) <= 2000),
  unique (user_id, id)
);

create table public.investment_operations (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  product_id uuid not null,
  kind text not null check (kind in ('existing','buy','sell','contribution')),
  operation_date date not null,
  quantity text,
  unit_price_minor bigint,
  total_minor bigint not null check (total_minor between 1 and 99999999999999),
  cost_basis_minor bigint not null default 0
    check (cost_basis_minor between 0 and 99999999999999),
  realized_profit_loss_minor bigint not null default 0
    check (realized_profit_loss_minor between -99999999999999 and 99999999999999),
  note text check (note is null or char_length(note) <= 2000),
  import_key text check (import_key is null or char_length(import_key) between 1 and 240),
  constraint investment_operations_user_product_fk
    foreign key (user_id, product_id)
    references public.investment_products (user_id, id)
    on delete cascade,
  constraint investment_operations_quantity_check check (
    (
      quantity is null
      and kind = 'contribution'
      and unit_price_minor is null
    )
    or (
      quantity is not null
      and char_length(quantity) <= 30
      and quantity ~ '^[0-9]+(\.[0-9]{1,8})?$'
      and quantity::numeric > 0
      and unit_price_minor between 1 and 99999999999999
    )
  ),
  constraint investment_operations_sale_result_check check (
    kind = 'sell'
    or (cost_basis_minor = 0 and realized_profit_loss_minor = 0)
  )
);

create unique index investment_operations_user_import_key
  on public.investment_operations (user_id, import_key)
  where import_key is not null;
create index investment_profiles_user_updated_id
  on public.investment_profiles (user_id, updated_at, id);
create index investment_products_user_updated_id
  on public.investment_products (user_id, updated_at, id);
create index investment_operations_user_updated_id
  on public.investment_operations (user_id, updated_at, id);
create index investment_operations_user_product_date
  on public.investment_operations (user_id, product_id, operation_date, id);

alter table public.investment_profiles enable row level security;
alter table public.investment_products enable row level security;
alter table public.investment_operations enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'investment_profiles','investment_products','investment_operations'
  ] loop
    execute format(
      'create policy "%s_select_own" on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t, t
    );
    execute format(
      'create policy "%s_insert_own" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t, t
    );
    execute format(
      'create policy "%s_update_own" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t, t
    );
    execute format(
      'create trigger set_updated_at before insert or update on public.%I for each row execute function public.set_updated_at()',
      t
    );
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
  end loop;
end $$;

-- These helpers are trigger-only. SECURITY DEFINER lets them see the complete
-- owner graph while RLS remains strict for clients; no API role can execute
-- them directly.
create or replace function private.investment_operation_cash_effect(
  p_kind text,
  p_total_minor bigint,
  p_deleted_at timestamptz
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_deleted_at is not null or p_kind = 'existing' then 0
    when p_kind = 'sell' then p_total_minor
    else -p_total_minor
  end;
$$;

create or replace function private.investment_transaction_cash_effect(
  p_user_id uuid,
  p_type text,
  p_amount_try_minor bigint,
  p_effective_date date,
  p_status text,
  p_category_id uuid,
  p_deleted_at timestamptz
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when
    p_deleted_at is null
    and p_type = 'transfer'
    and p_status = 'realized'
    and p_effective_date <= current_date
    and exists (
      select 1
      from public.investment_profiles p
      where p.user_id = p_user_id
        and p.deleted_at is null
        and p.started_on <= p_effective_date
    )
    and exists (
      select 1
      from public.categories c
      where c.user_id = p_user_id
        and c.id = p_category_id
        and c.is_transfer
    )
  then p_amount_try_minor else 0 end;
$$;

create or replace function private.investment_cash(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select p.opening_cash_minor
    + coalesce((
        select sum(private.investment_transaction_cash_effect(
          t.user_id, t.type, t.amount_try_minor, t.effective_date,
          t.status, t.category_id, t.deleted_at
        ))
        from public.transactions t
        where t.user_id = p_user_id
      ), 0)
    + coalesce((
        select sum(private.investment_operation_cash_effect(
          o.kind, o.total_minor, o.deleted_at
        ))
        from public.investment_operations o
        where o.user_id = p_user_id
      ), 0)
  from public.investment_profiles p
  where p.user_id = p_user_id
    and p.deleted_at is null;
$$;

create or replace function private.guard_investment_operation_cash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_cash bigint;
  projected_cash bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 1107296257)
  );
  current_cash := private.investment_cash(new.user_id);
  if current_cash is null then
    return new;
  end if;
  projected_cash := current_cash
    - case when tg_op = 'UPDATE'
      then private.investment_operation_cash_effect(old.kind, old.total_minor, old.deleted_at)
      else 0 end
    + private.investment_operation_cash_effect(new.kind, new.total_minor, new.deleted_at);
  if projected_cash >= 0 then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.deleted_at := pg_catalog.now();
    new.tombstone_version := pg_catalog.greatest(new.tombstone_version, 1);
    return new;
  end if;
  new := old;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function private.guard_investment_transaction_cash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_cash bigint;
  projected_cash bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 1107296257)
  );
  current_cash := private.investment_cash(new.user_id);
  if current_cash is null then
    return new;
  end if;
  projected_cash := current_cash
    - case when tg_op = 'UPDATE' then private.investment_transaction_cash_effect(
        old.user_id, old.type, old.amount_try_minor, old.effective_date,
        old.status, old.category_id, old.deleted_at
      ) else 0 end
    + private.investment_transaction_cash_effect(
        new.user_id, new.type, new.amount_try_minor, new.effective_date,
        new.status, new.category_id, new.deleted_at
      );
  if projected_cash >= 0 then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.deleted_at := pg_catalog.now();
    new.tombstone_version := pg_catalog.greatest(new.tombstone_version, 1);
    return new;
  end if;
  new := old;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function private.guard_investment_profile_cash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  projected_cash bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 1107296257)
  );
  if new.deleted_at is not null then
    return new;
  end if;
  select new.opening_cash_minor
    + coalesce((
        select sum(t.amount_try_minor)
        from public.transactions t
        join public.categories c
          on c.user_id = t.user_id and c.id = t.category_id and c.is_transfer
        where t.user_id = new.user_id
          and t.deleted_at is null
          and t.type = 'transfer'
          and t.status = 'realized'
          and t.effective_date between new.started_on and current_date
      ), 0)
    + coalesce((
        select sum(private.investment_operation_cash_effect(
          o.kind, o.total_minor, o.deleted_at
        ))
        from public.investment_operations o
        where o.user_id = new.user_id
      ), 0)
  into projected_cash
  ;

  if projected_cash >= 0 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.deleted_at := pg_catalog.now();
    new.tombstone_version := pg_catalog.greatest(new.tombstone_version, 1);
    return new;
  end if;
  new := old;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function private.guard_investment_category_cash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_cash bigint;
  category_effect bigint;
begin
  if new.is_transfer = old.is_transfer then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 1107296257)
  );
  current_cash := private.investment_cash(new.user_id);
  if current_cash is null then
    return new;
  end if;
  select coalesce(sum(t.amount_try_minor), 0)
  into category_effect
  from public.transactions t
  join public.investment_profiles p
    on p.user_id = t.user_id and p.deleted_at is null
  where t.user_id = new.user_id
    and t.category_id = new.id
    and t.deleted_at is null
    and t.type = 'transfer'
    and t.status = 'realized'
    and t.effective_date between p.started_on and current_date;
  if current_cash + (case when new.is_transfer then category_effect else -category_effect end) >= 0 then
    return new;
  end if;
  new := old;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger a_guard_investment_operation_cash
  before insert or update on public.investment_operations
  for each row execute function private.guard_investment_operation_cash();
create trigger a_guard_investment_transaction_cash
  before insert or update on public.transactions
  for each row execute function private.guard_investment_transaction_cash();
create trigger a_guard_investment_profile_cash
  before insert or update on public.investment_profiles
  for each row execute function private.guard_investment_profile_cash();
create trigger a_guard_investment_category_cash
  before update of is_transfer on public.categories
  for each row execute function private.guard_investment_category_cash();

revoke all on function private.investment_operation_cash_effect(text,bigint,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.investment_transaction_cash_effect(uuid,text,bigint,date,text,uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.investment_cash(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_investment_operation_cash()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_investment_transaction_cash()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_investment_profile_cash()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_investment_category_cash()
  from public, anon, authenticated, service_role;

commit;
