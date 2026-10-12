CREATE TABLE copilot_research_jobs (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  origin_run_id text NOT NULL,
  source_key text NOT NULL,
  conversation_id text NOT NULL,
  child_run_id text NOT NULL,
  report_message_id text,
  created_at integer NOT NULL,
  FOREIGN KEY(user_id, origin_run_id) REFERENCES copilot_runs(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY(user_id, child_run_id) REFERENCES copilot_runs(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY(user_id, conversation_id) REFERENCES copilot_conversations(user_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_research_source ON copilot_research_jobs(user_id, source_key);
--> statement-breakpoint
CREATE INDEX idx_copilot_research_origin ON copilot_research_jobs(user_id, origin_run_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_research_child ON copilot_research_jobs(user_id, child_run_id);
