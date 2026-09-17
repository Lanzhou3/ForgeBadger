CREATE TABLE copilot_connections (
 id text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL,
 endpoint text NOT NULL,
 credential_encrypted text,
 enabled integer NOT NULL DEFAULT 0,
 revision integer NOT NULL DEFAULT 1,
 tools_json text NOT NULL DEFAULT '[]',
 enabled_tools_json text NOT NULL DEFAULT '[]',
 last_discovered_at integer,
 created_at integer NOT NULL,
 updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_copilot_connections_user ON copilot_connections(user_id);
