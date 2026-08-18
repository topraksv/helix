-- Provenance, attachments, contextual colours and allocation targets.
--
-- Four independent additions in one migration, because they are one client
-- release. Every one is additive and nullable or defaulted, so a client that
-- predates it keeps writing valid rows -- the forward-only,
-- backward-compatible rule in docs/RELEASE.md. Apply this BEFORE shipping the
-- client that writes these columns: the outbound sync policy derives its
-- allowed columns from the local schema, so the app would otherwise push a
-- column this database does not have.
--
-- Attachments store METADATA only. The bytes stay on the device that added
-- them: this pipeline carries PostgREST JSON, so a blob column would push whole
-- documents through it and replicate every document to every device. A device
-- that does not hold the file shows the row as unavailable rather than
-- pretending it is gone.
--
-- Colours are stored as TOKENS, not colours. The palette owns what a token
-- looks like in light and dark, so a marked cell cannot become a stored hex
-- value that a later palette change strands below its contrast floor.

begin;

-- A composite foreign key needs a unique key to point at, and `transactions`
-- has only `id`. `investment_products` already carries `unique (user_id, id)`
-- for exactly this reason; without the matching constraint here the
-- `attachments` foreign key below aborts the whole migration, the new columns
-- never reach the database, and every client that has them fails to push.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and conname = 'transactions_user_id_id_key'
  ) then
    alter table public.transactions add constraint transactions_user_id_id_key unique (user_id, id);
  end if;
end $$;

alter table public.transactions
  add column if not exists origin text
    constraint transactions_origin_check
    check (origin is null or origin in ('manual','spreadsheet','statement','expected')),
  add column if not exists import_key text
    constraint transactions_import_key_len
    check (import_key is null or char_length(import_key) between 1 and 240);

-- The identity that makes a repeated import idempotent. Partial, so the
-- overwhelming majority of hand-entered rows (null key) stay unconstrained.
create unique index if not exists transactions_user_import_key
  on public.transactions (user_id, import_key)
  where import_key is not null;

alter table public.investment_products
  add column if not exists target_weight_bp integer
    constraint investment_products_target_weight_check
    check (target_weight_bp is null or target_weight_bp between 0 and 10000);

create table if not exists public.attachments (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  transaction_id uuid not null,
  -- Bounded, and free of the characters that turn a display name into a path
  -- or a spoofed extension. This name is rendered in lists and written into an
  -- export manifest.
  file_name text not null
    constraint attachments_file_name_shape
    check (
      char_length(file_name) between 1 and 160
      and file_name not like '%/%'
      and file_name not like '%' || chr(92) || '%'
      and file_name !~ '[[:cntrl:]]'
    ),
  stored_name text not null
    constraint attachments_stored_name_shape
    check (stored_name ~ '^[A-Za-z0-9._-]{1,120}$'),
  mime_type text not null
    constraint attachments_mime_type_allowed
    check (mime_type in ('application/pdf','image/jpeg','image/png','image/heic','image/webp')),
  byte_size bigint not null check (byte_size between 1 and 26214400),
  kind text not null default 'other'
    check (kind in ('receipt','invoice','warranty','other')),
  constraint attachments_user_transaction_fk
    foreign key (user_id, transaction_id)
    references public.transactions (user_id, id)
    on delete cascade
);

create table if not exists public.matrix_colors (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  scope text not null check (scope in ('row','column','cell')),
  item_key text
    constraint matrix_colors_item_key_len
    check (item_key is null or char_length(item_key) between 1 and 120),
  month text
    constraint matrix_colors_month_shape
    check (month is null or month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  token text not null
    check (token in ('neutral','info','success','warning','critical')),
  -- A scope names exactly the coordinates it needs. Without this a "row"
  -- colour could carry a month and mean two different things to two client
  -- versions.
  constraint matrix_colors_scope_shape check (
    (scope = 'row' and item_key is not null and month is null)
    or (scope = 'column' and item_key is null and month is not null)
    or (scope = 'cell' and item_key is not null and month is not null)
  )
);

-- One colour per target: re-colouring updates rather than stacking rows that
-- disagree about what a cell is.
create unique index if not exists matrix_colors_user_target
  on public.matrix_colors (user_id, scope, coalesce(item_key, ''), coalesce(month, ''));

create index if not exists attachments_user_updated_id
  on public.attachments (user_id, updated_at, id);
create index if not exists attachments_user_transaction
  on public.attachments (user_id, transaction_id);
create index if not exists matrix_colors_user_updated_id
  on public.matrix_colors (user_id, updated_at, id);

alter table public.attachments enable row level security;
alter table public.matrix_colors enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['attachments','matrix_colors'] loop
    execute format(
      'create policy "%s_select_own" on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t, t
    );
    execute format(
      'create policy "%s_insert_own" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t, t
    );
    execute format(
      'create policy "%s_update_own" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t, t
    );
    execute format(
      'create trigger set_updated_at before insert or update on public.%I for each row execute function public.set_updated_at()',
      t
    );
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
  end loop;
end $$;

commit;
