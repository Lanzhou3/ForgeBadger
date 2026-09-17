ALTER TABLE copilot_conversations ADD COLUMN channel_owned INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE copilot_conversations SET channel_owned=1 WHERE EXISTS (SELECT 1 FROM channel_routes r WHERE r.user_id=copilot_conversations.user_id AND r.conversation_id=copilot_conversations.id);
--> statement-breakpoint
ALTER TABLE platform_action_intents ADD COLUMN channel_conversation_id TEXT;
--> statement-breakpoint
UPDATE platform_action_intents SET channel_conversation_id=(SELECT r.conversation_id FROM copilot_run_steps s JOIN copilot_runs r ON r.id=s.run_id AND r.user_id=s.user_id JOIN copilot_conversations c ON c.id=r.conversation_id AND c.user_id=r.user_id WHERE s.id=platform_action_intents.idempotency_key AND s.user_id=platform_action_intents.user_id AND c.channel_owned=1);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_route_tenant ON channel_routes(user_id,id);
--> statement-breakpoint
CREATE TABLE channel_messages (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 route_id TEXT NOT NULL, account_id TEXT NOT NULL, event_id TEXT NOT NULL, message_id TEXT NOT NULL,
 payload_encrypted TEXT NOT NULL, payload_digest TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', run_id TEXT, created_at INTEGER NOT NULL,
 FOREIGN KEY(user_id,route_id) REFERENCES channel_routes(user_id,id),
 FOREIGN KEY(user_id,run_id) REFERENCES copilot_runs(user_id,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_message_event ON channel_messages(user_id,account_id,event_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_message_provider ON channel_messages(user_id,account_id,message_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_message_run ON channel_messages(user_id,run_id);
--> statement-breakpoint
CREATE INDEX idx_channel_message_pending ON channel_messages(user_id,status,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_message_tenant ON channel_messages(user_id,id);
--> statement-breakpoint
CREATE TABLE channel_message_events (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, account_id TEXT NOT NULL,
 event_id TEXT NOT NULL, inbox_id TEXT NOT NULL,
 PRIMARY KEY(user_id,account_id,event_id),
 FOREIGN KEY(user_id,inbox_id) REFERENCES channel_messages(user_id,id) ON DELETE CASCADE
);
