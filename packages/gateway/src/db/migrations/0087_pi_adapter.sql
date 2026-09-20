-- PI became a first-class adapter: extend model_provider_bindings_adapter_check
-- to include 'pi'. SQLite cannot ALTER a CHECK constraint, so the table is
-- rebuilt (0053/0059 pattern): same DDL in a `_pi` table (only change: 'pi'
-- added to the adapter check), rows copied, copy guarded by row count, old
-- table dropped, renamed back, indexes recreated with the 0056 shapes.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `model_provider_bindings_pi` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `adapter` text NOT NULL,
  `scope` text NOT NULL,
  `scope_key` text NOT NULL,
  `project_id` text,
  `provider_profile_id` text NOT NULL,
  `model_profile_id` text NOT NULL,
  `provider_credential_id` text,
  `auth_mode` text NOT NULL,
  `target_locator_hash` text NOT NULL,
  `target_realpath_hash` text,
  `desired_revision` integer DEFAULT 1 NOT NULL,
  `applied_revision` integer,
  `observed_fingerprint` text,
  `backup_revision` integer,
  `status` text DEFAULT 'active' NOT NULL,
  `revoked_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `model_provider_bindings_adapter_check`
    CHECK (`adapter` IN ('claude','opencode','codex','kimi','pi')),
  CONSTRAINT `model_provider_bindings_auth_mode_check`
    CHECK (`auth_mode` IN ('managed_credential','native_cli_login','host_environment','none')),
  CONSTRAINT `model_provider_bindings_status_check`
    CHECK (`status` IN ('active','revoked')),
  CONSTRAINT `model_provider_bindings_scope_check` CHECK (
    (`scope` = 'global' AND `scope_key` = 'global' AND `project_id` IS NULL)
    OR (`scope` = 'project' AND `project_id` IS NOT NULL AND `scope_key` = `project_id`)
  ),
  CONSTRAINT `model_provider_bindings_credential_check` CHECK (
    (`auth_mode` = 'managed_credential' AND `provider_credential_id` IS NOT NULL)
    OR (`auth_mode` <> 'managed_credential' AND `provider_credential_id` IS NULL)
  ),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`,`user_id`) REFERENCES `projects`(`id`,`user_id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`provider_profile_id`,`user_id`) REFERENCES `model_provider_profiles`(`id`,`user_id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`model_profile_id`,`user_id`,`provider_profile_id`) REFERENCES `model_profiles`(`id`,`user_id`,`provider_profile_id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`provider_credential_id`,`user_id`,`provider_profile_id`) REFERENCES `provider_credentials`(`id`,`user_id`,`provider_profile_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `model_provider_bindings_pi` (
  `id`,`user_id`,`adapter`,`scope`,`scope_key`,`project_id`,`provider_profile_id`,
  `model_profile_id`,`provider_credential_id`,`auth_mode`,`target_locator_hash`,
  `target_realpath_hash`,`desired_revision`,`applied_revision`,`observed_fingerprint`,
  `backup_revision`,`status`,`revoked_at`,`created_at`,`updated_at`
)
SELECT
  `id`,`user_id`,`adapter`,`scope`,`scope_key`,`project_id`,`provider_profile_id`,
  `model_profile_id`,`provider_credential_id`,`auth_mode`,`target_locator_hash`,
  `target_realpath_hash`,`desired_revision`,`applied_revision`,`observed_fingerprint`,
  `backup_revision`,`status`,`revoked_at`,`created_at`,`updated_at`
FROM `model_provider_bindings`;
--> statement-breakpoint
CREATE TEMP TABLE `_pi_binding_copy_guard` (`ok` integer NOT NULL CHECK (`ok` = 0));
--> statement-breakpoint
INSERT INTO `_pi_binding_copy_guard` (`ok`)
SELECT CASE
  WHEN (SELECT count(*) FROM `model_provider_bindings_pi`)
       = (SELECT count(*) FROM `model_provider_bindings`) THEN 0
  ELSE 1
END;
--> statement-breakpoint
DROP TABLE `_pi_binding_copy_guard`;
--> statement-breakpoint
DROP TABLE `model_provider_bindings`;
--> statement-breakpoint
ALTER TABLE `model_provider_bindings_pi` RENAME TO `model_provider_bindings`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_provider_bindings_id_user`
  ON `model_provider_bindings` (`id`,`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_provider_bindings_active_scope`
  ON `model_provider_bindings` (`user_id`,`adapter`,`scope`,`scope_key`)
  WHERE `status` = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_provider_bindings_active_locator`
  ON `model_provider_bindings` (`target_locator_hash`)
  WHERE `status` = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_provider_bindings_active_realpath`
  ON `model_provider_bindings` (`target_realpath_hash`)
  WHERE `status` = 'active' AND `target_realpath_hash` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_model_provider_bindings_user_provider`
  ON `model_provider_bindings` (`user_id`,`provider_profile_id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
