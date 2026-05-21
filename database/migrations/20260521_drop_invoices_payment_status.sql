-- Remove payment_status from clinic invoices (no longer used in UI or PDF).

ALTER TABLE IF EXISTS public.invoices
  DROP COLUMN IF EXISTS payment_status;

COMMENT ON TABLE public.invoices IS
  'Pre-computed invoice summary per clinic per month. Refreshed on provider sheet save. payment_date and due_date are manually editable and preserved on recompute.';
