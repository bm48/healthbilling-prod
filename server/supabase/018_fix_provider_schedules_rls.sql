-- Fix 403 "permission denied for table users" on provider_schedules.
-- The provider_schedules RLS policies read from providers, which in turn reads public.users
-- (clinic_ids). Use a SECURITY DEFINER function so we never touch public.users as the provider.

CREATE OR REPLACE FUNCTION public.current_user_provider_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id FROM public.providers p
  JOIN auth.users u ON u.email = p.email
  WHERE u.id = auth.uid()
  LIMIT 1
$$;

COMMENT ON FUNCTION public.current_user_provider_id() IS 'Returns the provider id for the current auth user (by email). Used by provider_schedules RLS so policies do not read public.users.';

GRANT EXECUTE ON FUNCTION public.current_user_provider_id() TO authenticated;

-- Replace provider_schedules policies to use the function (no read of public.users)
DROP POLICY IF EXISTS "Providers can view own schedule" ON provider_schedules;
DROP POLICY IF EXISTS "Providers can insert own schedule" ON provider_schedules;
DROP POLICY IF EXISTS "Providers can update own schedule" ON provider_schedules;
DROP POLICY IF EXISTS "Providers can delete own schedule" ON provider_schedules;

CREATE POLICY "Providers can view own schedule"
  ON provider_schedules FOR SELECT
  TO authenticated
  USING (provider_id = current_user_provider_id());

CREATE POLICY "Providers can insert own schedule"
  ON provider_schedules FOR INSERT
  TO authenticated
  WITH CHECK (provider_id = current_user_provider_id());

CREATE POLICY "Providers can update own schedule"
  ON provider_schedules FOR UPDATE
  TO authenticated
  USING (provider_id = current_user_provider_id())
  WITH CHECK (provider_id = current_user_provider_id());

CREATE POLICY "Providers can delete own schedule"
  ON provider_schedules FOR DELETE
  TO authenticated
  USING (provider_id = current_user_provider_id());
