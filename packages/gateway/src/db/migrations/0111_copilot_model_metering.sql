ALTER TABLE copilot_model_calls ADD COLUMN model_json text;
--> statement-breakpoint
ALTER TABLE copilot_model_calls ADD COLUMN pricing_json text;
--> statement-breakpoint
ALTER TABLE copilot_model_calls ADD COLUMN cost_nanousd integer;
--> statement-breakpoint
CREATE TABLE copilot_token_rates (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_profile_id text NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
  rates_json text NOT NULL,
  updated_at integer NOT NULL,
  PRIMARY KEY(user_id,model_profile_id)
);
