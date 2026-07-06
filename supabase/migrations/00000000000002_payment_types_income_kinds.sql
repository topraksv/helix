-- Faz 2: wider payment source types + recurring income kinds.
-- Run in the Supabase SQL Editor (mirrors local migration 0001).

alter table payment_sources drop constraint if exists payment_sources_type_check;
alter table payment_sources
  add constraint payment_sources_type_check
  check (type in ('credit_card','debit_card','virtual_card','e_wallet','cash','direct_debit','bank_transfer'));

alter table recurring_incomes
  add column if not exists kind text not null default 'salary';
alter table recurring_incomes drop constraint if exists recurring_incomes_kind_check;
alter table recurring_incomes
  add constraint recurring_incomes_kind_check
  check (kind in ('salary','rent','allowance','other'));
