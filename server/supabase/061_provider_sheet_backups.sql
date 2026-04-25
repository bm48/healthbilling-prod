-- Provider sheet backups: versioned CSV backups per sheet (per provider per month).
-- Used by backup-provider-sheets Edge Function and cron. Storage path: provider-sheet-backups/{sheet_id}/v{version}.csv

CREATE TABLE IF NOT EXISTS provider_sheet_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES provider_sheets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  file_path TEXT NOT NULL,
  UNIQUE(sheet_id, version)
);

CREATE INDEX IF NOT EXISTS idx_provider_sheet_backups_sheet_id ON provider_sheet_backups(sheet_id);
CREATE INDEX IF NOT EXISTS idx_provider_sheet_backups_created_at ON provider_sheet_backups(created_at DESC);

ALTER TABLE provider_sheet_backups ENABLE ROW LEVEL SECURITY;

-- Super admins can list and read backup metadata for sheets they can access (via provider_sheets RLS)
CREATE POLICY "Super admins can view backup metadata for all sheets" ON provider_sheet_backups
  FOR SELECT USING (is_super_admin());

-- Only service role (Edge Function) inserts backup records; no INSERT policy for app users
-- So we use a policy that allows insert only when called from backend (no app user inserts)
-- Actually: Edge Function uses service_role which bypasses RLS. So we need SELECT for super_admin to list versions.
-- No INSERT/UPDATE/DELETE for app users is fine (only Edge Function writes).

COMMENT ON TABLE provider_sheet_backups IS 'Versioned CSV backups of provider_sheet_rows. File stored in Supabase Storage bucket provider-sheet-backups at path {sheet_id}/v{version}.csv';

-- Allow super_admin to read backup files from Storage (for version list and download).
-- Bucket "provider-sheet-backups" is created by the backup-provider-sheets Edge Function on first run.
CREATE POLICY "Super admin can read provider sheet backups" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'provider-sheet-backups'
    AND (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );
