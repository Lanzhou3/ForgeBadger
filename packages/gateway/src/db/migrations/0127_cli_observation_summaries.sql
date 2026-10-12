ALTER TABLE feishu_notification_settings ADD COLUMN content_level TEXT NOT NULL DEFAULT 'status' CHECK(content_level IN ('status','summary'));
--> statement-breakpoint
CREATE TABLE cli_observation_runtimes (
 user_id TEXT NOT NULL, session_id TEXT NOT NULL, epoch TEXT NOT NULL, token_fingerprint TEXT NOT NULL,
 current_native_session_id TEXT, current_turn_id TEXT,
 PRIMARY KEY(user_id,session_id),
 FOREIGN KEY(user_id,session_id) REFERENCES sessions(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE cli_observations (
 user_id TEXT NOT NULL, session_id TEXT NOT NULL, runtime_epoch TEXT NOT NULL,
 native_session_id TEXT NOT NULL, turn_id TEXT NOT NULL, summary_json TEXT NOT NULL, observed_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,session_id,runtime_epoch,native_session_id,turn_id),
 FOREIGN KEY(user_id,session_id) REFERENCES sessions(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX cli_observation_latest ON cli_observations(user_id,session_id,observed_at);
