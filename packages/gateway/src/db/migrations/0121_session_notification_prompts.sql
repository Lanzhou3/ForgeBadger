CREATE TABLE session_notification_prompts (
 user_id TEXT NOT NULL,
 session_id TEXT NOT NULL,
 native_session_id TEXT NOT NULL,
 native_turn_id TEXT NOT NULL DEFAULT '',
 prompt TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY (user_id,session_id,native_session_id,native_turn_id),
 FOREIGN KEY (user_id,session_id) REFERENCES sessions(user_id,id) ON DELETE CASCADE
);
