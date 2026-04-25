-- Add additional_fee to clinic invoice notes (default $0.00).
ALTER TABLE public.clinic_invoice_notes
  ADD COLUMN IF NOT EXISTS additional_fee numeric(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.clinic_invoice_notes.additional_fee IS 'Optional additional fee for this clinic for the invoice month; included in Total and in PDF notes when non-zero.';
