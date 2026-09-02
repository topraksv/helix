-- The three questions an incident log is kept to answer.
--
-- This repository has no admin panel and is not getting one: Supabase Studio
-- already provides SQL, the table editor, auth and logs, and a second surface
-- would be one more thing to secure for one user. What Studio does not provide
-- is the queries themselves — `diagnostic_events` is a flat table of individual
-- incidents, and reading it raw answers "what happened" but not "is this new",
-- "is it getting worse", or "did the last release cause it".
--
-- Views rather than a file of SQL to paste: a view is one click in the table
-- editor, it is versioned and reviewed like everything else here, and it cannot
-- drift from the schema it reads.
--
-- SECURITY_INVOKER IS THE WHOLE SAFETY ARGUMENT. A Postgres view runs as its
-- OWNER by default, and the owner here is `postgres`, which is exempt from row
-- level security. A view defined without this option would therefore return
-- every user's incidents to any caller who can select from it — a genuine leak
-- built out of three read-only queries. With the option, the view is a saved
-- query and nothing more: the caller's own RLS policy applies exactly as it
-- does to the base table, so these can only ever show the caller their own
-- rows. Supabase's own linter reports the other case as
-- `0010_security_definer_view`, and the pgTAP suite asserts the property.
--
-- The client never reads these. They exist for a person in Studio, so nothing
-- in `src/` imports them and `database.types.ts` does not need them.

begin;

-- 1. What just happened. The whole redacted record, newest first.
create or replace view public.incident_recent
with (security_invoker = true) as
  select
    occurred_at,
    received_at,
    severity,
    scope,
    code,
    error_name,
    fingerprint,
    frames,
    platform,
    app_version
  from public.diagnostic_events
  order by occurred_at desc
  limit 200;

-- 2. What keeps happening. One row per kind of failure rather than per
--    occurrence, which is the difference between a log and a signal.
--    `first_seen` is what says whether something is new or has been there all
--    along, and that is usually the first thing worth knowing.
create or replace view public.incident_summary
with (security_invoker = true) as
  select
    scope,
    code,
    severity,
    count(*) as occurrences,
    min(occurred_at) as first_seen,
    max(occurred_at) as last_seen,
    array_agg(distinct platform order by platform) as platforms,
    array_agg(distinct app_version order by app_version) as app_versions,
    array_agg(distinct error_name) filter (where error_name is not null) as error_names,
    array_agg(distinct fingerprint) filter (where fingerprint is not null) as fingerprints
  from public.diagnostic_events
  group by scope, code, severity
  order by count(*) desc;

-- 3. Whether the last release made it worse. The one query a single-developer
--    project cannot answer any other way: there is no staging tier and no
--    alerting, so a regression shows up as this month's version carrying
--    errors last month's did not.
create or replace view public.incident_by_release
with (security_invoker = true) as
  select
    app_version,
    platform,
    count(*) filter (where severity = 'error') as errors,
    count(*) filter (where severity = 'warning') as warnings,
    count(distinct scope) as distinct_scopes,
    min(occurred_at) as first_seen,
    max(occurred_at) as last_seen
  from public.diagnostic_events
  group by app_version, platform
  order by app_version desc, platform;

-- Least privilege, the same shape migration 27 gave the table underneath: start
-- from nothing, then grant the one verb a view can serve.
revoke all on public.incident_recent from anon, authenticated;
revoke all on public.incident_summary from anon, authenticated;
revoke all on public.incident_by_release from anon, authenticated;

grant select on public.incident_recent to authenticated;
grant select on public.incident_summary to authenticated;
grant select on public.incident_by_release to authenticated;

comment on view public.incident_recent is
  'Saved query: the latest 200 redacted incidents for the calling user.';
comment on view public.incident_summary is
  'Saved query: incidents grouped by scope, code and severity, worst first.';
comment on view public.incident_by_release is
  'Saved query: incident counts per app version and platform, for regressions.';

commit;
