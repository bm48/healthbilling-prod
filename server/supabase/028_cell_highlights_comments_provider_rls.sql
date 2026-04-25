-- Allow providers to read cell_highlights and cell_comments for clinics they belong to
-- (via providers.clinic_ids), not only users.clinic_ids. Super_admin and staff use users.clinic_ids.

-- cell_highlights: add provider read access
DROP POLICY IF EXISTS "Users can read cell highlights for their clinics" ON cell_highlights;
CREATE POLICY "Users can read cell highlights for their clinics"
  ON cell_highlights FOR SELECT TO authenticated
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
  );

-- cell_comments: add provider read access
DROP POLICY IF EXISTS "Users can read cell comments for their clinics" ON cell_comments;
CREATE POLICY "Users can read cell comments for their clinics"
  ON cell_comments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND cell_comments.clinic_id = ANY(COALESCE(users.clinic_ids, '{}'))
    )
    OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'super_admin')
    OR EXISTS (
      SELECT 1 FROM providers p
      WHERE p.id = current_user_provider_id()
      AND cell_comments.clinic_id = ANY(COALESCE(p.clinic_ids, '{}'))
    )
  );
