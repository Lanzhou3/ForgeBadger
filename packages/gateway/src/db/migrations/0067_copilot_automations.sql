-- Scheduled Copilot automations: natural-language prompts that run on a
-- schedule (cron / interval / once) and deliver their result to the owner's
-- conversation + notifications. Runs are claimed via a lease (claim_token /
-- claim_expires_at) so overlapping ticks never double-execute a slot.
CREATE TABLE `copilot_automations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`scope_type` text NOT NULL,
	`scope_policy` text NOT NULL,
	`prompt` text NOT NULL,
	`schedule_kind` text NOT NULL,
	`schedule_expression` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`delivery_plan` text NOT NULL,
	`authority_snapshot` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_automations_user_status` ON `copilot_automations` (`user_id`,`status`,`next_run_at`);
--> statement-breakpoint
CREATE TABLE `copilot_automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`execution_id` text,
	`scheduled_slot` text NOT NULL,
	`trigger_kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`not_before` integer NOT NULL,
	`claim_token` text,
	`claim_expires_at` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`scope_snapshot` text,
	`generated_content_encrypted` text,
	`last_error_code` text,
	`last_error_message` text,
	`created_at` integer,
	`updated_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_id`) REFERENCES `copilot_automations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_copilot_automation_run_slot` ON `copilot_automation_runs` (`user_id`,`automation_id`,`scheduled_slot`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_copilot_automation_execution` ON `copilot_automation_runs` (`user_id`,`execution_id`);
--> statement-breakpoint
CREATE INDEX `idx_copilot_automation_run_due` ON `copilot_automation_runs` (`user_id`,`status`,`not_before`);
--> statement-breakpoint
CREATE TABLE `copilot_automation_run_projects` (
	`run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`project_name` text NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`run_id`,`project_id`),
	FOREIGN KEY (`run_id`) REFERENCES `copilot_automation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_automation_snapshot_user` ON `copilot_automation_run_projects` (`user_id`,`run_id`,`ordinal`);
--> statement-breakpoint
CREATE TABLE `copilot_automation_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`dedup_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`job_spec` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_copilot_automation_suggestion_dedup` ON `copilot_automation_suggestions` (`user_id`,`dedup_key`);
