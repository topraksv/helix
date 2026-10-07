-- The feedback limit, serialised per account.
--
-- Migration 37 argued that counting and inserting "in one statement" kept two
-- requests from both passing the same count. They were never one statement —
-- a SELECT INTO, then an INSERT — and under READ COMMITTED even one statement
-- would not see another transaction's uncommitted row, so any number of
-- overlapping calls could all read the same count and all send. Measured on
-- the local stack before this change: with four sends recorded, a second
-- session's call returned true while the first's fifth was still open.
--
-- A transaction-scoped advisory lock on the account makes the second call wait
-- for the first to commit and then count its row. It is per account, so one
-- sender never waits on another, and it is released with the transaction, so
-- nothing can leave it held.

begin;

create or replace function public.record_feedback_send()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid := auth.uid();
  recent integer;
  today integer;
begin
  if account is null then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('record_feedback_send:' || account::text, 0)
  );
  -- Housekeeping first, and only this account's rows: anything outside the
  -- wider window can never affect an answer again, so it is not kept.
  delete from public.feedback_reports
   where user_id = account
     and created_at < pg_catalog.now() - interval '1 day';

  select
    count(*) filter (where created_at > pg_catalog.now() - interval '1 hour'),
    count(*)
    into recent, today
    from public.feedback_reports
   where user_id = account;

  if recent >= 5 or today >= 20 then
    return false;
  end if;

  insert into public.feedback_reports (user_id) values (account);
  return true;
end $$;

revoke all on function public.record_feedback_send() from public, anon;
grant execute on function public.record_feedback_send() to authenticated;

commit;
