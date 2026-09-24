-- Per-model thinking-strength declaration for Model Center -> CLI config sync.
-- support_efforts is a JSON array of levels (low|medium|high|xhigh|max);
-- default_effort is nullable (NULL = the CLI keeps its own default).
-- The Kimi Code adapter writes both into the model alias entry in
-- ~/.kimi-code/config.toml (support_efforts / default_effort keys).
ALTER TABLE `model_profiles` ADD COLUMN `support_efforts` TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `model_profiles` ADD COLUMN `default_effort` TEXT;
