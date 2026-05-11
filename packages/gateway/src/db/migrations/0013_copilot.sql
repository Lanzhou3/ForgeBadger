CREATE TABLE `copilot_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`provider_profile_id` text,
	`model_profile_id` text,
	`source` text NOT NULL,
	`source_ref_id` text,
	`goal` text NOT NULL,
	`step_count` integer DEFAULT 0 NOT NULL,
	`max_steps` integer DEFAULT 8 NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` integer,
	`updated_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_profile_id`) REFERENCES `model_provider_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`model_profile_id`) REFERENCES `model_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_runs_user_created` ON `copilot_runs` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `copilot_run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`run_id` text NOT NULL,
	`type` text NOT NULL,
	`sequence` integer NOT NULL,
	`message` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `copilot_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_copilot_run_events_run_sequence` ON `copilot_run_events` (`run_id`,`sequence`);
--> statement-breakpoint
CREATE TABLE `copilot_pending_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`run_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`result_json` text,
	`approved_by` text,
	`approved_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `copilot_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_pending_actions_run` ON `copilot_pending_actions` (`run_id`,`status`);
