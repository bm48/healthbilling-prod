-- RPC for super admin to fetch provider levels without relying on table RLS (avoids 403 when is_super_admin() has permission issues).
-- Runs as SECURITY DEFINER so it can read public.users and public.provider_levels; only returns data if caller is super_admin.

CREATE OR REPLACE FUNCTION public.get_provider_levels_for_super_admin(provider_ids uuid[])
RETURNS TABLE(provider_id uuid, level smallint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  -- Only allow if current user is super_admin (we read users as definer, so no 42501)
  IF (SELECT role FROM public.users WHERE id = auth.uid() LIMIT 1) <> 'super_admin' THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT pl.provider_id, pl.level
  FROM public.provider_levels pl
  WHERE pl.provider_id = ANY(provider_ids);
END;
$$;

COMMENT ON FUNCTION public.get_provider_levels_for_super_admin(uuid[]) IS 'Returns provider_id and level for given IDs; only works for super_admin. Use from Super Admin Settings to avoid RLS 403.';

GRANT EXECUTE ON FUNCTION public.get_provider_levels_for_super_admin(uuid[]) TO authenticated;

-- 42501 fix: the function runs as SECURITY DEFINER; its owner must have SELECT on these tables
DO $$
DECLARE
  owner_name TEXT;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO owner_name
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'get_provider_levels_for_super_admin';
  IF owner_name IS NOT NULL THEN
    EXECUTE format('GRANT SELECT ON TABLE public.users TO %I', owner_name);
    EXECUTE format('GRANT SELECT ON TABLE public.provider_levels TO %I', owner_name);
  END IF;
END;
$$;
