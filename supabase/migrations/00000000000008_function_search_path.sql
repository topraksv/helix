-- Pin the search_path of the shared updated_at trigger function.
--
-- Supabase's database linter reports `set_updated_at` under
-- 0011_function_search_path_mutable: the function resolves unqualified names
-- through whatever search_path the calling session happens to have.
--
-- Severity here is low and it is worth being precise about why, so this is not
-- mistaken for a privilege-escalation fix: `set_updated_at` is SECURITY
-- INVOKER (the default), so it already runs with the caller's own rights and
-- shadowing `now()` would only affect the session doing the shadowing. The
-- real reason to pin it is determinism — every table's updated_at feeds
-- last-write-wins sync ordering, and that timestamp must not depend on the
-- caller's search_path.
--
-- `search_path = ''` means nothing is resolved implicitly, so `now()` has to be
-- schema-qualified. `new` is a PL/pgSQL record variable and is unaffected.
-- `create or replace` keeps the identity and signature, so every existing
-- `set_updated_at` trigger keeps pointing at this function and no trigger has
-- to be recreated.
--
-- NOT YET APPLIED to the linked project: this repository's toolchain has no
-- Supabase CLI, Docker or psql available, and applying migrations to the live
-- database is an explicit, separately authorized step. Until it is applied,
-- `supabase migration list --linked` will show this version as local-only.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end $$;
