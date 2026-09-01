-- Make session ownership indivisible from its project tenant and tighten frozen launch snapshots.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `sessions_launch_snapshot_immutable`;
--> statement-breakpoint
UPDATE `sessions`
SET `credential_generation` = (
  SELECT `generation` FROM `provider_credentials`
  WHERE `provider_credentials`.`id` = `sessions`.`provider_credential_id`
    AND `provider_credentials`.`user_id` = `sessions`.`user_id`
)
WHERE `binding_id` IS NOT NULL AND `launch_auth_mode` = 'managed_credential'
  AND `credential_generation` IS NULL;
--> statement-breakpoint
UPDATE `sessions`
SET `launch_desired_fingerprint` = lower(hex(zeroblob(32)))
WHERE `binding_id` IS NOT NULL AND `launch_desired_fingerprint` IS NULL;
--> statement-breakpoint
CREATE TABLE `sessions_v4` (
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
  `binding_id` text,
  `provider_profile_id` text,
  `model_profile_id` text,
  `provider_credential_id` text,
  `credential_generation` integer,
  `launch_auth_mode` text,
  `launch_provider_id` text,
  `launch_model_id` text,
  `launch_base_url` text,
  `launch_env_name` text,
  `launch_wire_api` text,
  `launch_desired_fingerprint` text,
  `last_active` integer,
  `error_message` text,
  `created_at` integer,
  `updated_at` integer,
  CONSTRAINT `sessions_credential_generation_check` CHECK (`credential_generation` IS NULL OR `credential_generation` >= 1),
  CONSTRAINT `sessions_launch_snapshot_complete` CHECK (
    (`binding_id` IS NULL AND `provider_profile_id` IS NULL AND `model_profile_id` IS NULL
      AND `provider_credential_id` IS NULL AND `credential_generation` IS NULL
      AND `launch_auth_mode` IS NULL AND `launch_provider_id` IS NULL AND `launch_model_id` IS NULL
      AND `launch_base_url` IS NULL AND `launch_env_name` IS NULL AND `launch_wire_api` IS NULL
      AND `launch_desired_fingerprint` IS NULL)
    OR (`binding_id` IS NOT NULL AND `provider_profile_id` IS NOT NULL AND `model_profile_id` IS NOT NULL
      AND `launch_auth_mode` IS NOT NULL AND `launch_provider_id` IS NOT NULL AND `launch_model_id` IS NOT NULL
      AND `launch_desired_fingerprint` IS NOT NULL
      AND ((`launch_auth_mode` = 'managed_credential' AND `provider_credential_id` IS NOT NULL
        AND `credential_generation` IS NOT NULL AND `launch_env_name` IS NOT NULL)
        OR (`launch_auth_mode` <> 'managed_credential' AND `provider_credential_id` IS NULL
          AND `credential_generation` IS NULL)))
  ),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`,`user_id`) REFERENCES `projects`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`model_id`) REFERENCES `model_profiles`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`binding_id`,`user_id`) REFERENCES `model_provider_bindings`(`id`,`user_id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`provider_profile_id`,`user_id`) REFERENCES `model_provider_profiles`(`id`,`user_id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`model_profile_id`,`user_id`,`provider_profile_id`) REFERENCES `model_profiles`(`id`,`user_id`,`provider_profile_id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`provider_credential_id`,`user_id`,`provider_profile_id`) REFERENCES `provider_credentials`(`id`,`user_id`,`provider_profile_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `sessions_v4` (
  `id`,`user_id`,`project_id`,`name`,`ai_tool`,`model_id`,`status`,`attach_token`,`tmux_session`,
  `working_dir`,`credential_mode`,`api_key_id`,`binding_id`,`provider_profile_id`,`model_profile_id`,
  `provider_credential_id`,`credential_generation`,`launch_auth_mode`,`launch_provider_id`,`launch_model_id`,
  `launch_base_url`,`launch_env_name`,`launch_wire_api`,`launch_desired_fingerprint`,`last_active`,`error_message`,
  `created_at`,`updated_at`
)
SELECT
  `id`,`user_id`,`project_id`,`name`,`ai_tool`,`model_id`,`status`,`attach_token`,`tmux_session`,
  `working_dir`,`credential_mode`,`api_key_id`,`binding_id`,`provider_profile_id`,`model_profile_id`,
  `provider_credential_id`,`credential_generation`,`launch_auth_mode`,`launch_provider_id`,`launch_model_id`,
  `launch_base_url`,`launch_env_name`,`launch_wire_api`,`launch_desired_fingerprint`,`last_active`,`error_message`,
  `created_at`,`updated_at`
FROM `sessions`;
--> statement-breakpoint
DROP TABLE `sessions`;
--> statement-breakpoint
ALTER TABLE `sessions_v4` RENAME TO `sessions`;
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
  OR OLD.`credential_generation` IS NOT NEW.`credential_generation`
  OR OLD.`launch_auth_mode` IS NOT NEW.`launch_auth_mode`
  OR OLD.`launch_provider_id` IS NOT NEW.`launch_provider_id`
  OR OLD.`launch_model_id` IS NOT NEW.`launch_model_id`
  OR OLD.`launch_base_url` IS NOT NEW.`launch_base_url`
  OR OLD.`launch_env_name` IS NOT NEW.`launch_env_name`
  OR OLD.`launch_wire_api` IS NOT NEW.`launch_wire_api`
  OR OLD.`launch_desired_fingerprint` IS NOT NEW.`launch_desired_fingerprint`
)
BEGIN
  SELECT RAISE(ABORT, 'session launch snapshot is immutable');
END;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
