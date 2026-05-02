CREATE TABLE `plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`status` text DEFAULT 'disabled' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plugins_user_plugin` ON `plugins` (`user_id`,`plugin_id`);
