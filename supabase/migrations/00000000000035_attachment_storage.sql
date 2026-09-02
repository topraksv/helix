-- Attachment bytes reach every device, through the owner's own Storage bucket.
--
-- Until now the metadata row synced and the file did not, so a receipt added on
-- the phone was simply absent on the laptop and the UI said so. That was a
-- deliberate position (spec §3.1c) and it is being reversed deliberately: the
-- owner asked for the documents to follow the ledger they belong to.
--
-- WHAT "ENCRYPTED" MEANS HERE, EXACTLY. Supabase encrypts objects at rest. The
-- app does not encrypt before uploading, so this is protection against the
-- storage medium, NOT end-to-end: anyone holding the project's credentials can
-- read a receipt. The alternative was a client-side key, and every place to put
-- one was worse — the reasoning is in `ARCHITECTURE.md`, and the consequence is
-- stated to the user in `PRIVACY.md` rather than implied by the word encrypted.
--
-- The bucket is PRIVATE. There is no public URL and no anonymous read; every
-- byte is fetched with the caller's own JWT through a policy that checks the
-- first path segment against `auth.uid()`. The path is therefore not decoration
-- — `<user_id>/<stored_name>` IS the authorization boundary, and the client is
-- written to build it from the session's own id and never from a row.
--
-- Two server-side bounds so a compromised or buggy client cannot be the only
-- thing standing between this bucket and abuse: 25 MB per object, matching
-- `MAX_ATTACHMENT_BYTES`, and the same five MIME types `ATTACHMENT_MIME_TYPES`
-- accepts. A client that stopped checking would be refused here.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Four policies, one per verb, each scoped the same way. `storage.foldername`
-- splits the object name on `/`, so element 1 is the owner segment.
--
-- UPDATE carries both `using` and `with check`: without the second, a caller
-- could move an object they own into another account's folder, which is the
-- one way a per-verb policy set is usually got wrong.
drop policy if exists attachments_read_own on storage.objects;
create policy attachments_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists attachments_insert_own on storage.objects;
create policy attachments_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists attachments_update_own on storage.objects;
create policy attachments_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists attachments_delete_own on storage.objects;
create policy attachments_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Account deletion has to reach the bucket too.
--
-- Every public table's `user_id` cascades from `auth.users`, which is what made
-- `delete_own_account` a single statement. Storage does not cascade: the
-- objects are rows in `storage.objects` keyed by a path string, with no foreign
-- key to the account. Deleting the identity and leaving the receipts behind
-- would break the promise `PRIVACY.md` makes and the KVKK obligation under it.
--
-- The client deletes its objects through the Storage API first, which is what
-- actually frees the underlying blob. This is the backstop for the case where
-- that never ran — an offline delete, a crash between the two calls — and it is
-- inside the same transaction as the identity removal, so it cannot half-run.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid := auth.uid();
begin
  if account is null then
    return;
  end if;
  -- The sweep is a BACKSTOP and is written so it can never be the reason a
  -- deletion fails. `storage.objects` is owned by `supabase_storage_admin`, so
  -- a privilege change on the managed side would raise here — and an
  -- unreachable file must not keep an identity alive. The client removes the
  -- objects through the Storage API first, which is the path that actually
  -- frees the stored blob; this only catches the case where that never ran.
  begin
    delete from storage.objects
     where bucket_id = 'attachments'
       and (storage.foldername(name))[1] = account::text;
  exception when others then
    null;
  end;
  delete from auth.users where id = account;
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

commit;
