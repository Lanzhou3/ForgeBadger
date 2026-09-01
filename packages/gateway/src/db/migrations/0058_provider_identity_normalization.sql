-- The repository treats NULL and an empty base URL as the same provider
-- identity. Reject historical duplicates before enforcing that invariant.
CREATE TEMP TABLE `_provider_identity_guard` (
  `conflict` integer NOT NULL CHECK (`conflict` = 0)
);
--> statement-breakpoint
INSERT INTO `_provider_identity_guard` (`conflict`)
SELECT 1
FROM `model_provider_profiles`
GROUP BY `user_id`, `provider_key`, ifnull(`base_url`, '')
HAVING count(*) > 1;
--> statement-breakpoint
DROP TABLE `_provider_identity_guard`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_model_provider_profiles_user_key_url`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_provider_profiles_user_key_url`
  ON `model_provider_profiles` (`user_id`, `provider_key`, ifnull(`base_url`, ''));
