-- Allow super admins to insert timecards for any user (e.g. when adding a user with hourly pay)
CREATE POLICY "Super admins can insert timecards for any user" ON timecards
  FOR INSERT WITH CHECK (is_super_admin());
