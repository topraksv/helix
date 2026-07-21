CREATE INDEX `idx_outbox_table_id` ON `outbox` (`table_name`,`id`);--> statement-breakpoint
CREATE INDEX `idx_outbox_table_row_id_id` ON `outbox` (`table_name`,`row_id`,`id`);