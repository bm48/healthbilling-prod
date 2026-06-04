-- Multi-line additional fees on the monthly invoice.
--
-- BEFORE: `clinic_invoice_notes.additional_fee` held a single combined number and the
-- standalone `note` column was used both for the line label and as a free-form memo. The user
-- could only have one fee per invoice and had no way to delete an existing fee line.
--
-- AFTER: each additional fee is its own row in `invoice_additional_fee_lines`, with its own
-- label and amount. Users can add many, edit them independently, and delete any of them. The
-- standalone `clinic_invoice_notes.note` column is preserved for a free-form memo if Jenali
-- wants one again later, but the invoice PDF no longer reads it as a fee label.
--
-- One-time migration: any existing non-zero `clinic_invoice_notes.additional_fee` is copied into
-- the new lines table (using the note as the line label, falling back to "Additional Fee" when
-- the note is empty). The legacy `additional_fee` column is then zeroed so the server's recompute
-- logic — which only sums the new lines table — doesn't double-count.
--
-- SAFE TO RE-RUN: every statement uses IF NOT EXISTS guards; the migration step is guarded so
-- it only fires the first time a row's `additional_fee` is non-zero.

CREATE TABLE IF NOT EXISTS public.invoice_additional_fee_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  month int2 NOT NULL CHECK (month >= 1 AND month <= 12),
  year int2 NOT NULL CHECK (year >= 2000),
  /** Human label shown on the invoice PDF row (e.g. "Reimbursement", "PDF setup fee"). */
  label text NOT NULL DEFAULT 'Additional Fee',
  /** Flat charge added to the invoice total at face value — NOT multiplied by any billing rate. */
  amount numeric(12,2) NOT NULL DEFAULT 0,
  /** Display order on the invoice PDF; lower numbers render first. Defaults to extract(epoch) so
   *  newly-inserted lines naturally land at the bottom of the list. */
  sort_order int8 NOT NULL DEFAULT extract(epoch from now())::int8,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.invoice_additional_fee_lines IS
  'One row per additional-fee line on a monthly clinic invoice. Each has its own label and amount; users can add, edit, and delete lines independently.';

CREATE INDEX IF NOT EXISTS idx_invoice_additional_fee_lines_clinic_month
  ON public.invoice_additional_fee_lines (clinic_id, year, month, sort_order);

-- One-time migration: pull every legacy non-zero `clinic_invoice_notes.additional_fee` into the
-- new lines table, then zero out the legacy column so the recompute logic doesn't double-count.
-- Guarded so it's a no-op on re-runs (legacy values are already zero after the first run).
WITH migrated AS (
  INSERT INTO public.invoice_additional_fee_lines (clinic_id, month, year, label, amount, sort_order)
  SELECT
    n.clinic_id,
    n.month,
    n.year,
    COALESCE(NULLIF(trim(n.note), ''), 'Additional Fee') AS label,
    n.additional_fee,
    0 AS sort_order
  FROM public.clinic_invoice_notes n
  WHERE n.additional_fee IS NOT NULL AND n.additional_fee <> 0
  RETURNING clinic_id, month, year
)
UPDATE public.clinic_invoice_notes n
   SET additional_fee = 0, updated_at = now()
  FROM migrated m
 WHERE n.clinic_id = m.clinic_id
   AND n.month = m.month
   AND n.year = m.year;
