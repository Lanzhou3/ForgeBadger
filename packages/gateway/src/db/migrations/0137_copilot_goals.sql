-- Copilot Goal mode: goal-driven multi-run execution. A goal owns a task
-- checklist and a handover journal; every run row optionally references its
-- goal (index only, no FK, so the existing run chain is untouched). Goal-level
-- budgets (tokens / wall-clock / run count) cap the whole chain; per-run
-- budgets are unchanged. All rows are tenant scoped; tasks and journal cascade
-- with their goal, and goals cascade with their conversation.
CREATE TABLE `copilot_goals` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `conversation_id` text NOT NULL,
  `project_id` text,
  `title` text NOT NULL,
  `spec` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `token_budget` integer NOT NULL DEFAULT 5000000,
  `max_duration_ms` integer NOT NULL DEFAULT 28800000,
  `max_runs` integer NOT NULL DEFAULT 50,
  `blocked_reason` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `completed_at` integer,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`conversation_id`) REFERENCES `copilot_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_copilot_goal_tenant` ON `copilot_goals` (`user_id`, `id`);
--> statement-breakpoint
CREATE INDEX `idx_copilot_goals_conversation` ON `copilot_goals` (`user_id`, `conversation_id`);
--> statement-breakpoint
CREATE TABLE `copilot_goal_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `goal_id` text NOT NULL,
  `seq` integer NOT NULL,
  `description` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `evidence` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`goal_id`) REFERENCES `copilot_goals`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_copilot_goal_tasks_goal_seq` ON `copilot_goal_tasks` (`goal_id`, `seq`);
--> statement-breakpoint
CREATE TABLE `copilot_goal_journal` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `goal_id` text NOT NULL,
  `run_id` text,
  `note` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`goal_id`) REFERENCES `copilot_goals`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_copilot_goal_journal_goal_created` ON `copilot_goal_journal` (`goal_id`, `created_at`);
--> statement-breakpoint
ALTER TABLE `copilot_runs` ADD COLUMN `goal_id` text;
--> statement-breakpoint
CREATE INDEX `idx_copilot_runs_goal` ON `copilot_runs` (`goal_id`);
