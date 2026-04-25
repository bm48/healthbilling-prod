-- Migration script to add text_color column to existing status_colors table
-- Run this ONLY if you already have the status_colors table without text_color

-- Add text_color column with default value
ALTER TABLE status_colors 
ADD COLUMN IF NOT EXISTS text_color TEXT NOT NULL DEFAULT '#000000';

-- Update text colors for better readability
-- White text for dark backgrounds, black text for light backgrounds

-- Appointment Status Colors
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'Complete' AND type = 'appointment';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'PP Complete' AND type = 'appointment';
UPDATE status_colors SET text_color = '#000000' WHERE status = 'Charge NS/LC' AND type = 'appointment';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'RS No Charge' AND type = 'appointment';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'NS No Charge' AND type = 'appointment';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'Note not complete' AND type = 'appointment';

-- Claim Status Colors
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'Claim Sent' AND type = 'claim';
UPDATE status_colors SET text_color = '#000000' WHERE status = 'RS' AND type = 'claim';
UPDATE status_colors SET text_color = '#000000' WHERE status = 'IP' AND type = 'claim';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'Paid' AND type = 'claim';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'Deductible' AND type = 'claim';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'N/A' AND type = 'claim';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'PP' AND type = 'claim';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'Denial' AND type = 'claim';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'Rejection' AND type = 'claim';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'No Coverage' AND type = 'claim';

-- Patient Pay Status Colors
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'Paid' AND type = 'patient_pay';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'CC declined' AND type = 'patient_pay';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'Secondary' AND type = 'patient_pay';
UPDATE status_colors SET text_color = '#000000' WHERE status = 'Refunded' AND type = 'patient_pay';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'Payment Plan' AND type = 'patient_pay';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'Waiting on Claims' AND type = 'patient_pay';

-- Month Colors
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'January' AND type = 'month';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'February' AND type = 'month';
UPDATE status_colors SET text_color = '#000000' WHERE status = 'March' AND type = 'month';
UPDATE status_colors SET text_color = '#000000' WHERE status = 'April' AND type = 'month';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'May' AND type = 'month';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'June' AND type = 'month';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'July' AND type = 'month';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'August' AND type = 'month';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'September' AND type = 'month';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'October' AND type = 'month';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'November' AND type = 'month';
UPDATE status_colors SET text_color = '#ffffff' WHERE status = 'December' AND type = 'month';
