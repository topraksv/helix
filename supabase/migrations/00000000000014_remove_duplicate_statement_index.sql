-- The owner-aware unique constraint already provides this exact btree prefix.
-- Keeping the older non-unique copy doubles write and vacuum work without
-- offering the planner another access path.

begin;

drop index if exists public.idx_card_statement_user_source_period;

commit;
