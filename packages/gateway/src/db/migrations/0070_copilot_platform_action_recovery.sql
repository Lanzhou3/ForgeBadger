-- Refuse invalid historical bindings before rebuilding; never discard their rows.
CREATE TEMP TABLE copilot_binding_migration_guard (invalid_rows INTEGER NOT NULL CHECK(invalid_rows = 0));
--> statement-breakpoint
INSERT INTO copilot_binding_migration_guard(invalid_rows)
SELECT COUNT(*) FROM copilot_conversation_grants b
LEFT JOIN copilot_conversations c ON c.id = b.conversation_id AND c.user_id = b.user_id
WHERE c.id IS NULL;
--> statement-breakpoint
DROP TABLE copilot_binding_migration_guard;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_conversation_tenant ON copilot_conversations(user_id,id);
--> statement-breakpoint
CREATE TABLE copilot_conversation_grants_next (
 conversation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 grant_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 FOREIGN KEY(user_id,grant_id) REFERENCES copilot_grants(user_id,id),
 FOREIGN KEY(user_id,conversation_id) REFERENCES copilot_conversations(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO copilot_conversation_grants_next(conversation_id,user_id,grant_id,created_at)
SELECT conversation_id,user_id,grant_id,created_at FROM copilot_conversation_grants;
--> statement-breakpoint
DROP TABLE copilot_conversation_grants;
--> statement-breakpoint
ALTER TABLE copilot_conversation_grants_next RENAME TO copilot_conversation_grants;
--> statement-breakpoint
CREATE TABLE session_writer_leases (
 workspace TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL,
 session_id TEXT NOT NULL,
 token TEXT,
 fence INTEGER NOT NULL DEFAULT 0,
 expires_at INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY(user_id,project_id,session_id) REFERENCES sessions(user_id,project_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX idx_session_writer_lease_user_session ON session_writer_leases(user_id,session_id);
--> statement-breakpoint
ALTER TABLE platform_action_intents ADD COLUMN execution_owner TEXT;
--> statement-breakpoint
ALTER TABLE platform_action_intents ADD COLUMN execution_lease_expires_at INTEGER;
--> statement-breakpoint
CREATE INDEX idx_platform_action_execution_lease ON platform_action_intents(user_id,status,execution_lease_expires_at);
--> statement-breakpoint
-- These legacy executions never owned a durable lease; do not replay them.
UPDATE platform_action_intents SET status = 'indeterminate' WHERE status = 'executing';
