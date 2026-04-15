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

INSERT INTO pm_membership_periods (ign, start_at, end_at, created_at)
SELECT p.ign, COALESCE(p.created_at, NOW()), NULL, NOW()
FROM (
  SELECT DISTINCT ON (LOWER(TRIM(ign)))
    ign, created_at
  FROM pm_list
  WHERE ign IS NOT NULL AND TRIM(ign) <> ''
  ORDER BY LOWER(TRIM(ign)), created_at ASC, id ASC
) p
WHERE NOT EXISTS (
  SELECT 1
  FROM pm_membership_periods m
  WHERE LOWER(TRIM(m.ign)) = LOWER(TRIM(p.ign))
);
