-- Add text_color to billing_codes for contrast on background color
ALTER TABLE billing_codes
ADD COLUMN IF NOT EXISTS text_color TEXT NOT NULL DEFAULT '#000000';

COMMENT ON COLUMN billing_codes.text_color IS 'Text color (hex) for the billing code label when shown on the background color';
