CREATE TABLE `token_usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`adapter` text NOT NULL,
	`session_id` text,
	`project_id` text,
	`project_path` text DEFAULT '' NOT NULL,
	`model_id` text,
	`request_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`source_file` text NOT NULL,
	`watermark` text DEFAULT '' NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_token_usage_user_adapter_request` ON `token_usage_records` (`user_id`,`adapter`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_token_usage_user_adapter_occurred` ON `token_usage_records` (`user_id`,`adapter`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_token_usage_user_project_occurred` ON `token_usage_records` (`user_id`,`project_path`,`occurred_at`);