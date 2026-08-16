-- Context auto-compression for the Copilot harness.
--
-- Additive columns on copilot_conversations carrying the rolling summary used
-- to keep long conversations within the model context window. summary is the
-- accumulated LLM-produced digest of all messages up to
-- summary_covered_sequence; later turns fold newly-overflowed messages into it
-- instead of resending everything. NULL summary means no compression yet.
ALTER TABLE `copilot_conversations` ADD `summary` text;
--> statement-breakpoint
ALTER TABLE `copilot_conversations` ADD `summary_covered_sequence` integer;
--> statement-breakpoint
ALTER TABLE `copilot_conversations` ADD `last_summary_at` integer;
