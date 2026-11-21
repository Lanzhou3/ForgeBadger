-- Copilot Plan/Execute mode persistence, single-run plan execution goals and
-- per-role Copilot models (plan mode, delegated sub-runs).
ALTER TABLE copilot_conversations ADD COLUMN mode text NOT NULL DEFAULT 'execute' CHECK (mode IN ('plan', 'execute'));
--> statement-breakpoint
ALTER TABLE copilot_goals ADD COLUMN auto_continue integer NOT NULL DEFAULT 1 CHECK (auto_continue IN (0, 1));
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN copilot_plan_model_id text;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN copilot_subagent_model_id text;
