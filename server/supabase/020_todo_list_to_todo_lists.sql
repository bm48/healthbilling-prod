-- Migration: Drop todo_list and create todo_lists table
-- Run this in Supabase SQL Editor after backing up data if needed

-- Step 1: Drop RLS policies on todo_list
DROP POLICY IF EXISTS "Super admins can view all todos" ON todo_list;
DROP POLICY IF EXISTS "Billing staff can view todos for their clinics" ON todo_list;
DROP POLICY IF EXISTS "Billing staff can insert todos for their clinics" ON todo_list;
DROP POLICY IF EXISTS "Billing staff can update todos for their clinics" ON todo_list;
DROP POLICY IF EXISTS "Billing staff can delete todos for their clinics" ON todo_list;

-- Step 2: Drop trigger
DROP TRIGGER IF EXISTS update_todo_list_updated_at ON todo_list;

-- Step 3: Drop indexes
DROP INDEX IF EXISTS idx_todo_list_clinic;
DROP INDEX IF EXISTS idx_todo_list_created_by;
DROP INDEX IF EXISTS idx_todo_list_status;

-- Step 4: Drop the todo_list table
DROP TABLE IF EXISTS todo_list CASCADE;

-- Step 5: Create the new todo_lists table (same schema)
CREATE TABLE IF NOT EXISTS todo_lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  issue TEXT,
  status TEXT NOT NULL DEFAULT 'Open',
  notes TEXT,
  followup_notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Step 6: Create indexes
CREATE INDEX IF NOT EXISTS idx_todo_lists_clinic ON todo_lists(clinic_id);
CREATE INDEX IF NOT EXISTS idx_todo_lists_created_by ON todo_lists(created_by);
CREATE INDEX IF NOT EXISTS idx_todo_lists_status ON todo_lists(status);

-- Step 7: Trigger for updated_at
CREATE TRIGGER update_todo_lists_updated_at BEFORE UPDATE ON todo_lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Step 8: Enable RLS
ALTER TABLE todo_lists ENABLE ROW LEVEL SECURITY;

-- Step 9: RLS Policies for todo_lists
CREATE POLICY "Super admins can view all todos" ON todo_lists
  FOR SELECT USING (is_super_admin());

CREATE POLICY "Billing staff can view todos for their clinics" ON todo_lists
  FOR SELECT USING (
    clinic_id = ANY(
      SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
    ) AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin')
    )
  );

CREATE POLICY "Billing staff can insert todos for their clinics" ON todo_lists
  FOR INSERT WITH CHECK (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin')
      ) AND created_by = auth.uid()
    )
  );

CREATE POLICY "Billing staff can update todos for their clinics" ON todo_lists
  FOR UPDATE USING (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin')
      )
    )
  );

CREATE POLICY "Billing staff can delete todos for their clinics" ON todo_lists
  FOR DELETE USING (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin')
      )
    )
  );
