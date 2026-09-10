CREATE TABLE cli_config_applied_providers (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 adapter TEXT NOT NULL,
 provider_profile_id TEXT NOT NULL REFERENCES model_provider_profiles(id) ON DELETE CASCADE,
 model_profile_id TEXT,
 applied_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id, adapter)
);
