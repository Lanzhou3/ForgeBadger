-- Preserve existing runs and receipts; older clients retain unkeyed admission.
ALTER TABLE copilot_runs ADD COLUMN client_request_id text;
--> statement-breakpoint
ALTER TABLE copilot_runs ADD COLUMN request_digest text;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_copilot_request_identity ON copilot_runs(user_id,conversation_id,client_request_id) WHERE client_request_id IS NOT NULL;
