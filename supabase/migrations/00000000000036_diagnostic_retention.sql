-- A retention limit the database enforces, rather than one a document claims.
--
-- `diagnostic_events` had no expiry at all: rows accumulated until the account
-- was deleted, which is the same as keeping them for ever. KVKK asks that
-- personal data be kept no longer than the purpose requires, and the purpose
-- here — telling a new failure from a long-standing one, and telling whether a
-- release made things worse — is served by months, not by years.
--
-- 180 days, because `incident_by_release` (migration 34) compares the current
-- version against earlier ones, and a window shorter than a couple of release
-- cycles would answer that question with an empty table.
--
-- SECURITY DEFINER, and the reason is the opposite of the usual one. Migration
-- 27 deliberately gave clients no delete: an incident log a compromised client
-- can erase is not an incident log. That guarantee is kept here. The function
-- takes no argument, deletes only `auth.uid()`'s rows, and only rows already
-- past the window — so a caller can enforce the retention policy and still
-- cannot erase what happened yesterday. Granting `delete` to `authenticated`
-- instead would have handed over exactly the power 27 withheld.

begin;

create or replace function public.purge_expired_diagnostics()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid := auth.uid();
  removed integer;
begin
  if account is null then
    return 0;
  end if;
  delete from public.diagnostic_events
   where user_id = account
     and occurred_at < pg_catalog.now() - interval '180 days';
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function public.purge_expired_diagnostics() from public, anon;
grant execute on function public.purge_expired_diagnostics() to authenticated;

comment on function public.purge_expired_diagnostics() is
  'Deletes the calling user''s incident rows older than the 180-day retention window. Cannot reach anything newer.';

commit;
