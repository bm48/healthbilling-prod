-- Create is_lock_providers table for providers column locking
-- This table can only have one record per clinic

CREATE TABLE IF NOT EXISTS is_lock_providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE UNIQUE,
  patient_id BOOLEAN NOT NULL DEFAULT false,
  first_name BOOLEAN NOT NULL DEFAULT false,
  last_initial BOOLEAN NOT NULL DEFAULT false,
  insurance BOOLEAN NOT NULL DEFAULT false,
  copay BOOLEAN NOT NULL DEFAULT false,
  coinsurance BOOLEAN NOT NULL DEFAULT false,
  date_of_service BOOLEAN NOT NULL DEFAULT false,
  cpt_code BOOLEAN NOT NULL DEFAULT false,
  appointment_note_status BOOLEAN NOT NULL DEFAULT false,
  claim_status BOOLEAN NOT NULL DEFAULT false,
  most_recent_submit_date BOOLEAN NOT NULL DEFAULT false,
  ins_pay BOOLEAN NOT NULL DEFAULT false,
  ins_pay_date BOOLEAN NOT NULL DEFAULT false,
  pt_res BOOLEAN NOT NULL DEFAULT false,
  collected_from_pt BOOLEAN NOT NULL DEFAULT false,
  pt_pay_status BOOLEAN NOT NULL DEFAULT false,
  pt_payment_ar_ref_date BOOLEAN NOT NULL DEFAULT false,
  total BOOLEAN NOT NULL DEFAULT false,
  notes BOOLEAN NOT NULL DEFAULT false,
  patient_id_comment TEXT,
  first_name_comment TEXT,
  last_initial_comment TEXT,
  insurance_comment TEXT,
  copay_comment TEXT,
  coinsurance_comment TEXT,
  date_of_service_comment TEXT,
  cpt_code_comment TEXT,
  appointment_note_status_comment TEXT,
  claim_status_comment TEXT,
  most_recent_submit_date_comment TEXT,
  ins_pay_comment TEXT,
  ins_pay_date_comment TEXT,
  pt_res_comment TEXT,
  collected_from_pt_comment TEXT,
  pt_pay_status_comment TEXT,
  pt_payment_ar_ref_date_comment TEXT,
  total_comment TEXT,
  notes_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_is_lock_providers_clinic ON is_lock_providers(clinic_id);

-- Row Level Security (RLS)
ALTER TABLE is_lock_providers ENABLE ROW LEVEL SECURITY;

-- Users can read lock status for their clinic
CREATE POLICY "Users can read providers column locks" ON is_lock_providers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
    )
  );

-- Only super admins and admins can manage providers column locks
CREATE POLICY "Admins can manage providers column locks" ON is_lock_providers
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
CREATE OR REPLACE FUNCTION update_is_lock_providers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER trigger_is_lock_providers_updated_at
  BEFORE UPDATE ON is_lock_providers
  FOR EACH ROW
  EXECUTE FUNCTION update_is_lock_providers_updated_at();
