-- Drop accounts_receivable table and recreate as accounts_receivables

-- Step 1: Drop RLS policies on accounts_receivable (required before dropping table)
DROP POLICY IF EXISTS "Super admins can manage all accounts receivable" ON accounts_receivable;
DROP POLICY IF EXISTS "Admins can manage accounts receivable for their clinics" ON accounts_receivable;
DROP POLICY IF EXISTS "Billing staff can manage accounts receivable for their clinics" ON accounts_receivable;

-- Step 2: Drop the table (CASCADE will drop dependent objects if any)
DROP TABLE IF EXISTS accounts_receivable CASCADE;

-- Step 3: Create new table accounts_receivables with same structure
CREATE TABLE accounts_receivables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  ar_id TEXT NOT NULL,
  name TEXT,
  date_of_service DATE,
  amount NUMERIC(10, 2),
  date_recorded DATE,
  type TEXT NOT NULL CHECK (type IN ('Patient', 'Insurance', 'Admin')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clinic_id, ar_id)
);

-- Step 4: Create indexes
CREATE INDEX IF NOT EXISTS idx_accounts_receivables_clinic_id ON accounts_receivables(clinic_id);
CREATE INDEX IF NOT EXISTS idx_accounts_receivables_date_recorded ON accounts_receivables(date_recorded);

-- Step 5: Enable RLS
ALTER TABLE accounts_receivables ENABLE ROW LEVEL SECURITY;

-- Step 6: RLS Policies for accounts_receivables
CREATE POLICY "Super admins can manage all accounts receivables"
  ON accounts_receivables
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'super_admin'
    )
  );

CREATE POLICY "Admins can manage accounts receivables for their clinics"
  ON accounts_receivables
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'view_only_admin')
      AND accounts_receivables.clinic_id = ANY(users.clinic_ids)
    )
  );

CREATE POLICY "Billing staff can manage accounts receivables for their clinics"
  ON accounts_receivables
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('billing_staff', 'view_only_billing')
      AND accounts_receivables.clinic_id = ANY(users.clinic_ids)
    )
  );
