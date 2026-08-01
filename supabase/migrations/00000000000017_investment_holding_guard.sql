-- Serialize and validate the quantity side of the investment journal as well
-- as cash. This prevents two devices from selling the same remaining units
-- and prevents an edit/tombstone from making a later sale exceed the holding.

begin;

create or replace function private.guard_investment_operation_cash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_cash bigint;
  projected_cash bigint;
  movement record;
  holding_quantity numeric := 0;
  holding_cost bigint := 0;
  expected_cost bigint;
  valid_graph boolean := true;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 1107296257)
  );
  current_cash := private.investment_cash(new.user_id);
  if current_cash is not null then
    projected_cash := current_cash
      - case when tg_op = 'UPDATE'
        then private.investment_operation_cash_effect(old.kind, old.total_minor, old.deleted_at)
        else 0 end
      + private.investment_operation_cash_effect(new.kind, new.total_minor, new.deleted_at);
    if projected_cash < 0 then
      if tg_op = 'INSERT' then
        new.deleted_at := pg_catalog.now();
        new.tombstone_version := pg_catalog.greatest(new.tombstone_version, 1);
        return new;
      end if;
      new := old;
      new.updated_at := pg_catalog.now();
      return new;
    end if;
  end if;

  -- Changing the stable product edge would require validating two journals at
  -- once. The client edits product identity on the product row, never by
  -- moving a financial operation, so keep the canonical server row.
  if tg_op = 'UPDATE' and new.product_id <> old.product_id then
    new := old;
    new.updated_at := pg_catalog.now();
    return new;
  end if;

  for movement in
    select *
    from (
      select
        o.id, o.kind, o.operation_date, o.quantity, o.total_minor
      from public.investment_operations o
      where o.user_id = new.user_id
        and o.product_id = new.product_id
        and o.id <> new.id
        and o.deleted_at is null
      union all
      select
        new.id, new.kind, new.operation_date, new.quantity, new.total_minor
      where new.deleted_at is null
    ) journal
    order by operation_date, id
  loop
    if movement.kind = 'sell' then
      if holding_quantity is null
        or movement.quantity is null
        or movement.quantity::numeric > holding_quantity
      then
        valid_graph := false;
        exit;
      end if;
      expected_cost := case
        when movement.quantity::numeric = holding_quantity then holding_cost
        else pg_catalog.round(
          holding_cost::numeric * movement.quantity::numeric / holding_quantity
        )::bigint
      end;
      holding_quantity := holding_quantity - movement.quantity::numeric;
      holding_cost := holding_cost - expected_cost;
      if movement.id = new.id then
        new.cost_basis_minor := expected_cost;
        new.realized_profit_loss_minor := new.total_minor - expected_cost;
      end if;
    else
      holding_cost := holding_cost + movement.total_minor;
      if movement.quantity is null then
        holding_quantity := null;
      elsif holding_quantity is not null then
        holding_quantity := holding_quantity + movement.quantity::numeric;
      end if;
    end if;
  end loop;

  if valid_graph then
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

revoke all on function private.guard_investment_operation_cash()
  from public, anon, authenticated, service_role;

commit;
