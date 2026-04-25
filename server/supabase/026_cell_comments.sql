-- Table for per-cell comments (e.g. "comment for provider" on a cell)
CREATE TABLE IF NOT EXISTS cell_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  sheet_type TEXT NOT NULL,
  row_id TEXT NOT NULL,
  column_key TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clinic_id, sheet_type, row_id, column_key)
);

CREATE INDEX IF NOT EXISTS idx_cell_comments_lookup ON cell_comments(clinic_id, sheet_type);

ALTER TABLE cell_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read cell comments for their clinics"
  ON cell_comments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND cell_comments.clinic_id = ANY(users.clinic_ids)
    )
    OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'super_admin')
  );

CREATE POLICY "Users can insert cell comments for their clinics"
  ON cell_comments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND cell_comments.clinic_id = ANY(users.clinic_ids)
    )
    OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'super_admin')
  );

CREATE POLICY "Users can update cell comments for their clinics"
  ON cell_comments FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND cell_comments.clinic_id = ANY(users.clinic_ids)
    )
    OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'super_admin')
  );

CREATE POLICY "Users can delete cell comments for their clinics"
  ON cell_comments FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND cell_comments.clinic_id = ANY(users.clinic_ids)
    )
    OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'super_admin')
  );

CREATE OR REPLACE FUNCTION update_cell_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cell_comments_updated_at
  BEFORE UPDATE ON cell_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_cell_comments_updated_at();
