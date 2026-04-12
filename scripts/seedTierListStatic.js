/**
 * Replaces tier_results with the canonical list below (run once when data is wrong).
 * Usage: node scripts/seedTierListStatic.js
 * Requires DATABASE_URL (e.g. from .env).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('./lib/pool');
const { normalizeIgn, normalizeTierLabelForDb } = require('./lib/helpers');

/** [ladder, ign, tierLabel] — tier before normalization (F → D via helper). */
const ROWS = [
  // Apex
  ['A', 'lawings', 'S'],
  ['A', 'thornsk1n', 'A'],
  ['A', 'alinaur', 'B+'],
  ['A', 'pcey', 'B+'],
  ['A', 'palestinx', 'D'],
  // Elite
  ['E', 'dozzs', 'A+'],
  ['E', 'nextmove', 'A+'],
  ['E', 'sinscere', 'A+'],
  ['E', 'demorph', 'A'],
  ['E', 'doomgong', 'A'],
  ['E', 'xqtv', 'B-'],
  ['E', 'provozal', 'F'],
  // Prime
  ['P', 'mrjaxser', 'S'],
  ['P', 'karnll', 'A+'],
  ['P', 'lenlep', 'A+'],
  ['P', 'metromirror', 'A+'],
  ['P', 'unpolited', 'A+'],
  ['P', 'aquafull', 'A'],
  ['P', 'heliuminhailer', 'A'],
  ['P', 'mqliciousmf', 'A'],
  ['P', 'ewdo', 'A-'],
  ['P', 'ggmanl', 'B+'],
  ['P', 'hottue', 'B+'],
  ['P', 'juicegtr', 'B+'],
  ['P', 'chickade', 'B'],
  ['P', 'iretry', 'B'],
  ['P', 'spyloww', 'B'],
  ['P', 'penguiins', 'B-'],
  ['P', 'warfights', 'B-'],
  ['P', 'archieinmattelsa', 'C'],
  ['P', 'ezood', 'C'],
  ['P', 'ger0menav1rrete', 'C'],
  ['P', 'oblatant', 'C'],
  ['P', 'subyt', 'C'],
  ['P', 'tylurh', 'C'],
  ['P', 'ziegen', 'C'],
  ['P', 'hexration', 'D'],
  ['P', 'lushiu', 'D'],
  ['P', 'superkinokopros', 'D'],
  ['P', 'thetea5', 'D'],
  ['P', 'voxeiz', 'D'],
  ['P', 'hitsel', 'F'],
  ['P', 'krazzy_9inja', 'F'],
  ['P', 'louis258000', 'F'],
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL missing');
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE tier_results RESTART IDENTITY CASCADE');
    let n = 0;
    for (const [ladder, ignRaw, tierRaw] of ROWS) {
      const ign = normalizeIgn(ignRaw);
      const tier = normalizeTierLabelForDb(tierRaw);
      await client.query(
        `INSERT INTO tier_results (ign, type, tier, discord_id, created_at, tester)
         VALUES ($1, $2, $3, NULL, NOW(), $4)`,
        [ign, ladder, tier, 'seedTierListStatic']
      );
      n += 1;
    }
    await client.query('COMMIT');
    console.log(`✅ tier_results cleared and ${n} row(s) inserted.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
