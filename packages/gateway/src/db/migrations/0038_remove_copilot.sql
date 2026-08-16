-- Full Copilot feature retirement ahead of a re-architecture: the backend
-- Copilot orchestrator, providers, memory, automations, and conversations are
-- removed, so every copilot_* table drops here.
--
-- project_manager_commands.approval_id participates in a table-level FOREIGN
-- KEY referencing copilot_pending_actions(id), so SQLite cannot DROP COLUMN or
-- remove the constraint in place; the table is rebuilt without that FK (the
-- column stays as a plain text field, matching schema.ts). Foreign key checks
-- are disabled for the drops and the rebuild, mirroring 0034_remove_agents.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_automation_run_projects`;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_automation_runs`;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_automations`;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_messages`;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_conversations`;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_run_events`;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_pending_actions`;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_memory_fts`;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_memory_notes`;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_memory_entries`;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_runs`;
--> statement-breakpoint
CREATE TABLE `project_manager_commands_v2` (
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
	FOREIGN KEY (`assignment_id`) REFERENCES `project_manager_session_assignments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `project_manager_commands_v2` (`id`,`user_id`,`project_id`,`work_item_id`,`attempt_id`,`assignment_id`,`approval_id`,`command_type`,`idempotency_key`,`payload_digest`,`status`,`result_json`,`failure_code`,`failure_message`,`created_at`,`updated_at`,`completed_at`)
SELECT `id`,`user_id`,`project_id`,`work_item_id`,`attempt_id`,`assignment_id`,`approval_id`,`command_type`,`idempotency_key`,`payload_digest`,`status`,`result_json`,`failure_code`,`failure_message`,`created_at`,`updated_at`,`completed_at` FROM `project_manager_commands`;
--> statement-breakpoint
DROP TABLE `project_manager_commands`;
--> statement-breakpoint
ALTER TABLE `project_manager_commands_v2` RENAME TO `project_manager_commands`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_manager_commands_idempotency` ON `project_manager_commands` (`user_id`,`attempt_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_project_manager_commands_attempt_created` ON `project_manager_commands` (`user_id`,`attempt_id`,`created_at`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
