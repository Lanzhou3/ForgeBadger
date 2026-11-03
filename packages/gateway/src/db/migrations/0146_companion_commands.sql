CREATE TABLE companion_commands (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 command_type TEXT NOT NULL,
 payload_encrypted TEXT NOT NULL,
 payload_digest TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'accepted',
 effect_status TEXT NOT NULL DEFAULT 'none',
 authority_revision INTEGER NOT NULL,
 result_reference TEXT,
 error_code TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(device_id,id),
 FOREIGN KEY(user_id,device_id) REFERENCES companion_devices(user_id,id) ON DELETE CASCADE,
 CHECK(status IN ('accepted','running','succeeded','rejected','failed','unknown')),
 CHECK(effect_status IN ('none','confirmed','unknown'))
);
--> statement-breakpoint
CREATE INDEX idx_companion_commands_device_updated ON companion_commands(user_id,device_id,updated_at);
--> statement-breakpoint
CREATE INDEX idx_companion_commands_recovery ON companion_commands(status,updated_at);
