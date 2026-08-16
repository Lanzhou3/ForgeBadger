-- Full Agent feature retirement: project Agent management and the per-project
-- orchestration sequence are removed. The agents and project_agent_sequences
-- tables drop, and session/snapshot rows stop carrying an agent binding.
--
-- sessions.agent_id participates in a table-level FOREIGN KEY referencing
-- agents(id), so SQLite cannot DROP COLUMN it directly; the table is rebuilt
-- without the column (foreign key checks are disabled for the rebuild).
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
-- 0033 added composite worker-signal references. Phase 2 installations have
-- the parent rows but not these parent-key indexes, which SQLite requires
-- before validating the session table rebuild below.
CREATE UNIQUE INDEX IF NOT EXISTS `idx_portfolio_work_items_user_project_id`
  ON `portfolio_work_items` (`user_id`,`project_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_portfolio_attempts_user_project_work_item_id`
  ON `portfolio_task_attempts` (`user_id`,`project_id`,`work_item_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_portfolio_attempts_user_project_id`
  ON `portfolio_task_attempts` (`user_id`,`project_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sessions_user_project_id`
  ON `sessions` (`user_id`,`project_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_portfolio_assignments_user_project_work_item_attempt_id`
  ON `portfolio_session_assignments` (`user_id`,`project_id`,`work_item_id`,`attempt_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_portfolio_commands_user_project_work_item_attempt_id`
  ON `portfolio_commands` (`user_id`,`project_id`,`work_item_id`,`attempt_id`,`id`);
--> statement-breakpoint
-- Early 0033 installs persisted the command reference as (user_id, id).
CREATE UNIQUE INDEX IF NOT EXISTS `idx_portfolio_commands_user_id`
  ON `portfolio_commands` (`user_id`,`id`);
--> statement-breakpoint
DROP TABLE IF EXISTS `project_agent_sequences`;
--> statement-breakpoint
DROP TABLE IF EXISTS `agents`;
--> statement-breakpoint
CREATE TABLE `sessions_v2` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`ai_tool` text NOT NULL,
	`model_id` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`attach_token` text DEFAULT '' NOT NULL,
	`tmux_session` text,
	`working_dir` text NOT NULL,
	`credential_mode` text DEFAULT 'host_environment' NOT NULL,
	`api_key_id` text,
	`last_active` integer,
	`error_message` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `sessions_v2` (`id`,`user_id`,`project_id`,`name`,`ai_tool`,`model_id`,`status`,`attach_token`,`tmux_session`,`working_dir`,`credential_mode`,`api_key_id`,`last_active`,`error_message`,`created_at`,`updated_at`)
SELECT `id`,`user_id`,`project_id`,`name`,`ai_tool`,`model_id`,`status`,`attach_token`,`tmux_session`,`working_dir`,`credential_mode`,`api_key_id`,`last_active`,`error_message`,`created_at`,`updated_at` FROM `sessions`;
--> statement-breakpoint
DROP TABLE `sessions`;
--> statement-breakpoint
ALTER TABLE `sessions_v2` RENAME TO `sessions`;
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_project` ON `sessions` (`user_id`,`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_sessions_status` ON `sessions` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sessions_user_project_id` ON `sessions` (`user_id`,`project_id`,`id`);
--> statement-breakpoint
ALTER TABLE `session_snapshots` DROP COLUMN `agent_id`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
