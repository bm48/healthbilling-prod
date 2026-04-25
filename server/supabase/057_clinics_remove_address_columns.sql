-- Migrate existing clinic address data into clinic_addresses, then drop address columns from clinics.
-- Run after 056_clinic_addresses.sql.

-- Copy address to clinic_addresses line 1 where present
INSERT INTO clinic_addresses (clinic_id, line_index, address, updated_at)
SELECT id, 1, address, NOW()
FROM clinics
WHERE address IS NOT NULL AND TRIM(address) != ''
ON CONFLICT (clinic_id, line_index) DO UPDATE SET address = EXCLUDED.address, updated_at = NOW();

-- Copy address_line_2 to clinic_addresses line 2 where present
INSERT INTO clinic_addresses (clinic_id, line_index, address, updated_at)
SELECT id, 2, address_line_2, NOW()
FROM clinics
WHERE address_line_2 IS NOT NULL AND TRIM(address_line_2) != ''
ON CONFLICT (clinic_id, line_index) DO UPDATE SET address = EXCLUDED.address, updated_at = NOW();

-- Drop address columns from clinics
ALTER TABLE clinics DROP COLUMN IF EXISTS address;
ALTER TABLE clinics DROP COLUMN IF EXISTS address_line_2;
