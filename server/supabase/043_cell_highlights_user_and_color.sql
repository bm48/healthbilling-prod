-- Store who highlighted each cell and which color to show (color of user who highlighted)
ALTER TABLE cell_highlights
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS highlight_color TEXT;

CREATE INDEX IF NOT EXISTS idx_cell_highlights_user_id ON cell_highlights(user_id);

COMMENT ON COLUMN cell_highlights.user_id IS 'User who added the highlight';
COMMENT ON COLUMN cell_highlights.highlight_color IS 'Highlight color of that user at time of highlight (hex e.g. #eab308)';

-- Allow update for upsert (same clinic access as insert/delete)
CREATE POLICY "Users can update cell highlights for their clinics"
  ON cell_highlights FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND cell_highlights.clinic_id = ANY(COALESCE(users.clinic_ids, '{}'))
    )
    OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'super_admin')
    OR EXISTS (
      SELECT 1 FROM providers p
      WHERE p.id = current_user_provider_id()
      AND cell_highlights.clinic_id = ANY(COALESCE(p.clinic_ids, '{}'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND cell_highlights.clinic_id = ANY(COALESCE(users.clinic_ids, '{}'))
    )
    OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'super_admin')
    OR EXISTS (
      SELECT 1 FROM providers p
      WHERE p.id = current_user_provider_id()
      AND cell_highlights.clinic_id = ANY(COALESCE(p.clinic_ids, '{}'))
    )
  );
