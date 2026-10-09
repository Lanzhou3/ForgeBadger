-- Provider api_format values moved from vendor identity to wire-protocol names:
-- "openai" (ambiguous — meant OpenAI-native /responses but was routinely picked
-- for third-party chat-completions gateways, breaking OpenCode/PI/mcode applies)
-- became "openai-responses"; "bedrock" was removed from the enum (no apply path
-- ever supported it end-to-end); "local" was folded into "openai-compatible"
-- (Ollama/vLLM and friends expose OpenAI chat-completions ports, so the alias
-- carried no distinct protocol).
--
-- Rows are reclassified by what their endpoint actually speaks. Only rows that
-- keep OpenAI-native semantics (api.openai.com endpoints, or the provider keys
-- the old Codex/PI resolution already treated as native: openai/codex/chatgpt)
-- become "openai-responses"; every other legacy "openai" row was already driven
-- through chat completions by the Copilot transport and the Claude route, so it
-- becomes "openai-compatible" — which also fixes third-party OpenCode applies.
-- Bedrock and local rows are folded into "openai-compatible" as well; re-edit
-- those providers to the protocol they actually use (or delete them).
UPDATE `model_provider_profiles`
SET `api_format` = 'openai-compatible'
WHERE `api_format` = 'openai'
	AND `provider_key` NOT IN ('openai', 'codex', 'chatgpt')
	AND COALESCE(`openai_base_url`, `base_url`, '') NOT LIKE '%api.openai.com%';
--> statement-breakpoint
UPDATE `model_provider_profiles`
SET `api_format` = 'openai-responses'
WHERE `api_format` = 'openai';
--> statement-breakpoint
UPDATE `model_provider_profiles`
SET `api_format` = 'openai-compatible'
WHERE `api_format` IN ('bedrock', 'local');
