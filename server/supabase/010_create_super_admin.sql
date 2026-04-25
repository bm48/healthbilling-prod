-- Script to create Super Admin user profile
-- 
-- IMPORTANT: You must first create the auth user via Supabase Dashboard:
-- 1. Go to Authentication > Users
-- 2. Click "Add User" > "Create new user"
-- 3. Email: admin@amerbilling.com
-- 4. Password: American#2025
-- 5. Auto Confirm User: Yes
-- 6. Copy the User UID that is generated
--
-- Then run this script to create the user profile:

DO $$
DECLARE
  admin_email TEXT := 'admin@amerbilling.com';
  admin_user_id UUID;
BEGIN
  -- Find the user ID from auth.users
  SELECT id INTO admin_user_id
  FROM auth.users
  WHERE email = admin_email
  LIMIT 1;
  
  -- Create the user profile if user exists
  IF admin_user_id IS NOT NULL THEN
    INSERT INTO users (id, email, full_name, role, clinic_ids, highlight_color)
    VALUES (
      admin_user_id,
      admin_email,
      'Super Admin',
      'super_admin',
      ARRAY[]::UUID[],
      '#dc2626'
    )
    ON CONFLICT (id) DO UPDATE SET
      role = 'super_admin',
      email = admin_email,
      full_name = 'Super Admin',
      highlight_color = '#dc2626';
    
    RAISE NOTICE 'Super Admin profile created successfully for user: %', admin_email;
    RAISE NOTICE 'User ID: %', admin_user_id;
  ELSE
    RAISE EXCEPTION 'Auth user not found with email: %. Please create the user first via Supabase Dashboard with email: % and password: American#2025', admin_email, admin_email;
  END IF;
END $$;

-- Alternative: If you know the user ID, you can run this directly:
-- Replace 'YOUR_USER_ID_HERE' with the actual UUID from auth.users

/*
INSERT INTO users (id, email, full_name, role, clinic_ids, highlight_color)
VALUES (
  'YOUR_USER_ID_HERE'::UUID,
  'admin@amerbilling.com',
  'Super Admin',
  'super_admin',
  ARRAY[]::UUID[],
  '#dc2626'
)
ON CONFLICT (id) DO UPDATE SET
  role = 'super_admin',
  email = 'admin@amerbilling.com',
  full_name = 'Super Admin',
  highlight_color = '#dc2626';
*/
