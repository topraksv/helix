-- Definer RPCs leave the exposed schema; an invoker of the same name stays.
--
-- The security advisor flags every SECURITY DEFINER function a client role can
-- call through `/rest/v1/rpc` (lints 0028, 0029). These six are the client's
-- API on purpose, so neither revoking them nor making them invokers is open:
-- each needs its owner's rights for a table clients hold nothing on. The
-- advisor's third remedy keeps them: the definer moves to a schema PostgREST
-- does not expose, and `public` keeps an invoker with the same name, arguments
-- and grants that calls it. A client calls exactly what it called before; SET
-- SCHEMA carries each function's body, owner, search_path and grants with it.
--
-- The invoker runs as the caller, so the caller's roles need USAGE on that
-- schema. Not `private`: client roles hold nothing there on purpose, and the
-- guard helpers it keeps are asserted unreachable. `definers` holds these six
-- alone, and it is not exposed, so USAGE opens no new route.
--
-- `feedback_reports` is reached through the two feedback functions alone; a
-- policy refusing client roles says so instead of leaving RLS without one
-- (lint 0008).
begin;

create schema definers;
revoke all on schema definers from public;
grant usage on schema definers to anon, authenticated, service_role;

alter function public.delete_own_account() set schema definers;
alter function public.purge_expired_diagnostics() set schema definers;
alter function public.purge_usage_counters() set schema definers;
alter function public.record_feedback_send() set schema definers;
alter function public.record_signed_out_feedback_send() set schema definers;
alter function public.record_usage(jsonb) set schema definers;

create function public.delete_own_account()
returns void language sql security invoker set search_path = ''
as $$ select definers.delete_own_account() $$;

create function public.purge_expired_diagnostics()
returns integer language sql security invoker set search_path = ''
as $$ select definers.purge_expired_diagnostics() $$;

create function public.purge_usage_counters()
returns void language sql security invoker set search_path = ''
as $$ select definers.purge_usage_counters() $$;

create function public.record_feedback_send()
returns boolean language sql security invoker set search_path = ''
as $$ select definers.record_feedback_send() $$;

create function public.record_signed_out_feedback_send()
returns boolean language sql security invoker set search_path = ''
as $$ select definers.record_signed_out_feedback_send() $$;

create function public.record_usage(events jsonb)
returns void language sql security invoker set search_path = ''
as $$ select definers.record_usage(events) $$;

revoke all on function public.delete_own_account() from public, anon, authenticated, service_role;
revoke all on function public.purge_expired_diagnostics() from public, anon, authenticated, service_role;
revoke all on function public.purge_usage_counters() from public, anon, authenticated, service_role;
revoke all on function public.record_feedback_send() from public, anon, authenticated, service_role;
revoke all on function public.record_signed_out_feedback_send() from public, anon, authenticated, service_role;
revoke all on function public.record_usage(jsonb) from public, anon, authenticated, service_role;

grant execute on function public.delete_own_account() to authenticated;
grant execute on function public.purge_expired_diagnostics() to authenticated, service_role;
grant execute on function public.purge_usage_counters() to authenticated, service_role;
grant execute on function public.record_feedback_send() to authenticated, service_role;
grant execute on function public.record_signed_out_feedback_send() to anon, service_role;
grant execute on function public.record_usage(jsonb) to authenticated, service_role;

create policy feedback_reports_no_client
  on public.feedback_reports
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

commit;
