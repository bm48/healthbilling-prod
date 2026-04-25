-- Co-pay and Co-Insurance as TEXT so users can enter numbers (formatted as currency/percent) or text (e.g. N/A, TBD)
ALTER TABLE provider_sheet_rows
  ALTER COLUMN patient_copay TYPE TEXT USING (patient_copay::TEXT),
  ALTER COLUMN patient_coinsurance TYPE TEXT USING (patient_coinsurance::TEXT);
