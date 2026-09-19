-- 1.8.2: the second half of local migration 0013.
--
-- `setup_completed` was written once at wallet setup and read by nothing. The
-- client stopped sending it in 0013, so no live client writes it, and dropping it
-- here cannot reject a push (docs/RELEASE.md, "A column removed in two steps").

begin;

alter table public.investment_profiles drop column setup_completed;

commit;
