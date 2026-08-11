-- Installment plans materialize transactions directly; the app no longer
-- creates expected rows for them. Retire any old live derivatives first, but
-- keep their tombstones so sync and backup restore remain lossless.

begin;

update public.expected_payments
set deleted_at = pg_catalog.now()
where deleted_at is null
  and kind in ('installment', 'loan');

alter table public.expected_payments
  drop constraint expected_payments_kind_check,
  add constraint expected_payments_kind_check check (
    kind in ('subscription', 'recurring_income')
    or (deleted_at is not null and kind in ('installment', 'loan'))
  );

create or replace function public.enforce_expected_payment_ref()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  valid_ref boolean;
begin
  -- Legacy derived rows remain as tombstones only; they have no active
  -- reference to enforce and must stay syncable for older clients.
  if new.deleted_at is not null then
    return new;
  end if;

  valid_ref := case new.kind
    when 'subscription' then exists (
      select 1 from public.subscriptions s
      where s.user_id = new.user_id and s.id = new.ref_id
    )
    when 'recurring_income' then exists (
      select 1 from public.recurring_incomes r
      where r.user_id = new.user_id and r.id = new.ref_id
    )
    else false
  end;

  if not valid_ref then
    raise exception 'Expected payment reference does not match its owner and kind'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

commit;
