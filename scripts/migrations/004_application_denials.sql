-- Cooldown after /deny (per Discord account + rank ladder)
CREATE TABLE IF NOT EXISTS application_denials (
  id               SERIAL PRIMARY KEY,
  discord_id       TEXT NOT NULL,
  ign              TEXT NOT NULL,
  rank_type        TEXT NOT NULL CHECK (rank_type IN ('P', 'E', 'A')),
  cooldown_until   TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (discord_id, rank_type)
);
