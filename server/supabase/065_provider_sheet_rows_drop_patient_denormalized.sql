-- Option A: Remove denormalized patient columns from provider_sheet_rows.
-- Keep only patient_id as the link to the patient; display uses patients table via (sheet.clinic_id, row.patient_id).
-- Run this migration AFTER deploying app and edge function changes that no longer read/write these columns.

ALTER TABLE provider_sheet_rows
  DROP COLUMN IF EXISTS patient_first_name,
  DROP COLUMN IF EXISTS patient_last_name,
  DROP COLUMN IF EXISTS last_initial,
  DROP COLUMN IF EXISTS patient_insurance,
  DROP COLUMN IF EXISTS patient_copay,
  DROP COLUMN IF EXISTS patient_coinsurance;
