ALTER TABLE copilot_runs ADD COLUMN runtime_version integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE copilot_runs ADD COLUMN source text NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE copilot_runs ADD COLUMN input_json text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE copilot_runs ADD COLUMN max_steps integer NOT NULL DEFAULT 16;
--> statement-breakpoint
ALTER TABLE copilot_runs ADD COLUMN stop_reason text;
--> statement-breakpoint
ALTER TABLE copilot_runs ADD COLUMN revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE copilot_runs ADD COLUMN lease_owner text;
--> statement-breakpoint
ALTER TABLE copilot_runs ADD COLUMN lease_expires_at integer;
--> statement-breakpoint
ALTER TABLE copilot_runs ADD COLUMN fence integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE copilot_messages ADD COLUMN run_id text;
--> statement-breakpoint
ALTER TABLE copilot_messages ADD COLUMN step_id text;
--> statement-breakpoint
ALTER TABLE copilot_pending_actions ADD COLUMN step_id text;
--> statement-breakpoint
ALTER TABLE copilot_pending_actions ADD COLUMN tool_call_id text;
--> statement-breakpoint
ALTER TABLE copilot_memory ADD COLUMN conversation_id text;
--> statement-breakpoint
UPDATE copilot_pending_actions SET status = 'expired' WHERE status = 'pending';
--> statement-breakpoint
UPDATE copilot_runs SET status = 'failed', error = 'legacy_runtime_not_resumable', stop_reason = 'legacy_runtime_not_resumable' WHERE status IN ('pending','running','awaiting_approval');
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_run_tenant ON copilot_runs (user_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_active_conversation ON copilot_runs(user_id,conversation_id) WHERE runtime_version = 1 AND status IN ('pending','running','awaiting_approval');
--> statement-breakpoint
CREATE TABLE copilot_run_steps (
 id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 run_id text NOT NULL, ordinal integer NOT NULL, kind text NOT NULL,
 status text NOT NULL DEFAULT 'pending', tool_call_id text, tool_name text,
 input_json text, input_digest text, result_json text, effect text NOT NULL DEFAULT 'read',
 attempt integer NOT NULL DEFAULT 0, fence integer NOT NULL DEFAULT 0,
 started_at integer, completed_at integer,
 FOREIGN KEY (user_id,run_id) REFERENCES copilot_runs(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_step_ordinal ON copilot_run_steps(user_id,run_id,ordinal);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_step_call ON copilot_run_steps(user_id,run_id,tool_call_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_action_step ON copilot_pending_actions(user_id,step_id);
