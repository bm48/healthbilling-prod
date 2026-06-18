-- User-editable identifier shown in the Billing To-Do "ID" column. Previously the column rendered
-- a truncated UUID preview with no persistence path, so anything the user typed snapped back to
-- "the random string" (the UUID truncation) on the next render. This column gives that input a
-- real home. Default NULL keeps existing rows visually blank in the ID column until the user fills
-- one in. Run once against existing databases; fresh installs use the updated database-deploy.sql.

ALTER TABLE public.todo_lists
  ADD COLUMN IF NOT EXISTS display_id text;

COMMENT ON COLUMN public.todo_lists.display_id IS
  'User-entered identifier shown in the Billing To-Do "ID" column (free-form text). Distinct from the row UUID `id`; used as a human reference (claim number, ticket ref, etc.).';
