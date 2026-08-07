-- Failure telemetry: the redacted incident ring, uploaded to the owner's own
-- project.
--
-- Until now `src/services/diagnostics.ts` kept the last twelve incidents in
-- device storage and nothing ever read them off the device. So an app that
-- crashed on the owner's phone produced exactly one signal — the owner
-- noticing — and a crash that only happens on iOS, or only offline, or only
-- after a migration, left no trace at all.
--
-- What is stored is what was already being stored locally, and nothing more:
-- when, which internal scope, how bad, and which of six classes the failure
-- fell into. There is no message, no stack, no value, no identifier. That is a
-- property of `src/domain/diagnostics.ts`, which builds the only shape allowed
-- to persist, and the CHECK constraints below are the second lock on it: if a
-- future change ever tries to write a free-text message through this table, the
-- database refuses the row rather than storing it.
--
-- Append-only by construction. There is no update and no delete policy, so a
-- compromised client token can add to the record and can never rewrite or erase
-- it — which is the whole value of an incident log. Account deletion still
-- clears it, through the ON DELETE CASCADE to auth.users.

begin;

create table if not exists public.diagnostic_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- When the incident happened on the device, which is not when it arrived
  -- here: the ring is flushed on the next run with a network.
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  -- An internal label such as `sync.push` or `error-boundary`. The same
  -- pattern `createDiagnosticEvent` enforces before it will persist a scope,
  -- restated here so the database is not relying on the client to have done it.
  scope text not null
    constraint diagnostic_events_scope_shape
    check (scope ~ '^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$' and length(scope) <= 40),
  severity text not null
    constraint diagnostic_events_severity
    check (severity in ('warning', 'error')),
  code text not null
    constraint diagnostic_events_code
    check (code in ('network', 'auth', 'database', 'validation', 'cancelled', 'unknown')),
  -- Enough context to tell "only on iOS" from "only after the 1.2 release"
  -- apart, and deliberately not enough to identify a device.
  platform text not null
    constraint diagnostic_events_platform
    check (platform in ('ios', 'android', 'web')),
  app_version text not null
    constraint diagnostic_events_app_version
    check (app_version ~ '^[0-9A-Za-z._-]{1,32}$')
);

-- The only question anyone asks of this table: what went wrong lately, for me.
create index if not exists diagnostic_events_user_occurred_idx
  on public.diagnostic_events (user_id, occurred_at desc);

-- A device that reconnects after a week must not re-upload the same twelve
-- incidents it uploaded last time. The ring is small and its entries are
-- naturally unique in time per scope, so the identity of an incident is who,
-- when and where — not a client-generated id the client could collide.
create unique index if not exists diagnostic_events_identity_idx
  on public.diagnostic_events (user_id, occurred_at, scope, code);

alter table public.diagnostic_events enable row level security;
alter table public.diagnostic_events force row level security;

create policy diagnostic_events_select_own on public.diagnostic_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy diagnostic_events_insert_own on public.diagnostic_events
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- Least privilege, the same way migration 13 rebuilt it for every other table:
-- start from nothing rather than from Supabase's defaults, and grant only the
-- two verbs the policies above can serve. No update, no delete, for anyone but
-- the service role.
revoke all on table public.diagnostic_events from anon, authenticated;
grant select, insert on table public.diagnostic_events to authenticated;
grant all on table public.diagnostic_events to service_role;

commit;
