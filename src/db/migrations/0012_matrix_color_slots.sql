-- Mali Tablo's contextual marks became four hue-named slots.
--
-- The five meaning-named tokens are rewritten in place rather than dropped: a
-- mark the owner made is invisible once it stops resolving, so a lost row is a
-- silently unmarked cell. `neutral` and `info` both meant "look at this", which
-- is what yellow now says.
--
-- No `updated_at` bump and no tombstone: this is the same mark under its new
-- name, not an edit. The server migration applies the identical mapping, so the
-- two sides converge without either pushing a change at the other.
UPDATE `matrix_colors`
SET `token` = CASE `token`
  WHEN 'critical' THEN 'red'
  WHEN 'warning' THEN 'orange'
  WHEN 'neutral' THEN 'yellow'
  WHEN 'info' THEN 'yellow'
  WHEN 'success' THEN 'green'
  ELSE `token`
END
WHERE `token` IN ('critical', 'warning', 'neutral', 'info', 'success');
