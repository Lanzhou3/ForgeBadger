-- MiniMax Code became a first-class apply-provider target after providers
-- were created: existing profiles predate the adapter, so their
-- supported_adapters lists never mention it. Backfill "mcode" for every API
-- format the mcode apply branch can write (anthropic-messages,
-- openai-responses, openai-completions), following the 0072/0088 pattern used
-- when Kimi Code and PI became first-class adapters, so the Apply-to-CLI dialog
-- offers MiniMax Code for existing providers too. google/bedrock/local have
-- no corresponding `api` value in config.yaml and are excluded.
UPDATE `model_provider_profiles`
SET `supported_adapters` = json_insert(`supported_adapters`, '$[#]', 'mcode')
WHERE `api_format` IN ('anthropic', 'openai', 'openai-compatible')
	AND NOT EXISTS (
		SELECT 1
		FROM json_each(`model_provider_profiles`.`supported_adapters`)
		WHERE json_each.`value` = 'mcode'
	);
