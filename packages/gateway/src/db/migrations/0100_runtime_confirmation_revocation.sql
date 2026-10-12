CREATE TABLE `__new_session_runtime_confirmations` (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id text NOT NULL,
 runtime_name text NOT NULL,
 launch_nonce text NOT NULL UNIQUE,
 daemon_pid integer NOT NULL CHECK(daemon_pid > 0),
 daemon_started_at text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','stopped','revoked')),
 receipt_json text,
 updated_at integer NOT NULL,
 PRIMARY KEY(user_id,session_id),
 FOREIGN KEY(user_id,session_id) REFERENCES sessions(user_id,id) ON DELETE CASCADE,
 CHECK((status='pending' AND receipt_json IS NULL) OR (status='stopped' AND receipt_json IS NOT NULL) OR (status='revoked' AND receipt_json IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_session_runtime_confirmations` SELECT * FROM session_runtime_confirmations;
--> statement-breakpoint
DROP TABLE session_runtime_confirmations;
--> statement-breakpoint
ALTER TABLE `__new_session_runtime_confirmations` RENAME TO session_runtime_confirmations;
--> statement-breakpoint
CREATE TRIGGER preserve_pending_runtime_confirmation
BEFORE DELETE ON session_runtime_confirmations
WHEN OLD.status = 'pending'
BEGIN
 SELECT RAISE(ABORT, 'SESSION_RUNTIME_STOP_UNCONFIRMED');
END;
