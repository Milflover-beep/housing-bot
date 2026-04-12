-- Run once on existing databases (Railway SQL console):
ALTER TABLE punishment_queue
  ADD COLUMN IF NOT EXISTS punishment_log_id INTEGER REFERENCES punishment_logs (id);
