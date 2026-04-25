-- Change copay and coinsurance to TEXT so users can enter words (e.g. "N/A", "TBD") or numbers
ALTER TABLE patients
  ALTER COLUMN copay TYPE TEXT USING (copay::TEXT),
  ALTER COLUMN coinsurance TYPE TEXT USING (coinsurance::TEXT);
