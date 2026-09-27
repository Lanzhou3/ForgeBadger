ALTER TABLE copilot_runs ADD COLUMN repair_revoked_at integer;
--> statement-breakpoint
CREATE TABLE copilot_repair_jobs (
 id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL,
 root_task_id text NOT NULL,
 failed_task_id text NOT NULL,
 origin_run_id text NOT NULL,
 child_run_id text NOT NULL,
 attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 2),
 evidence_digest text NOT NULL,
 submission_step_id text,
 submitted_task_id text,
 report_message_id text,
 created_at integer NOT NULL,
 FOREIGN KEY(user_id,root_task_id) REFERENCES copilot_development_tasks(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,failed_task_id) REFERENCES copilot_development_tasks(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,origin_run_id) REFERENCES copilot_runs(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,child_run_id) REFERENCES copilot_runs(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,submitted_task_id) REFERENCES copilot_development_tasks(user_id,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_repair_attempt ON copilot_repair_jobs(user_id,root_task_id,attempt);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_repair_failed ON copilot_repair_jobs(user_id,failed_task_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_repair_child ON copilot_repair_jobs(user_id,child_run_id);
