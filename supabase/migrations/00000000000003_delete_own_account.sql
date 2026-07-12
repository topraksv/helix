-- Faz 3: self-service account deletion (KVKK md.7 "silme/yok etme" + Apple
-- App Store Guideline 5.1.1(v) account-deletion requirement).
-- Run in the Supabase SQL Editor (there is no local mirror — this touches the
-- auth schema, which only exists on the Supabase side).
--
-- Why an RPC and not a client-side delete: the email-uniqueness constraint and
-- the credentials both live in auth.users, NOT in any public table. Clearing
-- only the public (app-data) tables therefore left the identity intact, so
-- re-registering the same email hit "already registered" and the "deleted"
-- account could still sign in. Removing auth.users is an admin operation
-- (normally the service_role key, which must never ship in the client); a
-- SECURITY DEFINER function is the standard server-side way to let a user erase
-- their OWN identity without exposing that key.
--
-- Every public.* table's user_id FK is `references auth.users(id) on delete
-- cascade`, so deleting the auth row removes all of the caller's app data in
-- the same transaction — atomic, with no window for a racing sync to leave
-- orphans behind.

create or replace function public.delete_own_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

-- Only a signed-in user may call it, and only ever for themselves (the body is
-- scoped to auth.uid() — there is no argument to target another account).
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
