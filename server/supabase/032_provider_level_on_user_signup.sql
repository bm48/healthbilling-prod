-- When a user is created with role 'provider', ensure a provider record exists (by email)
-- and that provider_levels has level 1. This covers sign-up flow where only users table
-- is populated; the trigger on providers INSERT still handles when providers are added directly.

CREATE OR REPLACE FUNCTION public.ensure_provider_level_for_provider_user()
RETURNS TRIGGER AS $$
DECLARE
  p_id UUID;
  fname TEXT;
  lname TEXT;
BEGIN
  IF NEW.role <> 'provider' THEN
    RETURN NEW;
  END IF;

  -- Find existing provider by email
  SELECT id INTO p_id
  FROM public.providers
  WHERE email = NEW.email
  LIMIT 1;

  -- If no provider exists, create one (first_name/last_name from full_name)
  IF p_id IS NULL THEN
    fname := COALESCE(TRIM(SPLIT_PART(COALESCE(NEW.full_name, '') || ' ', ' ', 1)), 'User');
    lname := COALESCE(NULLIF(TRIM(SUBSTRING(COALESCE(NEW.full_name, '') FROM POSITION(' ' IN COALESCE(NEW.full_name, '') || ' ') + 1)), ''), '-');
    INSERT INTO public.providers (email, first_name, last_name, clinic_ids)
    VALUES (NEW.email, fname, lname, ARRAY[]::UUID[])
    RETURNING id INTO p_id;
  END IF;

  -- Ensure provider_levels has level 1 for this provider
  IF p_id IS NOT NULL THEN
    INSERT INTO public.provider_levels (provider_id, level)
    VALUES (p_id, 1)
    ON CONFLICT (provider_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_user_provider_ensure_level ON public.users;

CREATE TRIGGER on_user_provider_ensure_level
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_provider_level_for_provider_user();
