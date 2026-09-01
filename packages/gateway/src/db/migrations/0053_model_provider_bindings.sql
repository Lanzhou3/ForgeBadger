-- Explicit tenant-scoped provider/model/auth bindings and immutable session launch snapshots.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_model_provider_profiles_id_user`
  ON `model_provider_profiles` (`id`,`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_model_profiles_id_user_provider`
  ON `model_profiles` (`id`,`user_id`,`provider_profile_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_provider_credentials_id_user_provider`
  ON `provider_credentials` (`id`,`user_id`,`provider_profile_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_projects_id_user`
  ON `projects` (`id`,`user_id`);
--> statement-breakpoint
CREATE TABLE `model_provider_bindings` (
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
    CHECK (`adapter` IN ('claude','opencode','codex','kimi')),
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
CREATE UNIQUE INDEX `idx_model_provider_bindings_id_user`
  ON `model_provider_bindings` (`id`,`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_provider_bindings_active_scope`
  ON `model_provider_bindings` (`user_id`,`adapter`,`scope`,`scope_key`)
  WHERE `status` = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_provider_bindings_active_locator`
  ON `model_provider_bindings` (`adapter`,`target_locator_hash`)
  WHERE `status` = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_provider_bindings_active_realpath`
  ON `model_provider_bindings` (`adapter`,`target_realpath_hash`)
  WHERE `status` = 'active' AND `target_realpath_hash` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_model_provider_bindings_user_provider`
  ON `model_provider_bindings` (`user_id`,`provider_profile_id`);
--> statement-breakpoint
CREATE TABLE `sessions_v3` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `name` text NOT NULL,
  `ai_tool` text NOT NULL,
  `model_id` text,
  `status` text DEFAULT 'idle' NOT NULL,
  `attach_token` text DEFAULT '' NOT NULL,
  `tmux_session` text,
  `working_dir` text NOT NULL,
  `credential_mode` text DEFAULT 'host_environment' NOT NULL,
  `api_key_id` text,
  `last_active` integer,
  `error_message` text,
  `binding_id` text,
  `provider_profile_id` text,
  `model_profile_id` text,
  `provider_credential_id` text,
  `launch_auth_mode` text,
  `launch_provider_id` text,
  `launch_model_id` text,
  `launch_base_url` text,
  `launch_env_name` text,
  `launch_wire_api` text,
  `created_at` integer,
  `updated_at` integer,
  CONSTRAINT `sessions_launch_snapshot_complete` CHECK (
    (`binding_id` IS NULL AND `provider_profile_id` IS NULL AND `model_profile_id` IS NULL
      AND `provider_credential_id` IS NULL AND `launch_auth_mode` IS NULL AND `launch_provider_id` IS NULL
      AND `launch_model_id` IS NULL AND `launch_base_url` IS NULL AND `launch_env_name` IS NULL AND `launch_wire_api` IS NULL)
    OR (`binding_id` IS NOT NULL AND `provider_profile_id` IS NOT NULL AND `model_profile_id` IS NOT NULL
      AND `launch_auth_mode` IS NOT NULL AND `launch_provider_id` IS NOT NULL AND `launch_model_id` IS NOT NULL
      AND ((`launch_auth_mode` = 'managed_credential' AND `provider_credential_id` IS NOT NULL AND `launch_env_name` IS NOT NULL)
        OR (`launch_auth_mode` <> 'managed_credential' AND `provider_credential_id` IS NULL)))
  ),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`model_id`) REFERENCES `model_profiles`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`binding_id`,`user_id`) REFERENCES `model_provider_bindings`(`id`,`user_id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`provider_profile_id`,`user_id`) REFERENCES `model_provider_profiles`(`id`,`user_id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`model_profile_id`,`user_id`,`provider_profile_id`) REFERENCES `model_profiles`(`id`,`user_id`,`provider_profile_id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`provider_credential_id`,`user_id`,`provider_profile_id`) REFERENCES `provider_credentials`(`id`,`user_id`,`provider_profile_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `sessions_v3` (
  `id`,`user_id`,`project_id`,`name`,`ai_tool`,`model_id`,`status`,`attach_token`,`tmux_session`,
  `working_dir`,`credential_mode`,`api_key_id`,`last_active`,`error_message`,`created_at`,`updated_at`
)
SELECT
  `id`,`user_id`,`project_id`,`name`,`ai_tool`,`model_id`,`status`,`attach_token`,`tmux_session`,
  `working_dir`,`credential_mode`,`api_key_id`,`last_active`,`error_message`,`created_at`,`updated_at`
FROM `sessions`;
--> statement-breakpoint
DROP TABLE `sessions`;
--> statement-breakpoint
ALTER TABLE `sessions_v3` RENAME TO `sessions`;
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_project` ON `sessions` (`user_id`,`project_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sessions_user_project_id` ON `sessions` (`user_id`,`project_id`,`id`);
--> statement-breakpoint
CREATE INDEX `idx_sessions_status` ON `sessions` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_sessions_binding` ON `sessions` (`user_id`,`binding_id`);
--> statement-breakpoint
CREATE TRIGGER `sessions_launch_snapshot_immutable`
BEFORE UPDATE ON `sessions`
WHEN OLD.`binding_id` IS NOT NULL AND (
  OLD.`binding_id` IS NOT NEW.`binding_id`
  OR OLD.`provider_profile_id` IS NOT NEW.`provider_profile_id`
  OR OLD.`model_profile_id` IS NOT NEW.`model_profile_id`
  OR OLD.`provider_credential_id` IS NOT NEW.`provider_credential_id`
  OR OLD.`launch_auth_mode` IS NOT NEW.`launch_auth_mode`
  OR OLD.`launch_provider_id` IS NOT NEW.`launch_provider_id`
  OR OLD.`launch_model_id` IS NOT NEW.`launch_model_id`
  OR OLD.`launch_base_url` IS NOT NEW.`launch_base_url`
  OR OLD.`launch_env_name` IS NOT NEW.`launch_env_name`
  OR OLD.`launch_wire_api` IS NOT NEW.`launch_wire_api`
)
BEGIN
  SELECT RAISE(ABORT, 'session launch snapshot is immutable');
END;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
