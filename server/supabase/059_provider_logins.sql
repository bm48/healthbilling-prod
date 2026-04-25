-- Track provider logins so clinic dashboard can show "Visits" as number of provider logins.

CREATE TABLE IF NOT EXISTS provider_logins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_logins_provider_id ON provider_logins(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_logins_logged_at ON provider_logins(logged_at);

COMMENT ON TABLE provider_logins IS 'One row per provider sign-in; used for clinic dashboard Visits count.';

ALTER TABLE provider_logins ENABLE ROW LEVEL SECURITY;

-- Super admins can read all provider logins.
CREATE POLICY "Super admins can view all provider logins"
  ON provider_logins FOR SELECT
  TO authenticated
  USING (is_super_admin());

-- Users can read login counts for providers in their clinics (clinic_ids overlap).
CREATE POLICY "Users can view provider logins in their clinics"
  ON provider_logins FOR SELECT
  TO authenticated
  USING (
    provider_id IN (
      SELECT p.id FROM providers p
      WHERE p.clinic_ids && COALESCE(
        (SELECT u.clinic_ids FROM users u WHERE u.id = auth.uid() LIMIT 1),
        '{}'
      )
    )
  );

-- Record a login for the current user's provider (if they are a provider). Called from app on sign-in.
CREATE OR REPLACE FUNCTION public.record_provider_login()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid UUID;
BEGIN
  pid := current_user_provider_id();
  IF pid IS NOT NULL THEN
    INSERT INTO provider_logins (provider_id, logged_at)
    VALUES (pid, NOW());
  END IF;
END;
$$;

COMMENT ON FUNCTION public.record_provider_login() IS 'Inserts one row into provider_logins for the current auth user if they are linked to a provider (by email). Call on sign-in.';

GRANT EXECUTE ON FUNCTION public.record_provider_login() TO authenticated;
