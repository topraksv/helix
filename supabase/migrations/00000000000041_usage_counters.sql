-- Which screens get used, counted and nothing else.
--
-- The question this answers is the one the owner could not answer before:
-- people report that something is broken, and the incident table says what
-- threw, but nothing said where anybody actually goes. A count per screen per
-- day answers it without a session recording, an event stream or a third party.
--
-- What it may carry is bounded by the same shape rule as `diagnostic_events`:
-- a screen key is a normalised route with every identifier stripped, matched
-- by a CHECK here rather than trusted from the client. No path parameter, no
-- amount, no label, no free text can reach this table, so there is nothing in
-- it that belongs to a person beyond the fact that a screen was opened.
--
-- Deltas rather than totals, applied by `record_usage` below. A client that
-- sent its running total would overwrite a second device's; a client that sends
-- what it has not yet reported lets the server add them up, which is the only
-- shape that survives two devices and an offline day.
begin;

create table if not exists public.usage_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The device's own local day. Grouping by the server's clock would move a
  -- late-evening visit into tomorrow for anyone west of UTC.
  day date not null,
  screen text not null
    constraint usage_counters_screen_shape
    check (screen ~ '^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$' and length(screen) <= 60),
  count integer not null default 0
    constraint usage_counters_count_sane check (count >= 0 and count <= 100000),
  updated_at timestamptz not null default now(),
  primary key (user_id, day, screen)
);

alter table public.usage_counters enable row level security;

create policy usage_counters_select_own on public.usage_counters
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.usage_counters from anon, authenticated;
grant select on table public.usage_counters to authenticated;
grant all on table public.usage_counters to service_role;

-- Insert and update reach the table only through this function, which is why
-- the grants above stop at select: a client cannot write an arbitrary row, and
-- cannot lower a count it has already raised.
create or replace function public.record_usage(events jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  event jsonb;
begin
  if auth.uid() is null then
    raise exception 'record_usage requires a session';
  end if;
  if jsonb_typeof(events) <> 'array' or jsonb_array_length(events) > 400 then
    raise exception 'record_usage takes an array of at most 400 entries';
  end if;
  for event in select * from jsonb_array_elements(events) loop
    insert into public.usage_counters as target (user_id, day, screen, count, updated_at)
    values (
      auth.uid(),
      (event ->> 'day')::date,
      event ->> 'screen',
      greatest(0, least(10000, coalesce((event ->> 'count')::int, 0))),
      now()
    )
    on conflict (user_id, day, screen)
      do update set count = least(100000, target.count + excluded.count), updated_at = now();
  end loop;
end;
$$;

revoke all on function public.record_usage(jsonb) from public, anon;
grant execute on function public.record_usage(jsonb) to authenticated;

-- The same retention shape migration 36 gave the incident log: a limit the
-- database enforces rather than one a document claims.
create or replace function public.purge_usage_counters()
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.usage_counters
  where user_id = (select auth.uid()) and day < (current_date - interval '180 days');
$$;

revoke all on function public.purge_usage_counters() from public, anon;
grant execute on function public.purge_usage_counters() to authenticated;

commit;
