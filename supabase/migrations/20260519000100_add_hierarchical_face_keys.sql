-- Hierarchical per-face key access control (ADR 0009)
-- All columns nullable / defaulted → existing recordings + reveals unaffected.

-- Position of this face in the recording's hash chain (0 = first detected).
-- NULL for recordings created before this feature (legacy whole-key reveal).
ALTER TABLE faces ADD COLUMN IF NOT EXISTS chain_index INT;

-- The face's ArcFace embedding, sealed with the chain key K_index
-- (AES-256-GCM, base64). Only a holder of K_level (level <= chain_index)
-- can unseal it → cryptographic reveal gate. NULL = legacy (plain embedding).
ALTER TABLE faces ADD COLUMN IF NOT EXISTS embedding_sealed TEXT;

-- Reveal authority level for a user. 0 = director (sees all faces),
-- higher = more restricted (sees only chain_index >= reveal_level).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reveal_level INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN faces.chain_index IS 'Hash-chain position (ADR 0009). 0=first detected. NULL=legacy.';
COMMENT ON COLUMN faces.embedding_sealed IS 'ArcFace embedding sealed with chain key K_index (AES-GCM base64). ADR 0009.';
COMMENT ON COLUMN profiles.reveal_level IS 'Hierarchical reveal authority. 0=director(all), higher=restricted. ADR 0009.';
