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

select extensions.plan(63);

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
      and not has_table_privilege('authenticated', format('public.%I', name), 'TRUNCATE')
      and not has_table_privilege('authenticated', format('public.%I', name), 'REFERENCES')
      and not has_table_privilege('authenticated', format('public.%I', name), 'TRIGGER')
      and not has_table_privilege('authenticated', format('public.%I', name), 'MAINTAIN')
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
    from unnest(array[
      'public.enforce_category_kind()'::regprocedure,
      'public.enforce_expected_payment_ref()'::regprocedure,
      'public.enforce_expense_budget_category()'::regprocedure,
      'public.set_updated_at()'::regprocedure
    ]) as functions(oid)
    where not has_function_privilege('anon', oid, 'EXECUTE')
      and not has_function_privilege('authenticated', oid, 'EXECUTE')
  ),
  4::bigint,
  'trigger functions are not directly executable by client roles'
);

select ok(
  not has_table_privilege('anon', 'public.keep_alive', 'SELECT')
    and not has_table_privilege('authenticated', 'public.keep_alive', 'SELECT')
    and not has_table_privilege('authenticated', 'public.keep_alive', 'INSERT')
    and not has_table_privilege('authenticated', 'public.keep_alive', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.keep_alive', 'DELETE')
    and not has_table_privilege('authenticated', 'public.keep_alive', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.keep_alive', 'REFERENCES')
    and not has_table_privilege('authenticated', 'public.keep_alive', 'TRIGGER')
    and not has_table_privilege('authenticated', 'public.keep_alive', 'MAINTAIN'),
  'keepalive remains service-role only at the privilege layer'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'keep_alive'
      and cmd = 'ALL'
      and roles = array['service_role']::name[]
      and qual = 'true'
      and with_check = 'true'
  ),
  1::bigint,
  'keepalive declares its service-role-only RLS contract'
);

select ok(
  pg_catalog.to_regclass('public.idx_card_statement_user_source_period') is null
    and pg_catalog.to_regclass(
      'public.credit_card_statements_user_id_payment_source_id_period_mon_key'
    ) is not null,
  'the statement natural key has one covering index, not a duplicate copy'
);

select is(
  (
    with expected(table_name, index_name, column_names) as (
      values
        ('category_budgets', 'category_budgets_user_category', array['user_id', 'category_id']),
        ('cell_notes', 'cell_notes_user_category', array['user_id', 'category_id']),
        ('expected_payments', 'expected_payments_user_transaction', array['user_id', 'transaction_id']),
        ('installment_plans', 'installment_plans_user_category', array['user_id', 'category_id']),
        ('installment_plans', 'installment_plans_user_person', array['user_id', 'person_id']),
        ('installment_plans', 'installment_plans_user_source', array['user_id', 'payment_source_id']),
        ('payment_sources', 'payment_sources_user_person', array['user_id', 'person_id']),
        ('price_history', 'price_history_user_subscription', array['user_id', 'subscription_id']),
        ('recurring_incomes', 'recurring_incomes_user_category', array['user_id', 'category_id']),
        ('recurring_incomes', 'recurring_incomes_user_person', array['user_id', 'person_id']),
        ('subscriptions', 'subscriptions_user_category', array['user_id', 'category_id']),
        ('subscriptions', 'subscriptions_user_person', array['user_id', 'person_id']),
        ('subscriptions', 'subscriptions_user_source', array['user_id', 'payment_source_id']),
        ('transactions', 'transactions_user_category', array['user_id', 'category_id']),
        ('transactions', 'transactions_user_person', array['user_id', 'person_id']),
        ('transactions', 'transactions_user_plan', array['user_id', 'installment_plan_id']),
        ('transactions', 'transactions_user_source', array['user_id', 'payment_source_id']),
        ('transactions', 'transactions_user_subscription', array['user_id', 'subscription_id'])
    ),
    actual as (
      select
        table_class.relname::text as table_name,
        index_class.relname::text as index_name,
        array_agg(attribute.attname::text order by key.ordinality) as column_names
      from pg_index index_definition
      join pg_class table_class
        on table_class.oid = index_definition.indrelid
      join pg_class index_class
        on index_class.oid = index_definition.indexrelid
      join pg_namespace namespace
        on namespace.oid = table_class.relnamespace
      cross join lateral unnest(index_definition.indkey)
        with ordinality as key(attribute_number, ordinality)
      join pg_attribute attribute
        on attribute.attrelid = table_class.oid
       and attribute.attnum = key.attribute_number
      where namespace.nspname = 'public'
        and key.ordinality <= index_definition.indnkeyatts
      group by table_class.relname, index_class.relname
    )
    select count(*)
    from expected
    join actual using (table_name, index_name, column_names)
  ),
  18::bigint,
  'every owner-aware foreign key has the expected composite referencing index'
);

select ok(
  pg_catalog.to_regclass('public.idx_tx_user_effective') is null,
  'the measured-unused server effective-date index is removed'
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
  (
    select pg_get_userbyid(proowner)
    from pg_proc
    where oid = 'public.delete_own_account()'::regprocedure
  ),
  'postgres',
  'account deletion is owned by the trusted postgres role'
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
  not has_function_privilege('anon', 'public.delete_own_account()', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.delete_own_account()', 'EXECUTE'),
  'account deletion has no anonymous or service-role RPC surface'
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


-- ---------------------------------------------------------------------------
-- Cross-user adversarial matrix (Package 4C)
--
-- The suite above proves user B cannot READ user A. These prove the writes a
-- hostile or simply broken client can attempt: forging an owner, handing a row
-- to another account, and reaching another account's parent row through every
-- relationship shape the schema has. The composite `(user_id, parent_id)`
-- foreign keys are what make the last one fail even when RLS would have let the
-- row through, so each relation is asserted rather than assumed to inherit the
-- guarantee from a sibling.
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.persons (id, user_id, name, is_self) values (
      '10000000-0000-4000-8000-000000000091',
      '20000000-0000-4000-8000-000000000002',
      'forged owner', false
    )
  $command$),
  '42501',
  'user A cannot insert a row owned by user B'
);

select is(
  pg_temp.exec_sqlstate($command$
    update public.persons
    set user_id = '20000000-0000-4000-8000-000000000002'
    where id = '10000000-0000-4000-8000-000000000011'
  $command$),
  '42501',
  'user A cannot hand an owned row to user B'
);

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.persons (id, user_id, name, is_self)
    values ('10000000-0000-4000-8000-000000000092', null, 'no owner', false)
  $command$),
  '42501',
  'a row with no owner is refused before the not-null check'
);

select is(
  pg_temp.exec_sqlstate($$truncate public.persons$$),
  '42501',
  'user A cannot truncate a synced table'
);

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.payment_sources (id, user_id, name, type, person_id) values (
      '10000000-0000-4000-8000-000000000093',
      '10000000-0000-4000-8000-000000000001',
      'A kart', 'credit_card',
      '20000000-0000-4000-8000-000000000021'
    )
  $command$),
  '23503',
  'a payment source cannot point at another account''s person'
);

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.credit_card_statements (
      id, user_id, payment_source_id, period_month, statement_date, due_date
    ) values (
      '10000000-0000-4000-8000-000000000094',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000022',
      '2026-08', '2026-08-20', '2026-09-05'
    )
  $command$),
  '23503',
  'a statement cannot point at another account''s payment source'
);

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.price_history (
      id, user_id, subscription_id, amount_minor, currency, effective_from
    ) values (
      '10000000-0000-4000-8000-000000000095',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000024',
      1000, 'TRY', '2026-08-01'
    )
  $command$),
  '23503',
  'price history cannot point at another account''s subscription'
);

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.cell_notes (id, user_id, month, category_id, body) values (
      '10000000-0000-4000-8000-000000000096',
      '10000000-0000-4000-8000-000000000001',
      '2026-08',
      '20000000-0000-4000-8000-000000000023',
      'note'
    )
  $command$),
  '23503',
  'a cell note cannot point at another account''s category'
);

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.transactions (
      id, user_id, type, amount_minor, amount_try_minor, entry_date,
      effective_date, status, category_id, person_id
    ) values (
      '10000000-0000-4000-8000-000000000097',
      '10000000-0000-4000-8000-000000000001',
      'expense', 10000, 10000, '2026-08-01', '2026-08-01', 'realized',
      '20000000-0000-4000-8000-000000000023',
      '10000000-0000-4000-8000-000000000011'
    )
  $command$),
  '23514',
  'a transaction cannot borrow another account''s category'
);

-- A join through a column both accounts share must not become a read path.
select is(
  (
    select count(*)::bigint
    from public.categories c
    join public.persons p on p.user_id = c.user_id
    where c.user_id = '20000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'joining on a shared column does not expose another account'
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

-- A deleted account's access token stays syntactically valid until it expires,
-- so a client that has not noticed the deletion keeps presenting the same
-- `sub`. RLS alone would accept it — it only compares the claim to `user_id` —
-- but every synced table's owner column references `auth.users`, so the
-- identity has to still exist for the write to land.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  pg_temp.exec_sqlstate($command$
    insert into public.persons (id, user_id, name, is_self) values (
      '10000000-0000-4000-8000-000000000098',
      '10000000-0000-4000-8000-000000000001',
      'ghost', false
    )
  $command$),
  '23503',
  'a stale token for a deleted account cannot write new rows'
);

reset role;

-- `reset role` returns to the Supabase CLI's short-lived login role, which can
-- execute the assertions through the test search_path but cannot execute
-- `extensions.finish()`. Re-assume the privileged fixture role for pgTAP's
-- summary; the surrounding transaction still rolls every fixture back.
set local role postgres;
select * from extensions.finish();
rollback;
