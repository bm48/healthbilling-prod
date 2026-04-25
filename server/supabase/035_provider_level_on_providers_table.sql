-- Move provider level from provider_levels table to providers.level column (default 1, values 1 or 2).
-- Then drop provider_levels and all related triggers/functions.

-- 1. Add level column to providers
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS level SMALLINT NOT NULL DEFAULT 1 CHECK (level IN (1, 2));

-- 2. Migrate existing data from provider_levels (if table still exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'provider_levels') THEN
    UPDATE public.providers p
    SET level = pl.level
    FROM public.provider_levels pl
    WHERE pl.provider_id = p.id AND pl.level IN (1, 2);
  END IF;
END;
$$;

-- 3. Drop trigger that inserts into provider_levels when a provider is created (no longer needed; column has default)
DROP TRIGGER IF EXISTS on_provider_created_set_level ON public.providers;
DROP FUNCTION IF EXISTS public.set_default_provider_level();

-- 4. Update sign-up trigger: ensure provider exists when user is created as provider; do not touch provider_levels
CREATE OR REPLACE FUNCTION public.ensure_provider_for_provider_user()
RETURNS TRIGGER AS $$
DECLARE
  p_id UUID;
  fname TEXT;
  lname TEXT;
BEGIN
  IF NEW.role <> 'provider' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO p_id
  FROM public.providers
  WHERE email = NEW.email
  LIMIT 1;

  IF p_id IS NULL THEN
    fname := COALESCE(TRIM(SPLIT_PART(COALESCE(NEW.full_name, '') || ' ', ' ', 1)), 'User');
    lname := COALESCE(NULLIF(TRIM(SUBSTRING(COALESCE(NEW.full_name, '') FROM POSITION(' ' IN COALESCE(NEW.full_name, '') || ' ') + 1)), ''), '-');
    INSERT INTO public.providers (email, first_name, last_name, clinic_ids)
    VALUES (NEW.email, fname, lname, ARRAY[]::UUID[]);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_user_provider_ensure_level ON public.users;
CREATE TRIGGER on_user_provider_ensure_level
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_provider_for_provider_user();

-- Drop old function that wrote to provider_levels (keep name for reference: was ensure_provider_level_for_provider_user)
DROP FUNCTION IF EXISTS public.ensure_provider_level_for_provider_user();

-- 5. Drop RPC that read from provider_levels (no longer needed)
DROP FUNCTION IF EXISTS public.get_provider_levels_for_super_admin(uuid[]);

-- 6. Drop provider_levels table (policies are dropped with the table)
DROP TABLE IF EXISTS public.provider_levels;

COMMENT ON COLUMN public.providers.level IS 'Provider access level: 1 or 2 (default 1). Set by super admin in User Management.';
