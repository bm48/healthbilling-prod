-- Per-provider scoping for Accounts Receivable.
--
-- BEFORE THIS MIGRATION: `accounts_receivables` only had `clinic_id`, so every row was visible in
-- every provider's A-R view of that clinic. The UI showed the provider in the URL but the data was
-- clinic-wide, which let entries from one provider appear in another provider's A-R sheet.
--
-- AFTER THIS MIGRATION: a nullable `provider_id` lets new rows be scoped to a single provider.
--
-- WHY NULLABLE / NO BACKFILL: we don't have a reliable signal to assign existing rows to a
-- specific provider (there's no historical "added on provider Y's URL" record), and the product
-- direction here is to NOT change existing data. So legacy rows keep `provider_id = NULL` and the
-- client treats NULL as "visible in every provider's view" for backward compatibility. New rows
-- inserted from a provider-scoped URL will carry a real `provider_id`. The user can manually
-- reassign legacy rows over time if desired.
--
-- SAFE TO RE-RUN: every statement uses IF NOT EXISTS guards.

ALTER TABLE public.accounts_receivables
  ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES public.providers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_receivables_clinic_provider_month
  ON public.accounts_receivables (clinic_id, provider_id, ar_year, ar_month);
