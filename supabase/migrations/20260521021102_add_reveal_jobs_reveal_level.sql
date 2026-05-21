-- The reveal authority level snapshotted from the requester's profile at
-- job creation (ADR 0009). 0 = director (sees all faces), higher = restricted
-- to faces with chain_index >= reveal_level. Default 0 keeps legacy behaviour.
ALTER TABLE reveal_jobs ADD COLUMN IF NOT EXISTS reveal_level INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN reveal_jobs.reveal_level IS 'Requester reveal authority (ADR 0009). 0=director(all). Gates which chain_index faces can be unsealed.';
