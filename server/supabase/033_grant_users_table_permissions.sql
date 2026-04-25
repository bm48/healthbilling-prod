-- Fix 42501 "permission denied for table users".
-- authenticated needs table-level GRANTs so client UPDATE on users is allowed; RLS then filters rows.
-- is_super_admin() owner must have SELECT on public.users.
-- Run this in Supabase Dashboard → SQL Editor (as postgres) then retry the failing action.

-- Table-level grants for client role
GRANT SELECT, INSERT, UPDATE ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;

-- Grant so is_super_admin() owner can read users
DO $$
DECLARE
  owner_name TEXT;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO owner_name
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'is_super_admin';
  IF owner_name IS NOT NULL THEN
    EXECUTE format('GRANT SELECT ON TABLE public.users TO %I', owner_name);
  END IF;
END;
$$;
