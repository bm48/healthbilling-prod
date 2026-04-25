-- Table for per-cell highlights (yellow highlight on provider sheet cells)
CREATE TABLE IF NOT EXISTS cell_highlights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  sheet_type TEXT NOT NULL,
  row_id TEXT NOT NULL,
  column_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clinic_id, sheet_type, row_id, column_key)
);

CREATE INDEX IF NOT EXISTS idx_cell_highlights_lookup ON cell_highlights(clinic_id, sheet_type);

ALTER TABLE cell_highlights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read cell highlights for their clinics"
  ON cell_highlights FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND cell_highlights.clinic_id = ANY(users.clinic_ids)
    )
    OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'super_admin')
  );

CREATE POLICY "Users can insert cell highlights for their clinics"
  ON cell_highlights FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND cell_highlights.clinic_id = ANY(users.clinic_ids)
    )
    OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'super_admin')
  );

CREATE POLICY "Users can delete cell highlights for their clinics"
  ON cell_highlights FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND cell_highlights.clinic_id = ANY(users.clinic_ids)
    )
    OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'super_admin')
  );
