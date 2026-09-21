CREATE UNIQUE INDEX idx_copilot_development_project_identity ON copilot_development_tasks(user_id,project_id,id);
--> statement-breakpoint
CREATE TABLE project_task_artifact_links (
 id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id text NOT NULL,
 work_item_id text NOT NULL,
 development_task_id text NOT NULL,
 artifact_digest text NOT NULL,
 task_digest text NOT NULL,
 artifact_status text NOT NULL CHECK(artifact_status IN ('checks_passed','checks_failed','accepted')),
 files_count integer NOT NULL CHECK(files_count >= 0),
 checks_count integer NOT NULL CHECK(checks_count >= 0),
 passed_checks integer NOT NULL CHECK(passed_checks >= 0 AND passed_checks <= checks_count),
 linked_by text NOT NULL REFERENCES users(id),
 linked_at integer NOT NULL,
 FOREIGN KEY(user_id,project_id,work_item_id) REFERENCES project_manager_work_items(user_id,project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,project_id,development_task_id) REFERENCES copilot_development_tasks(user_id,project_id,id),
 UNIQUE(user_id,project_id,work_item_id,development_task_id,artifact_digest)
);
