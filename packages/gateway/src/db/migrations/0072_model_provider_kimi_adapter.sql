-- Kimi Code became a first-class apply-provider target after providers were
-- created: existing profiles predate the adapter, so their supported_adapters
-- lists never mention it. Backfill "kimi" for every API format the Kimi apply
-- branch can write (openai/openai-compatible/anthropic), so the Apply-to-CLI
-- dialog offers Kimi Code for existing providers too.
UPDATE `model_provider_profiles`
SET `supported_adapters` = json_insert(`supported_adapters`, '$[#]', 'kimi')
WHERE `api_format` IN ('openai', 'openai-compatible', 'anthropic')
	AND NOT EXISTS (
		SELECT 1
		FROM json_each(`model_provider_profiles`.`supported_adapters`)
		WHERE json_each.`value` = 'kimi'
	);
