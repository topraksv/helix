-- A category's month-table financial behavior is persisted explicitly. Name-
-- based inference made renaming "Yatırım" silently turn future transfers into
-- spending (and let unrelated similarly named categories become transfers).

begin;

alter table public.categories
  add column is_transfer boolean not null default false,
  add constraint categories_transfer_kind_check
    check (not is_transfer or kind = 'expense');

update public.categories c
set is_transfer = true
where c.kind = 'expense'
  and (
    c.name ilike '%yatırım%'
    or exists (
      select 1 from public.transactions t
      where t.user_id = c.user_id
        and t.category_id = c.id
        and t.type = 'transfer'
    )
  );

commit;
