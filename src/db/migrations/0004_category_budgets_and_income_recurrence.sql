CREATE TABLE `category_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`category_id` text NOT NULL,
	`month` text NOT NULL,
	`amount_minor` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_budget_month_category` ON `category_budgets` (`month`,`category_id`);--> statement-breakpoint
ALTER TABLE `recurring_incomes` ADD `recurrence` text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring_incomes` ADD `anchor_date` text;