-- Add notes column to provider_pay header for side description in Provider Pay tab
ALTER TABLE IF EXISTS provider_pay
  ADD COLUMN IF NOT EXISTS notes TEXT;

