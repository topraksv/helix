-- Investment cash belongs only to the account's stable self person. The local
-- projector already excluded watch-only people, but the server guard counted
-- every same-user transfer and let a direct PostgREST client fund purchases
-- with watch-only rows. Repair legacy duplicate selves, prevent new identity
-- rewrites, and make the server calculation use the same ownership boundary.

begin;

-- Historical clients could create duplicate self rows. Consolidate their
-- references before locking the invariant; the oldest row is the same keeper
-- chosen by local maintenance, so every device converges on one identity.
do $$
declare
  duplicate record;
begin
  for duplicate in
    select user_id, id, keep_id
    from (
      select
        user_id,
        id,
        first_value(id) over (
          partition by user_id order by created_at, id
        ) as keep_id,
        row_number() over (
          partition by user_id order by created_at, id
        ) as position
      from public.persons
      where is_self and deleted_at is null
    ) ranked
    where position > 1
  loop
    update public.payment_sources
      set person_id = duplicate.keep_id
      where user_id = duplicate.user_id and person_id = duplicate.id;
    update public.installment_plans
      set person_id = duplicate.keep_id
      where user_id = duplicate.user_id and person_id = duplicate.id;
    update public.transactions
      set person_id = duplicate.keep_id
      where user_id = duplicate.user_id and person_id = duplicate.id;
    update public.subscriptions
      set person_id = duplicate.keep_id
      where user_id = duplicate.user_id and person_id = duplicate.id;
    update public.recurring_incomes
      set person_id = duplicate.keep_id
      where user_id = duplicate.user_id and person_id = duplicate.id;
    update public.persons
      set deleted_at = pg_catalog.now()
      where user_id = duplicate.user_id and id = duplicate.id;
  end loop;
end $$;

create unique index persons_one_live_self_per_user
  on public.persons (user_id)
  where is_self and deleted_at is null;

create or replace function private.guard_stable_self_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and new.user_id <> (select auth.uid()) then
    raise insufficient_privilege using message = 'self person owner mismatch';
  end if;

  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise insufficient_privilege using message = 'self person owner is immutable';
  end if;
  if tg_op = 'UPDATE' and new.is_self <> old.is_self then
    raise check_violation using message = 'self person identity is immutable';
  end if;
  if tg_op = 'UPDATE'
    and old.is_self
    and old.deleted_at is null
    and new.deleted_at is not null
  then
    raise check_violation using message = 'live self person cannot be tombstoned';
  end if;
  if new.is_self and new.deleted_at is null and exists (
    select 1
    from public.persons p
    where p.user_id = new.user_id
      and p.id <> new.id
      and p.is_self
      and p.deleted_at is null
  ) then
    raise unique_violation using message = 'account already has a live self person';
  end if;
  return new;
end;
$$;

create trigger a_guard_stable_self_person
  before insert or update of user_id, is_self, deleted_at on public.persons
  for each row execute function private.guard_stable_self_person();

revoke all on function private.guard_stable_self_person()
  from public, anon, authenticated, service_role;

create or replace function private.investment_transaction_cash_effect(
  p_user_id uuid,
  p_type text,
  p_amount_try_minor bigint,
  p_effective_date date,
  p_status text,
  p_category_id uuid,
  p_person_id uuid,
  p_deleted_at timestamptz
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when
    p_deleted_at is null
    and p_type = 'transfer'
    and p_status = 'realized'
    and p_effective_date <= current_date
    and exists (
      select 1
      from public.investment_profiles p
      where p.user_id = p_user_id
        and p.deleted_at is null
        and p.started_on <= p_effective_date
    )
    and exists (
      select 1
      from public.categories c
      where c.user_id = p_user_id
        and c.id = p_category_id
        and c.is_transfer
    )
    and exists (
      select 1
      from public.persons p
      where p.user_id = p_user_id
        and p.id = p_person_id
        and p.is_self
        and p.deleted_at is null
    )
  then p_amount_try_minor else 0 end;
$$;

create or replace function private.investment_cash(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select p.opening_cash_minor
    + coalesce((
        select sum(private.investment_transaction_cash_effect(
          t.user_id, t.type, t.amount_try_minor, t.effective_date,
          t.status, t.category_id, t.person_id, t.deleted_at
        ))
        from public.transactions t
        where t.user_id = p_user_id
      ), 0)
    + coalesce((
        select sum(private.investment_operation_cash_effect(
          o.kind, o.total_minor, o.deleted_at
        ))
        from public.investment_operations o
        where o.user_id = p_user_id
      ), 0)
  from public.investment_profiles p
  where p.user_id = p_user_id
    and p.deleted_at is null;
$$;

create or replace function private.guard_investment_profile_cash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  projected_cash bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 1107296257)
  );
  if new.deleted_at is not null then
    return new;
  end if;
  select new.opening_cash_minor
    + coalesce((
        select sum(t.amount_try_minor)
        from public.transactions t
        join public.categories c
          on c.user_id = t.user_id and c.id = t.category_id and c.is_transfer
        join public.persons owner
          on owner.user_id = t.user_id
          and owner.id = t.person_id
          and owner.is_self
          and owner.deleted_at is null
        where t.user_id = new.user_id
          and t.deleted_at is null
          and t.type = 'transfer'
          and t.status = 'realized'
          and t.effective_date between new.started_on and current_date
      ), 0)
    + coalesce((
        select sum(private.investment_operation_cash_effect(
          o.kind, o.total_minor, o.deleted_at
        ))
        from public.investment_operations o
        where o.user_id = new.user_id
      ), 0)
  into projected_cash;

  if projected_cash between 0 and 99999999999999 then
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

create or replace function private.guard_investment_category_cash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_cash bigint;
  category_effect bigint;
begin
  if new.is_transfer = old.is_transfer then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 1107296257)
  );
  current_cash := private.investment_cash(new.user_id);
  if current_cash is null then
    return new;
  end if;
  select coalesce(sum(t.amount_try_minor), 0)
  into category_effect
  from public.transactions t
  join public.investment_profiles p
    on p.user_id = t.user_id and p.deleted_at is null
  join public.persons owner
    on owner.user_id = t.user_id
    and owner.id = t.person_id
    and owner.is_self
    and owner.deleted_at is null
  where t.user_id = new.user_id
    and t.category_id = new.id
    and t.deleted_at is null
    and t.type = 'transfer'
    and t.status = 'realized'
    and t.effective_date between p.started_on and current_date;
  if current_cash + (case when new.is_transfer then category_effect else -category_effect end)
    between 0 and 99999999999999
  then
    return new;
  end if;
  new := old;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function private.guard_investment_transaction_cash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_cash bigint;
  projected_cash bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 1107296257)
  );
  current_cash := private.investment_cash(new.user_id);
  if current_cash is null then
    return new;
  end if;
  projected_cash := current_cash
    - case when tg_op = 'UPDATE' then private.investment_transaction_cash_effect(
        old.user_id, old.type, old.amount_try_minor, old.effective_date,
        old.status, old.category_id, old.person_id, old.deleted_at
      ) else 0 end
    + private.investment_transaction_cash_effect(
        new.user_id, new.type, new.amount_try_minor, new.effective_date,
        new.status, new.category_id, new.person_id, new.deleted_at
      );
  if projected_cash between 0 and 99999999999999 then
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

revoke all on function private.investment_transaction_cash_effect(
  uuid,text,bigint,date,text,uuid,uuid,timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.investment_cash(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_investment_profile_cash()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_investment_category_cash()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_investment_transaction_cash()
  from public, anon, authenticated, service_role;

drop function private.investment_transaction_cash_effect(
  uuid,text,bigint,date,text,uuid,timestamptz
);

commit;
