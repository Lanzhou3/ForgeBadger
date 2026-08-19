-- Pairs each tool_call assistant message with its tool_result so the chat UI
-- can render a single status icon (running / ok / error / denied) for the pair
-- instead of treating the assistant tool_call row as a one-off line. The id
-- comes from the model's streamed tool_call event; tool_result rows written
-- by the orchestrator carry the same id so the UI can join them in JS.
ALTER TABLE `copilot_messages` ADD COLUMN `tool_call_id` text;
--> statement-breakpoint
CREATE INDEX `idx_copilot_messages_tool_call_id` ON `copilot_messages` (`tool_call_id`);