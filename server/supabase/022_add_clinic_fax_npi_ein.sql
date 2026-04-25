-- Add Fax, NPI, EIN, and Address Line 2 to clinics table
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS fax TEXT,
  ADD COLUMN IF NOT EXISTS npi TEXT,
  ADD COLUMN IF NOT EXISTS ein TEXT,
  ADD COLUMN IF NOT EXISTS address_line_2 TEXT;

COMMENT ON COLUMN clinics.fax IS 'Clinic fax number';
COMMENT ON COLUMN clinics.npi IS 'National Provider Identifier for the clinic';
COMMENT ON COLUMN clinics.ein IS 'Employer Identification Number';
COMMENT ON COLUMN clinics.address_line_2 IS 'Second line of clinic address';
