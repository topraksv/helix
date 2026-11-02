-- "Not in the future" is judged against the latest date anywhere on Earth
-- (UTC+14), not the server's UTC day. A device stamps today from its own
-- calendar, so between midnight and 03:00 in Istanbul an investment entry or a
-- transfer dated today was a day ahead of `current_date`: the domain check
-- refused it with 23514, the push threw before its pull, and sync stood still
-- until UTC caught up (devil round 2026-11-03-1). The client still refuses a
-- date after its own day; this bound only stops a date no calendar has reached.

alter table public.investment_profiles drop constraint investment_profiles_finite_date;
alter table public.investment_profiles add constraint investment_profiles_finite_date
  check (
    pg_catalog.isfinite(started_on)
    and started_on between date '0001-01-01' and pg_catalog.timezone('Etc/GMT-14', pg_catalog.now())::date
  );
alter table public.investment_operations drop constraint investment_operations_finite_date;
alter table public.investment_operations add constraint investment_operations_finite_date
  check (
    pg_catalog.isfinite(operation_date)
    and operation_date between date '0001-01-01' and pg_catalog.timezone('Etc/GMT-14', pg_catalog.now())::date
  );

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
    and p_effective_date <= pg_catalog.timezone('Etc/GMT-14', pg_catalog.now())::date
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
          and t.effective_date between new.started_on and pg_catalog.timezone('Etc/GMT-14', pg_catalog.now())::date
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
    and t.effective_date between p.started_on and pg_catalog.timezone('Etc/GMT-14', pg_catalog.now())::date;
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
