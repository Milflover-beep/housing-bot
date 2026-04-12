-- Fix SERIAL sequences after importing rows with explicit ids (e.g. seed from Excel).
-- Run in Railway / psql if you see: duplicate key value violates unique constraint "..._pkey"

SELECT setval(pg_get_serial_sequence('pm_list', 'id'), (SELECT MAX(id) FROM pm_list));

-- Optional: repeat for other tables if inserts fail there, or re-run `node scripts/seed.js`
-- (seed now syncs all sequences automatically before COMMIT).
