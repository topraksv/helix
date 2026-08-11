-- Installment plans materialize transactions directly. Older clients could
-- leave derived installment/loan expected rows behind; retire those live
-- derivatives while preserving their tombstones for sync and backup recovery.
UPDATE `expected_payments`
SET `deleted_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `deleted_at` IS NULL
  AND `kind` IN ('installment', 'loan');
--> statement-breakpoint
UPDATE `expected_payments`
SET `tombstone_version` = CASE WHEN `tombstone_version` < 1 THEN 1 ELSE `tombstone_version` END
WHERE `deleted_at` IS NOT NULL
  AND `kind` IN ('installment', 'loan');
