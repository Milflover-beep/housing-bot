-- Prime / Elite / Apex manager category for PM list (NULL = N/A)
ALTER TABLE pm_list ADD COLUMN IF NOT EXISTS manager_type TEXT;

ALTER TABLE pm_list DROP CONSTRAINT IF EXISTS pm_list_manager_type_check;
ALTER TABLE pm_list ADD CONSTRAINT pm_list_manager_type_check
  CHECK (manager_type IS NULL OR manager_type IN ('P', 'E', 'A'));
