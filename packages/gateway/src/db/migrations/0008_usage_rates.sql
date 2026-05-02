CREATE TABLE `model_cost_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`model_id` text NOT NULL,
	`hourly_rate_usd` real DEFAULT 0 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_cost_rates_user_model` ON `model_cost_rates` (`user_id`,`model_id`);
