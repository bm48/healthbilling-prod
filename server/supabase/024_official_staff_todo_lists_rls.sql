-- Grant official_staff the same todo_lists access as billing_staff (view/insert/update/delete for their clinic_ids).

DROP POLICY IF EXISTS "Billing staff can view todos for their clinics" ON todo_lists;
CREATE POLICY "Billing staff can view todos for their clinics" ON todo_lists
  FOR SELECT USING (
    clinic_id = ANY(
      SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
    ) AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'official_staff', 'admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Billing staff can insert todos for their clinics" ON todo_lists;
CREATE POLICY "Billing staff can insert todos for their clinics" ON todo_lists
  FOR INSERT WITH CHECK (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'official_staff', 'admin', 'super_admin')
      ) AND created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Billing staff can update todos for their clinics" ON todo_lists;
CREATE POLICY "Billing staff can update todos for their clinics" ON todo_lists
  FOR UPDATE USING (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'official_staff', 'admin', 'super_admin')
      )
    )
  );

DROP POLICY IF EXISTS "Billing staff can delete todos for their clinics" ON todo_lists;
CREATE POLICY "Billing staff can delete todos for their clinics" ON todo_lists
  FOR DELETE USING (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'official_staff', 'admin', 'super_admin')
      )
    )
  );
