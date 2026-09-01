-- A physical CLI config target may have only one active owner, regardless of adapter or tenant.
CREATE TEMP TABLE `_binding_target_claim_guard` (`conflict` integer NOT NULL CHECK (`conflict` = 0));
--> statement-breakpoint
INSERT INTO `_binding_target_claim_guard` (`conflict`)
SELECT 1 FROM `model_provider_bindings`
WHERE `status` = 'active'
GROUP BY `target_locator_hash`
HAVING count(*) > 1;
--> statement-breakpoint
INSERT INTO `_binding_target_claim_guard` (`conflict`)
SELECT 1 FROM `model_provider_bindings`
WHERE `status` = 'active' AND `target_realpath_hash` IS NOT NULL
GROUP BY `target_realpath_hash`
HAVING count(*) > 1;
--> statement-breakpoint
DROP TABLE `_binding_target_claim_guard`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_model_provider_bindings_active_locator`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_model_provider_bindings_active_realpath`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_provider_bindings_active_locator`
ON `model_provider_bindings` (`target_locator_hash`)
WHERE `status` = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_provider_bindings_active_realpath`
ON `model_provider_bindings` (`target_realpath_hash`)
WHERE `status` = 'active' AND `target_realpath_hash` IS NOT NULL;
