-- Add notes column to timecards (used in Edit timecard form and manual entry)
ALTER TABLE timecards
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN timecards.notes IS 'Optional notes for this timecard entry.';
