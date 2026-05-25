-- Rollback of 20260522_provider_pay_paystub_fee_note.sql.
-- The single per-paystub fee/note approach was replaced by rendering the existing free-form
-- provider_pay_rows (row_index >= 7 with a non-empty Description) directly on the paystub PDF.
-- That covers the multi-line "fees taken out / additional pay" case Jenali described, so these
-- two columns are no longer used by the app. Safe to drop — no other tables reference them.

ALTER TABLE public.provider_pay
  DROP COLUMN IF EXISTS paystub_additional_fee,
  DROP COLUMN IF EXISTS paystub_note;
