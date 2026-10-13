-- Copilot Goal mode M2: machine verification and decision-point columns.
-- Tasks gain an optional verify_command whose successful run_checks exit
-- (exit code 0) is recorded before the task may pass; goals gain a pending
-- question while blocked awaiting the owner's answer.
ALTER TABLE `copilot_goal_tasks` ADD COLUMN `verify_command` text;
--> statement-breakpoint
ALTER TABLE `copilot_goal_tasks` ADD COLUMN `verified_at` integer;
--> statement-breakpoint
ALTER TABLE `copilot_goal_tasks` ADD COLUMN `verify_exit_code` integer;
--> statement-breakpoint
ALTER TABLE `copilot_goals` ADD COLUMN `pending_question` text;
