-- Rename Appointment / Claim statuses to match the simplified labels used in the UI.
--
-- WHAT THIS DOES:
--   1. provider_sheet_rows.appointment_status: legacy NS/LC variants -> 'No Show' | 'Rescheduled' | 'Cancellation'
--      ('Charge NS/LC' / 'NS/LC - Charge' -> 'No Show'  — these still count toward the No Shows tally)
--      ('RS No Charge' / 'NS/LC/RS - No Charge' -> 'Rescheduled'  — no longer counts as a no-show)
--      ('NS No Charge' / 'NS/LC - No Charge' -> 'Cancellation'   — no longer counts as a no-show)
--   2. provider_sheet_rows.claim_status: 'Rejection' -> 'Rejected'.
--      Existing 'PP' rows are left untouched so the legacy Private Pay tally on the metrics bar
--      keeps displaying historic numbers; the dropdown no longer offers 'PP' so no new rows can
--      be created with it. Delete this fallback (and the privatePay metric in the UI) once the
--      historic 'PP' rows have been recategorized.
--   3. status_colors: renames the corresponding rows so colored bubbles render on the new labels.
--
-- SAFE TO RE-RUN: all UPDATEs are idempotent (rows already at the new value are left alone).

BEGIN;

-- Appointment status renames on existing sheet rows
UPDATE provider_sheet_rows
   SET appointment_status = 'No Show'
 WHERE appointment_status IN ('Charge NS/LC', 'NS/LC - Charge');

UPDATE provider_sheet_rows
   SET appointment_status = 'Rescheduled'
 WHERE appointment_status IN ('RS No Charge', 'NS/LC/RS - No Charge');

UPDATE provider_sheet_rows
   SET appointment_status = 'Cancellation'
 WHERE appointment_status IN ('NS No Charge', 'NS/LC - No Charge');

-- Claim status rename
UPDATE provider_sheet_rows
   SET claim_status = 'Rejected'
 WHERE claim_status = 'Rejection';

-- status_colors: rename the matching color rows. If both old and new rows already exist (e.g. a
-- clinic was reseeded), the old one is deleted instead of updated to avoid unique-key conflicts.
DO $$
DECLARE
  rec RECORD;
  rename_pairs CONSTANT TEXT[][] := ARRAY[
    -- old_status, new_status, type
    ARRAY['Charge NS/LC',          'No Show',      'appointment'],
    ARRAY['NS/LC - Charge',        'No Show',      'appointment'],
    ARRAY['RS No Charge',          'Rescheduled',  'appointment'],
    ARRAY['NS/LC/RS - No Charge',  'Rescheduled',  'appointment'],
    ARRAY['NS No Charge',          'Cancellation', 'appointment'],
    ARRAY['NS/LC - No Charge',     'Cancellation', 'appointment'],
    ARRAY['Rejection',             'Rejected',     'claim']
  ];
  pair TEXT[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY rename_pairs LOOP
    IF EXISTS (SELECT 1 FROM status_colors WHERE status = pair[2] AND type = pair[3]) THEN
      DELETE FROM status_colors WHERE status = pair[1] AND type = pair[3];
    ELSE
      UPDATE status_colors
         SET status = pair[2], updated_at = NOW()
       WHERE status = pair[1] AND type = pair[3];
    END IF;
  END LOOP;
END $$;

COMMIT;
