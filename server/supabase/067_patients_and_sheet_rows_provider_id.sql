-- Link patients to a single provider per clinic (sheet assignment).
-- NOTE: provider_sheet_rows does NOT store provider_id; provider is derived from provider_sheets.

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES providers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patients_clinic_provider ON patients (clinic_id, provider_id);

-- Safety for environments where provider_sheet_rows.provider_id was added earlier by mistake.
ALTER TABLE provider_sheet_rows
  DROP COLUMN IF EXISTS provider_id;

COMMENT ON COLUMN patients.provider_id IS 'Provider this patient is assigned to when first used on that provider''s sheet; blocks same patient_id on another provider''s sheet in the clinic.';
