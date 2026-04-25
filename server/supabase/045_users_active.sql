-- Add active flag to users (super admin can toggle in User Management).
-- Inactive users are hidden from lists and dashboard. New users are active by default.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
