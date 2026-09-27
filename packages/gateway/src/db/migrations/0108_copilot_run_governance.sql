ALTER TABLE copilot_runs ADD COLUMN execution_phase text NOT NULL DEFAULT 'queued';
--> statement-breakpoint
ALTER TABLE copilot_runs ADD COLUMN phase_started_at integer;
--> statement-breakpoint
ALTER TABLE copilot_runs ADD COLUMN token_budget integer NOT NULL DEFAULT 500000;
--> statement-breakpoint
ALTER TABLE copilot_runs ADD COLUMN max_duration_ms integer NOT NULL DEFAULT 1800000;
--> statement-breakpoint
UPDATE copilot_runs SET execution_phase = CASE WHEN status = 'awaiting_approval' THEN 'awaiting_approval' WHEN status IN ('completed','stopped','failed','cancelled','indeterminate') THEN 'finished' ELSE 'queued' END;
--> statement-breakpoint
CREATE TABLE copilot_model_calls (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  run_id text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  charged_tokens integer NOT NULL,
  usage_json text,
  created_at integer NOT NULL,
  completed_at integer,
  FOREIGN KEY (user_id, run_id) REFERENCES copilot_runs(user_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX idx_copilot_model_calls_run ON copilot_model_calls(user_id, run_id);
--> statement-breakpoint
CREATE TABLE copilot_followups (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  conversation_id text NOT NULL,
  request_key text NOT NULL,
  request_digest text NOT NULL,
  input_json text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  run_id text,
  error text,
  created_at integer NOT NULL,
  FOREIGN KEY (user_id, conversation_id) REFERENCES copilot_conversations(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, run_id) REFERENCES copilot_runs(user_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_followup_identity ON copilot_followups(user_id, conversation_id, request_key);
--> statement-breakpoint
CREATE INDEX idx_copilot_followup_pending ON copilot_followups(user_id, status, created_at);
