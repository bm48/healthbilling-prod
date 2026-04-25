-- Create is_lock_patients table for patient column locking
-- This table can only have one record per clinic

CREATE TABLE IF NOT EXISTS is_lock_patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE UNIQUE,
  patient_id BOOLEAN NOT NULL DEFAULT false,
  first_name BOOLEAN NOT NULL DEFAULT false,
  last_name BOOLEAN NOT NULL DEFAULT false,
  insurance BOOLEAN NOT NULL DEFAULT false,
  copay BOOLEAN NOT NULL DEFAULT false,
  coinsurance BOOLEAN NOT NULL DEFAULT false,
  patient_id_comment TEXT,
  first_name_comment TEXT,
  last_name_comment TEXT,
  insurance_comment TEXT,
  copay_comment TEXT,
  coinsurance_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_is_lock_patients_clinic ON is_lock_patients(clinic_id);

-- Row Level Security (RLS)
ALTER TABLE is_lock_patients ENABLE ROW LEVEL SECURITY;

-- Users can read lock status for their clinic
CREATE POLICY "Users can read patient column locks" ON is_lock_patients
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
    )
  );

-- Only super admins and admins can manage patient column locks
CREATE POLICY "Admins can manage patient column locks" ON is_lock_patients
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND (
        users.role = 'super_admin'
        OR users.role = 'admin'
      )
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_is_lock_patients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER trigger_is_lock_patients_updated_at
  BEFORE UPDATE ON is_lock_patients
  FOR EACH ROW
  EXECUTE FUNCTION update_is_lock_patients_updated_at();
