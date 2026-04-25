-- Ensure providers.active exists and defaults to true (synced when user active is toggled in User Management).
ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

UPDATE providers SET active = true WHERE active IS NULL;
ALTER TABLE providers ALTER COLUMN active SET DEFAULT true;
ALTER TABLE providers ALTER COLUMN active SET NOT NULL;
