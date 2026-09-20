-- PI became a first-class apply-provider target after providers were created:
-- existing profiles predate the adapter, so their supported_adapters lists
-- never mention it. Backfill "pi" for every API format the PI apply branch
-- can write (anthropic / openai / openai-compatible / google / local —
-- bedrock has no file-based API in models.json), following the 0072 pattern
-- used when Kimi Code became a first-class adapter, so the Apply-to-CLI
-- dialog offers PI for existing providers too.
UPDATE `model_provider_profiles`
SET `supported_adapters` = json_insert(`supported_adapters`, '$[#]', 'pi')
WHERE `api_format` IN ('anthropic', 'openai', 'openai-compatible', 'google', 'local')
	AND NOT EXISTS (
		SELECT 1
		FROM json_each(`model_provider_profiles`.`supported_adapters`)
		WHERE json_each.`value` = 'pi'
	);
