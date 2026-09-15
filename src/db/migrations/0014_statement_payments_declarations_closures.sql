CREATE TABLE `card_statement_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`statement_id` text NOT NULL,
	`paid_on` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`kind` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `idx_statement_payment_statement` ON `card_statement_payments` (`statement_id`);--> statement-breakpoint
ALTER TABLE `balance_adjustments` ADD `declared_minor` integer;--> statement-breakpoint
ALTER TABLE `installment_plans` ADD `closed_on` text;--> statement-breakpoint
ALTER TABLE `installment_plans` ADD `original_installment_count` integer;--> statement-breakpoint
ALTER TABLE `transactions` ADD `refund_of_transaction_id` text;--> statement-breakpoint
CREATE INDEX `idx_tx_refund_of` ON `transactions` (`refund_of_transaction_id`);