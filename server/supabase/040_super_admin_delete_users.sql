-- Allow super admins to delete user rows from public.users (removes app access; auth user remains).
CREATE POLICY "Super admins can delete users" ON users
  FOR DELETE USING (is_super_admin());
