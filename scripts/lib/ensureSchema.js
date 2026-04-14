/**
 * One cooldown row per Discord user (any rank denial blocks all ladders until expiry).
 */
async function ensureApplicationDenials(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS application_denials (
      id               SERIAL PRIMARY KEY,
      discord_id       TEXT NOT NULL,
      ign              TEXT NOT NULL,
      rank_type        TEXT,
      cooldown_until   TIMESTAMPTZ NOT NULL,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`ALTER TABLE application_denials DROP CONSTRAINT IF EXISTS application_denials_discord_id_rank_type_key`);
  await client.query(`ALTER TABLE application_denials DROP CONSTRAINT IF EXISTS application_denials_rank_type_check`);
  await client.query(`
    ALTER TABLE application_denials ADD CONSTRAINT application_denials_rank_type_check
    CHECK (rank_type IS NULL OR rank_type IN ('P', 'E', 'A'))
  `).catch(() => {});
  await client.query(`ALTER TABLE application_denials ALTER COLUMN rank_type DROP NOT NULL`).catch(() => {});
  await client.query(`
    DELETE FROM application_denials
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT DISTINCT ON (discord_id) id
        FROM application_denials
        ORDER BY discord_id, cooldown_until DESC
      ) sub
    )
  `).catch(() => {});
  await client.query(`DROP INDEX IF EXISTS application_denials_discord_id_uidx`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS application_denials_discord_id_uidx ON application_denials (discord_id)
  `).catch(() => {});
}

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
      ALTER TABLE punishment_logs ADD COLUMN IF NOT EXISTS cooldown_raw TEXT;
    `);
    await client.query(`
      ALTER TABLE punishment_logs ADD COLUMN IF NOT EXISTS reversal_remind_at TIMESTAMPTZ;
    `);
    await client.query(`
      ALTER TABLE punishment_logs ADD COLUMN IF NOT EXISTS reversal_reminded BOOLEAN DEFAULT FALSE;
    `);
    await client.query(`
      ALTER TABLE punishment_logs ADD COLUMN IF NOT EXISTS progressive_ban BOOLEAN DEFAULT TRUE;
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
    await ensureApplicationDenials(client);

    /** Coerce tier_results.type to single-letter P/E/A (legacy rows used prime/elite/apex words). */
    await client.query(`
      UPDATE tier_results SET type = 'P' WHERE LOWER(TRIM(type)) IN ('p', 'prime')
    `).catch(() => {});
    await client.query(`
      UPDATE tier_results SET type = 'E' WHERE LOWER(TRIM(type)) IN ('e', 'elite')
    `).catch(() => {});
    await client.query(`
      UPDATE tier_results SET type = 'A' WHERE LOWER(TRIM(type)) IN ('a', 'apex')
    `).catch(() => {});
    /** One live row per player: drop older rows so Prime→Elite moves do not leave stale ladder rows. */
    await client.query(`
      DELETE FROM tier_results a
      WHERE EXISTS (
        SELECT 1 FROM tier_results b
        WHERE LOWER(TRIM(a.ign)) = LOWER(TRIM(b.ign))
          AND a.id < b.id
      )
    `).catch(() => {});

    console.log('✅ Database schema OK (punishment_logs/queue, pm_list, application_denials, tier_results)');
  } finally {
    client.release();
  }
}

module.exports = { ensureDatabaseSchema };
