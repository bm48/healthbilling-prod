-- Migration: Add subscriber_id, copay, and coinsurance fields to patients table

-- Add new columns if they don't exist
DO $$ 
BEGIN
  -- Add subscriber_id column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'subscriber_id'
  ) THEN
    ALTER TABLE patients ADD COLUMN subscriber_id TEXT;
  END IF;

  -- Add copay column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'copay'
  ) THEN
    ALTER TABLE patients ADD COLUMN copay NUMERIC(10, 2);
  END IF;

  -- Add coinsurance column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'patients' AND column_name = 'coinsurance'
  ) THEN
    ALTER TABLE patients ADD COLUMN coinsurance NUMERIC(5, 2);
  END IF;
END $$;
