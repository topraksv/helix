-- Keep the direct PostgREST acceptance boundary inside the same finite domain
-- as the offline client. Otherwise an authenticated malformed write can be
-- valid in Postgres but permanently rejected by every client's pull cursor.

begin;

-- The product deliberately stays below Number.MAX_SAFE_INTEGER so sums and
-- formatting retain exact minor units across JavaScript, SQLite and Postgres.
alter table public.transactions
  drop constraint tx_amount_minor_bounds,
  drop constraint tx_amount_try_minor_bounds,
  add constraint tx_amount_minor_bounds
    check (amount_minor between -99999999999999 and 99999999999999 and amount_minor <> 0),
  add constraint tx_amount_try_minor_bounds
    check (amount_try_minor between -99999999999999 and 99999999999999 and amount_try_minor <> 0),
  add constraint tx_amount_sign_consistency
    check ((amount_minor > 0) = (amount_try_minor > 0)),
  add constraint transactions_fx_rate_bounds
    check (fx_rate is null or fx_rate > 0 and fx_rate <= 1000000);

alter table public.installment_plans
  drop constraint plan_total_amount_minor_bounds,
  drop constraint plan_monthly_amount_minor_bounds,
  drop constraint installment_plans_installment_count_check,
  drop constraint installment_plans_start_month_check,
  add constraint plan_total_amount_minor_bounds
    check (total_amount_minor is null or total_amount_minor between 1 and 99999999999999),
  add constraint plan_monthly_amount_minor_bounds
    check (monthly_amount_minor is null or monthly_amount_minor between 1 and 99999999999999),
  add constraint installment_plans_installment_count_check
    check (installment_count between 1 and 600),
  add constraint installment_plans_start_month_check
    check (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$');

alter table public.subscriptions
  drop constraint sub_amount_minor_bounds,
  drop constraint subscriptions_interval_months_check,
  add constraint sub_amount_minor_bounds
    check (amount_minor between 1 and 99999999999999),
  add constraint subscriptions_interval_months_check
    check (interval_months between 1 and 12);

alter table public.price_history
  drop constraint price_amount_minor_bounds,
  add constraint price_amount_minor_bounds
    check (amount_minor between 1 and 99999999999999);

alter table public.recurring_incomes
  drop constraint income_amount_minor_bounds,
  add constraint income_amount_minor_bounds
    check (default_amount_minor between 1 and 99999999999999);

alter table public.expected_payments
  drop constraint expected_amount_minor_bounds,
  add constraint expected_amount_minor_bounds
    check (amount_minor between 1 and 99999999999999);

alter table public.balance_adjustments
  drop constraint adjustment_amount_minor_bounds,
  add constraint adjustment_amount_minor_bounds
    check (amount_minor between -99999999999999 and 99999999999999);

alter table public.category_budgets
  drop constraint category_budgets_amount_minor_check,
  add constraint category_budgets_amount_minor_check
    check (amount_minor between 1 and 99999999999999);

alter table public.fx_rates
  add constraint fx_rates_rate_try_bounds
    check (rate_try > 0 and rate_try <= 1000000);

alter table public.investment_operations
  drop constraint investment_operations_quantity_check,
  add constraint investment_operations_quantity_check check (
    (
      quantity is null
      and kind = 'contribution'
      and unit_price_minor is null
    )
    or (
      quantity is not null
      and char_length(quantity) <= 30
      and quantity ~ '^[0-9]+(\.[0-9]{1,8})?$'
      and quantity::numeric > 0
      and quantity::numeric <= 999999999999
      and unit_price_minor between 1 and 99999999999999
    )
  );

-- The client keeps exact quantities as 1e-8 atoms, exact minor-unit cost and
-- an exact final realized result. Bound the replayed graph, not just one row:
-- otherwise individually valid direct API writes can combine into a state no
-- supported client can calculate. Amount-only pension contributions
-- intentionally make quantity unknown, matching the client projector.
do $$
begin
  if exists (
    select 1
    from public.investment_profiles p
    where p.deleted_at is null
      and private.investment_cash(p.user_id) not between 0 and 99999999999999
  ) then
    raise check_violation using message = 'Existing investment cash exceeds the client domain';
  end if;
  if exists (
    select 1
    from public.investment_operations
    where deleted_at is null
    group by user_id
    having sum(case
      when kind = 'sell' then -cost_basis_minor::numeric
      else total_minor::numeric
    end) > 99999999999999
  ) then
    raise check_violation using message = 'Existing investment cost exceeds the client domain';
  end if;
  if exists (
    select 1
    from public.investment_operations
    where deleted_at is null
    group by user_id, product_id
    having pg_catalog.abs(sum(realized_profit_loss_minor::numeric)) > 9007199254740991
  ) or exists (
    select 1
    from public.investment_operations
    where deleted_at is null
    group by user_id
    having pg_catalog.abs(sum(realized_profit_loss_minor::numeric)) > 9007199254740991
  ) then
    raise check_violation using message = 'Existing investment result exceeds the exact client domain';
  end if;
  if exists (
    select 1
    from (
      select
        bool_or(quantity is null) over journal as quantity_unknown,
        sum(case
          when quantity is null then 0::numeric
          when kind = 'sell' then -quantity::numeric
          else quantity::numeric
        end) over journal as holding_quantity,
        sum(case
          when kind = 'sell' then -cost_basis_minor::numeric
          else total_minor::numeric
        end) over journal as holding_cost
      from public.investment_operations
      where deleted_at is null
      window journal as (
        partition by user_id, product_id
        order by operation_date, private.investment_operation_order(kind), id
        rows between unbounded preceding and current row
      )
    ) replay
    where (not quantity_unknown and holding_quantity not between 0 and 999999999999)
      or holding_cost not between 0 and 99999999999999
  ) then
    raise check_violation using message = 'Existing investment holding exceeds the client domain';
  end if;
end $$;

create or replace function private.guard_investment_state_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  movement record;
  holding_quantity numeric := 0;
  holding_cost numeric := 0;
  expected_cost numeric;
  product_realized numeric := 0;
  projected_cost numeric := 0;
  projected_realized numeric := 0;
  valid_graph boolean := true;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 1107296257)
  );

  for movement in
    select *
    from (
      select o.id, o.kind, o.operation_date, o.quantity, o.total_minor
      from public.investment_operations o
      where o.user_id = new.user_id
        and o.product_id = new.product_id
        and o.id <> new.id
        and o.deleted_at is null
      union all
      select new.id, new.kind, new.operation_date, new.quantity, new.total_minor
      where new.deleted_at is null
    ) journal
    order by operation_date, private.investment_operation_order(kind), id
  loop
    if movement.kind = 'sell' then
      if holding_quantity is null
        or movement.quantity is null
        or movement.quantity::numeric > holding_quantity
      then
        valid_graph := false;
        exit;
      end if;
      expected_cost := case
        when movement.quantity::numeric = holding_quantity then holding_cost
        else pg_catalog.round(
          holding_cost * movement.quantity::numeric / holding_quantity
        )
      end;
      holding_quantity := holding_quantity - movement.quantity::numeric;
      holding_cost := holding_cost - expected_cost;
      product_realized := product_realized + movement.total_minor::numeric - expected_cost;
    else
      holding_cost := holding_cost + movement.total_minor::numeric;
      if movement.quantity is null then
        holding_quantity := null;
      elsif holding_quantity is not null then
        holding_quantity := holding_quantity + movement.quantity::numeric;
      end if;
    end if;
    if holding_cost not between 0 and 99999999999999
      or (holding_quantity is not null and holding_quantity > 999999999999)
    then
      valid_graph := false;
      exit;
    end if;
  end loop;

  select coalesce(sum(case
    when kind = 'sell' then -cost_basis_minor::numeric
    else total_minor::numeric
  end), 0)
  into projected_cost
  from public.investment_operations
  where user_id = new.user_id
    and product_id <> new.product_id
    and deleted_at is null;
  projected_cost := projected_cost + holding_cost;

  select coalesce(sum(realized_profit_loss_minor::numeric), 0)
  into projected_realized
  from public.investment_operations
  where user_id = new.user_id
    and product_id <> new.product_id
    and deleted_at is null;
  projected_realized := projected_realized + product_realized;
  if projected_cost not between 0 and 99999999999999
    or pg_catalog.abs(product_realized) > 9007199254740991
    or pg_catalog.abs(projected_realized) > 9007199254740991
  then
    valid_graph := false;
  end if;

  if valid_graph then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.deleted_at := pg_catalog.now();
    new.tombstone_version := greatest(new.tombstone_version, 1::bigint);
    return new;
  end if;
  new := old;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger ab_guard_investment_state_limits
before insert or update on public.investment_operations
for each row execute function private.guard_investment_state_limits();

revoke all on function private.guard_investment_state_limits()
  from public, anon, authenticated, service_role;

-- Sales can increase wallet cash just as transfers do. The historical
-- operation guard rejected only negative cash, so individually valid sales
-- could combine into a value no client can represent. Run this narrow upper
-- bound before the existing holding/cost projector.
create or replace function private.guard_investment_cash_upper()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_cash bigint;
  projected_cash bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 1107296257)
  );
  current_cash := private.investment_cash(new.user_id);
  if current_cash is null then
    return new;
  end if;
  projected_cash := current_cash
    - case when tg_op = 'UPDATE'
      then private.investment_operation_cash_effect(old.kind, old.total_minor, old.deleted_at)
      else 0 end
    + private.investment_operation_cash_effect(new.kind, new.total_minor, new.deleted_at);
  if projected_cash <= 99999999999999 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.deleted_at := pg_catalog.now();
    new.tombstone_version := greatest(new.tombstone_version, 1::bigint);
    return new;
  end if;
  new := old;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger a0_guard_investment_cash_upper
before insert or update on public.investment_operations
for each row execute function private.guard_investment_cash_upper();

revoke all on function private.guard_investment_cash_upper()
  from public, anon, authenticated, service_role;

-- Every currency rendered by the client is intentionally curated. Unknown
-- codes are not harmless labels: they make conversion undefined and the row
-- is rejected by the sync/restore boundary.
alter table public.installment_plans add constraint installment_plans_currency_supported
  check (currency in ('TRY','USD','EUR','GBP','CHF','JPY','AUD','CAD','SEK','NOK','DKK','CNY','KRW','RON','RUB','AED','SAR','AZN','KWD','ALL','BGN','GEL'));
alter table public.transactions add constraint transactions_currency_supported
  check (currency in ('TRY','USD','EUR','GBP','CHF','JPY','AUD','CAD','SEK','NOK','DKK','CNY','KRW','RON','RUB','AED','SAR','AZN','KWD','ALL','BGN','GEL'));
alter table public.subscriptions add constraint subscriptions_currency_supported
  check (currency in ('TRY','USD','EUR','GBP','CHF','JPY','AUD','CAD','SEK','NOK','DKK','CNY','KRW','RON','RUB','AED','SAR','AZN','KWD','ALL','BGN','GEL'));
alter table public.price_history add constraint price_history_currency_supported
  check (currency in ('TRY','USD','EUR','GBP','CHF','JPY','AUD','CAD','SEK','NOK','DKK','CNY','KRW','RON','RUB','AED','SAR','AZN','KWD','ALL','BGN','GEL'));
alter table public.recurring_incomes add constraint recurring_incomes_currency_supported
  check (currency in ('TRY','USD','EUR','GBP','CHF','JPY','AUD','CAD','SEK','NOK','DKK','CNY','KRW','RON','RUB','AED','SAR','AZN','KWD','ALL','BGN','GEL'));
alter table public.expected_payments add constraint expected_payments_currency_supported
  check (currency in ('TRY','USD','EUR','GBP','CHF','JPY','AUD','CAD','SEK','NOK','DKK','CNY','KRW','RON','RUB','AED','SAR','AZN','KWD','ALL','BGN','GEL'));
alter table public.fx_rates add constraint fx_rates_currency_supported
  check (currency in ('TRY','USD','EUR','GBP','CHF','JPY','AUD','CAD','SEK','NOK','DKK','CNY','KRW','RON','RUB','AED','SAR','AZN','KWD','ALL','BGN','GEL'));

-- Bound user-controlled text at the same limits enforced by repositories.
alter table public.persons add constraint persons_name_shape
  check (deleted_at is not null or char_length(btrim(name)) between 1 and 120) not valid;
alter table public.payment_sources
  add constraint payment_sources_name_shape check (deleted_at is not null or char_length(btrim(name)) between 1 and 120) not valid,
  add constraint payment_sources_color_length check (deleted_at is not null or color is null or char_length(color) <= 64) not valid,
  add constraint payment_sources_logo_ref_length check (deleted_at is not null or logo_ref is null or char_length(logo_ref) <= 512) not valid;
alter table public.categories
  add constraint categories_name_shape check (deleted_at is not null or char_length(btrim(name)) between 1 and 120) not valid,
  add constraint categories_icon_length check (deleted_at is not null or icon is null or char_length(icon) <= 64) not valid,
  add constraint categories_color_length check (deleted_at is not null or color is null or char_length(color) <= 64) not valid;
alter table public.computed_columns add constraint computed_columns_name_shape
  check (deleted_at is not null or char_length(btrim(name)) between 1 and 120) not valid;
alter table public.installment_plans
  add constraint installment_plans_title_shape check (deleted_at is not null or char_length(btrim(title)) between 1 and 120) not valid,
  add constraint installment_plans_note_length check (deleted_at is not null or note is null or char_length(note) <= 1000) not valid;
alter table public.transactions add constraint transactions_note_length
  check (deleted_at is not null or note is null or char_length(note) <= 1000) not valid;
alter table public.subscriptions
  add constraint subscriptions_name_shape check (deleted_at is not null or char_length(btrim(name)) between 1 and 120) not valid,
  add constraint subscriptions_website_domain_length check (deleted_at is not null or website_domain is null or char_length(website_domain) <= 512) not valid,
  add constraint subscriptions_logo_ref_length check (deleted_at is not null or logo_ref is null or char_length(logo_ref) <= 512) not valid,
  add constraint subscriptions_note_length check (deleted_at is not null or note is null or char_length(note) <= 1000) not valid;
alter table public.recurring_incomes
  add constraint recurring_incomes_name_shape check (deleted_at is not null or char_length(btrim(name)) between 1 and 120) not valid,
  add constraint recurring_incomes_note_length check (deleted_at is not null or note is null or char_length(note) <= 1000) not valid;
alter table public.balance_adjustments add constraint balance_adjustments_note_length
  check (deleted_at is not null or note is null or char_length(note) <= 1000) not valid;
alter table public.cell_notes
  drop constraint cell_notes_month_check,
  add constraint cell_notes_month_check check (month ~ '^(000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3})-(0[1-9]|1[0-2])$'),
  add constraint cell_notes_body_length check (deleted_at is not null or char_length(body) <= 1000) not valid;
alter table public.category_budgets
  drop constraint category_budgets_month_check,
  add constraint category_budgets_month_check check (month ~ '^(000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3})-(0[1-9]|1[0-2])$');
alter table public.credit_card_statements
  drop constraint credit_card_statements_period_month_check,
  add constraint credit_card_statements_period_month_check check (period_month ~ '^(000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3})-(0[1-9]|1[0-2])$');
alter table public.installment_plans
  drop constraint installment_plans_start_month_check,
  add constraint installment_plans_start_month_check check (start_month ~ '^(000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3})-(0[1-9]|1[0-2])$');
alter table public.settings
  add constraint settings_key_shape check (deleted_at is not null or char_length(btrim(key)) between 1 and 120) not valid,
  add constraint settings_value_length check (deleted_at is not null or char_length(value) <= 50000) not valid,
  add constraint settings_value_json check (value is json);

-- Postgres accepts +/-infinity for date/timestamp columns; JSON clients do
-- not. Cap delete generations as well so they remain exact JS integers.
do $$
declare
  t text;
begin
  foreach t in array array[
    'persons','categories','category_budgets','investment_profiles',
    'investment_products','payment_sources','computed_columns',
    'installment_plans','credit_card_statements','subscriptions','transactions',
    'investment_operations','price_history','recurring_incomes',
    'expected_payments','balance_adjustments','cell_notes','settings','fx_rates'
  ] loop
    execute format(
      'alter table public.%I add constraint %I check (
         pg_catalog.isfinite(created_at) and pg_catalog.isfinite(updated_at)
         and (deleted_at is null or pg_catalog.isfinite(deleted_at))
         and created_at between timestamptz ''0001-01-01 00:00:00+00'' and timestamptz ''9999-12-31 23:59:59.999999+00''
         and updated_at between timestamptz ''0001-01-01 00:00:00+00'' and timestamptz ''9999-12-31 23:59:59.999999+00''
         and (deleted_at is null or deleted_at between timestamptz ''0001-01-01 00:00:00+00'' and timestamptz ''9999-12-31 23:59:59.999999+00'')
         and tombstone_version <= 9007199254740991
       )',
      t,
      t || '_sync_scalar_bounds'
    );
  end loop;
end $$;

alter table public.credit_card_statements add constraint credit_card_statements_finite_dates
  check (
    pg_catalog.isfinite(statement_date) and pg_catalog.isfinite(due_date)
    and statement_date between date '0001-01-01' and date '9999-12-31'
    and due_date between date '0001-01-01' and date '9999-12-31'
  );
alter table public.transactions add constraint transactions_finite_dates
  check (
    pg_catalog.isfinite(entry_date) and pg_catalog.isfinite(effective_date)
    and (purchase_date is null or pg_catalog.isfinite(purchase_date))
    and entry_date between date '0001-01-01' and date '9999-12-31'
    and effective_date between date '0001-01-01' and date '9999-12-31'
    and (purchase_date is null or purchase_date between date '0001-01-01' and date '9999-12-31')
  );
alter table public.subscriptions add constraint subscriptions_finite_dates
  check (
    pg_catalog.isfinite(next_due_date)
    and (trial_end_date is null or pg_catalog.isfinite(trial_end_date))
    and (canceled_at is null or pg_catalog.isfinite(canceled_at))
    and next_due_date between date '0001-01-01' and date '9999-12-31'
    and (trial_end_date is null or trial_end_date between date '0001-01-01' and date '9999-12-31')
    and (canceled_at is null or canceled_at between timestamptz '0001-01-01 00:00:00+00' and timestamptz '9999-12-31 23:59:59.999999+00')
  );
alter table public.price_history add constraint price_history_finite_date
  check (pg_catalog.isfinite(effective_from) and effective_from between date '0001-01-01' and date '9999-12-31');
alter table public.recurring_incomes add constraint recurring_incomes_finite_anchor
  check (anchor_date is null or pg_catalog.isfinite(anchor_date) and anchor_date between date '0001-01-01' and date '9999-12-31');
alter table public.expected_payments add constraint expected_payments_finite_dates
  check (
    pg_catalog.isfinite(due_date) and due_date between date '0001-01-01' and date '9999-12-31'
    and (paid_at is null or pg_catalog.isfinite(paid_at) and paid_at between timestamptz '0001-01-01 00:00:00+00' and timestamptz '9999-12-31 23:59:59.999999+00')
  );
alter table public.balance_adjustments add constraint balance_adjustments_finite_date
  check (pg_catalog.isfinite(date) and date between date '0001-01-01' and date '9999-12-31');
alter table public.fx_rates add constraint fx_rates_finite_date
  check (pg_catalog.isfinite(rate_date) and rate_date between date '0001-01-01' and date '9999-12-31');
alter table public.investment_profiles add constraint investment_profiles_finite_date
  check (
    pg_catalog.isfinite(started_on)
    and started_on between date '0001-01-01' and current_date
  );
alter table public.investment_operations add constraint investment_operations_finite_date
  check (
    pg_catalog.isfinite(operation_date)
    and operation_date between date '0001-01-01' and current_date
  );

create or replace function private.valid_computed_definition(p_definition jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  op text;
  key_count integer;
  ids jsonb;
begin
  if pg_catalog.jsonb_typeof(p_definition) <> 'object' then return false; end if;
  op := p_definition ->> 'op';
  select pg_catalog.count(*) into key_count from pg_catalog.jsonb_object_keys(p_definition);

  if op = 'income_minus_expense' then
    return key_count = 1;
  elsif op = 'cc_split' then
    return key_count = 2 and p_definition ->> 'part' in ('single', 'installment');
  elsif op = 'sum' then
    if key_count <> 2 or pg_catalog.jsonb_typeof(p_definition -> 'categoryIds') <> 'array' then return false; end if;
    ids := p_definition -> 'categoryIds';
    if pg_catalog.jsonb_array_length(ids) not between 1 and 500 then return false; end if;
  elsif op = 'difference' then
    if key_count <> 3
      or pg_catalog.jsonb_typeof(p_definition -> 'plusCategoryIds') <> 'array'
      or pg_catalog.jsonb_typeof(p_definition -> 'minusCategoryIds') <> 'array'
    then return false; end if;
    if pg_catalog.jsonb_array_length(p_definition -> 'plusCategoryIds') not between 1 and 500
      or pg_catalog.jsonb_array_length(p_definition -> 'minusCategoryIds') not between 1 and 500
    then return false; end if;
    ids := (p_definition -> 'plusCategoryIds') || (p_definition -> 'minusCategoryIds');
  else
    return false;
  end if;

  return not exists (
      select 1
      from pg_catalog.jsonb_array_elements(ids) as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'string'
        or item.value #>> '{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    )
    and (
      select pg_catalog.count(*) = pg_catalog.count(distinct item.value #>> '{}')
      from pg_catalog.jsonb_array_elements(ids) as item(value)
    );
end;
$$;

-- Fail deployment instead of silently retaining a row no supported client can
-- pull. Category references are checked separately because PostgreSQL CHECK
-- constraints cannot safely query another table.
do $$
declare
  row record;
  ids jsonb;
begin
  for row in select id, user_id, definition from public.computed_columns loop
    if not private.valid_computed_definition(row.definition) then
      raise check_violation using message = 'Existing computed-column definition is invalid';
    end if;
    ids := case row.definition ->> 'op'
      when 'sum' then row.definition -> 'categoryIds'
      when 'difference' then (row.definition -> 'plusCategoryIds') || (row.definition -> 'minusCategoryIds')
      else '[]'::jsonb
    end;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(ids) as item(category_id)
      where not exists (
        select 1 from public.categories c
        where c.user_id = row.user_id and c.id::text = item.category_id
      )
    ) then
      raise check_violation using message = 'Existing computed-column category has no matching owner';
    end if;
  end loop;
end $$;

create or replace function private.enforce_computed_definition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ids jsonb;
begin
  if not private.valid_computed_definition(new.definition) then
    raise exception 'Invalid computed-column definition' using errcode = '23514';
  end if;

  ids := case new.definition ->> 'op'
    when 'sum' then new.definition -> 'categoryIds'
    when 'difference' then (new.definition -> 'plusCategoryIds') || (new.definition -> 'minusCategoryIds')
    else '[]'::jsonb
  end;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(ids) as item(category_id)
    where not exists (
      select 1 from public.categories c
      where c.user_id = new.user_id and c.id::text = item.category_id
    )
  ) then
    raise exception 'Computed-column category must belong to the row owner'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_computed_definition
before insert or update of user_id, definition on public.computed_columns
for each row execute function private.enforce_computed_definition();

revoke all on function private.valid_computed_definition(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.enforce_computed_definition() from public, anon, authenticated, service_role;

commit;
