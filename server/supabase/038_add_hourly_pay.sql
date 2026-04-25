-- Add hourly_pay to timecards (rate used for each timecard entry)
ALTER TABLE timecards
  ADD COLUMN IF NOT EXISTS hourly_pay NUMERIC(10, 2);

-- Add hourly_pay to users (default rate set in Super Admin when adding/editing user; used when creating timecard entries)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS hourly_pay NUMERIC(10, 2);
