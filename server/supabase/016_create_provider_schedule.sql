-- Provider schedule table: independent of patients table, only provider role can access.
-- Columns: clinic_id, provider_id, patient_id, patient_name (full name), insurance, copay, coinsurance, date_of_service.

CREATE TABLE IF NOT EXISTS provider_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  patient_id TEXT,
  patient_name TEXT,
  insurance TEXT,
  copay NUMERIC(10, 2),
  coinsurance NUMERIC(5, 2),
  date_of_service DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_schedules_provider_id ON provider_schedules(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_schedules_date ON provider_schedules(date_of_service);
CREATE INDEX IF NOT EXISTS idx_provider_schedules_clinic_provider ON provider_schedules(clinic_id, provider_id);

ALTER TABLE provider_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers can view own schedule"
  ON provider_schedules FOR SELECT
  TO authenticated
  USING (
    provider_id IN (
      SELECT p.id FROM providers p
      JOIN auth.users u ON u.email = p.email
      WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "Providers can insert own schedule"
  ON provider_schedules FOR INSERT
  TO authenticated
  WITH CHECK (
    provider_id IN (
      SELECT p.id FROM providers p
      JOIN auth.users u ON u.email = p.email
      WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "Providers can update own schedule"
  ON provider_schedules FOR UPDATE
  TO authenticated
  USING (
    provider_id IN (
      SELECT p.id FROM providers p
      JOIN auth.users u ON u.email = p.email
      WHERE u.id = auth.uid()
    )
  )
  WITH CHECK (
    provider_id IN (
      SELECT p.id FROM providers p
      JOIN auth.users u ON u.email = p.email
      WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "Providers can delete own schedule"
  ON provider_schedules FOR DELETE
  TO authenticated
  USING (
    provider_id IN (
      SELECT p.id FROM providers p
      JOIN auth.users u ON u.email = p.email
      WHERE u.id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION update_provider_schedules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS provider_schedules_updated_at ON provider_schedules;
CREATE TRIGGER provider_schedules_updated_at
  BEFORE UPDATE ON provider_schedules
  FOR EACH ROW EXECUTE FUNCTION update_provider_schedules_updated_at();
