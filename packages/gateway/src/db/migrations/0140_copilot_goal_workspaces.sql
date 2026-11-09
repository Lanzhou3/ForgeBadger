-- Copilot goal workspaces: git-backed projects get a managed worktree on
-- branch forgebadger/goal-<goalId> (CLI dispatch and sandbox tools share it);
-- non-git projects keep the copy sandbox. workspace_base_commit is the
-- three-way base for diff/merge and advances after each owner merge.
-- dispatch_status tracks the CLI turn of a dispatched task:
-- running | completed | failed | ended.
ALTER TABLE `copilot_goals` ADD COLUMN `workspace_kind` text;
--> statement-breakpoint
ALTER TABLE `copilot_goals` ADD COLUMN `workspace_path` text;
--> statement-breakpoint
ALTER TABLE `copilot_goals` ADD COLUMN `workspace_branch` text;
--> statement-breakpoint
ALTER TABLE `copilot_goals` ADD COLUMN `workspace_base_commit` text;
--> statement-breakpoint
ALTER TABLE `copilot_goals` ADD COLUMN `workspace_target_branch` text;
--> statement-breakpoint
ALTER TABLE `copilot_goal_tasks` ADD COLUMN `dispatch_status` text;
--> statement-breakpoint
ALTER TABLE `copilot_goal_tasks` ADD COLUMN `dispatch_updated_at` integer;
