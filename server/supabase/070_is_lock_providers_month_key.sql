-- Provider column locks are scoped per clinic + month (same key as provider sheets: e.g. "2025-3" or "2025-3-2").
-- Existing single row per clinic becomes month_key = 'legacy' and is copied into each month on first access.

ALTER TABLE is_lock_providers
  ADD COLUMN IF NOT EXISTS month_key TEXT NOT NULL DEFAULT 'legacy';

-- Replace single-row-per-clinic with one row per (clinic_id, month_key). Pre-migration rows keep month_key = 'legacy'.
ALTER TABLE is_lock_providers DROP CONSTRAINT IF EXISTS is_lock_providers_clinic_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS is_lock_providers_clinic_id_month_key_key
  ON is_lock_providers (clinic_id, month_key);

COMMENT ON COLUMN is_lock_providers.month_key IS 'Matches provider sheet month key: "YYYY-M" or "YYYY-M-P" when clinic payroll=2. Value "legacy" holds pre-migration locks copied into each month on first open.';
