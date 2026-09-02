-- Enough of a failure to name the bug, still not enough to name a person.
--
-- Migration 27 stored when, where, how bad and which of six classes — and said,
-- in its own comment, "there is no message, no stack". That was the right first
-- position and it is being widened deliberately, not drifted past: six codes
-- across an app this size collapse unrelated bugs into one bucket, so the log
-- could say a database error happened on iOS and never which one.
--
-- What changes is bounded by `src/domain/diagnostics.ts`, and the rule it
-- follows is the one migration 27 already applied to `scope`: refuse an
-- unexpected shape rather than sanitize it. A masked message still has the
-- shape of what it masked, and one missed pattern is a permanent record.
--
--   error_name   the constructor name only: TypeError, PostgrestError.
--   fingerprint  the message reduced to its ASCII letter runs, at most eight.
--                Digits cannot survive the tokenizer, so no amount, date, IBAN
--                or account number can be here. A message containing `@`, a
--                slash, or a non-ASCII letter — an address, a path, or this
--                app's own Turkish content — is refused whole rather than
--                trimmed, and the column stays null.
--   frames       `fn@file:line:col`, at most eight, joined by `|`. The
--                directories above the file are dropped, because that is where
--                a build machine's home directory carries a real name.
--
-- The CHECKs below are the second lock, exactly as migration 27's were: if a
-- later change ever tries to write a free-text message through one of these
-- columns, the database refuses the row rather than storing it. Each pattern is
-- an allowlist of characters, not a denylist of leaks.
--
-- Expand-only, so the order in RELEASE.md is satisfied in both directions: the
-- columns are nullable, an older client that sends none of them still inserts,
-- and a newer client that reaches a project without them retries the insert
-- narrowed rather than losing the incident (`isUnknownColumnError`).
--
-- Symbolication is out of scope and worth stating plainly: this repository
-- uploads no source maps, so a Hermes release frame reads
-- `main.jsbundle:1:284713` and locates a bug only with the matching bundle in
-- hand. `error_name` and `fingerprint` are what make a production incident
-- legible; `frames` earns its place on web and in development builds.

begin;

alter table public.diagnostic_events
  add column if not exists error_name text,
  add column if not exists fingerprint text,
  add column if not exists frames text;

alter table public.diagnostic_events
  drop constraint if exists diagnostic_events_error_name,
  add constraint diagnostic_events_error_name
    check (error_name is null or error_name ~ '^[A-Za-z][A-Za-z0-9_]{0,39}$');

alter table public.diagnostic_events
  drop constraint if exists diagnostic_events_fingerprint,
  add constraint diagnostic_events_fingerprint
    check (fingerprint is null
           or (fingerprint ~ '^[A-Za-z]+( [A-Za-z]+)*$' and length(fingerprint) <= 120));

alter table public.diagnostic_events
  drop constraint if exists diagnostic_events_frames,
  add constraint diagnostic_events_frames
    check (frames is null
           or (frames ~ '^[A-Za-z0-9_.$<>@:|-]+$' and length(frames) <= 600));

comment on column public.diagnostic_events.error_name is
  'Error constructor name only. No message.';
comment on column public.diagnostic_events.fingerprint is
  'Message reduced to ASCII letter runs; null when the message was refused whole.';
comment on column public.diagnostic_events.frames is
  'Redacted stack: fn@file:line:col, path directories dropped.';

commit;
