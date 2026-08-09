-- Variable utility-style subscriptions keep a forecast on the rule and the
-- invoice amount on each expected occurrence. Existing rows are fixed and
-- known by default, so this is additive and preserves all existing history.

begin;

alter table public.subscriptions
  add column amount_mode text not null default 'fixed';

alter table public.subscriptions
  add constraint subscriptions_amount_mode_check
  check (amount_mode in ('fixed', 'variable'));

alter table public.expected_payments
  add column amount_is_estimated boolean not null default false;

commit;
