-- Patient demographics are sourced from `patients`; provider_sheet_rows keeps only patient_id + billing/scheduling data.
-- Safe after app/edge updates stop reading/writing denormalized patient columns.

ALTER TABLE provider_sheet_rows
  DROP COLUMN IF EXISTS patient_first_name,
  DROP COLUMN IF EXISTS patient_last_name,
  DROP COLUMN IF EXISTS last_initial,
  DROP COLUMN IF EXISTS patient_insurance,
  DROP COLUMN IF EXISTS patient_copay,
  DROP COLUMN IF EXISTS patient_coinsurance;
