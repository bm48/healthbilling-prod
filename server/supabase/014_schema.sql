-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Note: JWT secret is automatically managed by Supabase
-- No need to set it manually

-- Clinics table
CREATE TABLE IF NOT EXISTS clinics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  role TEXT NOT NULL CHECK (role IN (
    'super_admin',
    'admin',
    'view_only_admin',
    'billing_staff',
    'view_only_billing',
    'provider',
    'office_staff'
  )),
  clinic_ids UUID[] DEFAULT '{}',
  highlight_color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Patients table
CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  subscriber_id TEXT,
  insurance TEXT,
  copay NUMERIC(10, 2),
  coinsurance NUMERIC(5, 2),
  date_of_birth DATE,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clinic_id, patient_id)
);

-- Billing codes table
CREATE TABLE IF NOT EXISTS billing_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Providers table
CREATE TABLE IF NOT EXISTS providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  specialty TEXT,
  npi TEXT,
  email TEXT,
  phone TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE providers
ADD COLUMN IF NOT EXISTS provider_cut_percent NUMERIC DEFAULT 0.7;

COMMENT ON COLUMN providers.provider_cut_percent IS 'Provider cut percent 0–1 (default 0.7). Provider Cut = Total Payments × this. Set in Super Admin Settings.';

-- Provider sheets table
CREATE TABLE IF NOT EXISTS provider_sheets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  year INTEGER NOT NULL,
  row_data JSONB DEFAULT '[]'::jsonb,
  locked BOOLEAN DEFAULT FALSE,
  locked_columns TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clinic_id, provider_id, month, year)
);

-- Todo items table
CREATE TABLE IF NOT EXISTS todo_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open',
  claim_reference TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Todo notes table
CREATE TABLE IF NOT EXISTS todo_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  todo_id UUID NOT NULL REFERENCES todo_items(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Timecards table
CREATE TABLE IF NOT EXISTS timecards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES clinics(id) ON DELETE SET NULL,
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,
  hours NUMERIC(10, 2),
  amount_paid NUMERIC(10, 2),
  payment_date DATE,
  week_start_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES clinics(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_clinic_ids ON users USING GIN(clinic_ids);
CREATE INDEX IF NOT EXISTS idx_patients_clinic_id ON patients(clinic_id);
CREATE INDEX IF NOT EXISTS idx_patients_patient_id ON patients(clinic_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_providers_clinic_id ON providers(clinic_id);
CREATE INDEX IF NOT EXISTS idx_providers_active ON providers(clinic_id, active);
CREATE INDEX IF NOT EXISTS idx_provider_sheets_clinic_provider ON provider_sheets(clinic_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_sheets_month_year ON provider_sheets(year, month);
CREATE INDEX IF NOT EXISTS idx_todo_items_clinic ON todo_items(clinic_id);
CREATE INDEX IF NOT EXISTS idx_todo_items_created_by ON todo_items(created_by);
CREATE INDEX IF NOT EXISTS idx_todo_notes_todo_id ON todo_notes(todo_id);
CREATE INDEX IF NOT EXISTS idx_timecards_user_id ON timecards(user_id);
CREATE INDEX IF NOT EXISTS idx_timecards_week_start ON timecards(week_start_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_clinic_id ON audit_logs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Function to check if current user is super admin (bypasses RLS)
-- This function uses SECURITY DEFINER to bypass RLS when checking the users table
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
DECLARE
  user_role TEXT;
BEGIN
  -- SECURITY DEFINER allows this function to bypass RLS
  -- We query the users table directly without RLS restrictions
  SELECT role INTO user_role
  FROM users
  WHERE id = auth.uid()
  LIMIT 1;
  
  RETURN COALESCE(user_role = 'super_admin', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION is_super_admin() TO authenticated;

-- Function to check if a user exists in the users table (bypasses RLS)
-- This function uses SECURITY DEFINER to bypass RLS when checking the users table
CREATE OR REPLACE FUNCTION user_exists(user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  user_count INTEGER;
BEGIN
  -- SECURITY DEFINER allows this function to bypass RLS
  -- We query the users table directly without RLS restrictions
  SELECT COUNT(*) INTO user_count
  FROM users
  WHERE id = user_id;
  
  RETURN user_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION user_exists(UUID) TO authenticated;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if they exist (for idempotency)
DROP TRIGGER IF EXISTS update_clinics_updated_at ON clinics;
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
DROP TRIGGER IF EXISTS update_patients_updated_at ON patients;
DROP TRIGGER IF EXISTS update_billing_codes_updated_at ON billing_codes;
DROP TRIGGER IF EXISTS update_providers_updated_at ON providers;
DROP TRIGGER IF EXISTS update_provider_sheets_updated_at ON provider_sheets;
DROP TRIGGER IF EXISTS update_todo_items_updated_at ON todo_items;
DROP TRIGGER IF EXISTS update_timecards_updated_at ON timecards;

-- Triggers for updated_at
CREATE TRIGGER update_clinics_updated_at BEFORE UPDATE ON clinics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_billing_codes_updated_at BEFORE UPDATE ON billing_codes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_providers_updated_at BEFORE UPDATE ON providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_provider_sheets_updated_at BEFORE UPDATE ON provider_sheets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_todo_items_updated_at BEFORE UPDATE ON todo_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_timecards_updated_at BEFORE UPDATE ON timecards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to create audit log entry
CREATE OR REPLACE FUNCTION create_audit_log()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (user_id, clinic_id, action, table_name, record_id, new_values)
    VALUES (
      auth.uid(),
      NEW.clinic_id,
      'INSERT',
      TG_TABLE_NAME,
      NEW.id,
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (user_id, clinic_id, action, table_name, record_id, old_values, new_values)
    VALUES (
      auth.uid(),
      NEW.clinic_id,
      'UPDATE',
      TG_TABLE_NAME,
      NEW.id,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (user_id, clinic_id, action, table_name, record_id, old_values)
    VALUES (
      auth.uid(),
      OLD.clinic_id,
      'DELETE',
      TG_TABLE_NAME,
      OLD.id,
      to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable Row Level Security
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE todo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE todo_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE timecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Super admins can view all clinics" ON clinics;
DROP POLICY IF EXISTS "Users can view their assigned clinics" ON clinics;
DROP POLICY IF EXISTS "Users can view their own profile" ON users;
DROP POLICY IF EXISTS "Super admins can view all users" ON users;
DROP POLICY IF EXISTS "Users can view patients in their clinics" ON patients;
DROP POLICY IF EXISTS "Office staff and billing staff can insert patients" ON patients;
DROP POLICY IF EXISTS "Office staff and billing staff can update patients" ON patients;
DROP POLICY IF EXISTS "Office staff and billing staff can delete patients" ON patients;
DROP POLICY IF EXISTS "Everyone can view billing codes" ON billing_codes;
DROP POLICY IF EXISTS "Super admins can manage billing codes" ON billing_codes;
DROP POLICY IF EXISTS "Users can view providers in their clinics" ON providers;
DROP POLICY IF EXISTS "Super admins can manage providers" ON providers;
DROP POLICY IF EXISTS "Admins can manage providers in their clinics" ON providers;
DROP POLICY IF EXISTS "Users can view sheets for their clinics" ON provider_sheets;
DROP POLICY IF EXISTS "Users can insert sheets for their clinics" ON provider_sheets;
DROP POLICY IF EXISTS "Users can update sheets for their clinics" ON provider_sheets;
DROP POLICY IF EXISTS "Users can delete sheets for their clinics" ON provider_sheets;
DROP POLICY IF EXISTS "Billing staff can view todos for their clinics" ON todo_items;
DROP POLICY IF EXISTS "Super admins can view all todos" ON todo_items;
DROP POLICY IF EXISTS "Billing staff can insert todos for their clinics" ON todo_items;
DROP POLICY IF EXISTS "Billing staff can update todos for their clinics" ON todo_items;
DROP POLICY IF EXISTS "Billing staff can delete todos for their clinics" ON todo_items;
DROP POLICY IF EXISTS "Users can view notes for todos in their clinics" ON todo_notes;
DROP POLICY IF EXISTS "Users can insert notes for todos in their clinics" ON todo_notes;
DROP POLICY IF EXISTS "Users can update notes for todos in their clinics" ON todo_notes;
DROP POLICY IF EXISTS "Users can delete notes for todos in their clinics" ON todo_notes;
DROP POLICY IF EXISTS "Users can view their own timecards" ON timecards;
DROP POLICY IF EXISTS "Users can insert their own timecards" ON timecards;
DROP POLICY IF EXISTS "Users can update their own timecards" ON timecards;
DROP POLICY IF EXISTS "Super admins can view all audit logs" ON audit_logs;

-- RLS Policies for clinics
CREATE POLICY "Super admins can view all clinics" ON clinics
  FOR SELECT USING (is_super_admin());

CREATE POLICY "Super admins can manage clinics" ON clinics
  FOR ALL USING (is_super_admin());
  
CREATE POLICY "Users can view their assigned clinics" ON clinics
  FOR SELECT USING (
    id = ANY(
      SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
    )
  );

-- RLS Policies for users
CREATE POLICY "Users can view their own profile" ON users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Super admins can view all users" ON users
  FOR SELECT USING (is_super_admin());
CREATE POLICY "Super admins can manage users" ON users
  FOR ALL USING (is_super_admin());

-- RLS Policies for patients
CREATE POLICY "Users can view patients in their clinics" ON patients
  FOR SELECT USING (
    clinic_id = ANY(
      SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
    ) OR is_super_admin()
  );

CREATE POLICY "Office staff and billing staff can insert patients" ON patients
  FOR INSERT WITH CHECK (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('office_staff', 'billing_staff', 'admin', 'super_admin')
      )
    )
  );

CREATE POLICY "Office staff and billing staff can update patients" ON patients
  FOR UPDATE USING (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('office_staff', 'billing_staff', 'admin', 'super_admin')
      )
    )
  );

CREATE POLICY "Office staff and billing staff can delete patients" ON patients
  FOR DELETE USING (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('office_staff', 'billing_staff', 'admin', 'super_admin')
      )
    )
  );

-- RLS Policies for billing codes
CREATE POLICY "Everyone can view billing codes" ON billing_codes
  FOR SELECT USING (true);

CREATE POLICY "Super admins can manage billing codes" ON billing_codes
  FOR ALL USING (is_super_admin());

-- RLS Policies for providers
CREATE POLICY "Users can view providers in their clinics" ON providers
  FOR SELECT USING (
    clinic_id = ANY(
      SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
    ) OR is_super_admin()
  );

CREATE POLICY "Super admins can manage providers" ON providers
  FOR ALL USING (is_super_admin());

CREATE POLICY "Admins can manage providers in their clinics" ON providers
  FOR ALL USING (
    clinic_id = ANY(
      SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
    ) AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role IN ('admin', 'super_admin')
    )
  );

-- RLS Policies for provider sheets
CREATE POLICY "Users can view sheets for their clinics" ON provider_sheets
  FOR SELECT USING (
    clinic_id = ANY(
      SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
    ) OR is_super_admin()
  );

CREATE POLICY "Users can insert sheets for their clinics" ON provider_sheets
  FOR INSERT WITH CHECK (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin', 'provider', 'office_staff')
      )
    )
  );

CREATE POLICY "Users can update sheets for their clinics" ON provider_sheets
  FOR UPDATE USING (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin', 'provider', 'office_staff')
      )
    )
  );

CREATE POLICY "Users can delete sheets for their clinics" ON provider_sheets
  FOR DELETE USING (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin')
      )
    )
  );

-- RLS Policies for todo items
CREATE POLICY "Super admins can view all todos" ON todo_items
  FOR SELECT USING (is_super_admin());

CREATE POLICY "Billing staff can view todos for their clinics" ON todo_items
  FOR SELECT USING (
    clinic_id = ANY(
      SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
    ) AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin')
    )
  );

CREATE POLICY "Billing staff can insert todos for their clinics" ON todo_items
  FOR INSERT WITH CHECK (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin')
      ) AND created_by = auth.uid()
    )
  );

CREATE POLICY "Billing staff can update todos for their clinics" ON todo_items
  FOR UPDATE USING (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin')
      )
    )
  );

CREATE POLICY "Billing staff can delete todos for their clinics" ON todo_items
  FOR DELETE USING (
    (
      is_super_admin()
    ) OR (
      clinic_id = ANY(
        SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
      ) AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin')
      )
    )
  );

-- RLS Policies for todo notes
CREATE POLICY "Users can view notes for todos in their clinics" ON todo_notes
  FOR SELECT USING (
    (
      is_super_admin()
    ) OR (
      EXISTS (
        SELECT 1 FROM todo_items
        WHERE todo_items.id = todo_notes.todo_id
        AND (
          todo_items.clinic_id = ANY(
            SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
          )
        )
        AND EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin', 'view_only_billing', 'view_only_admin')
        )
      )
    )
  );

CREATE POLICY "Users can insert notes for todos in their clinics" ON todo_notes
  FOR INSERT WITH CHECK (
    (
      is_super_admin()
    ) OR (
      todo_notes.created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM todo_items
        WHERE todo_items.id = todo_notes.todo_id
        AND (
          todo_items.clinic_id = ANY(
            SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
          )
        )
        AND EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin')
        )
      )
    )
  );

CREATE POLICY "Users can update notes for todos in their clinics" ON todo_notes
  FOR UPDATE USING (
    (
      is_super_admin()
    ) OR (
      created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM todo_items
        WHERE todo_items.id = todo_notes.todo_id
        AND (
          todo_items.clinic_id = ANY(
            SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
          )
        )
        AND EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin')
        )
      )
    )
  );

CREATE POLICY "Users can delete notes for todos in their clinics" ON todo_notes
  FOR DELETE USING (
    (
      is_super_admin()
    ) OR (
      created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM todo_items
        WHERE todo_items.id = todo_notes.todo_id
        AND (
          todo_items.clinic_id = ANY(
            SELECT unnest(clinic_ids) FROM users WHERE id = auth.uid()
          )
        )
        AND EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid() AND users.role IN ('billing_staff', 'admin', 'super_admin')
        )
      )
    )
  );

-- RLS Policies for timecards
CREATE POLICY "Users can view their own timecards" ON timecards
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own timecards" ON timecards
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own timecards" ON timecards
  FOR UPDATE USING (user_id = auth.uid());

-- RLS Policies for audit logs
CREATE POLICY "Super admins can view all audit logs" ON audit_logs
  FOR SELECT USING (is_super_admin());

-- Insert default billing codes
INSERT INTO billing_codes (code, description, color) VALUES
  ('99213', 'Office Visit', '#3b82f6'),
  ('99214', 'Office Visit Extended', '#10b981'),
  ('99215', 'Office Visit Comprehensive', '#f59e0b'),
  ('90834', 'Psychotherapy 45 min', '#8b5cf6'),
  ('90837', 'Psychotherapy 60 min', '#ec4899')
ON CONFLICT (code) DO NOTHING;

-- Function to create super admin user profile
-- This function should be called after creating the auth user via Supabase Auth
CREATE OR REPLACE FUNCTION create_super_admin_profile(
  user_id UUID,
  user_email TEXT,
  user_full_name TEXT DEFAULT 'Super Admin'
)
RETURNS void AS $$
BEGIN
  INSERT INTO users (id, email, full_name, role, clinic_ids, highlight_color)
  VALUES (
    user_id,
    user_email,
    user_full_name,
    'super_admin',
    ARRAY[]::UUID[],
    '#dc2626' -- Red highlight color for super admin
  )
  ON CONFLICT (id) DO UPDATE SET
    role = 'super_admin',
    email = user_email,
    full_name = user_full_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Allow admins to see and manage all users that belong to their clinic(s).
-- Without this, admins only see their own profile (RLS "Users can view their own profile").
--
-- IMPORTANT: We must NOT query the users table inside a policy ON users (causes infinite
-- recursion). Use SECURITY DEFINER functions that read users without going through RLS.

-- Drop policies if they exist (e.g. from a previous run that caused recursion)
DROP POLICY IF EXISTS "Admins can view users in their clinics" ON users;
DROP POLICY IF EXISTS "Admins can update users in their clinics" ON users;

-- Returns the current user's clinic_ids. SECURITY DEFINER bypasses RLS so no recursion.
CREATE OR REPLACE FUNCTION current_user_clinic_ids()
RETURNS UUID[] AS $$
  SELECT COALESCE(clinic_ids, '{}') FROM users WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns true if the current user is admin or super_admin. SECURITY DEFINER bypasses RLS.
CREATE OR REPLACE FUNCTION current_user_is_admin_or_super()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION current_user_clinic_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_is_admin_or_super() TO authenticated;

-- Admins can view users whose clinic_ids overlap with their own (all users "of the clinic").
CREATE POLICY "Admins can view users in their clinics" ON users
  FOR SELECT USING (
    current_user_is_admin_or_super()
    AND (current_user_clinic_ids() && COALESCE(users.clinic_ids, '{}'))
  );

-- Admins can update users in their clinics (e.g. assign clinics, edit user).
CREATE POLICY "Admins can update users in their clinics" ON users
  FOR UPDATE USING (
    current_user_is_admin_or_super()
    AND (current_user_clinic_ids() && COALESCE(users.clinic_ids, '{}'))
  );


-- Instructions for creating Super Admin user:
-- 
-- OPTION 1: Via Supabase Dashboard (Recommended)
-- 1. Go to Authentication > Users in your Supabase dashboard
-- 2. Click "Add User" > "Create new user"
-- 3. Email: admin@amerbilling.com
-- 4. Password: American#2025
-- 5. Auto Confirm User: Yes
-- 6. After user is created, note the User UID
-- 7. Run the following SQL (replace USER_ID with the actual UUID):
--
--    SELECT create_super_admin_profile(
--      'USER_ID_HERE'::UUID,
--      'admin@amerbilling.com',
--      'Super Admin'
--    );
--
-- OPTION 2: Via SQL (Requires service_role key or admin access)
-- Run this after enabling the pgcrypto extension and having admin access:
--
-- DO $$
-- DECLARE
--   new_user_id UUID;
-- BEGIN
--   -- Create auth user (this requires admin/service_role access)
--   new_user_id := auth.uid();
--   
--   -- If you have the user ID from auth.users, use it directly:
--   -- Replace 'USER_ID_FROM_AUTH_USERS' with actual UUID from auth.users table
--   PERFORM create_super_admin_profile(
--     'USER_ID_FROM_AUTH_USERS'::UUID,
--     'admin@amerbilling.com',
--     'Super Admin'
--   );
-- END $$;
--
-- OPTION 3: Manual Insert (After auth user is created)
-- 1. Create the auth user via Supabase Dashboard or API
-- 2. Get the user ID from auth.users table
-- 3. Run:
--
--    INSERT INTO users (id, email, full_name, role, clinic_ids, highlight_color)
--    VALUES (
--      'USER_ID_HERE'::UUID,
--      'admin@amerbilling.com',
--      'Super Admin',
--      'super_admin',
--      ARRAY[]::UUID[],
--      '#dc2626'
--    )
--    ON CONFLICT (id) DO UPDATE SET
--      role = 'super_admin',
--      email = 'admin@amerbilling.com',
--      full_name = 'Super Admin';

-- Quick setup script (run this AFTER creating the auth user via dashboard):
-- Replace 'YOUR_USER_ID_HERE' with the UUID from auth.users table after creating the user
/*
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
      full_name = 'Super Admin';
    
    RAISE NOTICE 'Super Admin profile created successfully for user: %', admin_email;
  ELSE
    RAISE NOTICE 'Auth user not found. Please create the user first via Supabase Dashboard with email: %', admin_email;
  END IF;
END $$;
*/
