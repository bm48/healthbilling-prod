-- "Auto-backups": per-tab-leave snapshots of a provider sheet's rows.
--
-- Different lifecycle from `provider_sheet_backups` (the cron-based snapshots that go to storage
-- as CSV) — these fire every time the user navigates away from a Billing sheet they were editing,
-- and they hold raw row JSON so restore is a single SELECT with no signed-URL round-trip.
--
-- Retention: lazy-pruned on insert. The server endpoint deletes rows for the same `sheet_id` whose
-- `created_at` is older than 7 days. The cron backups stay forever (they're the "monthly archive");
-- these are the "in-session, you-just-typed-this" safety net.

CREATE TABLE IF NOT EXISTS public.provider_sheet_tab_leave_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES public.provider_sheets(id) ON DELETE CASCADE,
  -- The user who triggered the backup. Nullable so a backup made by a deleted user can still be
  -- restored from (we never want to drop a row of data because of a referential cascade).
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- Full row payload. Same shape the save endpoint accepts so restore can replay them as-is.
  rows jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.provider_sheet_tab_leave_backups IS
  'Auto-backups: snapshots written every time the user leaves a Billing sheet they were editing. 7-day retention, lazy-pruned on insert. Distinct from provider_sheet_backups (cron, CSV in storage).';

CREATE INDEX IF NOT EXISTS idx_provider_sheet_tab_leave_backups_sheet_created
  ON public.provider_sheet_tab_leave_backups (sheet_id, created_at DESC);
