CREATE TABLE copilot_grants (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active', revision INTEGER NOT NULL DEFAULT 1,
 scope_json TEXT NOT NULL, expires_at INTEGER NOT NULL, max_actions INTEGER NOT NULL,
 max_concurrency INTEGER NOT NULL, used_actions INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, UNIQUE(user_id,id)
);
--> statement-breakpoint
CREATE TABLE platform_action_intents (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 grant_id TEXT, grant_revision INTEGER, authority TEXT NOT NULL,
 command_id TEXT NOT NULL, input_json TEXT NOT NULL, digest TEXT NOT NULL,
 resources_json TEXT NOT NULL, policy_version INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, idempotency_key TEXT NOT NULL, status TEXT NOT NULL,
 created_at INTEGER NOT NULL, UNIQUE(user_id,idempotency_key), UNIQUE(user_id,id),
 FOREIGN KEY(user_id,grant_id) REFERENCES copilot_grants(user_id,id)
);
--> statement-breakpoint
CREATE TABLE platform_action_receipts (
 intent_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 outcome TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 FOREIGN KEY(user_id,intent_id) REFERENCES platform_action_intents(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE copilot_conversation_grants (
 conversation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 grant_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 FOREIGN KEY(user_id,grant_id) REFERENCES copilot_grants(user_id,id),
 FOREIGN KEY(conversation_id) REFERENCES copilot_conversations(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE project_manager_management (
 project_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 mode TEXT NOT NULL DEFAULT 'manual', owner_label TEXT NOT NULL DEFAULT '',
 next_action TEXT NOT NULL DEFAULT '', freshness_hours INTEGER NOT NULL DEFAULT 72,
 revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
 FOREIGN KEY(user_id,project_id) REFERENCES projects(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
UPDATE copilot_pending_actions SET status='expired' WHERE status='pending';
--> statement-breakpoint
UPDATE copilot_runs SET status='failed', error='governance_upgrade_requires_new_run', stop_reason='governance_upgrade_requires_new_run' WHERE status IN ('pending','running','awaiting_approval');
