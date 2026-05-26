-- Per-clinic paystub branding: optional logo (data URL or external URL) and accent color hex.
-- The paystub PDF now uses ONLY the clinic's own logo — the American Medical Billing logo no
-- longer appears on provider paystubs. NULL `paystub_logo_url` means no logo at all on that
-- clinic's paystubs. NULL `paystub_accent_color` falls back to the existing light-blue band.
-- Run once against existing databases. Fresh installs should use updated database-deploy.sql.

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS paystub_logo_url text;

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS paystub_accent_color text;

COMMENT ON COLUMN public.clinics.paystub_logo_url IS
  'Optional logo for this clinic''s paystub PDF. Either an https URL or a data: URL. NULL = no logo (the American Medical Billing logo is never used on paystubs).';
COMMENT ON COLUMN public.clinics.paystub_accent_color IS
  'Optional accent color (#rrggbb) for the provider-name band and Direct Deposit band on this clinic''s paystub PDF. NULL falls back to the default light blue (#add8e6).';
