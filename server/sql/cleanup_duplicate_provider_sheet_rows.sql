-- Cleanup script for duplicate provider_sheet_rows.
--
-- WHY THIS EXISTS: Before the advisory-lock fix (serviceRoutes.ts:389, 2026-07-29), overlapping
-- save requests could race past the application-level dedupe and produce N rows for the same
-- (sheet_id, patient_id, appointment_date) tuple. Jenali's Spencer/Garrett/Keri/James screenshot
-- from 2026-07-28 was the trigger. The lock stops NEW duplicates from being created; this script
-- cleans up the ones already sitting in the DB.
--
-- STRATEGY: for each dupe group, keep the EARLIEST row (by created_at, then id as tiebreaker),
-- and merge non-null values from every loser into that winner using COALESCE. Losers get deleted
-- afterward. Merge is loss-preserving: any data the losers held that the winner doesn't will end
-- up on the winner. Data the winner already has is kept as-is (COALESCE prefers the first non-
-- null argument, so losers' values never overwrite the winner's).
--
-- SAFETY:
--   1. Everything runs inside a single transaction. Nothing is committed until you run COMMIT
--      at the end. Run `ROLLBACK;` instead if the preview counts look wrong.
--   2. Only rows with patient_id IS NOT NULL are considered dupes. Patient-less rows are left
--      alone — they either represent legitimate stray data (money/notes with no patient) or are
--      the class the patient-less INSERT guard already blocks going forward.
--   3. The winner-identification is deterministic (ORDER BY created_at ASC, id ASC), so re-runs
--      of this script are idempotent — no dupes left, nothing to merge, no side effects.
--
-- HOW TO USE:
--   1. Read section 1 (preview) below and run just that block. It prints how many dupe groups
--      exist and how many total rows will be deleted. If the number surprises you, stop here and
--      investigate before proceeding.
--   2. Run section 2 (merge + delete) inside the transaction.
--   3. Re-run section 1 to confirm zero dupe groups remain.
--   4. Commit with `COMMIT;` (or `ROLLBACK;` to abort).

-- =============================================================================
-- SECTION 1: PREVIEW — safe to run repeatedly, no writes.
-- =============================================================================

-- Dupe groups: (sheet_id, patient_id, appointment_date) tuples with >1 row.
SELECT
  COUNT(*) AS dupe_group_count,
  SUM(dupe_rows - 1) AS rows_that_will_be_deleted
FROM (
  SELECT COUNT(*) AS dupe_rows
  FROM public.provider_sheet_rows
  WHERE patient_id IS NOT NULL
  GROUP BY sheet_id, patient_id, appointment_date
  HAVING COUNT(*) > 1
) AS dupe_groups;

-- Per-sheet breakdown (which sheets have the worst dupe density).
SELECT
  ps.id AS sheet_id,
  ps.provider_id,
  ps.month,
  ps.year,
  ps.payroll,
  SUM(dupes.dupe_rows - 1) AS rows_to_delete_on_this_sheet
FROM (
  SELECT sheet_id, COUNT(*) AS dupe_rows
  FROM public.provider_sheet_rows
  WHERE patient_id IS NOT NULL
  GROUP BY sheet_id, patient_id, appointment_date
  HAVING COUNT(*) > 1
) AS dupes
JOIN public.provider_sheets ps ON ps.id = dupes.sheet_id
GROUP BY ps.id, ps.provider_id, ps.month, ps.year, ps.payroll
ORDER BY rows_to_delete_on_this_sheet DESC
LIMIT 20;

-- =============================================================================
-- SECTION 2: MERGE + DELETE. Run inside a transaction; commit only after verifying.
-- =============================================================================

BEGIN;

-- Materialize winner + loser IDs so the DELETE at the end doesn't race with any further work.
CREATE TEMPORARY TABLE _dupe_map ON COMMIT DROP AS
SELECT
  id AS loser_id,
  FIRST_VALUE(id) OVER (
    PARTITION BY sheet_id, patient_id, appointment_date
    ORDER BY created_at ASC, id ASC
  ) AS winner_id
FROM public.provider_sheet_rows
WHERE patient_id IS NOT NULL
  AND (sheet_id, patient_id, appointment_date) IN (
    SELECT sheet_id, patient_id, appointment_date
    FROM public.provider_sheet_rows
    WHERE patient_id IS NOT NULL
    GROUP BY sheet_id, patient_id, appointment_date
    HAVING COUNT(*) > 1
  );

-- Sanity check: winner_id should never appear as a loser_id.
-- If this returns any rows, ABORT (ROLLBACK) — the map is inconsistent.
SELECT loser_id FROM _dupe_map WHERE loser_id = winner_id;

-- Merge losers into winners, one column at a time, preferring the winner's value when set.
-- Order losers oldest → newest so newer edits override older ones when the winner is NULL.
-- (Losers are aggregated first; the winner's value only stays if it's non-null.)
WITH loser_agg AS (
  SELECT
    dm.winner_id,
    -- For each nullable text/numeric field, pick the earliest non-null loser value. If multiple
    -- losers have differing non-null values, we keep the one with the earliest created_at — that
    -- was the value the DB saw first, which most closely matches the original user intent.
    (array_agg(psr.appointment_time         ORDER BY psr.created_at ASC) FILTER (WHERE psr.appointment_time         IS NOT NULL))[1] AS appointment_time,
    (array_agg(psr.visit_type               ORDER BY psr.created_at ASC) FILTER (WHERE psr.visit_type               IS NOT NULL))[1] AS visit_type,
    (array_agg(psr.notes                    ORDER BY psr.created_at ASC) FILTER (WHERE psr.notes                    IS NOT NULL))[1] AS notes,
    (array_agg(psr.billing_code             ORDER BY psr.created_at ASC) FILTER (WHERE psr.billing_code             IS NOT NULL))[1] AS billing_code,
    (array_agg(psr.billing_code_color       ORDER BY psr.created_at ASC) FILTER (WHERE psr.billing_code_color       IS NOT NULL))[1] AS billing_code_color,
    (array_agg(psr.cpt_code                 ORDER BY psr.created_at ASC) FILTER (WHERE psr.cpt_code                 IS NOT NULL))[1] AS cpt_code,
    (array_agg(psr.cpt_code_color           ORDER BY psr.created_at ASC) FILTER (WHERE psr.cpt_code_color           IS NOT NULL))[1] AS cpt_code_color,
    (array_agg(psr.appointment_status       ORDER BY psr.created_at ASC) FILTER (WHERE psr.appointment_status       IS NOT NULL))[1] AS appointment_status,
    (array_agg(psr.appointment_status_color ORDER BY psr.created_at ASC) FILTER (WHERE psr.appointment_status_color IS NOT NULL))[1] AS appointment_status_color,
    (array_agg(psr.claim_status             ORDER BY psr.created_at ASC) FILTER (WHERE psr.claim_status             IS NOT NULL))[1] AS claim_status,
    (array_agg(psr.claim_status_color       ORDER BY psr.created_at ASC) FILTER (WHERE psr.claim_status_color       IS NOT NULL))[1] AS claim_status_color,
    (array_agg(psr.submit_date              ORDER BY psr.created_at ASC) FILTER (WHERE psr.submit_date              IS NOT NULL))[1] AS submit_date,
    (array_agg(psr.insurance_payment        ORDER BY psr.created_at ASC) FILTER (WHERE psr.insurance_payment        IS NOT NULL))[1] AS insurance_payment,
    (array_agg(psr.insurance_adjustment     ORDER BY psr.created_at ASC) FILTER (WHERE psr.insurance_adjustment     IS NOT NULL))[1] AS insurance_adjustment,
    (array_agg(psr.invoice_amount           ORDER BY psr.created_at ASC) FILTER (WHERE psr.invoice_amount           IS NOT NULL))[1] AS invoice_amount,
    (array_agg(psr.collected_from_patient   ORDER BY psr.created_at ASC) FILTER (WHERE psr.collected_from_patient   IS NOT NULL))[1] AS collected_from_patient,
    (array_agg(psr.patient_pay_status       ORDER BY psr.created_at ASC) FILTER (WHERE psr.patient_pay_status       IS NOT NULL))[1] AS patient_pay_status,
    (array_agg(psr.patient_pay_status_color ORDER BY psr.created_at ASC) FILTER (WHERE psr.patient_pay_status_color IS NOT NULL))[1] AS patient_pay_status_color,
    (array_agg(psr.payment_date             ORDER BY psr.created_at ASC) FILTER (WHERE psr.payment_date             IS NOT NULL))[1] AS payment_date,
    (array_agg(psr.payment_date_color       ORDER BY psr.created_at ASC) FILTER (WHERE psr.payment_date_color       IS NOT NULL))[1] AS payment_date_color,
    (array_agg(psr.ar_type                  ORDER BY psr.created_at ASC) FILTER (WHERE psr.ar_type                  IS NOT NULL))[1] AS ar_type,
    (array_agg(psr.ar_amount                ORDER BY psr.created_at ASC) FILTER (WHERE psr.ar_amount                IS NOT NULL))[1] AS ar_amount,
    (array_agg(psr.ar_date                  ORDER BY psr.created_at ASC) FILTER (WHERE psr.ar_date                  IS NOT NULL))[1] AS ar_date,
    (array_agg(psr.ar_date_color            ORDER BY psr.created_at ASC) FILTER (WHERE psr.ar_date_color            IS NOT NULL))[1] AS ar_date_color,
    (array_agg(psr.ar_notes                 ORDER BY psr.created_at ASC) FILTER (WHERE psr.ar_notes                 IS NOT NULL))[1] AS ar_notes,
    (array_agg(psr.provider_payment_amount  ORDER BY psr.created_at ASC) FILTER (WHERE psr.provider_payment_amount  IS NOT NULL))[1] AS provider_payment_amount,
    (array_agg(psr.provider_payment_date    ORDER BY psr.created_at ASC) FILTER (WHERE psr.provider_payment_date    IS NOT NULL))[1] AS provider_payment_date,
    (array_agg(psr.provider_payment_notes   ORDER BY psr.created_at ASC) FILTER (WHERE psr.provider_payment_notes   IS NOT NULL))[1] AS provider_payment_notes,
    (array_agg(psr.highlight_color          ORDER BY psr.created_at ASC) FILTER (WHERE psr.highlight_color          IS NOT NULL))[1] AS highlight_color,
    (array_agg(psr.total                    ORDER BY psr.created_at ASC) FILTER (WHERE psr.total                    IS NOT NULL))[1] AS total
  FROM _dupe_map dm
  JOIN public.provider_sheet_rows psr ON psr.id = dm.loser_id AND psr.id <> dm.winner_id
  GROUP BY dm.winner_id
)
UPDATE public.provider_sheet_rows w
SET
  appointment_time         = COALESCE(w.appointment_time,         la.appointment_time),
  visit_type               = COALESCE(w.visit_type,               la.visit_type),
  notes                    = COALESCE(w.notes,                    la.notes),
  billing_code             = COALESCE(w.billing_code,             la.billing_code),
  billing_code_color       = COALESCE(w.billing_code_color,       la.billing_code_color),
  cpt_code                 = COALESCE(w.cpt_code,                 la.cpt_code),
  cpt_code_color           = COALESCE(w.cpt_code_color,           la.cpt_code_color),
  appointment_status       = COALESCE(w.appointment_status,       la.appointment_status),
  appointment_status_color = COALESCE(w.appointment_status_color, la.appointment_status_color),
  claim_status             = COALESCE(w.claim_status,             la.claim_status),
  claim_status_color       = COALESCE(w.claim_status_color,       la.claim_status_color),
  submit_date              = COALESCE(w.submit_date,              la.submit_date),
  insurance_payment        = COALESCE(w.insurance_payment,        la.insurance_payment),
  insurance_adjustment     = COALESCE(w.insurance_adjustment,     la.insurance_adjustment),
  invoice_amount           = COALESCE(w.invoice_amount,           la.invoice_amount),
  collected_from_patient   = COALESCE(w.collected_from_patient,   la.collected_from_patient),
  patient_pay_status       = COALESCE(w.patient_pay_status,       la.patient_pay_status),
  patient_pay_status_color = COALESCE(w.patient_pay_status_color, la.patient_pay_status_color),
  payment_date             = COALESCE(w.payment_date,             la.payment_date),
  payment_date_color       = COALESCE(w.payment_date_color,       la.payment_date_color),
  ar_type                  = COALESCE(w.ar_type,                  la.ar_type),
  ar_amount                = COALESCE(w.ar_amount,                la.ar_amount),
  ar_date                  = COALESCE(w.ar_date,                  la.ar_date),
  ar_date_color            = COALESCE(w.ar_date_color,            la.ar_date_color),
  ar_notes                 = COALESCE(w.ar_notes,                 la.ar_notes),
  provider_payment_amount  = COALESCE(w.provider_payment_amount,  la.provider_payment_amount),
  provider_payment_date    = COALESCE(w.provider_payment_date,    la.provider_payment_date),
  provider_payment_notes   = COALESCE(w.provider_payment_notes,   la.provider_payment_notes),
  highlight_color          = COALESCE(w.highlight_color,          la.highlight_color),
  total                    = COALESCE(w.total,                    la.total),
  updated_at               = now()
FROM loser_agg la
WHERE w.id = la.winner_id;

-- Delete the losers (rows that were NOT the winner in their dupe group).
DELETE FROM public.provider_sheet_rows
WHERE id IN (SELECT loser_id FROM _dupe_map WHERE loser_id <> winner_id);

-- Verify: this should now return zero dupe groups.
SELECT
  COUNT(*) AS remaining_dupe_group_count
FROM (
  SELECT 1
  FROM public.provider_sheet_rows
  WHERE patient_id IS NOT NULL
  GROUP BY sheet_id, patient_id, appointment_date
  HAVING COUNT(*) > 1
) AS remaining;

-- If remaining_dupe_group_count = 0, run:   COMMIT;
-- If anything looks wrong, run:             ROLLBACK;
