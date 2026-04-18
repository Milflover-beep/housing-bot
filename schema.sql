-- ============================================================
--  schema.sql  —  housing-bot database
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_blacklists (
  id                SERIAL PRIMARY KEY,
  ign               TEXT NOT NULL,
  time_length       TEXT,
  reason            TEXT,
  blacklist_expires TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  is_pardoned       BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS alts (
  id             SERIAL PRIMARY KEY,
  original_ign   TEXT,
  alt_ign        TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  is_whitelisted BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS apr_logs (
  id         SERIAL PRIMARY KEY,
  ign        TEXT,
  evals      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blacklists (
  id                SERIAL PRIMARY KEY,
  ign               TEXT NOT NULL,
  time_length       TEXT,
  reason            TEXT,
  blacklist_expires TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flagged_errors (
  id            SERIAL PRIMARY KEY,
  database_name TEXT,
  entry_id      INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS original_whitelist (
  id           SERIAL PRIMARY KEY,
  original_ign TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pm_list (
  id             SERIAL PRIMARY KEY,
  ign            TEXT,
  ping           INTEGER,
  uuid           TEXT,
  skin_head_url  TEXT,
  manager_type   TEXT CHECK (manager_type IS NULL OR manager_type IN ('P', 'E', 'A')),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pm_membership_periods (
  id         SERIAL PRIMARY KEY,
  ign        TEXT NOT NULL,
  start_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_at     TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pm_membership_periods_ign_start_idx
ON pm_membership_periods (LOWER(TRIM(ign)), start_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS pm_membership_periods_open_one_idx
ON pm_membership_periods (LOWER(TRIM(ign)))
WHERE end_at IS NULL;

CREATE TABLE IF NOT EXISTS proxies (
  id         SERIAL PRIMARY KEY,
  content    TEXT,
  added_by   TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS punishment_logs (
  id                 SERIAL PRIMARY KEY,
  user_ign           TEXT,
  staff_ign          TEXT,
  evidence           TEXT,
  punishment_details TEXT,
  date               TIMESTAMPTZ,
  discord_user       TEXT,
  punishment         TEXT,
  undo_punishment    TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  status             TEXT,
  punishment_status  TEXT,
  cooldown_raw       TEXT,
  reversal_remind_at TIMESTAMPTZ,
  reversal_reminded  BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS reports (
  id                SERIAL PRIMARY KEY,
  ign               TEXT,
  reason            TEXT,
  evidence_link     TEXT,
  punishment_issued BOOLEAN DEFAULT FALSE,
  discord_user_id   TEXT,
  date_issued       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_blacklists (
  id              SERIAL PRIMARY KEY,
  ign             TEXT,
  role_type       TEXT,
  reason          TEXT,
  discord_user_id TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scores (
  id          SERIAL PRIMARY KEY,
  winner_ign  TEXT,
  loser_ign   TEXT,
  final_score TEXT,
  fight_number INTEGER,
  reported_by TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  is_voided   BOOLEAN DEFAULT FALSE,
  fight_type  TEXT,
  flag_type   TEXT
);

CREATE TABLE IF NOT EXISTS tier_history (
  id         SERIAL PRIMARY KEY,
  ign        TEXT,
  type       TEXT,
  tier       TEXT,
  discord_id TEXT,
  rated_at   TIMESTAMPTZ DEFAULT NOW(),
  tester     TEXT
);

CREATE TABLE IF NOT EXISTS tier_list_messages (
  position   INTEGER PRIMARY KEY,
  message_id TEXT,
  channel_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tier_results (
  id         SERIAL PRIMARY KEY,
  ign        TEXT,
  type       TEXT,
  tier       TEXT,
  discord_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  tester     TEXT
);

CREATE TABLE IF NOT EXISTS timeouts (
  id               SERIAL PRIMARY KEY,
  ign              TEXT,
  timeout_duration TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  fight_type       TEXT,
  deny_type        TEXT
);

CREATE TABLE IF NOT EXISTS uuid_registry (
  id         SERIAL PRIMARY KEY,
  ign        TEXT,
  uuid       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watchlist (
  id           SERIAL PRIMARY KEY,
  ign          TEXT,
  reason       TEXT,
  threat_level TEXT,
  uuid         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Pending rank applications (abort / accept / deny)
CREATE TABLE IF NOT EXISTS applications (
  id          SERIAL PRIMARY KEY,
  ign         TEXT NOT NULL,
  discord_id  TEXT NOT NULL,
  rank_type   TEXT NOT NULL,
  status      TEXT DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Admin moderation queue: staff enqueue via /log; managers review with /checkqueue
CREATE TABLE IF NOT EXISTS punishment_queue (
  id                 SERIAL PRIMARY KEY,
  ign                TEXT,
  staff_discord_id   TEXT,
  details            TEXT,
  status             TEXT DEFAULT 'pending',
  punishment_log_id  INTEGER REFERENCES punishment_logs (id),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Gradient role requests (optional)
CREATE TABLE IF NOT EXISTS gradient_requests (
  id              SERIAL PRIMARY KEY,
  discord_user_id TEXT,
  note            TEXT,
  status          TEXT DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Application denial cooldowns (/deny); one row per Discord user (any ladder blocks all until expiry)
CREATE TABLE IF NOT EXISTS application_denials (
  id               SERIAL PRIMARY KEY,
  discord_id       TEXT NOT NULL,
  ign              TEXT NOT NULL,
  rank_type        TEXT CHECK (rank_type IS NULL OR rank_type IN ('P', 'E', 'A')),
  cooldown_until   TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (discord_id)
);