CREATE TABLE `project_manager_task_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`work_item_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`desired_state` text DEFAULT 'prepared' NOT NULL,
	`observed_state` text DEFAULT 'prepared' NOT NULL,
	`input_version` integer DEFAULT 1 NOT NULL,
	`input_digest` text NOT NULL,
	`active_slot` text,
	`failure_code` text,
	`failure_message` text,
	`reconcile_count` integer DEFAULT 0 NOT NULL,
	`decision_count` integer DEFAULT 0 NOT NULL,
	`follow_up_count` integer DEFAULT 0 NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`deadline_at` integer,
	`created_at` integer,
	`updated_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_item_id`) REFERENCES `project_manager_work_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_manager_task_attempts_work_item_number` ON `project_manager_task_attempts` (`user_id`,`work_item_id`,`attempt_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_manager_task_attempts_user_active` ON `project_manager_task_attempts` (`user_id`,`active_slot`);
--> statement-breakpoint
CREATE TABLE `project_manager_session_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`work_item_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`session_id` text NOT NULL,
	`adapter` text NOT NULL,
	`capabilities_json` text DEFAULT '{}' NOT NULL,
	`lease_token` text NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`active_slot` text,
	`released_reason` text,
	`created_at` integer,
	`updated_at` integer,
	`released_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_item_id`) REFERENCES `project_manager_work_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `project_manager_task_attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_session_assignments_attempt` ON `project_manager_session_assignments` (`user_id`,`attempt_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_manager_session_assignments_project_active` ON `project_manager_session_assignments` (`user_id`,`project_id`,`active_slot`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_manager_session_assignments_session_active` ON `project_manager_session_assignments` (`user_id`,`session_id`,`active_slot`);
--> statement-breakpoint
CREATE TABLE `project_manager_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`work_item_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`assignment_id` text,
	`approval_id` text,
	`command_type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_digest` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_json` text,
	`failure_code` text,
	`failure_message` text,
	`created_at` integer,
	`updated_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_item_id`) REFERENCES `project_manager_work_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `project_manager_task_attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_id`) REFERENCES `project_manager_session_assignments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approval_id`) REFERENCES `copilot_pending_actions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_manager_commands_idempotency` ON `project_manager_commands` (`user_id`,`attempt_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_commands_attempt_created` ON `project_manager_commands` (`user_id`,`attempt_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `project_manager_acceptance_results` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`work_item_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`verdict` text NOT NULL,
	`criteria_json` text DEFAULT '[]' NOT NULL,
	`verification_json` text DEFAULT '[]' NOT NULL,
	`evidence_refs_json` text DEFAULT '[]' NOT NULL,
	`policy_json` text DEFAULT '{}' NOT NULL,
	`summary` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_item_id`) REFERENCES `project_manager_work_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `project_manager_task_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_acceptance_attempt` ON `project_manager_acceptance_results` (`user_id`,`attempt_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `project_manager_wakeups` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`work_item_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`reason_class` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`active_slot` text,
	`not_before` integer NOT NULL,
	`claim_token` text,
	`claim_expires_at` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error_code` text,
	`last_error_message` text,
	`created_at` integer,
	`updated_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_item_id`) REFERENCES `project_manager_work_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `project_manager_task_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_manager_wakeups_pending` ON `project_manager_wakeups` (`user_id`,`attempt_id`,`reason_class`,`active_slot`);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_wakeups_attempt_due` ON `project_manager_wakeups` (`user_id`,`attempt_id`,`status`,`not_before`);
