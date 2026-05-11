CREATE TABLE `copilot_memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`source_run_id` text,
	`redacted_text` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_run_id`) REFERENCES `copilot_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_memory_entries_user_scope` ON `copilot_memory_entries` (`user_id`,`scope`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_copilot_memory_entries_user_project` ON `copilot_memory_entries` (`user_id`,`project_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `copilot_memory_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`session_id` text,
	`source_run_id` text,
	`redacted_text` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_run_id`) REFERENCES `copilot_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_memory_notes_user_created` ON `copilot_memory_notes` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_copilot_memory_notes_user_project` ON `copilot_memory_notes` (`user_id`,`project_id`,`created_at`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `copilot_memory_fts` USING fts5(
	`memory_id` UNINDEXED,
	`user_id` UNINDEXED,
	`item_type` UNINDEXED,
	`scope` UNINDEXED,
	`project_id` UNINDEXED,
	`redacted_text`
);
