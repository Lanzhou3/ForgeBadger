CREATE TABLE `usage_sync_cursors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`adapter` text NOT NULL,
	`watermark` text DEFAULT '' NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_usage_sync_cursors_user_adapter` ON `usage_sync_cursors` (`user_id`,`adapter`);