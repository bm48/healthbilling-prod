-- Persistent invoice summaries (one row per clinic per month).
-- Computed fields are refreshed near-real-time whenever a provider sheet is saved.
-- payment_status, payment_date, due_date are manually editable and preserved on recompute.

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  month int2 NOT NULL CHECK (month >= 1 AND month <= 12),
  year int2 NOT NULL CHECK (year >= 2000),
  insurance_payment_total numeric(12,2) NOT NULL DEFAULT 0,
  patient_payment_total numeric(12,2) NOT NULL DEFAULT 0,
  accounts_receivable_total numeric(12,2) NOT NULL DEFAULT 0,
  additional_fee numeric(12,2) NOT NULL DEFAULT 0,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  invoice_rate numeric(6,4),
  invoice_total numeric(12,2) NOT NULL DEFAULT 0,
  payment_status text,
  payment_date date,
  due_date date,
  note text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_clinic_month_year_key UNIQUE (clinic_id, month, year)
);

COMMENT ON TABLE public.invoices IS
  'Pre-computed invoice summary per clinic per month. Refreshed on every provider sheet save. payment_status/payment_date/due_date are manually editable and preserved on recompute.';

COMMENT ON COLUMN public.invoices.subtotal IS
  'insurance_payment_total + patient_payment_total + accounts_receivable_total + additional_fee';

COMMENT ON COLUMN public.invoices.invoice_total IS
  'subtotal * invoice_rate (the billing fee owed to American Medical Billing)';

COMMENT ON COLUMN public.invoices.due_date IS
  'Default = 15th day of the month following the invoice month. Manually editable by super admin.';

CREATE INDEX IF NOT EXISTS idx_invoices_clinic_id ON public.invoices (clinic_id);
CREATE INDEX IF NOT EXISTS idx_invoices_year_month ON public.invoices (year, month);
