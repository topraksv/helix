-- Migration 30 added `transactions_user_id_id_key` for the attachments foreign
-- key, believing `transactions` had no `(user_id, id)` key. Migration 6's
-- `transactions_user_id_id_unique` already was one, so every insert and update
-- has maintained two identical indexes since.
--
-- A foreign key binds to one specific index and blocks dropping it. Measured
-- locally, both composite keys that reference `transactions` (attachments,
-- expected_payments) bind to the older index, so the constraint is the copy.
-- Guarded rather than assumed: where a key bound to the constraint instead,
-- the older index is the one dropped, and either way one key remains.

begin;

do $$
declare
  constraint_index oid := (
    select conindid from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and conname = 'transactions_user_id_id_key'
  );
begin
  if constraint_index is null
    or pg_catalog.to_regclass('public.transactions_user_id_id_unique') is null then
    return;
  end if;
  if not exists (
    select 1 from pg_constraint where contype = 'f' and conindid = constraint_index
  ) then
    alter table public.transactions drop constraint transactions_user_id_id_key;
  else
    drop index public.transactions_user_id_id_unique;
  end if;
end $$;

commit;
