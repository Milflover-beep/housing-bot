/**
 * Applies lightweight schema fixes for existing databases (e.g. after pulling new code).
 * Safe to run repeatedly.
 */
async function ensureDatabaseSchema(pool) {
  const client = await pool.connect();
  try {
    await client.query(`
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
        punishment_status  TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS punishment_queue (
        id                 SERIAL PRIMARY KEY,
        ign                TEXT,
        staff_discord_id   TEXT,
        details            TEXT,
        status             TEXT DEFAULT 'pending',
        punishment_log_id  INTEGER REFERENCES punishment_logs (id),
        created_at         TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE punishment_queue ADD COLUMN IF NOT EXISTS punishment_log_id INTEGER;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pm_list (
        id             SERIAL PRIMARY KEY,
        ign            TEXT,
        ping           INTEGER,
        uuid           TEXT,
        skin_head_url  TEXT,
        created_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE pm_list ADD COLUMN IF NOT EXISTS manager_type TEXT;
    `);
    await client.query(`ALTER TABLE pm_list DROP CONSTRAINT IF EXISTS pm_list_manager_type_check`);
    await client.query(`
      ALTER TABLE pm_list ADD CONSTRAINT pm_list_manager_type_check
      CHECK (manager_type IS NULL OR manager_type IN ('P', 'E', 'A'))
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS application_denials (
        id               SERIAL PRIMARY KEY,
        discord_id       TEXT NOT NULL,
        ign              TEXT NOT NULL,
        rank_type        TEXT NOT NULL CHECK (rank_type IN ('P', 'E', 'A')),
        cooldown_until   TIMESTAMPTZ NOT NULL,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (discord_id, rank_type)
      )
    `);
    console.log('✅ Database schema OK (punishment_logs/queue, pm_list, application_denials)');
  } finally {
    client.release();
  }
}

module.exports = { ensureDatabaseSchema };
