-- Per-provider opt-in to a trusted plaintext `http:` endpoint. Only the
-- protocol requirement is relaxed; all SSRF host/IP/metadata checks still apply.
ALTER TABLE `model_provider_profiles`
  ADD COLUMN `allow_plaintext_http` integer DEFAULT 0 NOT NULL CHECK (`allow_plaintext_http` IN (0, 1));
