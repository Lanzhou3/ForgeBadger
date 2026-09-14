CREATE TABLE channel_deliveries (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 inbox_id TEXT NOT NULL, phase TEXT NOT NULL, payload_encrypted TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', claim_token TEXT, lease_until INTEGER,
 provider_message_id TEXT, created_at INTEGER NOT NULL,
 FOREIGN KEY(user_id,inbox_id) REFERENCES channel_messages(user_id,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_delivery_phase ON channel_deliveries(user_id,inbox_id,phase);
--> statement-breakpoint
CREATE INDEX idx_channel_delivery_pending ON channel_deliveries(user_id,status,created_at);
