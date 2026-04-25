-- Provider Pay: header per provider per month + rows (description, amount, notes)
-- Used by the Provider Pay tab to persist pay date, pay period, and the payment breakdown table.

CREATE TABLE IF NOT EXISTS provider_pay (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  year SMALLINT NOT NULL,
  month SMALLINT NOT NULL CHECK (month >= 1 AND month <= 12),
  pay_date TEXT,
  pay_period TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clinic_id, provider_id, year, month)
);

CREATE TABLE IF NOT EXISTS provider_pay_rows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_pay_id UUID NOT NULL REFERENCES provider_pay(id) ON DELETE CASCADE,
  row_index SMALLINT NOT NULL,
  description TEXT,
  amount TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider_pay_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_provider_pay_clinic_provider_year_month
  ON provider_pay(clinic_id, provider_id, year, month);
CREATE INDEX IF NOT EXISTS idx_provider_pay_rows_provider_pay_id
  ON provider_pay_rows(provider_pay_id);

ALTER TABLE provider_pay ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_pay_rows ENABLE ROW LEVEL SECURITY;

-- RLS: allow access when user has access to the clinic (same pattern as accounts_receivables)
CREATE POLICY "Super admins can manage all provider_pay"
  ON provider_pay FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'super_admin')
  );

CREATE POLICY "Admins can manage provider_pay for their clinics"
  ON provider_pay FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'view_only_admin')
      AND provider_pay.clinic_id = ANY(users.clinic_ids)
    )
  );

CREATE POLICY "Billing staff can manage provider_pay for their clinics"
  ON provider_pay FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('billing_staff', 'view_only_billing')
      AND provider_pay.clinic_id = ANY(users.clinic_ids)
    )
  );

-- Providers can manage their own provider_pay (using SECURITY DEFINER helper to avoid reading public.users)
CREATE POLICY "Providers can manage own provider_pay"
  ON provider_pay FOR ALL TO authenticated
  USING (provider_pay.provider_id = current_user_provider_id());

-- Office staff: same clinic access as other staff
CREATE POLICY "Office staff can manage provider_pay for their clinics"
  ON provider_pay FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'office_staff'
      AND provider_pay.clinic_id = ANY(users.clinic_ids)
    )
  );

-- provider_pay_rows: same policies via provider_pay_id (user must have access to parent provider_pay)
CREATE POLICY "Super admins can manage all provider_pay_rows"
  ON provider_pay_rows FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'super_admin')
  );

CREATE POLICY "Users can manage provider_pay_rows when they can access provider_pay"
  ON provider_pay_rows FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider_pay pp
      WHERE pp.id = provider_pay_rows.provider_pay_id
      AND (
        EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'super_admin')
        OR (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'view_only_admin') AND pp.clinic_id = ANY(users.clinic_ids)))
        OR (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'view_only_billing') AND pp.clinic_id = ANY(users.clinic_ids)))
        OR (pp.provider_id = current_user_provider_id())
        OR (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'office_staff' AND pp.clinic_id = ANY(users.clinic_ids)))
      )
    )
  );
