require('dotenv').config();
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { Pool } = require('pg');
const { normalizeTierLabelForDb, normalizeLadderTypeForDb } = require('./lib/helpers');

const RESET = process.argv.includes('--reset');
const XLSX_PATH = process.env.SEED_XLSX_PATH
  ? path.resolve(process.env.SEED_XLSX_PATH)
  : path.join(__dirname, '..', 'data', 'database_export.xlsx');

/** Tables cleared when using --reset (only those that exist in DB). */
const TRUNCATE_TABLES = [
  'punishment_queue',
  'punishment_logs',
  'reports',
  'role_blacklists',
  'scores',
  'tier_history',
  'tier_results',
  'timeouts',
  'uuid_registry',
  'watchlist',
  'admin_blacklists',
  'alts',
  'apr_logs',
  'blacklists',
  'flagged_errors',
  'original_whitelist',
  'pm_list',
  'proxies',
  'tier_list_messages',
  'applications',
  'application_denials',
  'gradient_requests',
];

console.log('Starting seed...');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'found' : 'MISSING');
console.log('XLSX:', XLSX_PATH);
if (RESET) {
  console.warn('⚠️  --reset: listed tables will be TRUNCATED, then reloaded from the workbook.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function truncateSeededTables(client) {
  const existing = [];
  for (const t of TRUNCATE_TABLES) {
    const r = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [t]
    );
    if (r.rows.length) existing.push(`"${t}"`);
  }
  if (!existing.length) {
    console.warn('No tables matched TRUNCATE list (empty database?).');
    return;
  }
  await client.query(`TRUNCATE TABLE ${existing.join(', ')} RESTART IDENTITY CASCADE`);
  console.log(`✓ Truncated ${existing.length} table(s)`);
}

function excelDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') {
    // Excel epoch starts Jan 1 1900
    return new Date((val - 25569) * 86400 * 1000);
  }
  return new Date(val);
}

async function seed() {
  console.log('Connecting to database...');
  const client = await pool.connect();
  console.log('Connected!');

  if (!fs.existsSync(XLSX_PATH)) {
    console.error('❌ XLSX file not found:', XLSX_PATH);
    client.release();
    await pool.end();
    process.exit(1);
    return;
  }

  const wb = xlsx.readFile(XLSX_PATH);
  console.log('Workbook loaded, sheets:', wb.SheetNames);

  function getRows(sheetName) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) {
      console.warn(`Sheet "${sheetName}" not found, skipping.`);
      return [];
    }
    return xlsx.utils.sheet_to_json(sheet);
  }

  let exitCode = 0;

  try {
    await client.query('BEGIN');

    if (RESET) {
      await truncateSeededTables(client);
    }

    const admin_blacklists = getRows('admin_blacklists');
    for (const row of admin_blacklists) {
      await client.query(
        `INSERT INTO admin_blacklists (id, ign, time_length, reason, blacklist_expires, created_at, is_pardoned)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.ign, row.time_length, row.reason, excelDate(row.blacklist_expires), excelDate(row.created_at), row.is_pardoned ?? false]
      );
    }
    console.log(`✓ admin_blacklists: ${admin_blacklists.length} rows`);

    const alts = getRows('alts');
    for (const row of alts) {
      await client.query(
        `INSERT INTO alts (id, original_ign, alt_ign, created_at, is_whitelisted)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.original_ign, row.alt_ign, excelDate(row.created_at), row.is_whitelisted ?? false]
      );
    }
    console.log(`✓ alts: ${alts.length} rows`);

    const apr_logs = getRows('apr_logs');
    for (const row of apr_logs) {
      await client.query(
        `INSERT INTO apr_logs (id, ign, evals, created_at)
         VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.ign, row.evals, excelDate(row.created_at)]
      );
    }
    console.log(`✓ apr_logs: ${apr_logs.length} rows`);

    const blacklists = getRows('blacklists');
    for (const row of blacklists) {
      await client.query(
        `INSERT INTO blacklists (id, ign, time_length, reason, blacklist_expires, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.ign, row.time_length, row.reason, excelDate(row.blacklist_expires), excelDate(row.created_at)]
      );
    }
    console.log(`✓ blacklists: ${blacklists.length} rows`);

    const flagged_errors = getRows('flagged_errors');
    for (const row of flagged_errors) {
      await client.query(
        `INSERT INTO flagged_errors (id, database_name, entry_id, created_at)
         VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.database_name, row.entry_id ?? null, excelDate(row.created_at)]
      );
    }
    console.log(`✓ flagged_errors: ${flagged_errors.length} rows`);

    const original_whitelist = getRows('original_whitelist');
    for (const row of original_whitelist) {
      await client.query(
        `INSERT INTO original_whitelist (id, original_ign, created_at)
         VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.original_ign, excelDate(row.created_at)]
      );
    }
    console.log(`✓ original_whitelist: ${original_whitelist.length} rows`);

    const pm_list = getRows('pm_list');
    for (const row of pm_list) {
      await client.query(
        `INSERT INTO pm_list (id, ign, ping, uuid, skin_head_url, manager_type, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.ign,
          row.ping ?? null,
          row.uuid,
          row.skin_head_url,
          row.manager_type ?? null,
          excelDate(row.created_at),
        ]
      );
    }
    console.log(`✓ pm_list: ${pm_list.length} rows`);

    const proxies = getRows('proxies');
    for (const row of proxies) {
      await client.query(
        `INSERT INTO proxies (id, content, added_by, created_at)
         VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.content, row.added_by, excelDate(row.created_at)]
      );
    }
    console.log(`✓ proxies: ${proxies.length} rows`);

    const punishment_logs = getRows('punishment_logs');
    for (const row of punishment_logs) {
      await client.query(
        `INSERT INTO punishment_logs (id, user_ign, staff_ign, evidence, punishment_details, date, discord_user, punishment, undo_punishment, created_at, status, punishment_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
        [
          row.id, row.user_ign, row.staff_ign, row.evidence ?? null,
          row.punishment_details ?? null, excelDate(row.date), row.discord_user ?? null,
          row.punishment ?? null, row.undo_punishment ?? null, excelDate(row.created_at),
          row.status ?? null, row.punishment_status ?? null
        ]
      );
    }
    console.log(`✓ punishment_logs: ${punishment_logs.length} rows`);

    const reports = getRows('reports');
    for (const row of reports) {
      await client.query(
        `INSERT INTO reports (id, ign, reason, punishment_issued, discord_user_id, date_issued)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.ign, row.reason, row.punishment_issued ?? false, row.discord_user_id ?? null, excelDate(row.date_issued)]
      );
    }
    console.log(`✓ reports: ${reports.length} rows`);

    const role_blacklists = getRows('role_blacklists');
    for (const row of role_blacklists) {
      await client.query(
        `INSERT INTO role_blacklists (id, ign, role_type, reason, discord_user_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.ign, row.role_type, row.reason, row.discord_user_id ?? null, excelDate(row.created_at)]
      );
    }
    console.log(`✓ role_blacklists: ${role_blacklists.length} rows`);

    const scores = getRows('scores');
    for (const row of scores) {
      await client.query(
        `INSERT INTO scores (id, winner_ign, loser_ign, final_score, fight_number, reported_by, created_at, is_voided, fight_type, flag_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [
          row.id, row.winner_ign, row.loser_ign, row.final_score,
          row.fight_number ?? null, row.reported_by ?? null, excelDate(row.created_at),
          row.is_voided ?? false, row.fight_type ?? null, row.flag_type ?? null
        ]
      );
    }
    console.log(`✓ scores: ${scores.length} rows`);

    const tier_history = getRows('tier_history');
    for (const row of tier_history) {
      await client.query(
        `INSERT INTO tier_history (id, ign, type, tier, discord_id, rated_at, tester)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.ign, row.type, row.tier, row.discord_id ?? null, excelDate(row.rated_at), row.tester ?? null]
      );
    }
    console.log(`✓ tier_history: ${tier_history.length} rows`);

    const tier_list_messages = getRows('tier_list_messages');
    for (const row of tier_list_messages) {
      await client.query(
        `INSERT INTO tier_list_messages (position, message_id, channel_id, updated_at)
         VALUES ($1,$2,$3,$4) ON CONFLICT (position) DO NOTHING`,
        [row.position, row.message_id, row.channel_id, excelDate(row.updated_at)]
      );
    }
    console.log(`✓ tier_list_messages: ${tier_list_messages.length} rows`);

    const tier_results = getRows('tier_results');
    let tierSkipped = 0;
    for (const row of tier_results) {
      const ladder = normalizeLadderTypeForDb(row.type);
      if (!ladder) {
        tierSkipped += 1;
        console.warn(`  skip tier_results id=${row.id} ign=${row.ign} bad type=${row.type}`);
        continue;
      }
      const tier = normalizeTierLabelForDb(row.tier);
      await client.query(
        `INSERT INTO tier_results (id, ign, type, tier, discord_id, created_at, tester)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.ign, ladder, tier, row.discord_id ?? null, excelDate(row.created_at), row.tester ?? null]
      );
    }
    console.log(`✓ tier_results: ${tier_results.length} rows (${tierSkipped} skipped bad ladder type)`);

    const timeouts = getRows('timeouts');
    for (const row of timeouts) {
      await client.query(
        `INSERT INTO timeouts (id, ign, timeout_duration, created_at, fight_type, deny_type)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.ign, row.timeout_duration, excelDate(row.created_at), row.fight_type ?? null, row.deny_type ?? null]
      );
    }
    console.log(`✓ timeouts: ${timeouts.length} rows`);

    const uuid_registry = getRows('uuid_registry');
    for (const row of uuid_registry) {
      await client.query(
        `INSERT INTO uuid_registry (id, ign, uuid, created_at)
         VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.ign, row.uuid, excelDate(row.created_at)]
      );
    }
    console.log(`✓ uuid_registry: ${uuid_registry.length} rows`);

    const watchlist = getRows('watchlist');
    for (const row of watchlist) {
      await client.query(
        `INSERT INTO watchlist (id, ign, reason, threat_level, uuid, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [row.id, row.ign, row.reason, row.threat_level ?? null, row.uuid ?? null, excelDate(row.created_at)]
      );
    }
    console.log(`✓ watchlist: ${watchlist.length} rows`);

    // Explicit ids from Excel leave SERIAL sequences behind → next INSERT collides. Resync all.
    const serialTables = [
      'admin_blacklists',
      'alts',
      'apr_logs',
      'blacklists',
      'flagged_errors',
      'original_whitelist',
      'pm_list',
      'proxies',
      'punishment_logs',
      'reports',
      'role_blacklists',
      'scores',
      'tier_history',
      'tier_results',
      'timeouts',
      'uuid_registry',
      'watchlist',
    ];
    for (const table of serialTables) {
      const { rows } = await client.query(`SELECT MAX(id) AS m FROM "${table}"`);
      const maxId = rows[0].m;
      const seq = await client.query(
        `SELECT pg_get_serial_sequence($1::text, 'id') AS s`,
        [table]
      );
      const seqName = seq.rows[0]?.s;
      if (!seqName) continue;
      if (maxId == null) {
        await client.query(`SELECT setval($1::regclass, 1, false)`, [seqName]);
      } else {
        await client.query(`SELECT setval($1::regclass, $2::bigint)`, [seqName, maxId]);
      }
    }
    console.log('✓ SERIAL sequences synced to MAX(id)');

    await client.query('COMMIT');
    console.log('\n✅ Seed complete! All tables populated.');
  } catch (err) {
    exitCode = 1;
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    console.error('\n❌ Seed failed, rolled back.');
    console.error('Error:', err.message);
    console.error(err.stack);
  } finally {
    client.release();
    await pool.end();
    process.exit(exitCode);
  }
}

seed().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});