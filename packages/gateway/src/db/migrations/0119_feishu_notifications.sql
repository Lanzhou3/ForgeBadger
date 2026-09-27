CREATE TABLE feishu_notification_settings (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL DEFAULT 0, identity_id TEXT,
 types_json TEXT NOT NULL DEFAULT '["attention","failure","completion"]',
 web_base_url TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL
);
--> statement-breakpoint
-- References are resolved with tenant filtering at send time. Keep delivery history after
-- notifications/identities are deleted; missing source records cancel unsent deliveries.
CREATE TABLE feishu_notification_deliveries (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 notification_id TEXT, test_key TEXT, event_type TEXT NOT NULL,
 subscription_revision INTEGER NOT NULL, identity_revision INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', error_code TEXT, provider_message_id TEXT,
 claim_token TEXT, lease_until INTEGER, attempt_count INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
 CHECK(status IN ('pending','sending','delivered','failed','unknown','cancelled')),
 CHECK((notification_id IS NOT NULL AND test_key IS NULL) OR (notification_id IS NULL AND test_key IS NOT NULL)),
 UNIQUE(user_id,notification_id), UNIQUE(user_id,test_key)
);
--> statement-breakpoint
CREATE INDEX idx_feishu_notification_due ON feishu_notification_deliveries(user_id,status,next_attempt_at);
