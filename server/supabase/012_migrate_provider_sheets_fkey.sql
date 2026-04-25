-- Migration script to fix provider_sheets.provider_id foreign key constraint
-- This changes the foreign key from users(id) to providers(id)
--
-- IMPORTANT: Before running this migration, ensure that all provider_id values
-- in provider_sheets table reference valid provider IDs from the providers table,
-- NOT user IDs from the users table.
--
-- If you have existing data with user IDs, you'll need to either:
-- 1. Delete those rows, OR
-- 2. Map user IDs to provider IDs and update them

-- Step 1: Check for any invalid provider_ids (those that don't exist in providers table)
-- This will show you any rows that need to be fixed or deleted
SELECT ps.id, ps.provider_id, ps.clinic_id, ps.month, ps.year
FROM provider_sheets ps
LEFT JOIN providers p ON ps.provider_id = p.id
WHERE p.id IS NULL;

-- Step 2: If there are invalid rows, you can delete them (uncomment to run):
-- DELETE FROM provider_sheets ps
-- WHERE NOT EXISTS (SELECT 1 FROM providers p WHERE p.id = ps.provider_id);

-- Step 3: Drop the old foreign key constraint
ALTER TABLE provider_sheets 
DROP CONSTRAINT IF EXISTS provider_sheets_provider_id_fkey;

-- Step 4: Add the new foreign key constraint pointing to providers table
ALTER TABLE provider_sheets 
ADD CONSTRAINT provider_sheets_provider_id_fkey 
FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;

-- Step 5: Verify the constraint was created correctly
-- You can check this by running:
-- SELECT conname, conrelid::regclass, confrelid::regclass 
-- FROM pg_constraint 
-- WHERE conname = 'provider_sheets_provider_id_fkey';
