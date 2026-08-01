-- GREATEST is SQL syntax, not a schema-qualified routine. The function bodies
-- compile lazily, so remove the pg_catalog prefix before a rejection executes.

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
    if pg_catalog.strpos(function_ddl, 'pg_catalog.greatest(') = 0 then
      raise exception 'Expected qualified greatest expression is missing from %', fn;
    end if;
    execute pg_catalog.replace(function_ddl, 'pg_catalog.greatest(', 'greatest(');
  end loop;
end $$;
