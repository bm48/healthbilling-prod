-- Cleanup script for stray patient-less provider_sheet_rows.
--
-- WHY THIS EXISTS: Before the July 21 patient-less INSERT guard (serviceRoutes.ts:498-521)
-- and the July 27 addition of patient_id to PROTECTED_FROM_NULL, the save endpoint would
-- accept INSERTs that had no patient_id AND no meaningful money/notes data, and UPDATEs
-- could null a patient_id off an existing row while `appointment_date` (PROTECTED) survived.
-- Those combinations left orphan rows in the DB — often "date-only strays" — that Jenali
-- keeps noticing when she scrolls through Spencer's sheet. The guards stop new strays; this
-- script sweeps the ones that were already there when the guards shipped.
--
-- STRATEGY: mirror the current INSERT guard exactly. A row is a stray iff both:
--   - patient_id is NULL or empty string, AND
--   - every "meaningful" non-patient field is NULL or empty (money + notes fields).
-- Rows with a patient_id (even without other data) are kept — they might be in-progress
-- assignments. Rows with money or notes are kept — those might be manual adjustments or
-- AR-only entries we don't otherwise model, and money/notes can't be re-derived if lost.
--
-- SAFETY:
--   1. Everything runs inside a single transaction. Nothing is committed until you run
--      COMMIT at the end. Run `ROLLBACK;` if the preview counts look wrong.
--   2. Idempotent — re-running finds zero strays, does nothing.
--   3. Doesn't touch dup-collapsed rows from cleanup_duplicate_provider_sheet_rows.sql;
--      that script keeps winners with real patient_ids, which this script leaves alone.
--
-- HOW TO USE:
--   1. Run section 1 (preview). If the count is surprisingly large, stop and investigate
--      (a fetch that's including scheduling-only rows we intended to keep, e.g.) before
--      proceeding.
--   2. Run section 2 (delete) inside the transaction.
--   3. Re-run section 1 to confirm zero strays remain.
--   4. Commit with `COMMIT;` (or `ROLLBACK;` to abort).

-- =============================================================================
-- SECTION 1: PREVIEW — safe to run repeatedly, no writes.
-- =============================================================================

-- Total strays across the DB.
SELECT COUNT(*) AS total_stray_rows
FROM public.provider_sheet_rows
WHERE (patient_id IS NULL OR patient_id = '')
  AND (insurance_payment       IS NULL OR insurance_payment       = '')
  AND (insurance_adjustment    IS NULL OR insurance_adjustment    = '')
  AND (collected_from_patient  IS NULL OR collected_from_patient  = '')
  AND invoice_amount           IS NULL
  AND ar_amount                IS NULL
  AND provider_payment_amount  IS NULL
  AND (total                   IS NULL OR total                   = '')
  AND (notes                   IS NULL OR notes                   = '')
  AND (ar_notes                IS NULL OR ar_notes                = '')
  AND (provider_payment_notes  IS NULL OR provider_payment_notes  = '');

-- Per-sheet breakdown (which sheets have the worst stray density).
SELECT
  ps.id AS sheet_id,
  ps.provider_id,
  ps.month,
  ps.year,
  ps.payroll,
  COUNT(psr.id) AS stray_rows_on_sheet,
  MIN(psr.created_at) AS oldest_stray,
  MAX(psr.created_at) AS newest_stray
FROM public.provider_sheet_rows psr
JOIN public.provider_sheets ps ON ps.id = psr.sheet_id
WHERE (psr.patient_id IS NULL OR psr.patient_id = '')
  AND (psr.insurance_payment       IS NULL OR psr.insurance_payment       = '')
  AND (psr.insurance_adjustment    IS NULL OR psr.insurance_adjustment    = '')
  AND (psr.collected_from_patient  IS NULL OR psr.collected_from_patient  = '')
  AND psr.invoice_amount           IS NULL
  AND psr.ar_amount                IS NULL
  AND psr.provider_payment_amount  IS NULL
  AND (psr.total                   IS NULL OR psr.total                   = '')
  AND (psr.notes                   IS NULL OR psr.notes                   = '')
  AND (psr.ar_notes                IS NULL OR psr.ar_notes                = '')
  AND (psr.provider_payment_notes  IS NULL OR psr.provider_payment_notes  = '')
GROUP BY ps.id, ps.provider_id, ps.month, ps.year, ps.payroll
ORDER BY stray_rows_on_sheet DESC
LIMIT 30;

-- Sanity check the "kept" side: rows that LOOK empty at a glance (no patient, no money,
-- no notes) but survive because they carry appointment_date + cpt_code + status. This
-- section returns 0 with the current guard logic — it's here to make it obvious if we
-- later loosen the definition of "stray" and start considering these too.
SELECT COUNT(*) AS scheduling_only_no_patient
FROM public.provider_sheet_rows
WHERE (patient_id IS NULL OR patient_id = '')
  AND (appointment_date IS NOT NULL AND appointment_date <> '')
  AND (cpt_code IS NOT NULL AND cpt_code <> '')
  AND (appointment_status IS NOT NULL AND appointment_status <> '')
  AND (insurance_payment       IS NULL OR insurance_payment       = '')
  AND (insurance_adjustment    IS NULL OR insurance_adjustment    = '')
  AND (collected_from_patient  IS NULL OR collected_from_patient  = '')
  AND invoice_amount           IS NULL
  AND ar_amount                IS NULL
  AND provider_payment_amount  IS NULL
  AND (total                   IS NULL OR total                   = '')
  AND (notes                   IS NULL OR notes                   = '')
  AND (ar_notes                IS NULL OR ar_notes                = '')
  AND (provider_payment_notes  IS NULL OR provider_payment_notes  = '');

-- =============================================================================
-- SECTION 2: DELETE. Run inside a transaction; commit only after verifying.
-- =============================================================================

BEGIN;

-- Materialize the list of stray IDs so the DELETE can't drift if concurrent writes land
-- while we're deciding to commit. Empty rows on a fresh sheet won't have any of these
-- fields set, but they're client-side (`empty-*` id) and haven't reached the DB yet, so
-- they can't be in this list.
CREATE TEMPORARY TABLE _stray_row_ids ON COMMIT DROP AS
SELECT id
FROM public.provider_sheet_rows
WHERE (patient_id IS NULL OR patient_id = '')
  AND (insurance_payment       IS NULL OR insurance_payment       = '')
  AND (insurance_adjustment    IS NULL OR insurance_adjustment    = '')
  AND (collected_from_patient  IS NULL OR collected_from_patient  = '')
  AND invoice_amount           IS NULL
  AND ar_amount                IS NULL
  AND provider_payment_amount  IS NULL
  AND (total                   IS NULL OR total                   = '')
  AND (notes                   IS NULL OR notes                   = '')
  AND (ar_notes                IS NULL OR ar_notes                = '')
  AND (provider_payment_notes  IS NULL OR provider_payment_notes  = '');

-- Show what we're about to delete (per-sheet counts) so it's easy to eyeball before commit.
SELECT ps.provider_id, ps.month, ps.year, ps.payroll, COUNT(*) AS will_delete
FROM _stray_row_ids sid
JOIN public.provider_sheet_rows psr ON psr.id = sid.id
JOIN public.provider_sheets ps ON ps.id = psr.sheet_id
GROUP BY ps.provider_id, ps.month, ps.year, ps.payroll
ORDER BY will_delete DESC
LIMIT 20;

-- The delete itself.
DELETE FROM public.provider_sheet_rows
WHERE id IN (SELECT id FROM _stray_row_ids);

-- Verify: this should now return zero.
SELECT COUNT(*) AS remaining_stray_rows
FROM public.provider_sheet_rows
WHERE (patient_id IS NULL OR patient_id = '')
  AND (insurance_payment       IS NULL OR insurance_payment       = '')
  AND (insurance_adjustment    IS NULL OR insurance_adjustment    = '')
  AND (collected_from_patient  IS NULL OR collected_from_patient  = '')
  AND invoice_amount           IS NULL
  AND ar_amount                IS NULL
  AND provider_payment_amount  IS NULL
  AND (total                   IS NULL OR total                   = '')
  AND (notes                   IS NULL OR notes                   = '')
  AND (ar_notes                IS NULL OR ar_notes                = '')
  AND (provider_payment_notes  IS NULL OR provider_payment_notes  = '');

-- If remaining_stray_rows = 0, run:   COMMIT;
-- If anything looks wrong, run:       ROLLBACK;
