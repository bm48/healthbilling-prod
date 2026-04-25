-- Add 'official_staff' role to users.role CHECK constraint.
-- Official staff can access only one assigned clinic and view only the billing (to-do) tab.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
  'super_admin',
  'admin',
  'view_only_admin',
  'billing_staff',
  'view_only_billing',
  'provider',
  'office_staff',
  'official_staff'
));
