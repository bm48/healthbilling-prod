-- Allow super admins to view all timecards (e.g. Recent Timecards list on Timecards page)
CREATE POLICY "Super admins can view all timecards" ON timecards
  FOR SELECT USING (is_super_admin());
-- Allow super admins to update and delete any timecard (e.g. edit/delete hours per row on Timecards page)
CREATE POLICY "Super admins can update any timecard" ON timecards
  FOR UPDATE USING (is_super_admin());

CREATE POLICY "Super admins can delete any timecard" ON timecards
  FOR DELETE USING (is_super_admin());
