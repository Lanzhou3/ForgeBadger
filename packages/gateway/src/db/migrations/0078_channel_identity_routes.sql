CREATE TABLE channel_pairings (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 channel TEXT NOT NULL, account_id TEXT NOT NULL, account_revision INTEGER NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending', revision INTEGER NOT NULL DEFAULT 1,
 external_user_id TEXT, chat_id TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_channel_pairing_owner ON channel_pairings(user_id, account_id, created_at);
--> statement-breakpoint
CREATE TABLE channel_identities (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 channel TEXT NOT NULL, account_id TEXT NOT NULL, account_revision INTEGER NOT NULL,
 external_user_id TEXT NOT NULL, chat_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active', revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_identity_tenant ON channel_identities(user_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_identity_peer ON channel_identities(user_id,channel,account_id,account_revision,external_user_id,chat_id) WHERE status='active';
--> statement-breakpoint
CREATE TABLE channel_routes (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 identity_id TEXT NOT NULL, grant_id TEXT NOT NULL, grant_revision INTEGER NOT NULL,
 conversation_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,
 FOREIGN KEY(user_id,identity_id) REFERENCES channel_identities(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,grant_id) REFERENCES copilot_grants(user_id,id),
 FOREIGN KEY(user_id,conversation_id) REFERENCES copilot_conversations(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_route_active ON channel_routes(user_id,identity_id) WHERE status='active';
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channel_route_conversation ON channel_routes(user_id,conversation_id);
