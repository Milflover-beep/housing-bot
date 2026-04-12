/**
 * Replace ALL tier_results with rows from database_export.xlsx (tier_results sheet).
 * - Ladder type normalized to P / E / A (prime/elite/apex strings OK).
 * - Tier labels must match VALID_TIERS; otherwise mapped to **D** (removed tiers like F).
 * - Legacy **HB** → **B-** (same as in-game tier ranking).
 *
 * Usage (local or CI with DATABASE_URL):
 *   node scripts/resetTierResultsFromExcel.js
 *
 * Optional: SEED_XLSX_PATH=/path/to/export.xlsx (default: data/database_export.xlsx)
 *
 * After running, restart the bot and run /publictierlistupdate (or your channel refresh) in Discord.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const xlsx = require('xlsx');
const { Pool } = require('pg');
const { normalizeTierLabelForDb, normalizeLadderTypeForDb } = require('./lib/helpers');

const XLSX_PATH = process.env.SEED_XLSX_PATH
  ? path.resolve(process.env.SEED_XLSX_PATH)
  : path.join(__dirname, '..', 'data', 'database_export.xlsx');

function excelDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') {
    return new Date((val - 25569) * 86400 * 1000);
  }
  return new Date(val);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set.');
    process.exit(1);
  }
  if (!fs.existsSync(XLSX_PATH)) {
    console.error('❌ Excel file not found:', XLSX_PATH);
    process.exit(1);
  }

  const wb = xlsx.readFile(XLSX_PATH);
  const sheet = wb.Sheets.tier_results;
  if (!sheet) {
    console.error('❌ Workbook has no sheet named "tier_results".');
    console.error('   Sheets:', wb.SheetNames.join(', '));
    process.exit(1);
  }

  const rows = xlsx.utils.sheet_to_json(sheet);
  console.log(`📂 ${XLSX_PATH} — tier_results sheet: ${rows.length} row(s)`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE tier_results RESTART IDENTITY CASCADE');

    let inserted = 0;
    let skipped = 0;
    for (const row of rows) {
      const ladder = normalizeLadderTypeForDb(row.type);
      if (!ladder) {
        console.warn(`  skip id=${row.id} ign=${row.ign} — invalid type: ${row.type}`);
        skipped += 1;
        continue;
      }
      const tier = normalizeTierLabelForDb(row.tier);
      await client.query(
        `INSERT INTO tier_results (id, ign, type, tier, discord_id, created_at, tester)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, row.ign, ladder, tier, row.discord_id ?? null, excelDate(row.created_at), row.tester ?? null]
      );
      inserted += 1;
    }

    const { rows: maxRow } = await client.query('SELECT MAX(id) AS m FROM tier_results');
    const maxId = maxRow[0].m;
    const seq = await client.query(`SELECT pg_get_serial_sequence('tier_results', 'id') AS s`);
    const seqName = seq.rows[0]?.s;
    if (seqName) {
      if (maxId == null) {
        await client.query(`SELECT setval($1::regclass, 1, false)`, [seqName]);
      } else {
        await client.query(`SELECT setval($1::regclass, $2::bigint)`, [seqName, maxId]);
      }
    }

    await client.query('COMMIT');
    console.log(`✅ tier_results reset: ${inserted} inserted, ${skipped} skipped (bad ladder type).`);
    console.log('   Unknown/removed tier labels → D; HB → B-.');
    console.log('   Restart the bot if needed, then refresh the public tier list in Discord.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Failed:', e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
