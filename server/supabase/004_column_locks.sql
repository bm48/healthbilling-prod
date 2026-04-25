-- Column Locks table for locking columns in provider sheets
CREATE TABLE IF NOT EXISTS column_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES providers(id) ON DELETE CASCADE,
  column_name TEXT NOT NULL,
  is_locked BOOLEAN NOT NULL DEFAULT true,
  comment TEXT,
  locked_by UUID REFERENCES users(id),
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clinic_id, provider_id, column_name)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_column_locks_clinic ON column_locks(clinic_id);
CREATE INDEX IF NOT EXISTS idx_column_locks_provider ON column_locks(provider_id);
CREATE INDEX IF NOT EXISTS idx_column_locks_column_name ON column_locks(column_name);

-- Row Level Security (RLS)
ALTER TABLE column_locks ENABLE ROW LEVEL SECURITY;

-- Users can read column locks for their clinic
CREATE POLICY "Users can read column locks" ON column_locks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      -- AND (
      --   users.role = 'super_admin'
      --   OR users.clinic_id = column_locks.clinic_id
      -- )
    )
  );

-- Only super admins and clinic admins can manage column locks
CREATE POLICY "Admins can manage column locks" ON column_locks
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND (
        users.role = 'super_admin'
        -- OR (users.role = 'admin' AND users.clinic_id = column_locks.clinic_id)
        OR users.role = 'admin'
      )
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_column_locks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER trigger_column_locks_updated_at
  BEFORE UPDATE ON column_locks
  FOR EACH ROW
  EXECUTE FUNCTION update_column_locks_updated_at();
