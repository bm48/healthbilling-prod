-- Provider levels table: one row per provider, level 1 or 2 (default 1).
-- Super admin sets provider level in User Management.

CREATE TABLE IF NOT EXISTS provider_levels (
  provider_id UUID PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  level SMALLINT NOT NULL DEFAULT 1 CHECK (level IN (1, 2)),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_levels_provider_id ON provider_levels(provider_id);

ALTER TABLE provider_levels ENABLE ROW LEVEL SECURITY;

-- Super admin policies use is_super_admin() (SECURITY DEFINER) so they never read public.users
-- as authenticated, avoiding 42501 "permission denied for table users".
DROP POLICY IF EXISTS "Super admin can select provider_levels" ON provider_levels;
DROP POLICY IF EXISTS "Super admin can insert provider_levels" ON provider_levels;
DROP POLICY IF EXISTS "Super admin can update provider_levels" ON provider_levels;
DROP POLICY IF EXISTS "Super admin can delete provider_levels" ON provider_levels;

CREATE POLICY "Super admin can select provider_levels"
  ON provider_levels FOR SELECT
  TO authenticated
  USING (is_super_admin());

CREATE POLICY "Super admin can insert provider_levels"
  ON provider_levels FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admin can update provider_levels"
  ON provider_levels FOR UPDATE
  TO authenticated
  USING (is_super_admin());

CREATE POLICY "Super admin can delete provider_levels"
  ON provider_levels FOR DELETE
  TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "Provider can select own provider_levels" ON provider_levels;
CREATE POLICY "Provider can select own provider_levels"
  ON provider_levels FOR SELECT
  TO authenticated
  USING (
    provider_id IN (
      SELECT p.id FROM providers p
      JOIN auth.users u ON u.email = p.email
      WHERE u.id = auth.uid()
    )
  );