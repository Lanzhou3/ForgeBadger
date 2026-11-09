ALTER TABLE copilot_conversations ADD project_id TEXT;
--> statement-breakpoint
UPDATE copilot_conversations
SET project_id = COALESCE(
  (
    SELECT r.project_id FROM channel_routes r
    WHERE r.user_id = copilot_conversations.user_id
      AND r.conversation_id = copilot_conversations.id
  ),
  (
    SELECT r.project_id FROM channel_route_sessions s
    JOIN channel_routes r ON r.user_id = s.user_id AND r.id = s.route_id
    WHERE s.user_id = copilot_conversations.user_id
      AND s.conversation_id = copilot_conversations.id
    LIMIT 1
  )
)
WHERE EXISTS (
  SELECT 1 FROM channel_routes r
  WHERE r.user_id = copilot_conversations.user_id
    AND r.conversation_id = copilot_conversations.id
)
OR EXISTS (
  SELECT 1 FROM channel_route_sessions s
  WHERE s.user_id = copilot_conversations.user_id
    AND s.conversation_id = copilot_conversations.id
);
--> statement-breakpoint
CREATE INDEX idx_copilot_conversation_project ON copilot_conversations(user_id,project_id);
--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
CREATE TEMP TABLE channel_route_sessions_saved AS SELECT * FROM channel_route_sessions;
--> statement-breakpoint
CREATE TABLE channel_routes_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id,identity_id) REFERENCES channel_identities(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,conversation_id) REFERENCES copilot_conversations(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO channel_routes_next(id,user_id,identity_id,conversation_id,status,revision,created_at)
SELECT id,user_id,identity_id,conversation_id,status,revision,created_at FROM channel_routes;
--> statement-breakpoint
DROP TABLE channel_routes;
--> statement-breakpoint
ALTER TABLE channel_routes_next RENAME TO channel_routes;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_route_tenant ON channel_routes(user_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_route_active ON channel_routes(user_id,identity_id) WHERE status='active';
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_route_conversation ON channel_routes(user_id,conversation_id);
--> statement-breakpoint
INSERT INTO channel_route_sessions SELECT * FROM channel_route_sessions_saved;
--> statement-breakpoint
DROP TABLE channel_route_sessions_saved;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
