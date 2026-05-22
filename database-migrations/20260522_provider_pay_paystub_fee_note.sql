-- Per-paystub "additional fee" + "note", mirroring the per-clinic invoice equivalent on clinic_invoice_notes.
-- The fee is included in the paystub's Direct Deposit Amount; the note is rendered below the amounts on the PDF.
-- Default 0 / NULL preserves behavior for existing rows.
-- Run once against existing databases. Fresh installs should use updated database-deploy.sql.

ALTER TABLE public.provider_pay
  ADD COLUMN IF NOT EXISTS paystub_additional_fee numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.provider_pay
  ADD COLUMN IF NOT EXISTS paystub_note text;

COMMENT ON COLUMN public.provider_pay.paystub_additional_fee IS
  'Per-paystub fee (+) or deduction (−) added to the Direct Deposit Amount on the generated paystub PDF. Edited in Provider Pay tab; mirrors clinic_invoice_notes.additional_fee for invoices.';
COMMENT ON COLUMN public.provider_pay.paystub_note IS
  'Free-form note rendered in the Notes section of the paystub PDF. Distinct from provider_pay.notes (side notes for the Provider Pay sheet).';
