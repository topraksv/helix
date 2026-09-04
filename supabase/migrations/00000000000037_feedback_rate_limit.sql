-- A send limit the database enforces, rather than one the client promises.
--
-- `send-feedback` refuses an unauthenticated caller, bounds every field and
-- every attachment, and reveals nothing back — but sign-up is open, so any
-- account it accepts could repeat a perfectly valid report until the mail
-- provider's quota was spent. That is a cost boundary rather than a data one,
-- and the client is the wrong place to hold it: the function is a public HTTP
-- endpoint and the app is not the only thing that can post to it.
--
-- SECURITY DEFINER, for the same reason migration 36 uses it and the opposite
-- of the usual one. `authenticated` is granted NOTHING on the table below —
-- no select, no insert, no delete — so a caller cannot read its own ledger,
-- cannot forge an older row, and above all cannot delete the rows that are
-- counting against it. A rate limit a client can erase is not a rate limit.
-- The only way to touch this table is the function, it takes no argument, and
-- it can only ever act on `auth.uid()`.
--
-- Two windows rather than one. Five an hour is what stops a burst; twenty a
-- day is what stops a patient sender doing five an hour all night. Both are
-- far above what reporting a bug looks like — the app's own history has never
-- had two in one day — and far below what makes the quota interesting.
--
-- The count and the insert are one statement, so two requests in flight cannot
-- both read the same count and both insert past it under READ COMMITTED. What
-- that does NOT do is serialise against a third: the bound is exact for any
-- pair and can be exceeded by at most the number of genuinely simultaneous
-- requests, which for a per-account limit is not a boundary worth a lock.

begin;

create table if not exists public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  -- Cascades with the account, so deleting an account takes its ledger with
  -- it. Nothing in here outlives the person it counted.
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- The only question ever asked of this table is "how many rows does this
-- account have since T", and it is asked on every send.
create index if not exists feedback_reports_user_created
  on public.feedback_reports (user_id, created_at desc);

-- Enabled, and deliberately WITHOUT policies: there is no client access to
-- grant. `force` is not used, so the owner the definer function runs as still
-- reaches the rows.
alter table public.feedback_reports enable row level security;

revoke all on table public.feedback_reports from public, anon, authenticated;
grant all on table public.feedback_reports to service_role;

/**
 * Record one send if the caller is under both limits.
 *
 * Returns true when the report may go out. The caller does not get to know how
 * many are left or when the window opens: it is a yes or a no, and a count
 * would be one more thing an abuser could tune against.
 */
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

comment on function public.record_feedback_send() is
  'Records one feedback send for the calling user and returns whether it was within the per-account limits (5/hour, 20/day). The only access path to feedback_reports.';

commit;
