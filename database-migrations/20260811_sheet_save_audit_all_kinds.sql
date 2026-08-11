-- Generalize provider_sheet_save_audit so it can log every clinic sheet save
-- (patients, AR, billing todo, provider pay), not only provider billing sheets.
--
-- Run once: psql ... -f 20260811_sheet_save_audit_all_kinds.sql

ALTER TABLE public.provider_sheet_save_audit
  ADD COLUMN IF NOT EXISTS sheet_kind text NOT NULL DEFAULT 'provider_sheet';

-- Patients / billing-todo / etc. have no provider. Existing provider_sheet rows keep their ids.
ALTER TABLE public.provider_sheet_save_audit
  ALTER COLUMN provider_id DROP NOT NULL;

COMMENT ON COLUMN public.provider_sheet_save_audit.sheet_kind IS
  'Which sheet produced this save: provider_sheet | patients | accounts_receivable | billing_todo | provider_pay';

CREATE INDEX IF NOT EXISTS idx_provider_sheet_save_audit_kind_clinic_time
  ON public.provider_sheet_save_audit (sheet_kind, clinic_id, created_at DESC);
