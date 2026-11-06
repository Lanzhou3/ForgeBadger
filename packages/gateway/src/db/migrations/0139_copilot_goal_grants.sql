-- Copilot Goal mode M3: per-goal authorization grants and CLI dispatch
-- bookkeeping. grants_json holds the one-time authorization package
-- (whitelist: operate_sessions | terminal_run | pm_dispatch) created with
-- the goal; dispatched_session_id links a task to the CLI session that
-- received its instructions.
ALTER TABLE `copilot_goals` ADD COLUMN `grants_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `copilot_goal_tasks` ADD COLUMN `dispatched_session_id` text;
