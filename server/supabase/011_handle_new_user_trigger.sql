-- Automatically create user profile in public.users when a new auth user is created.
-- Run this in Supabase SQL Editor after schema is applied.
-- The trigger reads role and full_name from auth user metadata (set during signUp).
--
-- IMPORTANT: To avoid "Email not confirmed" errors, you have two options:
-- 1. (RECOMMENDED) Disable email confirmation in Supabase Dashboard:
--    Go to Authentication > Settings > Email Auth > Disable "Enable email confirmations"
-- 2. Use this trigger which auto-confirms emails (may require additional permissions)

-- Function to auto-confirm user email (can be called separately)
CREATE OR REPLACE FUNCTION public.auto_confirm_user_email(user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, NOW())
  WHERE id = user_id AND email_confirmed_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to automatically create user profile when auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role TEXT;
  user_full_name TEXT;
BEGIN
  -- Get role and full_name from user metadata (raw_user_meta_data)
  user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'provider');
  user_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  
  -- Auto-confirm email (using SECURITY DEFINER to bypass RLS)
  PERFORM public.auto_confirm_user_email(NEW.id);
  
  -- Create user profile in public.users
  INSERT INTO public.users (id, email, full_name, role, clinic_ids)
  VALUES (
    NEW.id,
    NEW.email,
    user_full_name,
    user_role,
    ARRAY[]::UUID[]
  )
  ON CONFLICT (id) DO UPDATE SET
    email = NEW.email,
    full_name = COALESCE(user_full_name, users.full_name),
    role = COALESCE(user_role, users.role);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
