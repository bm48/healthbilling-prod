-- Add payroll (1 or 2) to clinics, accounts_receivables, and provider_pay.
-- Payroll 1 = default/original; Payroll 2 = clinics with two pay periods per month.

-- Clinics: one payroll setting per clinic
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS payroll SMALLINT NOT NULL DEFAULT 1
  CHECK (payroll IN (1, 2));

-- Accounts receivables: each row belongs to payroll 1 or 2
ALTER TABLE accounts_receivables
  ADD COLUMN IF NOT EXISTS payroll SMALLINT NOT NULL DEFAULT 1
  CHECK (payroll IN (1, 2));

-- Provider pay: allow two records per (clinic, provider, year, month) when payroll is 2
ALTER TABLE provider_pay
  ADD COLUMN IF NOT EXISTS payroll SMALLINT NOT NULL DEFAULT 1
  CHECK (payroll IN (1, 2));

-- Drop old unique constraint on provider_pay (name from PostgreSQL convention)
ALTER TABLE provider_pay
  DROP CONSTRAINT IF EXISTS provider_pay_clinic_id_provider_id_year_month_key;

-- Add new unique constraint including payroll
ALTER TABLE provider_pay
  ADD CONSTRAINT provider_pay_clinic_provider_year_month_payroll_key
  UNIQUE (clinic_id, provider_id, year, month, payroll);

-- Index for filtering AR by payroll
CREATE INDEX IF NOT EXISTS idx_accounts_receivables_payroll
  ON accounts_receivables(clinic_id, payroll);

-- Index for provider_pay lookups by payroll
CREATE INDEX IF NOT EXISTS idx_provider_pay_payroll
  ON provider_pay(clinic_id, provider_id, year, month, payroll);
