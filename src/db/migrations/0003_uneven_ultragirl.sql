CREATE TABLE `credit_card_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`payment_source_id` text NOT NULL,
	`period_month` text NOT NULL,
	`statement_date` text NOT NULL,
	`due_date` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_card_statement_source_period` ON `credit_card_statements` (`payment_source_id`,`period_month`);--> statement-breakpoint
CREATE INDEX `idx_card_statement_due` ON `credit_card_statements` (`due_date`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `purchase_date` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `card_statement_id` text;--> statement-breakpoint
CREATE INDEX `idx_tx_card_statement` ON `transactions` (`card_statement_id`);