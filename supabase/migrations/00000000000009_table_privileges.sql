-- Make the table privilege model reproducible from migrations.
--
-- Every RLS policy in migration 6 is written `to authenticated`, but RLS only
-- filters ROWS — it cannot grant the table privilege needed to reach them. The
-- hosted project was created when Supabase's default privileges still granted
-- DML on new public tables to anon/authenticated, so the app worked there and
-- nothing in these migrations ever had to say so. A database rebuilt from this
-- history on a current Supabase image gets only Dxtm (truncate/references/
-- trigger/maintain) and the application cannot read or write a single row.
--
-- That is why `supabase test db` could not run: the pgTAP suite died on its
-- third assertion with "permission denied for table persons". It also explains
-- the lone `grant select, insert, update, delete on table
-- public.category_budgets to authenticated` in migration 7 — that table was
-- added later, hit this, and was patched alone.
--
-- Privileges are stated explicitly here so local, CI and remote agree:
--
--   authenticated : row-level DML, constrained per row by the existing
--                   owner-only policies.
--   anon          : nothing. Every policy is `to authenticated`, so an
--                   anonymous caller already matched zero rows; removing the
--                   grant makes that a refusal instead of a silent empty
--                   result, and follows the precedent migration 7 set with
--                   `revoke all on table public.category_budgets from anon`.
--   service_role  : full access. It bypasses RLS by design and is used only
--                   by the keepalive workflow's server-side key.
--
-- No policy, constraint or row is touched.

begin;

do $$
declare
  t text;
begin
  foreach t in array array[
    'persons','payment_sources','categories','computed_columns',
    'installment_plans','credit_card_statements','transactions',
    'subscriptions','price_history','recurring_incomes','expected_payments',
    'balance_adjustments','cell_notes','settings','fx_rates','category_budgets'
  ] loop
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- `keep_alive` is not user data and has no owner column: the scheduled
-- heartbeat upserts one fixed row with the service-role key so the free-tier
-- project never pauses. No client role needs it.
revoke all on table public.keep_alive from anon;
revoke all on table public.keep_alive from authenticated;
grant all on table public.keep_alive to service_role;

commit;
