CREATE UNIQUE INDEX idx_sessions_tenant_identity ON sessions(user_id,id);
--> statement-breakpoint
CREATE TABLE session_runtime_confirmations (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id text NOT NULL,
 runtime_name text NOT NULL,
 launch_nonce text NOT NULL UNIQUE,
 daemon_pid integer NOT NULL CHECK(daemon_pid > 0),
 daemon_started_at text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','stopped')),
 receipt_json text,
 updated_at integer NOT NULL,
 PRIMARY KEY(user_id,session_id),
 FOREIGN KEY(user_id,session_id) REFERENCES sessions(user_id,id) ON DELETE CASCADE,
 CHECK((status='pending' AND receipt_json IS NULL) OR (status='stopped' AND receipt_json IS NOT NULL))
);
