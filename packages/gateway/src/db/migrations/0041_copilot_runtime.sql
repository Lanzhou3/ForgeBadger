-- Rebuild the Copilot as a self-hosted agent harness.
--
-- The legacy copilot_* tables were dropped by migration 0038. This migration
-- creates a FRESH runtime schema for the agent harness: conversations, an
-- append-only message log, runs, approval-gated pending actions, scoped
-- memory with FTS recall, and an idempotent operation log. All tables are
-- multi-tenant (user_id NOT NULL, FK -> users(id) CASCADE).
CREATE TABLE `copilot_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_conversations_user_updated` ON `copilot_conversations` (`user_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `copilot_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`tool_name` text,
	`tool_input_json` text,
	`sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `copilot_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_messages_conversation_seq` ON `copilot_messages` (`conversation_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `idx_copilot_messages_user_created` ON `copilot_messages` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `copilot_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider` text,
	`model` text,
	`steps` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `copilot_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_runs_conversation_created` ON `copilot_runs` (`conversation_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_copilot_runs_user_created` ON `copilot_runs` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `copilot_pending_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tool` text NOT NULL,
	`input_json` text NOT NULL,
	`input_digest` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `copilot_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_pending_actions_run` ON `copilot_pending_actions` (`run_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_copilot_pending_actions_user_status` ON `copilot_pending_actions` (`user_id`,`status`);
--> statement-breakpoint
CREATE TABLE `copilot_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_memory_user_scope` ON `copilot_memory` (`user_id`,`scope`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_copilot_memory_user_project` ON `copilot_memory` (`user_id`,`project_id`,`created_at`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `copilot_memory_fts` USING fts5(
	`memory_id` UNINDEXED,
	`user_id` UNINDEXED,
	`scope` UNINDEXED,
	`project_id` UNINDEXED,
	`kind` UNINDEXED,
	`text`
);
--> statement-breakpoint
CREATE TABLE `copilot_operation_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`operation` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_digest` text NOT NULL,
	`result_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_copilot_operation_user_op_key` ON `copilot_operation_log` (`user_id`,`operation`,`idempotency_key`);
