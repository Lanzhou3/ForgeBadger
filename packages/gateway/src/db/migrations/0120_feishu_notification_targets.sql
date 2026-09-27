ALTER TABLE feishu_notification_settings ADD COLUMN target_id TEXT;
--> statement-breakpoint
UPDATE feishu_notification_settings SET target_id='private:' || identity_id WHERE identity_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE feishu_notification_deliveries ADD COLUMN target_id TEXT;
--> statement-breakpoint
ALTER TABLE feishu_notification_deliveries ADD COLUMN target_revision INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Existing in-flight requests retain their outcome; old pending work is cancelled,
-- never redirected or revived by the new notification authorization semantics.
UPDATE feishu_notification_deliveries SET status='cancelled',error_code='TARGET_MIGRATED'
WHERE status='pending';
--> statement-breakpoint
CREATE TABLE feishu_notification_groups (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL,
 account_revision INTEGER NOT NULL,
 chat_id TEXT NOT NULL,
 name TEXT NOT NULL,
 available INTEGER NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 1,
 checked_at INTEGER NOT NULL,
 UNIQUE(user_id,account_id,account_revision,chat_id)
);
