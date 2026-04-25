-- Allow super admin to lock a timecard row (prevents edit/delete until unlocked)
ALTER TABLE timecards
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN timecards.is_locked IS 'When true, super admin has locked this row; edit/delete are disabled in UI until unlocked.';
