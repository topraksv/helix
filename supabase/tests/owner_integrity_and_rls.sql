begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(19);

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
        'balance_adjustments','cell_notes','settings','fx_rates'
      ])
  ),
  60::bigint,
  'all 15 synced tables have four owner policies'
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
        'balance_adjustments','cell_notes','settings','fx_rates'
      ])
      and roles = array['authenticated']::name[]
  ),
  60::bigint,
  'every owner policy is restricted to authenticated'
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

select results_eq(
  $$with removed as (
      delete from public.persons
      where id = '10000000-0000-4000-8000-000000000011'
      returning 1
    ) select count(*)::bigint from removed$$,
  $$values (0::bigint)$$,
  'user B cannot delete user A rows'
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

select results_eq(
  $$select count(*)::bigint from public.persons$$,
  $$values (0::bigint)$$,
  'anonymous callers cannot read synced rows'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select results_eq(
  $$with removed as (
      delete from public.persons
      where id = '10000000-0000-4000-8000-000000000011'
      returning 1
    ) select count(*)::bigint from removed$$,
  $$values (1::bigint)$$,
  'user A can delete the owned person'
);

reset role;
select * from finish(true);
rollback;
