-- Migration: Replace todo_items and todo_notes with todo_list table
-- This migration drops the old tables and creates a new unified todo_list table

-- Step 1: Drop existing policies for todo_items and todo_notes
DROP POLICY IF EXISTS "Super admins can view all todos" ON todo_items;
DROP POLICY IF EXISTS "Billing staff can view todos for their clinics" ON todo_items;
DROP POLICY IF EXISTS "Billing staff can insert todos for their clinics" ON todo_items;
DROP POLICY IF EXISTS "Billing staff can update todos for their clinics" ON todo_items;
DROP POLICY IF EXISTS "Billing staff can delete todos for their clinics" ON todo_items;
DROP POLICY IF EXISTS "Users can view notes for todos in their clinics" ON todo_notes;
DROP POLICY IF EXISTS "Users can insert notes for todos in their clinics" ON todo_notes;
DROP POLICY IF EXISTS "Users can update notes for todos in their clinics" ON todo_notes;
DROP POLICY IF EXISTS "Users can delete notes for todos in their clinics" ON todo_notes;

-- Step 2: Drop existing triggers
DROP TRIGGER IF EXISTS update_todo_items_updated_at ON todo_items;

-- Step 3: Drop existing indexes
DROP INDEX IF EXISTS idx_todo_items_clinic;
DROP INDEX IF EXISTS idx_todo_items_created_by;
DROP INDEX IF EXISTS idx_todo_notes_todo_id;

-- Step 4: Drop the old tables (CASCADE will handle foreign key constraints)
DROP TABLE IF EXISTS todo_notes CASCADE;
DROP TABLE IF EXISTS todo_items CASCADE;

-- Step 5: Create the new todo_list table
CREATE TABLE IF NOT EXISTS todo_list (
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

-- Step 6: Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_todo_list_clinic ON todo_list(clinic_id);
CREATE INDEX IF NOT EXISTS idx_todo_list_created_by ON todo_list(created_by);
CREATE INDEX IF NOT EXISTS idx_todo_list_status ON todo_list(status);

-- Step 7: Create trigger for updated_at
CREATE TRIGGER update_todo_list_updated_at BEFORE UPDATE ON todo_list
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Step 8: Enable Row Level Security
ALTER TABLE todo_list ENABLE ROW LEVEL SECURITY;

-- Step 9: Create RLS Policies for todo_list
CREATE POLICY "Super admins can view all todos" ON todo_list
  FOR SELECT USING (is_super_admin());

CREATE POLICY "Billing staff can view todos for their clinics" ON todo_list
  FOR SELECT USING (
    clinic_id = ANY(
      SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
    ) AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin')
    )
  );

CREATE POLICY "Billing staff can insert todos for their clinics" ON todo_list
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

CREATE POLICY "Billing staff can update todos for their clinics" ON todo_list
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

CREATE POLICY "Billing staff can delete todos for their clinics" ON todo_list
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
