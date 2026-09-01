-- Validate only the parent reference changed by an FK action. Validating both
-- nullable parents during a project cascade can observe SQLite's intermediate
-- delete state and incorrectly block ON DELETE SET NULL.
DROP TRIGGER IF EXISTS `session_activities_tenant_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `session_snapshots_tenant_update`;
--> statement-breakpoint
CREATE TRIGGER `session_activities_tenant_user_update`
BEFORE UPDATE OF `user_id` ON `session_activities`
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
CREATE TRIGGER `session_activities_tenant_session_update`
BEFORE UPDATE OF `session_id` ON `session_activities`
WHEN NEW.`session_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `sessions`
    WHERE `id` = NEW.`session_id` AND `user_id` = NEW.`user_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'session activity tenant mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `session_activities_tenant_project_update`
BEFORE UPDATE OF `project_id` ON `session_activities`
WHEN NEW.`project_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `projects`
    WHERE `id` = NEW.`project_id` AND `user_id` = NEW.`user_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'session activity tenant mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `session_snapshots_tenant_user_update`
BEFORE UPDATE OF `user_id` ON `session_snapshots`
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
CREATE TRIGGER `session_snapshots_tenant_session_update`
BEFORE UPDATE OF `session_id` ON `session_snapshots`
WHEN NEW.`session_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `sessions`
    WHERE `id` = NEW.`session_id` AND `user_id` = NEW.`user_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'session snapshot tenant mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER `session_snapshots_tenant_project_update`
BEFORE UPDATE OF `project_id` ON `session_snapshots`
WHEN NEW.`project_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `projects`
    WHERE `id` = NEW.`project_id` AND `user_id` = NEW.`user_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'session snapshot tenant mismatch');
END;
