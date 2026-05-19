UPDATE `model_provider_profiles`
SET `supported_adapters` = '["claude"]'
WHERE `supported_adapters` = '[]'
	OR `supported_adapters` LIKE '%codex%';
