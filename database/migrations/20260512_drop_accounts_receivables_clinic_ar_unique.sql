-- Allow duplicate ar_id per clinic (business key no longer enforced as unique).
-- New installs: omit this constraint in database-deploy.sql. Existing DBs: run once.

ALTER TABLE IF EXISTS public.accounts_receivables
  DROP CONSTRAINT IF EXISTS accounts_receivables_clinic_id_ar_id_key;
