-- Private patient IDs: not in `patients` (co-patients); first provider to use an ID in the clinic owns it.
-- `patients` holds only co-patients (shared across all providers in the clinic).

CREATE TABLE IF NOT EXISTS private_patient_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL,
  patient_id_key TEXT GENERATED ALWAYS AS (lower(trim(patient_id))) STORED,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (clinic_id, patient_id_key)
);

CREATE INDEX IF NOT EXISTS idx_private_patient_claims_clinic_id ON private_patient_claims (clinic_id);
CREATE INDEX IF NOT EXISTS idx_private_patient_claims_provider_id ON private_patient_claims (provider_id);

COMMENT ON TABLE private_patient_claims IS 'Provider-scoped patient IDs not listed in patients; UNIQUE per clinic on normalized patient_id.';

CREATE OR REPLACE FUNCTION update_private_patient_claims_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_private_patient_claims_updated_at ON private_patient_claims;
CREATE TRIGGER trigger_private_patient_claims_updated_at
  BEFORE UPDATE ON private_patient_claims
  FOR EACH ROW EXECUTE FUNCTION update_private_patient_claims_updated_at();

ALTER TABLE private_patient_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view private_patient_claims for their clinics" ON private_patient_claims;
CREATE POLICY "Users can view private_patient_claims for their clinics" ON private_patient_claims
  FOR SELECT USING (
    clinic_id = ANY(
      SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
    ) OR is_super_admin()
  );

DROP POLICY IF EXISTS "Users can insert private_patient_claims for their clinics" ON private_patient_claims;
CREATE POLICY "Users can insert private_patient_claims for their clinics" ON private_patient_claims
  FOR INSERT WITH CHECK (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin', 'provider', 'office_staff')
      )
    )
  );

DROP POLICY IF EXISTS "Users can update private_patient_claims for their clinics" ON private_patient_claims;
CREATE POLICY "Users can update private_patient_claims for their clinics" ON private_patient_claims
  FOR UPDATE USING (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin', 'provider', 'office_staff')
      )
    )
  );

DROP POLICY IF EXISTS "Users can delete private_patient_claims for their clinics" ON private_patient_claims;
CREATE POLICY "Users can delete private_patient_claims for their clinics" ON private_patient_claims
  FOR DELETE USING (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin', 'provider', 'office_staff')
      )
    )
  );

-- Migrate old assignment model: patients.provider_id -> private_patient_claims; then remove those rows from patients.
INSERT INTO private_patient_claims (clinic_id, patient_id, provider_id)
SELECT clinic_id, patient_id, provider_id
FROM patients
WHERE provider_id IS NOT NULL
ON CONFLICT (clinic_id, patient_id_key) DO NOTHING;

DELETE FROM patients WHERE provider_id IS NOT NULL;

DROP INDEX IF EXISTS idx_patients_clinic_provider;

ALTER TABLE patients DROP COLUMN IF EXISTS provider_id;

COMMENT ON TABLE patients IS 'Co-patients only (shared by all providers in the clinic). Private sheet-only IDs use private_patient_claims + provider_sheet_rows.';
