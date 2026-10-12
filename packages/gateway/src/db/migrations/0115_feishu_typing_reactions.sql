-- Keep compensation records when a route/conversation is revoked or removed.
CREATE TABLE feishu_typing_reactions (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 inbox_id TEXT NOT NULL, account_id TEXT NOT NULL, app_id TEXT NOT NULL,
 message_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', reaction_id TEXT,
 claim_token TEXT, lease_until INTEGER, attempt_count INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0, reconcile_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,inbox_id),
 CONSTRAINT feishu_typing_state CHECK(state IN ('pending','adding','active','uncertain','done'))
);
--> statement-breakpoint
CREATE INDEX idx_feishu_typing_due ON feishu_typing_reactions(user_id,state,next_attempt_at);
