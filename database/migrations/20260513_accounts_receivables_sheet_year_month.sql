-- Sheet period for Accounts Receivable (month selector), independent of service/record dates and created_at.

ALTER TABLE public.accounts_receivables
  ADD COLUMN IF NOT EXISTS ar_year smallint,
  ADD COLUMN IF NOT EXISTS ar_month smallint;

UPDATE public.accounts_receivables
SET
  ar_year = EXTRACT(YEAR FROM COALESCE(date_of_service, date_recorded, (created_at AT TIME ZONE 'UTC')::date))::smallint,
  ar_month = EXTRACT(MONTH FROM COALESCE(date_of_service, date_recorded, (created_at AT TIME ZONE 'UTC')::date))::smallint
WHERE ar_year IS NULL OR ar_month IS NULL;

ALTER TABLE public.accounts_receivables
  ALTER COLUMN ar_year SET NOT NULL,
  ALTER COLUMN ar_month SET NOT NULL;
