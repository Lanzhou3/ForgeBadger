-- Grok became a first-class apply-provider target after providers were
-- created: existing profiles predate the adapter, so their supported_adapters
-- lists never mention it. Backfill "grok" for every API format config.toml
-- can express (messages, responses, chat_completions). google has no Grok
-- backend and is excluded. Follows the 0123 pattern.
UPDATE `model_provider_profiles`
SET `supported_adapters` = json_insert(`supported_adapters`, '$[#]', 'grok')
WHERE `api_format` IN ('anthropic', 'openai-responses', 'openai-compatible')
	AND NOT EXISTS (
		SELECT 1
		FROM json_each(`model_provider_profiles`.`supported_adapters`)
		WHERE json_each.`value` = 'grok'
	);
