ALTER TABLE channel_messages ADD COLUMN conversation_id TEXT REFERENCES copilot_conversations(id);
--> statement-breakpoint
UPDATE channel_messages SET conversation_id=(SELECT r.conversation_id FROM copilot_runs r
 WHERE r.user_id=channel_messages.user_id AND r.id=channel_messages.run_id) WHERE run_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_channel_message_conversation ON channel_messages(user_id,conversation_id,status);
