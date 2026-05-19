ALTER TABLE `model_provider_profiles` ADD `anthropic_base_url` text;
--> statement-breakpoint
ALTER TABLE `model_provider_profiles` ADD `openai_base_url` text;
--> statement-breakpoint
ALTER TABLE `model_provider_profiles` ADD `region` text;
--> statement-breakpoint
ALTER TABLE `model_provider_profiles` ADD `product_type` text;
--> statement-breakpoint
UPDATE `model_provider_profiles`
SET
  `anthropic_base_url` = CASE
    WHEN `supported_adapters` LIKE '%claude%' THEN `base_url`
    ELSE NULL
  END,
  `openai_base_url` = CASE
    WHEN `supported_adapters` LIKE '%opencode%' AND `api_format` IN ('openai', 'openai-compatible') THEN `base_url`
    ELSE NULL
  END,
  `region` = 'global',
  `product_type` = CASE
    WHEN `api_format` = 'local' THEN 'local'
    ELSE 'payg_api'
  END;
