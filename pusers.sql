-- =========================================
-- USERS TABLE STRUCTURE UPDATE
-- =========================================

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS clinic_ids uuid[] DEFAULT '{}'::uuid[];

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS highlight_color text;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS hourly_pay numeric(10,2);

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS password varchar(255);

-- =========================================
-- INDEX
-- =========================================

CREATE INDEX IF NOT EXISTS idx_users_clinic_ids
ON public.users
USING gin (clinic_ids);

-- =========================================
-- UNIQUE CONSTRAINT
-- =========================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_email_key'
    ) THEN
        ALTER TABLE public.users
        ADD CONSTRAINT users_email_key UNIQUE (email);
    END IF;
END$$;

-- =========================================
-- ROLE CHECK CONSTRAINT
-- =========================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_role_check'
    ) THEN
        ALTER TABLE public.users
        ADD CONSTRAINT users_role_check CHECK (
            role = ANY (
                ARRAY[
                    'super_admin'::text,
                    'admin'::text,
                    'view_only_admin'::text,
                    'billing_staff'::text,
                    'view_only_billing'::text,
                    'provider'::text,
                    'office_staff'::text,
                    'official_staff'::text
                ]
            )
        );
    END IF;
END$$;

-- =========================================
-- UPDATE EXISTING USERS
-- =========================================

UPDATE public.users
SET
    clinic_ids = '{}'::uuid[]
WHERE clinic_ids IS NULL;

UPDATE public.users
SET
    active = true
WHERE active IS NULL;

-- =========================================
-- INSERT USERS IF NOT EXISTS
-- =========================================

INSERT INTO public.users (
    id,
    email,
    full_name,
    role,
    clinic_ids,
    highlight_color,
    created_at,
    updated_at,
    hourly_pay,
    active,
    password
)
VALUES
(
    'd16d4dfb-ee6c-47d1-aa62-5b2f26d3aa9e',
    'admin@amerbilling.com',
    'Super Admin',
    'super_admin',
    '{}'::uuid[],
    '#dc2626',
    '2026-01-15 09:55:25.531923-08',
    '2026-04-28 00:24:44.870216-07',
    43.00,
    true,
    '$2a$10$KnIvQhtIgWs75Zh0E8qENegEfsu/UUohtXbfZJ/92cbg7B4pEqywC'
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.users (
    id,
    email,
    full_name,
    role,
    clinic_ids,
    highlight_color,
    created_at,
    updated_at,
    hourly_pay,
    active,
    password
)
VALUES
(
    '25697489-bd5c-44de-bae5-057815974fa1',
    'admin@demo.com',
    'admin demo',
    'admin',
    '{9c542bda-d9b7-4903-9bcb-37eecca7720d,8cf4f148-1724-41f6-86a0-0da21a775b59}'::uuid[],
    '#3b82f6',
    '2026-02-03 01:53:09.441075-08',
    '2026-04-28 01:14:09.276885-07',
    54.00,
    true,
    '$2a$10$OL7elNEO9NsfNupNQxKt8u9PXQYxUiX0ljm2ENRiPelRkbPFm4bRO'
)
ON CONFLICT (email) DO NOTHING;