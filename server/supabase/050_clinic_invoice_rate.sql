-- Invoice rate per clinic: Invoice Total = (Insurance + Patient + AR) * invoice_rate. Stored as decimal (e.g. 0.05 = 5%).
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS invoice_rate NUMERIC(6, 4) DEFAULT NULL;

COMMENT ON COLUMN clinics.invoice_rate IS 'Decimal rate for invoice total (e.g. 0.05 = 5%). Invoice Total = (Ins Pay + Patient Pay + AR) * invoice_rate. Set in Clinic Management.';
