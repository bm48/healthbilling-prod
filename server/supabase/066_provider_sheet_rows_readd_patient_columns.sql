-- Restore denormalized patient columns on provider_sheet_rows (Providers tab reads/writes these; no join to patients for display).
-- patient_copay / patient_coinsurance are TEXT (see 054_provider_sheet_rows_copay_coinsurance_text.sql).

ALTER TABLE provider_sheet_rows
  ADD COLUMN IF NOT EXISTS patient_first_name TEXT,
  ADD COLUMN IF NOT EXISTS patient_last_name TEXT,
  ADD COLUMN IF NOT EXISTS last_initial TEXT,
  ADD COLUMN IF NOT EXISTS patient_insurance TEXT,
  ADD COLUMN IF NOT EXISTS patient_copay TEXT,
  ADD COLUMN IF NOT EXISTS patient_coinsurance TEXT;
