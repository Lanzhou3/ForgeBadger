CREATE UNIQUE INDEX idx_copilot_step_identity ON copilot_run_steps(user_id, run_id, id);
--> statement-breakpoint
CREATE TABLE copilot_tool_artifacts (
  step_id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  run_id text NOT NULL,
  conversation_id text NOT NULL,
  payload_json text NOT NULL,
  content_bytes integer NOT NULL CHECK(content_bytes >= 0 AND content_bytes <= 2097152),
  content_sha256 text NOT NULL,
  created_at integer NOT NULL,
  expires_at integer NOT NULL,
  FOREIGN KEY(user_id, run_id, step_id) REFERENCES copilot_run_steps(user_id, run_id, id) ON DELETE CASCADE,
  FOREIGN KEY(user_id, conversation_id) REFERENCES copilot_conversations(user_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX idx_copilot_artifact_run ON copilot_tool_artifacts(user_id, run_id);
--> statement-breakpoint
CREATE INDEX idx_copilot_artifact_expiry ON copilot_tool_artifacts(user_id, expires_at);
