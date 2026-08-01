-- Holdings acquired on a date must exist before a sale on that same date is
-- validated. Cash remains an aggregate wallet invariant, so there is no need
-- to place sales first merely to fund a same-day buy.

begin;

create or replace function private.investment_operation_order(p_kind text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind = 'existing' then 0
    when p_kind = 'sell' then 2
    else 1
  end;
$$;

revoke all on function private.investment_operation_order(text)
  from public, anon, authenticated, service_role;

commit;
