-- Normalize provider sheet data: move from JSONB row_data to a proper table with general SQL types.
-- provider_sheets keeps metadata (clinic_id, provider_id, month, year, locked, locked_columns).
-- provider_sheet_rows stores one row per sheet row with typed columns.

-- 1) Create provider_sheet_rows table (general types, not JSON)
CREATE TABLE IF NOT EXISTS provider_sheet_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES provider_sheets(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,

  patient_id TEXT,
  patient_first_name TEXT,
  patient_last_name TEXT,
  last_initial TEXT,
  patient_insurance TEXT,
  patient_copay NUMERIC(10, 2),
  patient_coinsurance NUMERIC(10, 2),
  appointment_date TEXT,
  appointment_time TEXT,
  visit_type TEXT,
  notes TEXT,

  billing_code TEXT,
  billing_code_color TEXT,
  cpt_code TEXT,
  cpt_code_color TEXT,
  appointment_status TEXT,
  appointment_status_color TEXT,

  claim_status TEXT,
  claim_status_color TEXT,
  submit_date TEXT,
  insurance_payment TEXT,
  insurance_adjustment TEXT,

  invoice_amount NUMERIC(10, 2),
  collected_from_patient TEXT,
  patient_pay_status TEXT,
  patient_pay_status_color TEXT,
  payment_date TEXT,
  payment_date_color TEXT,

  ar_type TEXT,
  ar_amount NUMERIC(10, 2),
  ar_date TEXT,
  ar_date_color TEXT,
  ar_notes TEXT,

  provider_payment_amount NUMERIC(10, 2),
  provider_payment_date TEXT,
  provider_payment_notes TEXT,

  highlight_color TEXT,
  total TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_sheet_rows_sheet_id ON provider_sheet_rows(sheet_id);
CREATE INDEX IF NOT EXISTS idx_provider_sheet_rows_sheet_sort ON provider_sheet_rows(sheet_id, sort_order);

-- 2) Migrate existing row_data (JSONB) into provider_sheet_rows (only when column exists)
INSERT INTO provider_sheet_rows (
  sheet_id, sort_order,
  patient_id, patient_first_name, patient_last_name, last_initial, patient_insurance,
  patient_copay, patient_coinsurance, appointment_date, appointment_time, visit_type, notes,
  billing_code, billing_code_color, cpt_code, cpt_code_color, appointment_status, appointment_status_color,
  claim_status, claim_status_color, submit_date, insurance_payment, insurance_adjustment,
  invoice_amount, collected_from_patient, patient_pay_status, patient_pay_status_color, payment_date, payment_date_color,
  ar_type, ar_amount, ar_date, ar_date_color, ar_notes,
  provider_payment_amount, provider_payment_date, provider_payment_notes,
  highlight_color, total, created_at, updated_at
)
SELECT
  ps.id,
  (t.ord - 1)::INTEGER,
  (elem->>'patient_id')::TEXT,
  (elem->>'patient_first_name')::TEXT,
  (elem->>'patient_last_name')::TEXT,
  (elem->>'last_initial')::TEXT,
  (elem->>'patient_insurance')::TEXT,
  (elem->>'patient_copay')::NUMERIC,
  (elem->>'patient_coinsurance')::NUMERIC,
  (elem->>'appointment_date')::TEXT,
  (elem->>'appointment_time')::TEXT,
  (elem->>'visit_type')::TEXT,
  (elem->>'notes')::TEXT,
  (elem->>'billing_code')::TEXT,
  (elem->>'billing_code_color')::TEXT,
  (elem->>'cpt_code')::TEXT,
  (elem->>'cpt_code_color')::TEXT,
  (elem->>'appointment_status')::TEXT,
  (elem->>'appointment_status_color')::TEXT,
  (elem->>'claim_status')::TEXT,
  (elem->>'claim_status_color')::TEXT,
  (elem->>'submit_date')::TEXT,
  (elem->>'insurance_payment')::TEXT,
  (elem->>'insurance_adjustment')::TEXT,
  (elem->>'invoice_amount')::NUMERIC,
  (elem->>'collected_from_patient')::TEXT,
  (elem->>'patient_pay_status')::TEXT,
  (elem->>'patient_pay_status_color')::TEXT,
  (elem->>'payment_date')::TEXT,
  (elem->>'payment_date_color')::TEXT,
  (elem->>'ar_type')::TEXT,
  (elem->>'ar_amount')::NUMERIC,
  (elem->>'ar_date')::TEXT,
  (elem->>'ar_date_color')::TEXT,
  (elem->>'ar_notes')::TEXT,
  (elem->>'provider_payment_amount')::NUMERIC,
  (elem->>'provider_payment_date')::TEXT,
  (elem->>'provider_payment_notes')::TEXT,
  (elem->>'highlight_color')::TEXT,
  (elem->>'total')::TEXT,
  COALESCE((elem->>'created_at')::TIMESTAMPTZ, NOW()),
  COALESCE((elem->>'updated_at')::TIMESTAMPTZ, NOW())
FROM provider_sheets ps
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ps.row_data, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
WHERE jsonb_typeof(COALESCE(ps.row_data, '[]'::jsonb)) = 'array';

-- 3) Drop row_data from provider_sheets
ALTER TABLE provider_sheets DROP COLUMN IF EXISTS row_data;

-- 4) RLS for provider_sheet_rows (same access as provider_sheets via sheet_id)
ALTER TABLE provider_sheet_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view provider_sheet_rows for their clinics" ON provider_sheet_rows;
CREATE POLICY "Users can view provider_sheet_rows for their clinics" ON provider_sheet_rows
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM provider_sheets ps
      WHERE ps.id = provider_sheet_rows.sheet_id
      AND (
        ps.clinic_id = ANY(SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid())
        OR is_super_admin()
      )
    )
  );

DROP POLICY IF EXISTS "Users can insert provider_sheet_rows for their clinics" ON provider_sheet_rows;
CREATE POLICY "Users can insert provider_sheet_rows for their clinics" ON provider_sheet_rows
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM provider_sheets ps
      WHERE ps.id = provider_sheet_rows.sheet_id
      AND (
        is_super_admin()
        OR (
          ps.clinic_id = ANY(SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid())
          AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin', 'provider', 'office_staff'))
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can update provider_sheet_rows for their clinics" ON provider_sheet_rows;
CREATE POLICY "Users can update provider_sheet_rows for their clinics" ON provider_sheet_rows
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM provider_sheets ps
      WHERE ps.id = provider_sheet_rows.sheet_id
      AND (
        is_super_admin()
        OR (
          ps.clinic_id = ANY(SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid())
          AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin', 'provider', 'office_staff'))
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can delete provider_sheet_rows for their clinics" ON provider_sheet_rows;
CREATE POLICY "Users can delete provider_sheet_rows for their clinics" ON provider_sheet_rows
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM provider_sheets ps
      WHERE ps.id = provider_sheet_rows.sheet_id
      AND (
        is_super_admin()
        OR (
          ps.clinic_id = ANY(SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid())
          AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin', 'provider', 'office_staff'))
        )
      )
    )
  );

-- 5) Trigger to keep updated_at in sync
CREATE OR REPLACE FUNCTION update_provider_sheet_rows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_provider_sheet_rows_updated_at ON provider_sheet_rows;
CREATE TRIGGER update_provider_sheet_rows_updated_at
  BEFORE UPDATE ON provider_sheet_rows
  FOR EACH ROW EXECUTE FUNCTION update_provider_sheet_rows_updated_at();
