CREATE TABLE companion_host (
 id TEXT PRIMARY KEY NOT NULL,
 host_id TEXT NOT NULL UNIQUE,
 relay_url TEXT NOT NULL,
 signing_public_key TEXT NOT NULL,
 encryption_public_key TEXT NOT NULL,
 signing_private_key_encrypted TEXT NOT NULL,
 encryption_private_key_encrypted TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE companion_pairings (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 host_id TEXT NOT NULL REFERENCES companion_host(host_id) ON DELETE CASCADE,
 host_revision INTEGER NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending',
 revision INTEGER NOT NULL DEFAULT 1,
 project_ids_json TEXT NOT NULL,
 capabilities_json TEXT NOT NULL,
 device_name TEXT,
 device_signing_public_key TEXT,
 device_encryption_public_key TEXT,
 claim_nonce TEXT,
 sas TEXT,
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 CHECK(status IN ('pending','claimed','confirmed','cancelled'))
);
--> statement-breakpoint
CREATE INDEX idx_companion_pairing_owner ON companion_pairings(user_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_companion_pairing_tenant ON companion_pairings(user_id,id);
--> statement-breakpoint
CREATE TABLE companion_devices (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 host_id TEXT NOT NULL REFERENCES companion_host(host_id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 signing_public_key TEXT NOT NULL,
 encryption_public_key TEXT NOT NULL,
 key_fingerprint TEXT NOT NULL,
 project_ids_json TEXT NOT NULL,
 capabilities_json TEXT NOT NULL,
 authority_revision INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'active',
 paired_at INTEGER NOT NULL,
 last_seen_at INTEGER,
 revoked_at INTEGER,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 CHECK(status IN ('active','revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_companion_device_tenant ON companion_devices(user_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_companion_device_active_key ON companion_devices(signing_public_key) WHERE status='active';
--> statement-breakpoint
CREATE INDEX idx_companion_device_owner ON companion_devices(user_id,created_at);
