-- Clinic addresses: up to 6 address lines per clinic (used in Super Admin Clinic Management).
CREATE TABLE IF NOT EXISTS clinic_addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL CHECK (line_index >= 1 AND line_index <= 6),
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clinic_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_clinic_addresses_clinic_id ON clinic_addresses(clinic_id);

ALTER TABLE clinic_addresses ENABLE ROW LEVEL SECURITY;

-- Super admins can manage all clinic addresses
CREATE POLICY "Super admins can manage clinic_addresses"
  ON clinic_addresses FOR ALL USING (is_super_admin());

-- Users can view clinic addresses for clinics they are assigned to
CREATE POLICY "Users can view clinic_addresses for their clinics"
  ON clinic_addresses FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND clinic_id = ANY(users.clinic_ids)
    ) OR is_super_admin()
  );
