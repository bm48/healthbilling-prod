-- Past-month whole-sheet lock for Accounts Receivable and Provider Pay.
-- Run against existing databases; new installs should include these columns in CREATE TABLE.

ALTER TABLE IF EXISTS public.is_lock_accounts_receivable
  ADD COLUMN IF NOT EXISTS whole_sheet_locked boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS public.provider_pay
  ADD COLUMN IF NOT EXISTS whole_sheet_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.is_lock_accounts_receivable.whole_sheet_locked IS 'When true and the viewed month/period is in the past, the AR grid is read-only for non-admin bypass (admins use lock control to unlock).';
COMMENT ON COLUMN public.provider_pay.whole_sheet_locked IS 'When true and the viewed month/period is in the past, the provider pay sheet is read-only until an admin unlocks.';
