ALTER TABLE companion_pairings ADD COLUMN device_id TEXT;
--> statement-breakpoint
CREATE TABLE companion_outbox (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 sequence INTEGER NOT NULL,
 event_type TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(device_id,sequence),
 FOREIGN KEY(user_id,device_id) REFERENCES companion_devices(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX idx_companion_outbox_device_sequence ON companion_outbox(user_id,device_id,sequence);
--> statement-breakpoint
CREATE INDEX idx_companion_outbox_created ON companion_outbox(created_at);
