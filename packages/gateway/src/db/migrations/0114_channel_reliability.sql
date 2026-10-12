CREATE TABLE channel_route_sessions (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 route_id TEXT NOT NULL, chat_type TEXT NOT NULL, chat_id TEXT NOT NULL,
 thread_id TEXT NOT NULL DEFAULT '', conversation_id TEXT NOT NULL,
 PRIMARY KEY(user_id,route_id,chat_type,chat_id,thread_id),
 FOREIGN KEY(user_id,route_id) REFERENCES channel_routes(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,conversation_id) REFERENCES copilot_conversations(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_session_conversation ON channel_route_sessions(user_id,conversation_id);
--> statement-breakpoint
INSERT INTO channel_route_sessions(user_id,route_id,chat_type,chat_id,conversation_id)
 SELECT r.user_id,r.id,'p2p',i.chat_id,r.conversation_id FROM channel_routes r
 JOIN channel_identities i ON i.user_id=r.user_id AND i.id=r.identity_id;
--> statement-breakpoint
ALTER TABLE channel_messages ADD COLUMN chat_id TEXT;
--> statement-breakpoint
DROP INDEX idx_channel_message_provider;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_message_provider ON channel_messages(user_id,account_id,chat_id,message_id);
--> statement-breakpoint
CREATE TABLE telegram_polling_cursors (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL, account_revision INTEGER NOT NULL, next_offset INTEGER NOT NULL,
 PRIMARY KEY(user_id,account_id,account_revision)
);
--> statement-breakpoint
ALTER TABLE channel_deliveries ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE channel_deliveries ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE channel_deliveries ADD COLUMN next_part INTEGER NOT NULL DEFAULT 0;
