-- Tab backups: versioned CSV backups for Accounts Receivable, Provider Pay, and Patient Info.
-- Storage bucket "tab-backups" with paths: ar/{clinic_id}/v{n}.csv, provider-pay/{clinic_id}/v{n}.csv, patients/{clinic_id}/v{n}.csv
-- Edge functions: backup-ar, backup-provider-pay, backup-patients (create bucket on first run).

-- Accounts Receivable backups (per clinic)
CREATE TABLE IF NOT EXISTS ar_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  file_path TEXT NOT NULL,
  UNIQUE(clinic_id, version)
);
CREATE INDEX IF NOT EXISTS idx_ar_backups_clinic_id ON ar_backups(clinic_id);
CREATE INDEX IF NOT EXISTS idx_ar_backups_created_at ON ar_backups(created_at DESC);
ALTER TABLE ar_backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins can view AR backup metadata" ON ar_backups FOR SELECT USING (is_super_admin());

-- Provider Pay backups (per clinic; file contains all providers' data for that clinic)
CREATE TABLE IF NOT EXISTS provider_pay_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  file_path TEXT NOT NULL,
  UNIQUE(clinic_id, version)
);
CREATE INDEX IF NOT EXISTS idx_provider_pay_backups_clinic_id ON provider_pay_backups(clinic_id);
CREATE INDEX IF NOT EXISTS idx_provider_pay_backups_created_at ON provider_pay_backups(created_at DESC);
ALTER TABLE provider_pay_backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins can view provider pay backup metadata" ON provider_pay_backups FOR SELECT USING (is_super_admin());

-- Patient backups (per clinic)
CREATE TABLE IF NOT EXISTS patients_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  file_path TEXT NOT NULL,
  UNIQUE(clinic_id, version)
);
CREATE INDEX IF NOT EXISTS idx_patients_backups_clinic_id ON patients_backups(clinic_id);
CREATE INDEX IF NOT EXISTS idx_patients_backups_created_at ON patients_backups(created_at DESC);
ALTER TABLE patients_backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins can view patients backup metadata" ON patients_backups FOR SELECT USING (is_super_admin());

-- Storage: allow super_admin to read from tab-backups bucket
CREATE POLICY "Super admin can read tab backups" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'tab-backups'
    AND (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );
