CREATE TABLE `session_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`project_id` text,
	`tmux_session` text,
	`model_id` text,
	`agent_id` text,
	`config_version` text,
	`metadata` text,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_session_snapshots_user_created` ON `session_snapshots` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_session_snapshots_session` ON `session_snapshots` (`user_id`,`session_id`);
--> statement-breakpoint
CREATE INDEX `idx_session_snapshots_project` ON `session_snapshots` (`user_id`,`project_id`);
