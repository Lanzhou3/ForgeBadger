CREATE TABLE copilot_plan_confirmations (
  step_id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  run_id text NOT NULL,
  receipt_json text NOT NULL,
  FOREIGN KEY (user_id, run_id, step_id)
    REFERENCES copilot_run_steps(user_id, run_id, id) ON DELETE CASCADE
);
