-- Status Colors table for storing configurable colors for statuses and months
CREATE TABLE IF NOT EXISTS status_colors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status TEXT NOT NULL,
  color TEXT NOT NULL,
  text_color TEXT NOT NULL DEFAULT '#000000',
  type TEXT NOT NULL CHECK (type IN ('appointment', 'claim', 'patient_pay', 'month')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(status, type)
);

-- Insert default status colors
INSERT INTO status_colors (status, color, text_color, type) VALUES
-- Appointment Status Colors
('Complete', '#22c55e', '#ffffff', 'appointment'),
('PP Complete', '#3b82f6', '#ffffff', 'appointment'),
('Charge NS/LC', '#f59e0b', '#000000', 'appointment'),
('RS No Charge', '#ef4444', '#ffffff', 'appointment'),
('NS No Charge', '#6b7280', '#ffffff', 'appointment'),
('Note not complete', '#dc2626', '#ffffff', 'appointment'),

-- Claim Status Colors
('Claim Sent', '#3b82f6', '#ffffff', 'claim'),
('RS', '#f59e0b', '#000000', 'claim'),
('IP', '#eab308', '#000000', 'claim'),
('Paid', '#22c55e', '#ffffff', 'claim'),
('Deductible', '#a855f7', '#ffffff', 'claim'),
('N/A', '#6b7280', '#ffffff', 'claim'),
('PP', '#06b6d4', '#ffffff', 'claim'),
('Denial', '#ef4444', '#ffffff', 'claim'),
('Rejection', '#dc2626', '#ffffff', 'claim'),
('No Coverage', '#991b1b', '#ffffff', 'claim'),

-- Patient Pay Status Colors
('Paid', '#22c55e', '#ffffff', 'patient_pay'),
('CC declined', '#ef4444', '#ffffff', 'patient_pay'),
('Secondary', '#3b82f6', '#ffffff', 'patient_pay'),
('Refunded', '#f59e0b', '#000000', 'patient_pay'),
('Payment Plan', '#a855f7', '#ffffff', 'patient_pay'),
('Waiting on Claims', '#6b7280', '#ffffff', 'patient_pay'),

-- Month Colors
('January', '#dc2626', '#ffffff', 'month'),
('February', '#ec4899', '#ffffff', 'month'),
('March', '#f59e0b', '#000000', 'month'),
('April', '#fde047', '#000000', 'month'),
('May', '#84cc16', '#ffffff', 'month'),
('June', '#22c55e', '#ffffff', 'month'),
('July', '#06b6d4', '#ffffff', 'month'),
('August', '#0284c7', '#ffffff', 'month'),
('September', '#6366f1', '#ffffff', 'month'),
('October', '#f97316', '#ffffff', 'month'),
('November', '#a855f7', '#ffffff', 'month'),
('December', '#0ea5e9', '#ffffff', 'month')
ON CONFLICT (status, type) DO NOTHING;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_status_colors_type ON status_colors(type);

-- Row Level Security (RLS)
ALTER TABLE status_colors ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read status colors
CREATE POLICY "Anyone can read status colors" ON status_colors
  FOR SELECT
  TO authenticated
  USING (true);

-- Only super admins can modify status colors
CREATE POLICY "Super admins can modify status colors" ON status_colors
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'super_admin'
    )
  );


  -- Add AR type colors to status_colors table
  -- First, alter the check constraint to allow 'ar_type'
ALTER TABLE status_colors 
DROP CONSTRAINT IF EXISTS status_colors_type_check;

ALTER TABLE status_colors 
ADD CONSTRAINT status_colors_type_check 
CHECK (type IN ('appointment', 'claim', 'patient_pay', 'month', 'ar_type'));

-- Add AR type colors to status_colors table
INSERT INTO status_colors (status, color, text_color, type)
VALUES 
  ('Patient', '#e3f2fd', '#000000', 'ar_type'),
  ('Insurance', '#fff9c4', '#000000', 'ar_type'),
  ('Admin', '#e1bee7', '#000000', 'ar_type')
ON CONFLICT (status, type) DO NOTHING;
