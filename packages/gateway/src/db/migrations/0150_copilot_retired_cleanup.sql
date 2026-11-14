-- Retire Copilot leftovers that no runtime code reads or writes:
--   * budget enforcement and model-call metering (removed 2026-10-23):
--     copilot_model_calls, copilot_token_rates, and the budget columns on
--     copilot_runs / copilot_goals;
--   * the failed-check repair loop (removed 2026-11): copilot_repair_jobs and
--     copilot_runs.repair_revoked_at;
--   * historical DSH / Feishu-to-Copilot / automation snapshot rows:
--     copilot_dsh_config, feishu_copilot_channels,
--     copilot_automation_run_projects, copilot_conversations.dsh_session_id.
-- No other table references the dropped tables, and none of the dropped
-- columns is part of an index, key or CHECK constraint.
DROP TABLE IF EXISTS `copilot_repair_jobs`;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_model_calls`;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_token_rates`;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_dsh_config`;
--> statement-breakpoint
DROP TABLE IF EXISTS `feishu_copilot_channels`;
--> statement-breakpoint
DROP TABLE IF EXISTS `copilot_automation_run_projects`;
--> statement-breakpoint
ALTER TABLE `copilot_runs` DROP COLUMN `token_budget`;
--> statement-breakpoint
ALTER TABLE `copilot_runs` DROP COLUMN `max_duration_ms`;
--> statement-breakpoint
ALTER TABLE `copilot_runs` DROP COLUMN `repair_revoked_at`;
--> statement-breakpoint
ALTER TABLE `copilot_goals` DROP COLUMN `token_budget`;
--> statement-breakpoint
ALTER TABLE `copilot_goals` DROP COLUMN `max_duration_ms`;
--> statement-breakpoint
ALTER TABLE `copilot_goals` DROP COLUMN `max_runs`;
--> statement-breakpoint
ALTER TABLE `copilot_conversations` DROP COLUMN `dsh_session_id`;
