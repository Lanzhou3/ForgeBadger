-- Drizzle `mode: "timestamp"` stores Unix seconds. Two raw SQL update paths
-- historically wrote JavaScript milliseconds into these same columns. Repair
-- only values that cannot plausibly be Unix seconds; native millisecond-domain
-- tables (providers, project manager, Feishu, Copilot) remain unchanged.
UPDATE `sessions`
SET `updated_at` = CAST(`updated_at` / 1000 AS integer)
WHERE `updated_at` >= 100000000000;
--> statement-breakpoint
UPDATE `notifications`
SET `updated_at` = CAST(`updated_at` / 1000 AS integer)
WHERE `updated_at` >= 100000000000;
