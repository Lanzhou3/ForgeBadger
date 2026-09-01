-- Freeze provider credential generations and desired launch safety state.
ALTER TABLE `provider_credentials`
  ADD COLUMN `generation` integer DEFAULT 1 NOT NULL CHECK (`generation` >= 1);
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `credential_generation` integer;
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `launch_desired_fingerprint` text;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `sessions_launch_snapshot_immutable`;
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
