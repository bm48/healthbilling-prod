-- Change providers.clinic_id from single UUID to UUID[] so one provider can belong to multiple clinics.

-- Step 1: Add new column
ALTER TABLE providers ADD COLUMN IF NOT EXISTS clinic_ids UUID[] DEFAULT '{}';

-- Step 2: Migrate existing data (copy single clinic_id into array)
UPDATE providers SET clinic_ids = ARRAY[clinic_id] WHERE clinic_id IS NOT NULL AND (clinic_ids IS NULL OR clinic_ids = '{}');

-- Step 3: Drop RLS policies that depend on clinic_id (must be dropped before dropping the column)
DROP POLICY IF EXISTS "Users can view providers in their clinics" ON providers;
DROP POLICY IF EXISTS "Admins can manage providers in their clinics" ON providers;

-- Step 4: Drop foreign key and old column (drop constraint by name; default name from 014_schema is providers_clinic_id_fkey)
ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_clinic_id_fkey;
ALTER TABLE providers DROP COLUMN IF EXISTS clinic_id;

-- Step 5: Ensure NOT NULL and default for new column
ALTER TABLE providers ALTER COLUMN clinic_ids SET DEFAULT '{}';
ALTER TABLE providers ALTER COLUMN clinic_ids SET NOT NULL;
-- Allow empty array for providers not yet assigned to a clinic
UPDATE providers SET clinic_ids = '{}' WHERE clinic_ids IS NULL;

-- Step 6: Drop old indexes, create GIN index for array overlap/contains
DROP INDEX IF EXISTS idx_providers_clinic_id;
DROP INDEX IF EXISTS idx_providers_active;
CREATE INDEX IF NOT EXISTS idx_providers_clinic_ids ON providers USING GIN(clinic_ids);
CREATE INDEX IF NOT EXISTS idx_providers_active ON providers(active);

-- Step 7: Update audit trigger to use clinic_ids for providers (first clinic in array for audit log)
CREATE OR REPLACE FUNCTION create_audit_log()
RETURNS TRIGGER AS $$
DECLARE
  audit_clinic_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'providers' THEN
    IF TG_OP = 'INSERT' THEN audit_clinic_id := (NEW.clinic_ids)[1];
    ELSIF TG_OP = 'UPDATE' THEN audit_clinic_id := (NEW.clinic_ids)[1];
    ELSIF TG_OP = 'DELETE' THEN audit_clinic_id := (OLD.clinic_ids)[1];
    END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN audit_clinic_id := NEW.clinic_id;
    ELSIF TG_OP = 'UPDATE' THEN audit_clinic_id := NEW.clinic_id;
    ELSIF TG_OP = 'DELETE' THEN audit_clinic_id := OLD.clinic_id;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (user_id, clinic_id, action, table_name, record_id, new_values)
    VALUES (auth.uid(), audit_clinic_id, 'INSERT', TG_TABLE_NAME, NEW.id, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (user_id, clinic_id, action, table_name, record_id, old_values, new_values)
    VALUES (auth.uid(), audit_clinic_id, 'UPDATE', TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (user_id, clinic_id, action, table_name, record_id, old_values)
    VALUES (auth.uid(), audit_clinic_id, 'DELETE', TG_TABLE_NAME, OLD.id, to_jsonb(OLD));
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 8: Recreate RLS policies for providers (use array overlap with user's clinic_ids)
CREATE POLICY "Users can view providers in their clinics" ON providers
  FOR SELECT USING (
    clinic_ids && (SELECT clinic_ids FROM users WHERE id = auth.uid())
    OR is_super_admin()
  );

CREATE POLICY "Admins can manage providers in their clinics" ON providers
  FOR ALL USING (
    clinic_ids && (SELECT clinic_ids FROM users WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role IN ('admin', 'super_admin')
    )
  );
