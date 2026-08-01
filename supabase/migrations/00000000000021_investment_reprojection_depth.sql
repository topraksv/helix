-- Make recursion exclusion explicit at the trigger boundary: corrective sale
-- updates never enter the projector, while an owner-initiated row change does.

begin;

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

drop trigger z_reproject_investment_sales on public.investment_operations;
create trigger z_reproject_investment_sales
  after insert or update on public.investment_operations
  for each row
  when (pg_catalog.pg_trigger_depth() < 1)
  execute function private.reproject_investment_sales();

revoke all on function private.reproject_investment_sales()
  from public, anon, authenticated, service_role;

commit;
