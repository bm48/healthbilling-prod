-- AR column locks are scoped per clinic + month (same key as provider sheets / AR month selector: "YYYY-M" or "YYYY-M-P").
-- Existing single row per clinic becomes month_key = 'legacy' and is copied into each month on first access.

ALTER TABLE is_lock_accounts_receivable
  ADD COLUMN IF NOT EXISTS month_key TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE is_lock_accounts_receivable DROP CONSTRAINT IF EXISTS is_lock_accounts_receivable_clinic_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS is_lock_accounts_receivable_clinic_id_month_key_key
  ON is_lock_accounts_receivable (clinic_id, month_key);

COMMENT ON COLUMN is_lock_accounts_receivable.month_key IS 'Matches clinic month key for AR: "YYYY-M" or "YYYY-M-P" when clinic payroll=2. Value "legacy" holds pre-migration locks copied into each month on first open.';
