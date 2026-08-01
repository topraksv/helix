-- BES contributions have an amount-only path that is intentionally distinct
-- from ordinary assets. Also pin the same-day operation order used by clients:
-- opening holdings, then sales, then cash-consuming buys/contributions.

begin;

alter table public.investment_operations
  drop constraint investment_operations_quote_consistency_check;
alter table public.investment_operations
  add constraint investment_operations_quote_consistency_check check (
    quantity is null
    or pg_catalog.abs(
      pg_catalog.round(quantity::numeric * unit_price_minor) - total_minor
    ) <= greatest(
      1::numeric,
      pg_catalog.ceil(quantity::numeric / 2),
      pg_catalog.ceil(unit_price_minor::numeric / 200000000)
    )
  );

create or replace function private.guard_investment_operation_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_type text;
begin
  if new.deleted_at is not null or new.kind <> 'contribution' then
    return new;
  end if;

  select asset_type
  into product_type
  from public.investment_products
  where user_id = new.user_id
    and id = new.product_id
    and deleted_at is null;

  if product_type = 'pension' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.deleted_at := pg_catalog.now();
    new.tombstone_version := greatest(new.tombstone_version, 1::bigint);
    return new;
  end if;
  new := old;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger aa_guard_investment_operation_type
  before insert or update on public.investment_operations
  for each row execute function private.guard_investment_operation_type();

create or replace function private.investment_operation_order(p_kind text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind = 'existing' then 0
    when p_kind = 'sell' then 1
    else 2
  end;
$$;

do $$
declare
  fn regprocedure;
  function_ddl text;
begin
  foreach fn in array array[
    'private.guard_investment_operation_cash()'::regprocedure,
    'private.reproject_investment_sales()'::regprocedure
  ] loop
    function_ddl := pg_catalog.pg_get_functiondef(fn);
    if pg_catalog.strpos(function_ddl, 'order by operation_date, id') = 0 then
      raise exception 'Expected investment journal order is missing from %', fn;
    end if;
    execute pg_catalog.replace(
      function_ddl,
      'order by operation_date, id',
      'order by operation_date, private.investment_operation_order(kind), id'
    );
  end loop;
end $$;

revoke all on function private.guard_investment_operation_type()
  from public, anon, authenticated, service_role;
revoke all on function private.investment_operation_order(text)
  from public, anon, authenticated, service_role;

commit;
