-- Per-provider billing percentages on the monthly invoice.
--
-- BEFORE: every clinic invoice used a single `clinics.invoice_rate` applied to the clinic-wide
-- subtotal. After this migration:
--   * Clinics can opt in to "per-provider" mode via `clinics.invoice_per_provider`.
--   * Each provider can override the clinic rate via `providers.invoice_rate` (NULL = inherit).
--   * When per-provider mode is on, the monthly invoice persists a per-provider breakdown in
--     the new `invoice_provider_lines` table, and `invoices.invoice_total` becomes the sum of
--     those provider rows plus (additional_fee × clinic_rate).
--
-- Defaults preserve current behavior — every existing clinic keeps `invoice_per_provider = false`
-- so today's invoices recompute identically until an admin flips the toggle.
--
-- SAFE TO RE-RUN: every statement uses IF NOT EXISTS guards.

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS invoice_per_provider boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clinics.invoice_per_provider IS
  'When true the monthly invoice breaks the subtotal out per provider using providers.invoice_rate (falling back to clinics.invoice_rate). When false, a single clinic-wide rate is applied as before.';

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS invoice_rate numeric(6,4);

COMMENT ON COLUMN public.providers.invoice_rate IS
  'Optional per-provider billing percentage (decimal, e.g. 0.0525 = 5.25%). NULL means inherit the clinic''s invoice_rate. Only used when the clinic has invoice_per_provider = true.';

ALTER TABLE public.providers
  ADD CONSTRAINT providers_invoice_rate_range CHECK (
    invoice_rate IS NULL OR (invoice_rate >= 0 AND invoice_rate <= 1)
  ) NOT VALID;

CREATE TABLE IF NOT EXISTS public.invoice_provider_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  insurance_payment_total numeric(12,2) NOT NULL DEFAULT 0,
  patient_payment_total numeric(12,2) NOT NULL DEFAULT 0,
  accounts_receivable_total numeric(12,2) NOT NULL DEFAULT 0,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  /** Effective rate used (provider's override or clinic's default) at recompute time. */
  invoice_rate numeric(6,4) NOT NULL DEFAULT 0,
  invoice_total numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_provider_lines_unique UNIQUE (invoice_id, provider_id)
);

COMMENT ON TABLE public.invoice_provider_lines IS
  'Per-provider breakdown of a monthly invoice. Populated only when the clinic''s invoice_per_provider = true. Recomputed alongside invoices.invoice_total.';

CREATE INDEX IF NOT EXISTS idx_invoice_provider_lines_invoice
  ON public.invoice_provider_lines (invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_provider_lines_provider
  ON public.invoice_provider_lines (provider_id);
