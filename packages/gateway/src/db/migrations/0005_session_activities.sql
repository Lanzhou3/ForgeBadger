CREATE TABLE `session_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`project_id` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`metadata` text,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_session_activities_user_created` ON `session_activities` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_session_activities_session` ON `session_activities` (`user_id`,`session_id`);
--> statement-breakpoint
CREATE INDEX `idx_session_activities_project` ON `session_activities` (`user_id`,`project_id`);
