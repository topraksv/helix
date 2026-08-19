-- Mali Tablo's contextual marks became four hue-named slots.
--
-- The slots carry the owner's own names now (stored account-wide in
-- `settings.matrix_color_labels`), so a token called `success` that a person
-- has renamed "Ödenmedi" would be a lie in the column. The identifier claims
-- only the hue, which is the one thing the client can promise.
--
-- Order matters: the check has to go before the rewrite, or the update is
-- refused by the constraint it is preparing to replace.

alter table public.matrix_colors
  drop constraint if exists matrix_colors_token_check;

-- `neutral` and `info` both meant "look at this", which is what yellow says.
-- Rewritten in place, with no `updated_at` bump: this is the same mark under a
-- new name, and touching the timestamp would push a change at every client for
-- a row none of them edited.
update public.matrix_colors
set token = case token
  when 'critical' then 'red'
  when 'warning' then 'orange'
  when 'neutral' then 'yellow'
  when 'info' then 'yellow'
  when 'success' then 'green'
  else token
end
where token in ('critical', 'warning', 'neutral', 'info', 'success');

-- EXPAND, not replace. Migrations here are backward-compatible with the
-- installed client, and this one cannot be: the rows above are rewritten the
-- moment it runs, but a client that has not taken the update yet — a web tab
-- left open, a phone before its OTA — still writes the five meaning-named
-- tokens. A four-token check would reject those pushes, and a rejected push
-- throws for the whole batch (`sync/engine.ts`), so one stale tab would stop
-- that device syncing anything at all, not just colours.
--
-- So both generations are accepted while both may be running. The client is
-- already strict on the way out (`isMatrixColorToken` admits only the four)
-- and forgiving on the way in (`normalizeMatrixColorToken` folds the legacy
-- five), so a legacy token can arrive but can never originate here.
--
-- CONTRACT once no client older than this release is in use: drop the five
-- legacy names from the check. Nothing writes them by then, and the rewrite
-- above means no row carries one.
alter table public.matrix_colors
  add constraint matrix_colors_token_check
  check (token in (
    'red', 'orange', 'yellow', 'green',
    'critical', 'warning', 'neutral', 'info', 'success'
  ));
