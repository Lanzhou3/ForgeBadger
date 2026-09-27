-- Retain invalid selections after a model is removed; execution must fail visibly, not fall back.
ALTER TABLE channel_route_sessions ADD COLUMN model_profile_id TEXT;
