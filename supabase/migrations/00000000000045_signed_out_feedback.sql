-- A report from someone signed out. Sign-up and sign-in say "tell us in
-- Geri bildirim" when mail fails, and that screen needed an account. Signed
-- out there is no one to count against, so all such reports share one bound:
-- ten a day reach the owner, and a flood spends only those ten, never an
-- account's own. `send-feedback` takes no picture from them and wants an
-- address to answer. Gital's migration 17 is the same change.

begin;

alter table public.feedback_reports alter column user_id drop not null;

create or replace function public.record_signed_out_feedback_send()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One at a time, so two in flight cannot both read nine (migration 44).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('record_signed_out_feedback_send', 0));
  delete from public.feedback_reports
   where user_id is null and created_at < pg_catalog.now() - interval '1 day';
  if (select count(*) from public.feedback_reports where user_id is null) >= 10 then
    return false;
  end if;
  insert into public.feedback_reports (user_id) values (null);
  return true;
end $$;

-- Supabase grants every new function to both roles; an account sends as itself.
revoke all on function public.record_signed_out_feedback_send() from public, authenticated;
grant execute on function public.record_signed_out_feedback_send() to anon;

commit;
