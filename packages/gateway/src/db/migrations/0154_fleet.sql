-- Fleet: a standing, per-project agent team with its own board. The lead is
-- a Copilot run on the fleet's dedicated conversation; its run rows carry the
-- fleet id in copilot_runs.goal_id (the execution "scope" id shared with goal
-- mode), so members, task worktrees, verification, review and integration
-- reuse the goal machinery. All rows are tenant scoped by user_id and cascade
-- with their fleet; a fleet cascades with its project and lead conversation.
--
-- fleets        one per (user, project); workspace_* mirror copilot_goals so
--               a fleet row projects onto a goal row structurally;
--               idle_lead_runs counts consecutive completed lead runs
--               without board progress (the no-progress guard).
-- fleet_tasks   the board; columns shared with copilot_goal_tasks keep the
--               same meaning, plus member/file scope/hold/creator.
-- fleet_events  the lead's inbox: every wake-up reason, deduplicated per fleet.
-- fleet_timers  one-shot follow-ups the lead sets for itself.
-- fleet_notes   lead memory (fleet / task / member notes), replaced whole.
-- fleet_journal the run-to-run handover log, optionally per task.

CREATE TABLE fleets (
 id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id text NOT NULL,
 conversation_id text NOT NULL,
 title text NOT NULL,
 instructions text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
 paused_reason text,
 idle_lead_runs integer NOT NULL DEFAULT 0,
 grants_json text NOT NULL DEFAULT '[]',
 workspace_kind text CHECK(workspace_kind IS NULL OR workspace_kind IN ('copy','worktree')),
 workspace_path text,
 workspace_branch text,
 workspace_base_commit text,
 workspace_target_branch text,
 created_at integer NOT NULL,
 updated_at integer NOT NULL,
 FOREIGN KEY(user_id,project_id) REFERENCES projects(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,conversation_id) REFERENCES copilot_conversations(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_fleets_tenant ON fleets(user_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_fleets_project ON fleets(user_id,project_id);
--> statement-breakpoint
CREATE INDEX idx_fleets_conversation ON fleets(user_id,conversation_id);
--> statement-breakpoint
CREATE TABLE fleet_tasks (
 id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 fleet_id text NOT NULL,
 seq integer NOT NULL,
 description text NOT NULL,
 details text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','passes','failed','cancelled')),
 evidence text,
 verify_command text,
 verified_at integer,
 verify_exit_code integer,
 dispatched_session_id text,
 dispatch_status text CHECK(dispatch_status IS NULL OR dispatch_status IN ('running','completed','failed','ended')),
 dispatch_updated_at integer,
 member_id text,
 file_scope_json text,
 hold_question text,
 hold_asked_at integer,
 work_item_id text,
 created_by text NOT NULL DEFAULT 'lead' CHECK(created_by IN ('owner','lead')),
 created_at integer NOT NULL,
 updated_at integer NOT NULL,
 FOREIGN KEY(user_id,fleet_id) REFERENCES fleets(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_fleet_tasks_seq ON fleet_tasks(user_id,fleet_id,seq);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_fleet_tasks_work_item ON fleet_tasks(user_id,fleet_id,work_item_id) WHERE work_item_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_fleet_tasks_session ON fleet_tasks(user_id,dispatched_session_id) WHERE dispatched_session_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE fleet_events (
 id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 fleet_id text NOT NULL,
 kind text NOT NULL,
 task_id text,
 dedupe_key text NOT NULL,
 payload_json text NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','done','failed')),
 run_id text,
 attempt_count integer NOT NULL DEFAULT 0,
 created_at integer NOT NULL,
 claimed_at integer,
 processed_at integer,
 FOREIGN KEY(user_id,fleet_id) REFERENCES fleets(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_fleet_events_dedupe ON fleet_events(fleet_id,dedupe_key);
--> statement-breakpoint
CREATE INDEX idx_fleet_events_status ON fleet_events(user_id,fleet_id,status,created_at);
--> statement-breakpoint
CREATE INDEX idx_fleet_events_run ON fleet_events(user_id,run_id) WHERE run_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE fleet_timers (
 id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 fleet_id text NOT NULL,
 task_id text,
 due_at integer NOT NULL,
 note text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','fired','cancelled')),
 created_at integer NOT NULL,
 fired_at integer,
 FOREIGN KEY(user_id,fleet_id) REFERENCES fleets(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX idx_fleet_timers_due ON fleet_timers(status,due_at);
--> statement-breakpoint
CREATE INDEX idx_fleet_timers_fleet ON fleet_timers(user_id,fleet_id,status);
--> statement-breakpoint
CREATE TABLE fleet_notes (
 id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 fleet_id text NOT NULL,
 scope text NOT NULL CHECK(scope IN ('fleet','task','member')),
 ref_id text NOT NULL DEFAULT '',
 body text NOT NULL,
 updated_at integer NOT NULL,
 FOREIGN KEY(user_id,fleet_id) REFERENCES fleets(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_fleet_notes_ref ON fleet_notes(fleet_id,scope,ref_id);
--> statement-breakpoint
CREATE TABLE fleet_journal (
 id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 fleet_id text NOT NULL,
 run_id text,
 task_id text,
 note text NOT NULL,
 created_at integer NOT NULL,
 FOREIGN KEY(user_id,fleet_id) REFERENCES fleets(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX idx_fleet_journal_created ON fleet_journal(user_id,fleet_id,created_at);
