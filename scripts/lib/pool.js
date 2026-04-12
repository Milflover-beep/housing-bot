const { Pool } = require('pg');

const url = process.env.DATABASE_URL || '';
const needsSsl =
  process.env.DATABASE_SSL === 'true' ||
  /railway\.app|render\.com|neon\.tech|supabase\.co|amazonaws\.com/i.test(url);

let ssl;
if (process.env.DATABASE_SSL === 'false') {
  ssl = false;
} else if (needsSsl) {
  ssl = { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: url,
  ...(ssl !== undefined ? { ssl } : {}),
});

module.exports = pool;
