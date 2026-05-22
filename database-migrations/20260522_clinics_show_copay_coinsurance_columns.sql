-- Per-clinic toggle to hide the Co-pay and Co-Ins columns from the billing sheet (Providers tab).
-- Default true preserves existing behavior; super admin can turn off per clinic in Clinic Management.
-- Run once against existing databases. Fresh installs should use updated database-deploy.sql.

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS show_copay_coinsurance_columns boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.clinics.show_copay_coinsurance_columns IS
  'When true, billing sheet (Providers tab) shows Co-pay and Co-Ins columns. When false, both are hidden clinic-wide. Toggled in Clinic Management.';
