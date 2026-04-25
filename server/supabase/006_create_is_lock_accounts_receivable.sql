-- Create is_lock_accounts_receivable table for accounts receivable column locking
-- This table can only have one record per clinic

CREATE TABLE IF NOT EXISTS is_lock_accounts_receivable (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE UNIQUE,
  ar_id BOOLEAN NOT NULL DEFAULT false,
  name BOOLEAN NOT NULL DEFAULT false,
  date_of_service BOOLEAN NOT NULL DEFAULT false,
  amount BOOLEAN NOT NULL DEFAULT false,
  date_recorded BOOLEAN NOT NULL DEFAULT false,
  type BOOLEAN NOT NULL DEFAULT false,
  notes BOOLEAN NOT NULL DEFAULT false,
  ar_id_comment TEXT,
  name_comment TEXT,
  date_of_service_comment TEXT,
  amount_comment TEXT,
  date_recorded_comment TEXT,
  type_comment TEXT,
  notes_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_is_lock_accounts_receivable_clinic ON is_lock_accounts_receivable(clinic_id);

-- Row Level Security (RLS)
ALTER TABLE is_lock_accounts_receivable ENABLE ROW LEVEL SECURITY;

-- Users can read lock status for their clinic
CREATE POLICY "Users can read accounts receivable column locks" ON is_lock_accounts_receivable
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
    )
  );

-- Only super admins and admins can manage accounts receivable column locks
CREATE POLICY "Admins can manage accounts receivable column locks" ON is_lock_accounts_receivable
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
CREATE OR REPLACE FUNCTION update_is_lock_accounts_receivable_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER trigger_is_lock_accounts_receivable_updated_at
  BEFORE UPDATE ON is_lock_accounts_receivable
  FOR EACH ROW
  EXECUTE FUNCTION update_is_lock_accounts_receivable_updated_at();
