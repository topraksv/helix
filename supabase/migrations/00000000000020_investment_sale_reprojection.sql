-- A buy/existing edit can change the weighted cost of sales that follow it.
-- Reproject every later sale on the same product while the owner advisory lock
-- is still held, so cached realized results converge across devices too.

begin;

alter table public.investment_operations
  add constraint investment_operations_quote_consistency_check check (
    quantity is null
    or pg_catalog.abs(
      pg_catalog.round(quantity::numeric * unit_price_minor) - total_minor
    ) <= 1
  );

alter table public.investment_products
  add constraint investment_products_user_profile_fk
  foreign key (user_id)
  references public.investment_profiles (user_id)
  on delete cascade;

create or replace function private.reproject_investment_sales()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  movement record;
  holding_quantity numeric := 0;
  holding_cost bigint := 0;
  expected_cost bigint;
begin
  -- The corrective updates below fire this trigger again. Their values have
  -- already been derived by this invocation, so nested calls must be inert.
  if pg_catalog.pg_trigger_depth() > 1 then
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 1107296257)
  );

  for movement in
    select id, kind, quantity, total_minor
    from public.investment_operations
    where user_id = new.user_id
      and product_id = new.product_id
      and deleted_at is null
    order by operation_date, id
  loop
    if movement.kind = 'sell' then
      if holding_quantity is null
        or movement.quantity is null
        or movement.quantity::numeric > holding_quantity
      then
        raise exception 'invalid investment holding graph';
      end if;
      expected_cost := case
        when movement.quantity::numeric = holding_quantity then holding_cost
        else pg_catalog.round(
          holding_cost::numeric * movement.quantity::numeric / holding_quantity
        )::bigint
      end;
      holding_quantity := holding_quantity - movement.quantity::numeric;
      holding_cost := holding_cost - expected_cost;
      update public.investment_operations
      set
        cost_basis_minor = expected_cost,
        realized_profit_loss_minor = movement.total_minor - expected_cost
      where id = movement.id
        and (
          cost_basis_minor <> expected_cost
          or realized_profit_loss_minor <> movement.total_minor - expected_cost
        );
    else
      holding_cost := holding_cost + movement.total_minor;
      if movement.quantity is null then
        holding_quantity := null;
      elsif holding_quantity is not null then
        holding_quantity := holding_quantity + movement.quantity::numeric;
      end if;
    end if;
  end loop;

  return null;
end;
$$;

create trigger z_reproject_investment_sales
  after insert or update on public.investment_operations
  for each row execute function private.reproject_investment_sales();

revoke all on function private.reproject_investment_sales()
  from public, anon, authenticated, service_role;

commit;
