-- Migration: Add comment columns to is_lock_patients table

-- Add comment columns if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'is_lock_patients' AND column_name = 'patient_id_comment'
  ) THEN
    ALTER TABLE is_lock_patients ADD COLUMN patient_id_comment TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'is_lock_patients' AND column_name = 'first_name_comment'
  ) THEN
    ALTER TABLE is_lock_patients ADD COLUMN first_name_comment TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'is_lock_patients' AND column_name = 'last_name_comment'
  ) THEN
    ALTER TABLE is_lock_patients ADD COLUMN last_name_comment TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'is_lock_patients' AND column_name = 'insurance_comment'
  ) THEN
    ALTER TABLE is_lock_patients ADD COLUMN insurance_comment TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'is_lock_patients' AND column_name = 'copay_comment'
  ) THEN
    ALTER TABLE is_lock_patients ADD COLUMN copay_comment TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'is_lock_patients' AND column_name = 'coinsurance_comment'
  ) THEN
    ALTER TABLE is_lock_patients ADD COLUMN coinsurance_comment TEXT;
  END IF;
END $$;
