-- Team hub insights (phase 3): module ownership, mirror analysis and remote
-- pull-request / CI status. Everything here is derived or operator-supplied
-- state that is refreshed in place; it is not evidence. Submissions and
-- confirmations (0151) remain the immutable record.
--
-- hub_task_modules       the module (a CODEOWNERS pattern) a task belongs to.
-- hub_submission_checks  latest result per (submission, kind):
--                        base_conflict / peer_conflict / scope come from the
--                        hub's mirror clone; pull_request / ci from the Git host.
-- hub_remote_credentials optional write-only Git host API token (AES-256-GCM).
-- hub_project_sync       when each refresh last ran and its last error code.

CREATE TABLE hub_task_modules (
 work_item_id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id text NOT NULL,
 pattern text NOT NULL,
 updated_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_at integer NOT NULL,
 FOREIGN KEY(user_id,project_id,work_item_id) REFERENCES project_manager_work_items(user_id,project_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE hub_submission_checks (
 submission_id text NOT NULL REFERENCES hub_task_submissions(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('base_conflict','peer_conflict','scope','pull_request','ci')),
 status text NOT NULL CHECK(status IN ('ok','attention','unknown')),
 details_json text NOT NULL DEFAULT '{}',
 checked_at integer NOT NULL,
 PRIMARY KEY(submission_id,kind)
);
--> statement-breakpoint
CREATE INDEX idx_hub_submission_checks_project ON hub_submission_checks(user_id,project_id);
--> statement-breakpoint
CREATE TABLE hub_remote_credentials (
 project_id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_encrypted text NOT NULL,
 updated_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_at integer NOT NULL,
 FOREIGN KEY(user_id,project_id) REFERENCES projects(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE hub_project_sync (
 project_id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 mirror_fetched_at integer,
 mirror_error text,
 remote_polled_at integer,
 remote_error text,
 FOREIGN KEY(user_id,project_id) REFERENCES projects(user_id,id) ON DELETE CASCADE
);
