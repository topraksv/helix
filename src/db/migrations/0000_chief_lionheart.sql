CREATE TABLE `balance_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`icon` text,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_column` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cell_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`month` text NOT NULL,
	`category_id` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `computed_columns` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`definition` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `expected_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`direction` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`due_date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`paid_at` text,
	`auto_confirmed` integer DEFAULT false NOT NULL,
	`transaction_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_expected_status_due` ON `expected_payments` (`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`currency` text NOT NULL,
	`rate_date` text NOT NULL,
	`rate_try` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `installment_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`total_amount_minor` integer,
	`monthly_amount_minor` integer,
	`installment_count` integer NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`start_month` text NOT NULL,
	`due_day` integer,
	`payment_source_id` text,
	`person_id` text NOT NULL,
	`category_id` text,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`table_name` text NOT NULL,
	`row_id` text NOT NULL,
	`op` text DEFAULT 'upsert' NOT NULL,
	`payload` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_idempotency_key_unique` ON `outbox` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `payment_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`person_id` text NOT NULL,
	`due_day` integer,
	`statement_day` integer,
	`color` text,
	`logo_source` text DEFAULT 'initials' NOT NULL,
	`logo_ref` text,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `persons` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`is_self` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`subscription_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`effective_from` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recurring_incomes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`default_amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`pay_day` integer NOT NULL,
	`person_id` text NOT NULL,
	`category_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`key` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`cycle` text NOT NULL,
	`interval_months` integer DEFAULT 1 NOT NULL,
	`billing_day` integer NOT NULL,
	`next_due_date` text NOT NULL,
	`payment_source_id` text,
	`category_id` text,
	`person_id` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`canceled_at` text,
	`trial_end_date` text,
	`auto_pay` integer DEFAULT false NOT NULL,
	`website_domain` text,
	`logo_source` text DEFAULT 'initials' NOT NULL,
	`logo_ref` text,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`table_name` text PRIMARY KEY NOT NULL,
	`last_pulled_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`type` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'TRY' NOT NULL,
	`fx_rate` text,
	`amount_try_minor` integer NOT NULL,
	`entry_date` text NOT NULL,
	`effective_date` text NOT NULL,
	`status` text NOT NULL,
	`category_id` text,
	`payment_source_id` text,
	`person_id` text NOT NULL,
	`installment_plan_id` text,
	`installment_no` integer,
	`subscription_id` text,
	`is_aggregate` integer DEFAULT false NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `idx_tx_effective` ON `transactions` (`effective_date`);--> statement-breakpoint
CREATE INDEX `idx_tx_category_effective` ON `transactions` (`category_id`,`effective_date`);--> statement-breakpoint
CREATE INDEX `idx_tx_plan` ON `transactions` (`installment_plan_id`);--> statement-breakpoint
CREATE INDEX `idx_tx_subscription` ON `transactions` (`subscription_id`);