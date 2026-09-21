CREATE TABLE collaboration_projects (
 project_id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 protected_root text NOT NULL, revision integer NOT NULL DEFAULT 0, execution_enabled integer NOT NULL DEFAULT 0 CHECK(execution_enabled IN (0,1)),
 verification_json text, verification_revision integer NOT NULL DEFAULT 0,
 FOREIGN KEY(user_id,project_id) REFERENCES projects(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE collaboration_members (
 project_id text NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 member_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 role text NOT NULL CHECK(role IN ('developer','reviewer','viewer')),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoking','revoked')),
 revision integer NOT NULL DEFAULT 1, PRIMARY KEY(project_id,member_id),
 FOREIGN KEY(user_id,project_id) REFERENCES projects(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX idx_collaboration_members_actor ON collaboration_members(member_id,state);
--> statement-breakpoint
CREATE TABLE collaboration_tasks (
 work_item_id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id text NOT NULL, revision integer NOT NULL DEFAULT 1,
 assignee_id text REFERENCES users(id) ON DELETE RESTRICT, reviewer_id text REFERENCES users(id) ON DELETE RESTRICT,
 FOREIGN KEY(user_id,project_id,work_item_id) REFERENCES project_manager_work_items(user_id,project_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE collaboration_events (
 id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id text NOT NULL, task_id text, actor_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 kind text NOT NULL, body_json text NOT NULL, created_at integer NOT NULL,
 FOREIGN KEY(user_id,project_id) REFERENCES projects(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX idx_collaboration_events_project ON collaboration_events(user_id,project_id,created_at);
--> statement-breakpoint
CREATE TABLE delivery_runs (
 id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 project_id text NOT NULL, work_item_id text NOT NULL, actor_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL, input_digest text NOT NULL, adapter text NOT NULL, membership_revision integer NOT NULL,
 state text NOT NULL CHECK(state IN ('provisioning','ready','failed','revoking','closed','integrated')),
 workspace_project_id text, session_id text REFERENCES sessions(id) ON DELETE RESTRICT,
 workspace_path text NOT NULL, branch text NOT NULL, base_commit text NOT NULL DEFAULT '', target_branch text NOT NULL DEFAULT '',
 preview_url text, pr_url text, error_code text, created_at integer NOT NULL, updated_at integer NOT NULL,
 FOREIGN KEY(user_id,project_id,work_item_id) REFERENCES project_manager_work_items(user_id,project_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(actor_id,workspace_project_id) REFERENCES projects(user_id,id) ON DELETE RESTRICT,
 UNIQUE(actor_id,idempotency_key), UNIQUE(workspace_path), UNIQUE(workspace_project_id), UNIQUE(session_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_delivery_runs_identity ON delivery_runs(user_id,project_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_delivery_runs_active_actor_task ON delivery_runs(work_item_id,actor_id) WHERE state IN ('provisioning','ready','revoking');
--> statement-breakpoint
CREATE TABLE delivery_verifications (
 id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT, project_id text NOT NULL,
 run_id text NOT NULL, actor_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 commit_sha text NOT NULL, task_digest text NOT NULL, task_revision integer NOT NULL, policy_revision integer NOT NULL,
 command_json text NOT NULL, status text NOT NULL CHECK(status IN ('running','passed','failed','unknown')),
 exit_code integer, summary text NOT NULL DEFAULT '', created_at integer NOT NULL, finished_at integer,
 FOREIGN KEY(user_id,project_id,run_id) REFERENCES delivery_runs(user_id,project_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_delivery_verifications_identity ON delivery_verifications(user_id,project_id,run_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_delivery_verifications_running ON delivery_verifications(run_id) WHERE status='running';
--> statement-breakpoint
CREATE TRIGGER delivery_verifications_final_immutable BEFORE UPDATE ON delivery_verifications WHEN OLD.status != 'running'
BEGIN SELECT RAISE(ABORT,'Final verification receipts are immutable'); END;
--> statement-breakpoint
CREATE TABLE delivery_reviews (
 id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT, project_id text NOT NULL,
 run_id text NOT NULL, actor_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 verification_id text NOT NULL, commit_sha text NOT NULL, task_digest text NOT NULL, task_revision integer NOT NULL, policy_revision integer NOT NULL,
 decision text NOT NULL CHECK(decision IN ('accepted','changes_requested')), note text NOT NULL, created_at integer NOT NULL,
 FOREIGN KEY(user_id,project_id,run_id,verification_id) REFERENCES delivery_verifications(user_id,project_id,run_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TRIGGER delivery_reviews_immutable BEFORE UPDATE ON delivery_reviews
BEGIN SELECT RAISE(ABORT,'Review decisions are immutable'); END;

--> statement-breakpoint
CREATE TABLE delivery_operations (
 run_id text PRIMARY KEY NOT NULL, user_id text NOT NULL, project_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('verify','review','integrate')),
 phase text NOT NULL DEFAULT 'active' CHECK(phase IN ('active','applying','interrupted')),
 expected_commit text, created_at integer NOT NULL,
 FOREIGN KEY(user_id,project_id,run_id) REFERENCES delivery_runs(user_id,project_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TRIGGER delivery_apply_project_manager_work_items_update BEFORE UPDATE ON project_manager_work_items
WHEN EXISTS(SELECT 1 FROM delivery_operations o JOIN delivery_runs r ON r.id=o.run_id WHERE o.kind='integrate' AND o.phase IN ('applying','interrupted') AND (r.work_item_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_apply_project_manager_work_items_delete BEFORE DELETE ON project_manager_work_items
WHEN EXISTS(SELECT 1 FROM delivery_operations o JOIN delivery_runs r ON r.id=o.run_id WHERE o.kind='integrate' AND o.phase IN ('applying','interrupted') AND (r.work_item_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_apply_collaboration_tasks_update BEFORE UPDATE ON collaboration_tasks
WHEN EXISTS(SELECT 1 FROM delivery_operations o JOIN delivery_runs r ON r.id=o.run_id WHERE o.kind='integrate' AND o.phase IN ('applying','interrupted') AND (r.work_item_id=OLD.work_item_id))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_apply_collaboration_tasks_delete BEFORE DELETE ON collaboration_tasks
WHEN EXISTS(SELECT 1 FROM delivery_operations o JOIN delivery_runs r ON r.id=o.run_id WHERE o.kind='integrate' AND o.phase IN ('applying','interrupted') AND (r.work_item_id=OLD.work_item_id))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_apply_collaboration_projects_update BEFORE UPDATE ON collaboration_projects
WHEN EXISTS(SELECT 1 FROM delivery_operations o JOIN delivery_runs r ON r.id=o.run_id WHERE o.kind='integrate' AND o.phase IN ('applying','interrupted') AND (r.project_id=OLD.project_id))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_apply_collaboration_projects_delete BEFORE DELETE ON collaboration_projects
WHEN EXISTS(SELECT 1 FROM delivery_operations o JOIN delivery_runs r ON r.id=o.run_id WHERE o.kind='integrate' AND o.phase IN ('applying','interrupted') AND (r.project_id=OLD.project_id))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_apply_collaboration_members_update BEFORE UPDATE ON collaboration_members
WHEN EXISTS(SELECT 1 FROM delivery_operations o JOIN delivery_runs r ON r.id=o.run_id WHERE o.kind='integrate' AND o.phase IN ('applying','interrupted') AND (r.project_id=OLD.project_id))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_apply_collaboration_members_delete BEFORE DELETE ON collaboration_members
WHEN EXISTS(SELECT 1 FROM delivery_operations o JOIN delivery_runs r ON r.id=o.run_id WHERE o.kind='integrate' AND o.phase IN ('applying','interrupted') AND (r.project_id=OLD.project_id))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_apply_users_update BEFORE UPDATE ON users
WHEN EXISTS(SELECT 1 FROM delivery_operations o JOIN delivery_runs r ON r.id=o.run_id WHERE o.kind='integrate' AND o.phase IN ('applying','interrupted') AND (r.user_id=OLD.id OR r.actor_id=OLD.id OR EXISTS(SELECT 1 FROM delivery_reviews v WHERE v.run_id=r.id AND v.actor_id=OLD.id)))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_apply_users_delete BEFORE DELETE ON users
WHEN EXISTS(SELECT 1 FROM delivery_operations o JOIN delivery_runs r ON r.id=o.run_id WHERE o.kind='integrate' AND o.phase IN ('applying','interrupted') AND (r.user_id=OLD.id OR r.actor_id=OLD.id OR EXISTS(SELECT 1 FROM delivery_reviews v WHERE v.run_id=r.id AND v.actor_id=OLD.id)))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_apply_projects_update BEFORE UPDATE ON projects
WHEN EXISTS(SELECT 1 FROM delivery_operations o JOIN delivery_runs r ON r.id=o.run_id WHERE o.kind='integrate' AND o.phase IN ('applying','interrupted') AND (r.project_id=OLD.id OR r.workspace_project_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_apply_projects_delete BEFORE DELETE ON projects
WHEN EXISTS(SELECT 1 FROM delivery_operations o JOIN delivery_runs r ON r.id=o.run_id WHERE o.kind='integrate' AND o.phase IN ('applying','interrupted') AND (r.project_id=OLD.id OR r.workspace_project_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_apply_runs_update BEFORE UPDATE OF state ON delivery_runs
WHEN NEW.state != 'integrated' AND EXISTS(SELECT 1 FROM delivery_operations WHERE run_id=OLD.id AND kind='integrate' AND phase IN ('applying','interrupted'))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_apply_members_insert BEFORE INSERT ON collaboration_members
WHEN EXISTS(SELECT 1 FROM delivery_operations WHERE project_id=NEW.project_id AND kind='integrate' AND phase IN ('applying','interrupted'))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_apply_tasks_insert BEFORE INSERT ON collaboration_tasks
WHEN EXISTS(SELECT 1 FROM delivery_operations o JOIN delivery_runs r ON r.id=o.run_id WHERE r.work_item_id=NEW.work_item_id AND o.kind='integrate' AND o.phase IN ('applying','interrupted'))
BEGIN SELECT RAISE(ABORT,'DELIVERY_INTEGRATION_IN_PROGRESS'); END;
