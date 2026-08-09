ALTER TABLE `expected_payments` ADD `amount_is_estimated` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `amount_mode` text DEFAULT 'fixed' NOT NULL;