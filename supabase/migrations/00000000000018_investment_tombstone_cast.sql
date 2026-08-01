-- PL/pgSQL resolves greatest(bigint, integer) only when the rejection branch
-- first executes. Pin the literal to the synced tombstone column's bigint type
-- in all three wallet guards.

do $$
declare
  fn regprocedure;
  function_ddl text;
begin
  foreach fn in array array[
    'private.guard_investment_operation_cash()'::regprocedure,
    'private.guard_investment_transaction_cash()'::regprocedure,
    'private.guard_investment_profile_cash()'::regprocedure
  ] loop
    function_ddl := pg_catalog.pg_get_functiondef(fn);
    if pg_catalog.strpos(function_ddl, 'new.tombstone_version, 1)') = 0 then
      raise exception 'Expected tombstone guard literal is missing from %', fn;
    end if;
    execute pg_catalog.replace(
      function_ddl,
      'new.tombstone_version, 1)',
      'new.tombstone_version, 1::bigint)'
    );
  end loop;
end $$;
