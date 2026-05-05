-- Scope provider sheet column locks per provider (clinic + month + provider), not clinic-wide per month.
-- Run once against existing databases. Fresh installs should use updated database-deploy.sql.

ALTER TABLE public.is_lock_providers
  ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES public.providers(id) ON DELETE CASCADE;

-- Must drop the old uniqueness on (clinic_id, month_key) *before* backfill: we insert one row per
-- provider for the same clinic + month, then replace uniqueness with (clinic_id, month_key, provider_id).
DROP INDEX IF EXISTS public.is_lock_providers_clinic_id_month_key_key;

-- Copy each legacy (clinic-wide) row to every provider assigned to that clinic.
INSERT INTO public.is_lock_providers (
  clinic_id,
  provider_id,
  patient_id,
  first_name,
  last_initial,
  insurance,
  copay,
  coinsurance,
  date_of_service,
  cpt_code,
  appointment_note_status,
  claim_status,
  most_recent_submit_date,
  ins_pay,
  ins_pay_date,
  pt_res,
  collected_from_pt,
  pt_pay_status,
  pt_payment_ar_ref_date,
  total,
  notes,
  patient_id_comment,
  first_name_comment,
  last_initial_comment,
  insurance_comment,
  copay_comment,
  coinsurance_comment,
  date_of_service_comment,
  cpt_code_comment,
  appointment_note_status_comment,
  claim_status_comment,
  most_recent_submit_date_comment,
  ins_pay_comment,
  ins_pay_date_comment,
  pt_res_comment,
  collected_from_pt_comment,
  pt_pay_status_comment,
  pt_payment_ar_ref_date_comment,
  total_comment,
  notes_comment,
  month_key
)
SELECT
  ilp.clinic_id,
  p.id,
  ilp.patient_id,
  ilp.first_name,
  ilp.last_initial,
  ilp.insurance,
  ilp.copay,
  ilp.coinsurance,
  ilp.date_of_service,
  ilp.cpt_code,
  ilp.appointment_note_status,
  ilp.claim_status,
  ilp.most_recent_submit_date,
  ilp.ins_pay,
  ilp.ins_pay_date,
  ilp.pt_res,
  ilp.collected_from_pt,
  ilp.pt_pay_status,
  ilp.pt_payment_ar_ref_date,
  ilp.total,
  ilp.notes,
  ilp.patient_id_comment,
  ilp.first_name_comment,
  ilp.last_initial_comment,
  ilp.insurance_comment,
  ilp.copay_comment,
  ilp.coinsurance_comment,
  ilp.date_of_service_comment,
  ilp.cpt_code_comment,
  ilp.appointment_note_status_comment,
  ilp.claim_status_comment,
  ilp.most_recent_submit_date_comment,
  ilp.ins_pay_comment,
  ilp.ins_pay_date_comment,
  ilp.pt_res_comment,
  ilp.collected_from_pt_comment,
  ilp.pt_pay_status_comment,
  ilp.pt_payment_ar_ref_date_comment,
  ilp.total_comment,
  ilp.notes_comment,
  ilp.month_key
FROM public.is_lock_providers ilp
INNER JOIN public.providers p ON ilp.clinic_id = ANY (p.clinic_ids)
WHERE ilp.provider_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.is_lock_providers ex
    WHERE ex.clinic_id = ilp.clinic_id
      AND ex.month_key = ilp.month_key
      AND ex.provider_id = p.id
  );

DELETE FROM public.is_lock_providers WHERE provider_id IS NULL;

ALTER TABLE public.is_lock_providers
  ALTER COLUMN provider_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS is_lock_providers_clinic_month_provider_key
  ON public.is_lock_providers (clinic_id, month_key, provider_id);
