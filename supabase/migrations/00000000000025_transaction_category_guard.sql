-- The repository requires every transaction to have a live category and
-- requires persisted transfer semantics for type=transfer. Mirror that at the
-- PostgREST boundary so a direct client cannot create unclassified transfers
-- or bypass investment/spending classification with category_id = null.

begin;

create or replace function public.enforce_category_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actual_kind text;
  actual_is_transfer boolean;
  required_kind text;
  transaction_type text;
begin
  -- Tombstones must remain syncable even when their historical category was
  -- already deleted. They have no live financial effect.
  if new.deleted_at is not null then
    return new;
  end if;

  if new.category_id is null then
    if tg_table_name = 'transactions' then
      raise check_violation using message = 'Transaction category is required';
    end if;
    return new;
  end if;

  select c.kind, c.is_transfer
  into actual_kind, actual_is_transfer
  from public.categories c
  where c.user_id = new.user_id
    and c.id = new.category_id
    and c.deleted_at is null;

  if tg_table_name = 'transactions' then
    transaction_type := pg_catalog.to_jsonb(new)->>'type';
    required_kind := case when transaction_type = 'income' then 'income' else 'expense' end;
  elsif tg_table_name = 'recurring_incomes' then
    required_kind := 'income';
  else
    required_kind := 'expense';
  end if;

  if actual_kind is null or actual_kind <> required_kind then
    raise exception 'Category must belong to the row owner and have kind %', required_kind
      using errcode = '23514';
  end if;
  if tg_table_name = 'transactions'
    and transaction_type = 'transfer'
    and not actual_is_transfer
  then
    raise check_violation using message = 'Transfer category must declare transfer semantics';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_category_kind()
  from public, anon, authenticated;

-- A live legacy row may remain uncategorized until the user repairs it, but
-- any subsequent live mutation has to cross the complete category boundary.
-- The original column-filtered trigger let an amount-only update bypass it.
drop trigger enforce_transaction_category_kind on public.transactions;
create trigger enforce_transaction_category_kind
before insert or update on public.transactions
for each row execute function public.enforce_category_kind();

commit;
