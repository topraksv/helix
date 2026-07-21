ALTER TABLE `categories` ADD `is_transfer` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `categories`
SET `is_transfer` = 1
WHERE `kind` = 'expense'
  AND (
    lower(`name`) LIKE '%yatırım%'
    OR EXISTS (
      SELECT 1 FROM `transactions`
      WHERE `transactions`.`user_id` = `categories`.`user_id`
        AND `transactions`.`category_id` = `categories`.`id`
        AND `transactions`.`type` = 'transfer'
    )
  );
