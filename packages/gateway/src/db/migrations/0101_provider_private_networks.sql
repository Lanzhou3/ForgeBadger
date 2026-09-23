-- Per-provider opt-in to trusted private / loopback endpoint addresses
-- (e.g. a local Ollama or vLLM server on 127.0.0.1). Only the
-- private/loopback/link-local IP blocklist and loopback hostname checks are
-- relaxed; cloud metadata hosts (169.254.169.254, *.metadata.google.internal),
-- `.internal` names, and credentials-in-URL remain blocked.
ALTER TABLE `model_provider_profiles`
  ADD COLUMN `allow_private_networks` integer DEFAULT 0 NOT NULL CHECK (`allow_private_networks` IN (0, 1));
