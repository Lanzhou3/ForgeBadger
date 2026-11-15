-- Team hub coordination: member machines ("nodes") keep their own clone and
-- execute locally; the hub only shares tasks, submissions and confirmations.
--
-- hub_node_tokens      a member's long-lived, single-project node credential
--                      (SHA-256 only). Authority is re-evaluated per request
--                      from team/project grants, so the token carries none.
-- hub_projects         optional per-project remote and confirmation policy.
--                      The policy is validated in the service, not by CHECK,
--                      so later reviewer kinds do not need a table rebuild.
-- hub_task_submissions a developer's published branch/commit for a task.
--                      Evidence: a task with submissions cannot be deleted
--                      (RESTRICT), matching the delivery-history rule.
-- hub_task_confirmations append-only review records bound to one submission.
--                      actor_kind/effect are the seam for a later Copilot
--                      reviewer; only human, binding records are issued today.

CREATE TABLE hub_node_tokens (
 id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name text NOT NULL,
 token_hash text NOT NULL UNIQUE,
 created_at integer NOT NULL,
 expires_at integer NOT NULL,
 last_used_at integer,
 revoked_at integer
);
--> statement-breakpoint
CREATE INDEX idx_hub_node_tokens_user ON hub_node_tokens(user_id,created_at);
--> statement-breakpoint
CREATE TABLE hub_projects (
 project_id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider text CHECK(provider IN ('github','gitee')),
 remote_url text,
 default_branch text,
 confirmation_policy text NOT NULL DEFAULT 'human_only',
 revision integer NOT NULL DEFAULT 1,
 updated_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 updated_at integer NOT NULL,
 FOREIGN KEY(user_id,project_id) REFERENCES projects(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE hub_task_submissions (
 id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id text NOT NULL,
 work_item_id text NOT NULL,
 actor_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 branch text NOT NULL,
 commit_sha text NOT NULL,
 pr_url text,
 checks_status text NOT NULL CHECK(checks_status IN ('passed','failed','not_run')),
 checks_summary text NOT NULL DEFAULT '',
 task_semantic_revision integer NOT NULL,
 created_at integer NOT NULL,
 FOREIGN KEY(user_id,project_id,work_item_id) REFERENCES project_manager_work_items(user_id,project_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX idx_hub_task_submissions_task ON hub_task_submissions(user_id,project_id,work_item_id,created_at);
--> statement-breakpoint
CREATE TRIGGER hub_task_submissions_immutable BEFORE UPDATE ON hub_task_submissions
BEGIN SELECT RAISE(ABORT,'Task submissions are immutable'); END;
--> statement-breakpoint
CREATE TABLE hub_task_confirmations (
 id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id text NOT NULL,
 work_item_id text NOT NULL,
 submission_id text NOT NULL REFERENCES hub_task_submissions(id) ON DELETE CASCADE,
 actor_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 actor_kind text NOT NULL CHECK(actor_kind IN ('human','copilot','system')),
 effect text NOT NULL CHECK(effect IN ('binding','advisory')),
 decision text NOT NULL CHECK(decision IN ('accepted','changes_requested')),
 note text NOT NULL,
 commit_sha text NOT NULL,
 task_semantic_revision integer NOT NULL,
 created_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_hub_task_confirmations_submission ON hub_task_confirmations(submission_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_hub_task_confirmations_binding ON hub_task_confirmations(submission_id) WHERE effect='binding';
--> statement-breakpoint
CREATE TRIGGER hub_task_confirmations_immutable BEFORE UPDATE ON hub_task_confirmations
BEGIN SELECT RAISE(ABORT,'Task confirmations are immutable'); END;
