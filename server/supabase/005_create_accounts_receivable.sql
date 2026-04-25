-- Accounts Receivable table
CREATE TABLE IF NOT EXISTS accounts_receivable (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  ar_id TEXT NOT NULL,
  name TEXT,
  date_of_service DATE,
  amount NUMERIC(10, 2),
  date_recorded DATE,
  type TEXT NOT NULL CHECK (type IN ('Patient', 'Insurance', 'Collections', 'MindRx Group')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clinic_id, ar_id)
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_accounts_receivable_clinic_id ON accounts_receivable(clinic_id);
CREATE INDEX IF NOT EXISTS idx_accounts_receivable_date_recorded ON accounts_receivable(date_recorded);

-- Enable RLS
ALTER TABLE accounts_receivable ENABLE ROW LEVEL SECURITY;

-- RLS Policies for accounts_receivable
-- Super admins can do everything
CREATE POLICY "Super admins can manage all accounts receivable"
  ON accounts_receivable
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'super_admin'
    )
  );

-- Admins can manage AR for their clinics
CREATE POLICY "Admins can manage accounts receivable for their clinics"
  ON accounts_receivable
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'view_only_admin')
      AND accounts_receivable.clinic_id = ANY(users.clinic_ids)
    )
  );

-- Billing staff can view and edit AR for their clinics
CREATE POLICY "Billing staff can manage accounts receivable for their clinics"
  ON accounts_receivable
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('billing_staff', 'view_only_billing')
      AND accounts_receivable.clinic_id = ANY(users.clinic_ids)
    )
  );

-- First, alter the check constraint to allow 'ar_type' in status_colors if needed
DO $$
BEGIN
  -- Check if constraint exists and drop it
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'status_colors_type_check'
  ) THEN
    ALTER TABLE status_colors DROP CONSTRAINT status_colors_type_check;
  END IF;
END $$;

-- Recreate constraint with ar_type included
ALTER TABLE status_colors 
ADD CONSTRAINT status_colors_type_check 
CHECK (type IN ('appointment', 'claim', 'patient_pay', 'month', 'ar_type'));

-- Add AR type colors to status_colors table
INSERT INTO status_colors (status, color, text_color, type)
VALUES 
  ('Patient', '#e3f2fd', '#000000', 'ar_type'),
  ('Insurance', '#fff9c4', '#000000', 'ar_type'),
  ('Collections', '#ffccbc', '#000000', 'ar_type'),
  ('MindRx Group', '#e1bee7', '#000000', 'ar_type')
ON CONFLICT (status, type) DO NOTHING;
