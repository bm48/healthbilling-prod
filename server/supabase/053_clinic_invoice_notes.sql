-- Invoice notes per clinic per month (super admin only). One row per clinic per month.
CREATE TABLE IF NOT EXISTS public.clinic_invoice_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  month smallint NOT NULL CHECK (month >= 1 AND month <= 12),
  year smallint NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_clinic_invoice_notes_lookup
  ON public.clinic_invoice_notes (clinic_id, year, month);

ALTER TABLE public.clinic_invoice_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can select clinic_invoice_notes"
  ON public.clinic_invoice_notes FOR SELECT USING (is_super_admin());

CREATE POLICY "Super admins can insert clinic_invoice_notes"
  ON public.clinic_invoice_notes FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update clinic_invoice_notes"
  ON public.clinic_invoice_notes FOR UPDATE USING (is_super_admin());

CREATE POLICY "Super admins can delete clinic_invoice_notes"
  ON public.clinic_invoice_notes FOR DELETE USING (is_super_admin());

COMMENT ON TABLE public.clinic_invoice_notes IS 'Notes for clinic invoices, one per clinic per month; super admin only.';
