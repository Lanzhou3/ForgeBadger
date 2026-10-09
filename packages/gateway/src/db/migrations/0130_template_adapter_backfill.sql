-- Materialize the historically implicit Claude binding for adapter-less
-- templates created before templates declared a target CLI. Rendering no
-- longer assumes a default adapter, so the legacy meaning is pinned in data.
UPDATE templates SET adapter = 'claude' WHERE adapter IS NULL;
