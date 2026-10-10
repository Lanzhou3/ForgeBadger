-- Retire the per-project Copilot autonomy switch (added in 0104, collapsed
-- as the sole authorization axis in 0131): programmatic dispatch is no
-- longer gated per project. Owner-level tool switches, the security policy
-- and tenant scope remain the enforcement boundary.
ALTER TABLE projects DROP COLUMN copilot_autonomy;
