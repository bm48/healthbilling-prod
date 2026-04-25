-- Create is_lock_billing_todo table for billing todo column locking
-- This table can only have one record per clinic

CREATE TABLE IF NOT EXISTS is_lock_billing_todo (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE UNIQUE,
  id_column BOOLEAN NOT NULL DEFAULT false,
  status BOOLEAN NOT NULL DEFAULT false,
  issue BOOLEAN NOT NULL DEFAULT false,
  notes BOOLEAN NOT NULL DEFAULT false,
  followup_notes BOOLEAN NOT NULL DEFAULT false,
  id_column_comment TEXT,
  status_comment TEXT,
  issue_comment TEXT,
  notes_comment TEXT,
  followup_notes_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_is_lock_billing_todo_clinic ON is_lock_billing_todo(clinic_id);

-- Row Level Security (RLS)
ALTER TABLE is_lock_billing_todo ENABLE ROW LEVEL SECURITY;

-- Users can read lock status for their clinic
CREATE POLICY "Users can read billing todo column locks" ON is_lock_billing_todo
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
    )
  );

-- Only super admins and admins can manage billing todo column locks
CREATE POLICY "Admins can manage billing todo column locks" ON is_lock_billing_todo
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
CREATE OR REPLACE FUNCTION update_is_lock_billing_todo_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER trigger_is_lock_billing_todo_updated_at
  BEFORE UPDATE ON is_lock_billing_todo
  FOR EACH ROW
  EXECUTE FUNCTION update_is_lock_billing_todo_updated_at();
