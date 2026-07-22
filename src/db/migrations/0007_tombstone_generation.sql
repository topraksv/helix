ALTER TABLE `balance_adjustments` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `category_budgets` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cell_notes` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `computed_columns` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `credit_card_statements` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `expected_payments` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `fx_rates` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `installment_plans` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_sources` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `persons` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `price_history` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring_incomes` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `tombstone_version` integer DEFAULT 0 NOT NULL;