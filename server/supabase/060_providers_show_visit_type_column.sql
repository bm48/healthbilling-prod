-- When true, the Providers tab shows an extra "Visit Type" column (In-person / Telehealth) for this provider.
ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS show_visit_type_column BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN providers.show_visit_type_column IS 'When true, provider sheet shows Visit Type column (In-person / Telehealth). Toggled in User Management.';
