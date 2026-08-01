CREATE TABLE `investment_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`product_id` text NOT NULL,
	`kind` text NOT NULL,
	`operation_date` text NOT NULL,
	`quantity` text,
	`unit_price_minor` integer,
	`total_minor` integer NOT NULL,
	`cost_basis_minor` integer DEFAULT 0 NOT NULL,
	`realized_profit_loss_minor` integer DEFAULT 0 NOT NULL,
	`note` text,
	`import_key` text
);
--> statement-breakpoint
CREATE INDEX `idx_investment_operations_product_date` ON `investment_operations` (`product_id`,`operation_date`);--> statement-breakpoint
CREATE INDEX `idx_investment_operations_date` ON `investment_operations` (`operation_date`);--> statement-breakpoint
CREATE TABLE `investment_products` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`asset_type` text NOT NULL,
	`name` text NOT NULL,
	`market_code` text,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `investment_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`started_on` text NOT NULL,
	`opening_cash_minor` integer NOT NULL,
	`setup_completed` integer DEFAULT false NOT NULL
);
