ALTER TABLE platform_action_intents ADD COLUMN origin_kind TEXT NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE platform_action_intents ADD COLUMN origin_run_id TEXT;
--> statement-breakpoint
ALTER TABLE platform_action_intents ADD COLUMN origin_step_id TEXT;
--> statement-breakpoint
CREATE TABLE copilot_development_tasks (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL,
 goal TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','running','checks_passed','checks_failed','failed','cancelled','indeterminate','accepted')),
 plan_json TEXT NOT NULL, recipe_digest TEXT NOT NULL, source_digest TEXT NOT NULL, output_digest TEXT NOT NULL,
 intent_id TEXT NOT NULL, origin_run_id TEXT, origin_step_id TEXT,
 project_root TEXT NOT NULL, workspace_path TEXT, evidence_json TEXT, artifact_digest TEXT, error TEXT,
 owner TEXT, lease_expires_at INTEGER, cancel_requested INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 FOREIGN KEY(user_id,project_id) REFERENCES projects(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,intent_id) REFERENCES platform_action_intents(user_id,id),
 UNIQUE(user_id,id), UNIQUE(user_id,intent_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_development_active_project ON copilot_development_tasks(user_id,project_id) WHERE status IN ('queued','running','indeterminate');
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_development_host_slot ON copilot_development_tasks((1)) WHERE status IN ('running','indeterminate');
--> statement-breakpoint
CREATE INDEX idx_copilot_development_queue ON copilot_development_tasks(user_id,status,created_at);
--> statement-breakpoint
CREATE TABLE copilot_development_events (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 task_id TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL,
 created_at INTEGER NOT NULL, delivered_at INTEGER,
 FOREIGN KEY(user_id,task_id) REFERENCES copilot_development_tasks(user_id,id) ON DELETE CASCADE,
 UNIQUE(user_id,task_id,revision)
);
