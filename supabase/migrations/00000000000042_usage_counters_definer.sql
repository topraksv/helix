-- The two functions migration 41 routes every screen-count write through,
-- given the rights to make that write.
--
-- Migration 41 stopped the caller's grants at SELECT so that a count could
-- reach `usage_counters` only through `record_usage` and leave it only through
-- `purge_usage_counters`, and then declared both SECURITY INVOKER. An invoker
-- runs with the caller's grants, so every call failed with 42501 and not one
-- count was stored. Nothing noticed: the client swallows a refusal and keeps
-- its deltas for the next sync, so what it still holds goes up on the first
-- sync after this lands — up to the cap `src/services/usage.ts` puts on
-- pending pairs, past which new ones were dropped.
--
-- DEFINER is the pattern migrations 36 and 37 already use for the same shape.
-- It bypasses RLS, so each function scopes itself: `record_usage` writes only
-- `auth.uid()`'s rows and refuses a call without a session, and the purge
-- deletes only `auth.uid()`'s. `search_path` is pinned by migration 41.
-- `supabase/tests/owner_integrity_and_rls.sql` proves both, including that one
-- account's purge does not reach another's counts.
--
-- Reversible by `alter function … security invoker`, which would put back
-- exactly the refusal this removes.
begin;

alter function public.record_usage(jsonb) security definer;
alter function public.purge_usage_counters() security definer;

commit;
