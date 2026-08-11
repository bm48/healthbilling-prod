-- Provider sheet save audit table.
--
-- Purpose: capture one row per POST /api/save-provider-sheet-rows so when a duplicate / stray /
-- data-loss report comes in, we can look back and see what actually happened instead of guessing
-- from a screenshot. Rows are inserted best-effort AFTER commit (or in the catch on failure), so
-- a save that succeeds always leaves a trace, and a save that failed leaves one with success=false.
--
-- PHI: this table intentionally stores ONLY structural fields — UUIDs, counts, timing, action
-- summary. No patient names, no insurance strings, no notes text. patient_id (an internal
-- identifier) is fine to reference indirectly via action.collapsed_pairs but never as a name.
--
-- Retention: 30 days is enough for the debug loop we care about (client reports usually surface
-- within a day or two of the incident). Run the retention query at the bottom on a schedule.
--
-- Run once:  psql ... -f create_provider_sheet_save_audit_table.sql

CREATE TABLE IF NOT EXISTS public.provider_sheet_save_audit (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  sheet_kind            text          NOT NULL DEFAULT 'provider_sheet',
  correlation_id        text,
  user_id               uuid          NOT NULL,
  clinic_id             uuid          NOT NULL,
  provider_id           uuid,
  sheet_id              uuid,
  selected_month_key    text,
  source                text,
  row_count             integer,
  lock_wait_ms          integer,
  elapsed_ms            integer,
  success               boolean       NOT NULL DEFAULT true,
  error_message         text,
  actions               jsonb         NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_provider_sheet_save_audit_kind_clinic_time
  ON public.provider_sheet_save_audit (sheet_kind, clinic_id, created_at DESC);

-- Common lookup: "show me every save for this (clinic, provider, month) in the last N hours."
-- Ordered DESC because the viewer defaults to newest-first.
CREATE INDEX IF NOT EXISTS idx_provider_sheet_save_audit_scope_time
  ON public.provider_sheet_save_audit (clinic_id, provider_id, selected_month_key, created_at DESC);

-- Cross-request lookup by correlation_id: if the client reports a specific event, we jump
-- straight to the matching audit row(s) via correlation_id rather than hunting by timestamp.
CREATE INDEX IF NOT EXISTS idx_provider_sheet_save_audit_correlation
  ON public.provider_sheet_save_audit (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- Race detection: two save requests arriving within seconds against the SAME sheet is the
-- pattern that produces duplicates. This index makes "give me every save for this sheet_id in
-- the last minute" cheap so we can spot the concurrent pair after the fact.
CREATE INDEX IF NOT EXISTS idx_provider_sheet_save_audit_sheet_time
  ON public.provider_sheet_save_audit (sheet_id, created_at DESC)
  WHERE sheet_id IS NOT NULL;

-- Retention: run daily (cron / pg_cron / manual). 30-day window covers a comfortable
-- report-to-investigation lag; longer wastes disk on rows nobody will read.
-- DELETE FROM public.provider_sheet_save_audit WHERE created_at < now() - interval '30 days';
