begin;

-- Linked CLI sessions use a short-lived login role. Assume the project-local
-- `postgres` role explicitly so the harness can reach pgTAP in `extensions`;
-- each authorization assertion still switches to anon/authenticated below.
set local role postgres;

-- pgTAP is installed on the linked project already; installing it is not this
-- suite's job. Its functions live in `extensions`, so the plan/finish calls
-- are schema-qualified and the transaction-local search_path puts that schema
-- first for the assertion helpers.
set local search_path = extensions, public, pg_catalog;

select extensions.plan(45);

-- A small invoker-rights helper lets tests assert SQLSTATE without coupling to
-- PostgreSQL's localized/full error text. The dynamic statement still runs as
-- the active anon/authenticated role, so RLS is not bypassed.
create function pg_temp.exec_sqlstate(command text)
returns text
language plpgsql
as $$
begin
  execute command;
  return null;
exception when others then
  return sqlstate;
end $$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'helix-rls-a@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'helix-rls-b@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'persons','payment_sources','categories','computed_columns',
        'installment_plans','credit_card_statements','transactions',
        'subscriptions','price_history','recurring_incomes','expected_payments',
        'balance_adjustments','cell_notes','settings','fx_rates','category_budgets'
      ])
  ),
  48::bigint,
  'all 16 synced tables have select, insert and update owner policies'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'persons','payment_sources','categories','computed_columns',
        'installment_plans','credit_card_statements','transactions',
        'subscriptions','price_history','recurring_incomes','expected_payments',
        'balance_adjustments','cell_notes','settings','fx_rates','category_budgets'
      ])
      and roles = array['authenticated']::name[]
  ),
  48::bigint,
  'every owner policy is restricted to authenticated'
);

select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any (array[
        'persons','payment_sources','categories','computed_columns',
        'installment_plans','credit_card_statements','transactions',
        'subscriptions','price_history','recurring_incomes','expected_payments',
        'balance_adjustments','cell_notes','settings','fx_rates','category_budgets'
      ])
      and c.relrowsecurity
  ),
  16::bigint,
  'RLS is enabled on every synced table'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and cmd = 'INSERT'
      and tablename = any (array[
        'persons','payment_sources','categories','computed_columns',
        'installment_plans','credit_card_statements','transactions',
        'subscriptions','price_history','recurring_incomes','expected_payments',
        'balance_adjustments','cell_notes','settings','fx_rates','category_budgets'
      ])
      and with_check like '%auth.uid()%'
      and with_check like '%user_id%'
  ),
  16::bigint,
  'every insert policy checks the authenticated owner'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and cmd = 'UPDATE'
      and tablename = any (array[
        'persons','payment_sources','categories','computed_columns',
        'installment_plans','credit_card_statements','transactions',
        'subscriptions','price_history','recurring_incomes','expected_payments',
        'balance_adjustments','cell_notes','settings','fx_rates','category_budgets'
      ])
      and qual like '%auth.uid()%'
      and qual like '%user_id%'
      and with_check like '%auth.uid()%'
      and with_check like '%user_id%'
  ),
  16::bigint,
  'every update policy filters and re-checks the authenticated owner'
);

select is(
  (
    select count(*)
    from unnest(array[
      'persons','payment_sources','categories','computed_columns',
      'installment_plans','credit_card_statements','transactions',
      'subscriptions','price_history','recurring_incomes','expected_payments',
      'balance_adjustments','cell_notes','settings','fx_rates','category_budgets'
    ]) as tables(name)
    where has_table_privilege('authenticated', format('public.%I', name), 'SELECT')
      and has_table_privilege('authenticated', format('public.%I', name), 'INSERT')
      and has_table_privilege('authenticated', format('public.%I', name), 'UPDATE')
      and not has_table_privilege('authenticated', format('public.%I', name), 'DELETE')
  ),
  16::bigint,
  'authenticated grants are limited to select, insert and update'
);

select is(
  (
    select count(*)
    from unnest(array[
      'persons','payment_sources','categories','computed_columns',
      'installment_plans','credit_card_statements','transactions',
      'subscriptions','price_history','recurring_incomes','expected_payments',
      'balance_adjustments','cell_notes','settings','fx_rates','category_budgets'
    ]) as tables(name)
    where has_table_privilege('anon', format('public.%I', name), 'SELECT')
       or has_table_privilege('anon', format('public.%I', name), 'INSERT')
       or has_table_privilege('anon', format('public.%I', name), 'UPDATE')
       or has_table_privilege('anon', format('public.%I', name), 'DELETE')
  ),
  0::bigint,
  'anon has no synced-table privilege'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and cmd = 'DELETE'
      and tablename = any (array[
        'persons','payment_sources','categories','computed_columns',
        'installment_plans','credit_card_statements','transactions',
        'subscriptions','price_history','recurring_incomes','expected_payments',
        'balance_adjustments','cell_notes','settings','fx_rates','category_budgets'
      ])
  ),
  0::bigint,
  'synced tables expose no client hard-delete policies'
);

select ok(
  (select prosecdef from pg_proc where oid = 'public.delete_own_account()'::regprocedure),
  'account deletion remains SECURITY DEFINER'
);

select is(
  (select proconfig from pg_proc
    where oid = 'public.delete_own_account()'::regprocedure),
  array['search_path=""']::text[],
  'account deletion pins an empty search_path'
);

select ok(
  has_function_privilege('authenticated', 'public.delete_own_account()', 'EXECUTE'),
  'authenticated can execute account deletion'
);

select ok(
  not has_function_privilege('anon', 'public.delete_own_account()', 'EXECUTE'),
  'anon cannot execute account deletion'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$insert into public.persons (id, user_id, name, is_self)
    values (
      '10000000-0000-4000-8000-000000000011',
      '10000000-0000-4000-8000-000000000001',
      'RLS A', true
    )$$,
  'user A can insert an owned person'
);

select results_eq(
  $$select name from public.persons
    where id = '10000000-0000-4000-8000-000000000011'$$,
  $$values ('RLS A'::text)$$,
  'user A can read the owned person'
);

select results_eq(
  $$with changed as (
      update public.persons set name = 'RLS A updated'
      where id = '10000000-0000-4000-8000-000000000011'
      returning name
    ) select name from changed$$,
  $$values ('RLS A updated'::text)$$,
  'user A can update the owned person'
);

reset role;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select lives_ok(
  $$insert into public.persons (id, user_id, name, is_self)
    values (
      '20000000-0000-4000-8000-000000000021',
      '20000000-0000-4000-8000-000000000002',
      'RLS B', true
    )$$,
  'user B can insert an owned person'
);

select results_eq(
  $$select count(*)::bigint from public.persons
    where id = '10000000-0000-4000-8000-000000000011'$$,
  $$values (0::bigint)$$,
  'user B cannot read user A rows'
);

select results_eq(
  $$with changed as (
      update public.persons set name = 'tampered'
      where id = '10000000-0000-4000-8000-000000000011'
      returning 1
    ) select count(*)::bigint from changed$$,
  $$values (0::bigint)$$,
  'user B cannot update user A rows'
);

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.persons (id, user_id, name, is_self)
    values (
      '20000000-0000-4000-8000-000000000034',
      '10000000-0000-4000-8000-000000000001',
      'Forged A owner', false
    )
  $command$),
  '42501',
  'WITH CHECK prevents user B from inserting as user A'
);

select results_eq(
  $$with changed as (
      update public.persons set deleted_at = now()
      where id = '10000000-0000-4000-8000-000000000011'
      returning 1
    ) select count(*)::bigint from changed$$,
  $$values (0::bigint)$$,
  'user B cannot tombstone user A rows'
);

select results_eq(
  $$update public.persons
      set deleted_at = now(), tombstone_version = 1
      where id = '20000000-0000-4000-8000-000000000021'
      returning tombstone_version$$,
  $$values (1::bigint)$$,
  'an owned tombstone advances one generation'
);

select results_eq(
  $$update public.persons
      set name = 'stale resurrection', deleted_at = null, tombstone_version = 0
      where id = '20000000-0000-4000-8000-000000000021'
      returning (deleted_at is not null), tombstone_version, name$$,
  $$values (true, 1::bigint, 'RLS B'::text)$$,
  'a stale generation cannot resurrect a tombstone despite a later write'
);

select results_eq(
  $$update public.persons
      set deleted_at = null, tombstone_version = 1
      where id = '20000000-0000-4000-8000-000000000021'
      returning (deleted_at is null), tombstone_version$$,
  $$values (true, 1::bigint)$$,
  'an explicit undo at the observed generation remains available'
);

select is(
  pg_temp.exec_sqlstate($command$
    update public.persons
      set tombstone_version = 99
      where id = '20000000-0000-4000-8000-000000000021'
  $command$),
  '23514',
  'a client cannot forge a future tombstone generation'
);

select is(
  pg_temp.exec_sqlstate($command$
      delete from public.persons
      where id = '10000000-0000-4000-8000-000000000011'
  $command$),
  '42501',
  'authenticated clients have no hard-delete privilege'
);

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.payment_sources (
      id, user_id, name, type, person_id
    ) values (
      '20000000-0000-4000-8000-000000000022',
      '20000000-0000-4000-8000-000000000002',
      'Cross owner', 'cash',
      '10000000-0000-4000-8000-000000000011'
    )
  $command$),
  '23503',
  'an owned child cannot reference another account'
);

select lives_ok(
  $$insert into public.categories (id, user_id, name, kind)
    values (
      '20000000-0000-4000-8000-000000000023',
      '20000000-0000-4000-8000-000000000002',
      'Expense', 'expense'
    )$$,
  'user B can insert an owned expense category'
);

select lives_ok(
  $$update public.categories set is_transfer = true
    where id = '20000000-0000-4000-8000-000000000023'$$,
  'an expense category can persist transfer semantics'
);

select lives_ok(
  $$insert into public.category_budgets (id, user_id, category_id, month, amount_minor)
    values (
      '20000000-0000-4000-8000-000000000029',
      '20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000023', '2026-08', 50000
    )$$,
  'an owned budget accepts a live expense category'
);

select lives_ok(
  $$insert into public.categories (id, user_id, name, kind)
    values (
      '20000000-0000-4000-8000-000000000030',
      '20000000-0000-4000-8000-000000000002',
      'Income', 'income'
    )$$,
  'user B can insert an owned income category'
);

select is(
  pg_temp.exec_sqlstate($command$
    update public.categories set is_transfer = true
    where id = '20000000-0000-4000-8000-000000000030'
  $command$),
  '23514',
  'an income category cannot become a transfer category'
);

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.category_budgets (id, user_id, category_id, month, amount_minor)
    values (
      '20000000-0000-4000-8000-000000000031',
      '20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000030', '2026-08', 50000
    )
  $command$),
  '23514',
  'a budget rejects an income category'
);

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.recurring_incomes (
      id, user_id, name, default_amount_minor, pay_day, recurrence,
      person_id, category_id
    ) values (
      '20000000-0000-4000-8000-000000000032',
      '20000000-0000-4000-8000-000000000002',
      'Missing anchor', 10000, 1, 'weekly',
      '20000000-0000-4000-8000-000000000021',
      '20000000-0000-4000-8000-000000000030'
    )
  $command$),
  '23514',
  'a weekly income requires an anchor date'
);

select lives_ok(
  $$insert into public.recurring_incomes (
      id, user_id, name, default_amount_minor, pay_day, recurrence, anchor_date,
      person_id, category_id
    ) values (
      '20000000-0000-4000-8000-000000000033',
      '20000000-0000-4000-8000-000000000002',
      'Weekly income', 10000, 1, 'weekly', '2026-08-01',
      '20000000-0000-4000-8000-000000000021',
      '20000000-0000-4000-8000-000000000030'
    )$$,
  'a weekly income accepts a valid anchor date'
);

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.recurring_incomes (
      id, user_id, name, default_amount_minor, pay_day, person_id, category_id
    ) values (
      '20000000-0000-4000-8000-000000000024',
      '20000000-0000-4000-8000-000000000002',
      'Wrong category', 10000, 1,
      '20000000-0000-4000-8000-000000000021',
      '20000000-0000-4000-8000-000000000023'
    )
  $command$),
  '23514',
  'recurring income rejects an expense category'
);

select is(
  pg_temp.exec_sqlstate($command$
    update public.persons
    set user_id = '10000000-0000-4000-8000-000000000001'
    where id = '20000000-0000-4000-8000-000000000021'
  $command$),
  '42501',
  'WITH CHECK prevents changing row ownership'
);

select lives_ok(
  $$insert into public.subscriptions (
      id, user_id, name, amount_minor, cycle, billing_day, next_due_date,
      category_id, person_id
    ) values (
      '20000000-0000-4000-8000-000000000025',
      '20000000-0000-4000-8000-000000000002',
      'Valid subscription', 10000, 'monthly', 1, '2026-08-01',
      '20000000-0000-4000-8000-000000000023',
      '20000000-0000-4000-8000-000000000021'
    )$$,
  'an owned subscription accepts an expense category'
);

select lives_ok(
  $$insert into public.expected_payments (
      id, user_id, direction, kind, ref_id, due_date, amount_minor
    ) values (
      '20000000-0000-4000-8000-000000000026',
      '20000000-0000-4000-8000-000000000002',
      'out', 'subscription',
      '20000000-0000-4000-8000-000000000025', '2026-08-01', 10000
    )$$,
  'expected payment accepts the matching owned reference'
);

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.expected_payments (
      id, user_id, direction, kind, ref_id, due_date, amount_minor
    ) values (
      '20000000-0000-4000-8000-000000000027',
      '20000000-0000-4000-8000-000000000002',
      'in', 'recurring_income',
      '20000000-0000-4000-8000-000000000025', '2026-08-01', 10000
    )
  $command$),
  '23514',
  'expected payment rejects a mismatched polymorphic reference'
);

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.transactions (
      id, user_id, type, amount_minor, amount_try_minor, entry_date,
      effective_date, status, category_id, person_id
    ) values (
      '20000000-0000-4000-8000-000000000028',
      '20000000-0000-4000-8000-000000000002',
      'income', 10000, 10000, '2026-08-01', '2026-08-01', 'realized',
      '20000000-0000-4000-8000-000000000023',
      '20000000-0000-4000-8000-000000000021'
    )
  $command$),
  '23514',
  'transaction category kind must match its financial type'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

-- Anonymous callers are refused at the privilege layer, not merely filtered to
-- zero rows by RLS. Every policy is `to authenticated`, so anon always matched
-- nothing; migration 9 removes the table grant as well, so the attempt is now
-- denied outright (42501) instead of returning a quiet empty result.
select throws_ok(
  $$select count(*)::bigint from public.persons$$,
  '42501',
  null,
  'anonymous callers are denied synced tables outright'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  pg_temp.exec_sqlstate($command$
      delete from public.persons
      where id = '10000000-0000-4000-8000-000000000011'
  $command$),
  '42501',
  'user A cannot hard-delete even an owned row'
);

select lives_ok(
  $$select public.delete_own_account()$$,
  'user A can delete the complete owned account through the scoped RPC'
);

set local role postgres;

select is(
  (select count(*) from auth.users where id = '10000000-0000-4000-8000-000000000001'),
  0::bigint,
  'account deletion removes the caller identity and cascades owned rows'
);

select is(
  (select count(*) from auth.users where id = '20000000-0000-4000-8000-000000000002'),
  1::bigint,
  'account deletion RPC cannot delete or return another identity'
);

select * from extensions.finish();
rollback;
