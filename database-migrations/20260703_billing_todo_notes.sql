-- Clinic-wide notepad for the Billing To-Do "Notes" tab. One row per clinic (upsert on clinic_id).
-- Stores HTML content so bold/italic formatting survives round-trips. This is distinct from
-- `todo_notes` (which is per-item chatter) and from `todo_lists.notes` (which is a per-row Issue
-- category). Run once against existing databases; fresh installs pick this up via
-- database-deploy.sql updates.

CREATE TABLE IF NOT EXISTS public.billing_todo_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  content text NOT NULL DEFAULT '',
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_todo_notes_pkey PRIMARY KEY (id),
  CONSTRAINT billing_todo_notes_clinic_id_key UNIQUE (clinic_id),
  CONSTRAINT billing_todo_notes_clinic_id_fkey
    FOREIGN KEY (clinic_id) REFERENCES public.clinics (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_billing_todo_notes_clinic
  ON public.billing_todo_notes USING btree (clinic_id);

DROP TRIGGER IF EXISTS update_billing_todo_notes_updated_at ON public.billing_todo_notes;
CREATE TRIGGER update_billing_todo_notes_updated_at BEFORE UPDATE ON public.billing_todo_notes
FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

COMMENT ON TABLE public.billing_todo_notes IS
  'Clinic-wide notepad shown on the Billing To-Do "Notes" tab. Stores freeform HTML (bold/italic).';
