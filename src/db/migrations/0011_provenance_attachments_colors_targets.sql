CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`transaction_id` text NOT NULL,
	`file_name` text NOT NULL,
	`stored_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_attachment_transaction` ON `attachments` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `matrix_colors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`scope` text NOT NULL,
	`item_key` text,
	`month` text,
	`token` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_matrix_color_lookup` ON `matrix_colors` (`scope`,`month`,`item_key`);--> statement-breakpoint
ALTER TABLE `investment_products` ADD `target_weight_bp` integer;--> statement-breakpoint
ALTER TABLE `transactions` ADD `origin` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `import_key` text;--> statement-breakpoint
CREATE INDEX `idx_tx_import_key` ON `transactions` (`import_key`);