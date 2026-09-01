-- Preserve historical rows on parent deletion while rejecting cross-tenant
-- parent references on every insert and ownership-changing update.
CREATE TEMP TABLE `_history_tenant_guard` (
  `conflict` integer NOT NULL CHECK (`conflict` = 0)
);
--> statement-breakpoint
INSERT INTO `_history_tenant_guard` (`conflict`)
SELECT 1
FROM `session_activities` AS `activity`
LEFT JOIN `sessions` AS `session`
  ON `session`.`id` = `activity`.`session_id`
 AND `session`.`user_id` = `activity`.`user_id`
WHERE `activity`.`session_id` IS NOT NULL AND `session`.`id` IS NULL
LIMIT 1;
--> statement-breakpoint
INSERT INTO `_history_tenant_guard` (`conflict`)
SELECT 1
FROM `session_activities` AS `activity`
LEFT JOIN `projects` AS `project`
  ON `project`.`id` = `activity`.`project_id`
 AND `project`.`user_id` = `activity`.`user_id`
WHERE `activity`.`project_id` IS NOT NULL AND `project`.`id` IS NULL
LIMIT 1;
--> statement-breakpoint
INSERT INTO `_history_tenant_guard` (`conflict`)
SELECT 1
FROM `session_snapshots` AS `snapshot`
LEFT JOIN `sessions` AS `session`
  ON `session`.`id` = `snapshot`.`session_id`
 AND `session`.`user_id` = `snapshot`.`user_id`
WHERE `snapshot`.`session_id` IS NOT NULL AND `session`.`id` IS NULL
LIMIT 1;
--> statement-breakpoint
INSERT INTO `_history_tenant_guard` (`conflict`)
SELECT 1
FROM `session_snapshots` AS `snapshot`
LEFT JOIN `projects` AS `project`
  ON `project`.`id` = `snapshot`.`project_id`
 AND `project`.`user_id` = `snapshot`.`user_id`
WHERE `snapshot`.`project_id` IS NOT NULL AND `project`.`id` IS NULL
LIMIT 1;
--> statement-breakpoint
INSERT INTO `_history_tenant_guard` (`conflict`)
SELECT 1
FROM `token_usage_records` AS `usage`
LEFT JOIN `projects` AS `project`
  ON `project`.`id` = `usage`.`project_id`
 AND `project`.`user_id` = `usage`.`user_id`
WHERE `usage`.`project_id` IS NOT NULL AND `project`.`id` IS NULL
LIMIT 1;
--> statement-breakpoint
DROP TABLE `_history_tenant_guard`;
--> statement-breakpoint
CREATE TRIGGER `session_activities_tenant_insert`
BEFORE INSERT ON `session_activities`
WHEN (
  NEW.`session_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `sessions`
    WHERE `id` = NEW.`session_id` AND `user_id` = NEW.`user_id`
  )
) OR (
  NEW.`project_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `projects`
    WHERE `id` = NEW.`project_id` AND `user_id` = NEW.`user_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'session activity tenant mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `session_activities_tenant_update`
BEFORE UPDATE OF `user_id`, `session_id`, `project_id` ON `session_activities`
WHEN (
  NEW.`session_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `sessions`
    WHERE `id` = NEW.`session_id` AND `user_id` = NEW.`user_id`
  )
) OR (
  NEW.`project_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `projects`
    WHERE `id` = NEW.`project_id` AND `user_id` = NEW.`user_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'session activity tenant mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `session_snapshots_tenant_insert`
BEFORE INSERT ON `session_snapshots`
WHEN (
  NEW.`session_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `sessions`
    WHERE `id` = NEW.`session_id` AND `user_id` = NEW.`user_id`
  )
) OR (
  NEW.`project_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `projects`
    WHERE `id` = NEW.`project_id` AND `user_id` = NEW.`user_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'session snapshot tenant mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `session_snapshots_tenant_update`
BEFORE UPDATE OF `user_id`, `session_id`, `project_id` ON `session_snapshots`
WHEN (
  NEW.`session_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `sessions`
    WHERE `id` = NEW.`session_id` AND `user_id` = NEW.`user_id`
  )
) OR (
  NEW.`project_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `projects`
    WHERE `id` = NEW.`project_id` AND `user_id` = NEW.`user_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'session snapshot tenant mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `token_usage_records_tenant_insert`
BEFORE INSERT ON `token_usage_records`
WHEN NEW.`project_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `projects`
    WHERE `id` = NEW.`project_id` AND `user_id` = NEW.`user_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'token usage tenant mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `token_usage_records_tenant_update`
BEFORE UPDATE OF `user_id`, `project_id` ON `token_usage_records`
WHEN NEW.`project_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `projects`
    WHERE `id` = NEW.`project_id` AND `user_id` = NEW.`user_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'token usage tenant mismatch');
END;
