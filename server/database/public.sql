/*
 Navicat Premium Dump SQL

 Source Server         : amerbilling
 Source Server Type    : PostgreSQL
 Source Server Version : 170007 (170007)
 Source Host           : localhost:5432
 Source Catalog        : amerbilling
 Source Schema         : public

 Target Server Type    : PostgreSQL
 Target Server Version : 170007 (170007)
 File Encoding         : 65001

 Date: 23/04/2026 10:48:44
*/


-- ----------------------------
-- Table structure for accounts_receivables
-- ----------------------------
DROP TABLE IF EXISTS "public"."accounts_receivables";
CREATE TABLE "public"."accounts_receivables" (
  "id" uuid NOT NULL,
  "clinic_id" uuid,
  "ar_id" text COLLATE "pg_catalog"."default",
  "name" text COLLATE "pg_catalog"."default",
  "date_of_service" date,
  "amount" numeric(10,2),
  "date_recorded" date,
  "type" text COLLATE "pg_catalog"."default",
  "notes" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "payroll" int2 NOT NULL DEFAULT 1
)
;

-- ----------------------------
-- Table structure for ar_backups
-- ----------------------------
DROP TABLE IF EXISTS "public"."ar_backups";
CREATE TABLE "public"."ar_backups" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "clinic_id" uuid NOT NULL,
  "version" int4 NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "file_path" text COLLATE "pg_catalog"."default" NOT NULL
)
;

-- ----------------------------
-- Table structure for audit_logs
-- ----------------------------
DROP TABLE IF EXISTS "public"."audit_logs";
CREATE TABLE "public"."audit_logs" (
  "id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "clinic_id" uuid,
  "action" text COLLATE "pg_catalog"."default" NOT NULL,
  "table_name" text COLLATE "pg_catalog"."default" NOT NULL,
  "record_id" uuid NOT NULL,
  "old_values" jsonb,
  "new_values" jsonb,
  "created_at" timestamptz(6) DEFAULT now()
)
;

-- ----------------------------
-- Table structure for billing_codes
-- ----------------------------
DROP TABLE IF EXISTS "public"."billing_codes";
CREATE TABLE "public"."billing_codes" (
  "id" uuid NOT NULL,
  "code" text COLLATE "pg_catalog"."default" NOT NULL,
  "description" text COLLATE "pg_catalog"."default",
  "color" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT '#3b82f6'::text,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "text_color" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT '#000000'::text
)
;
COMMENT ON COLUMN "public"."billing_codes"."text_color" IS 'Text color (hex) for the billing code label when shown on the background color';

-- ----------------------------
-- Table structure for cell_comments
-- ----------------------------
DROP TABLE IF EXISTS "public"."cell_comments";
CREATE TABLE "public"."cell_comments" (
  "id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "sheet_type" text COLLATE "pg_catalog"."default" NOT NULL,
  "row_id" text COLLATE "pg_catalog"."default" NOT NULL,
  "column_key" text COLLATE "pg_catalog"."default" NOT NULL,
  "comment" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT ''::text,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "resolved" bool NOT NULL DEFAULT false
)
;

-- ----------------------------
-- Table structure for cell_highlights
-- ----------------------------
DROP TABLE IF EXISTS "public"."cell_highlights";
CREATE TABLE "public"."cell_highlights" (
  "id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "sheet_type" text COLLATE "pg_catalog"."default" NOT NULL,
  "row_id" text COLLATE "pg_catalog"."default" NOT NULL,
  "column_key" text COLLATE "pg_catalog"."default" NOT NULL,
  "created_at" timestamptz(6) DEFAULT now(),
  "user_id" uuid,
  "highlight_color" text COLLATE "pg_catalog"."default"
)
;
COMMENT ON COLUMN "public"."cell_highlights"."user_id" IS 'User who added the highlight';
COMMENT ON COLUMN "public"."cell_highlights"."highlight_color" IS 'Highlight color of that user at time of highlight (hex e.g. #eab308)';

-- ----------------------------
-- Table structure for clinic_addresses
-- ----------------------------
DROP TABLE IF EXISTS "public"."clinic_addresses";
CREATE TABLE "public"."clinic_addresses" (
  "id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "line_index" int4 NOT NULL,
  "address" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;

-- ----------------------------
-- Table structure for clinic_invoice_notes
-- ----------------------------
DROP TABLE IF EXISTS "public"."clinic_invoice_notes";
CREATE TABLE "public"."clinic_invoice_notes" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "clinic_id" uuid NOT NULL,
  "month" int2 NOT NULL,
  "year" int2 NOT NULL,
  "note" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "additional_fee" numeric(12,2) NOT NULL DEFAULT 0
)
;
COMMENT ON COLUMN "public"."clinic_invoice_notes"."additional_fee" IS 'Optional additional fee for this clinic for the invoice month; included in Total and in PDF notes when non-zero.';
COMMENT ON TABLE "public"."clinic_invoice_notes" IS 'Notes for clinic invoices, one per clinic per month; super admin only.';

-- ----------------------------
-- Table structure for clinics
-- ----------------------------
DROP TABLE IF EXISTS "public"."clinics";
CREATE TABLE "public"."clinics" (
  "id" uuid NOT NULL,
  "name" text COLLATE "pg_catalog"."default" NOT NULL,
  "phone" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "fax" text COLLATE "pg_catalog"."default",
  "npi" text COLLATE "pg_catalog"."default",
  "ein" text COLLATE "pg_catalog"."default",
  "payroll" int2 NOT NULL DEFAULT 1,
  "invoice_rate" numeric(6,4) DEFAULT NULL::numeric
)
;
COMMENT ON COLUMN "public"."clinics"."fax" IS 'Clinic fax number';
COMMENT ON COLUMN "public"."clinics"."npi" IS 'National Provider Identifier for the clinic';
COMMENT ON COLUMN "public"."clinics"."ein" IS 'Employer Identification Number';
COMMENT ON COLUMN "public"."clinics"."invoice_rate" IS 'Decimal rate for invoice total (e.g. 0.05 = 5%). Invoice Total = (Ins Pay + Patient Pay + AR) * invoice_rate. Set in Clinic Management.';

-- ----------------------------
-- Table structure for column_locks
-- ----------------------------
DROP TABLE IF EXISTS "public"."column_locks";
CREATE TABLE "public"."column_locks" (
  "id" uuid NOT NULL,
  "clinic_id" uuid,
  "provider_id" uuid,
  "column_name" text COLLATE "pg_catalog"."default" NOT NULL,
  "is_locked" bool NOT NULL DEFAULT true,
  "comment" text COLLATE "pg_catalog"."default",
  "locked_by" uuid,
  "locked_at" timestamptz(6) DEFAULT now(),
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;

-- ----------------------------
-- Table structure for invite_tokens
-- ----------------------------
DROP TABLE IF EXISTS "public"."invite_tokens";
CREATE TABLE "public"."invite_tokens" (
  "token" uuid NOT NULL DEFAULT gen_random_uuid(),
  "email" text COLLATE "pg_catalog"."default" NOT NULL,
  "temp_password" text COLLATE "pg_catalog"."default" NOT NULL,
  "expires_at" timestamptz(6) NOT NULL DEFAULT (now() + '24:00:00'::interval),
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
)
;
COMMENT ON TABLE "public"."invite_tokens" IS 'One-time tokens for new user sign-in links; read once then deleted.';

-- ----------------------------
-- Table structure for is_lock_accounts_receivable
-- ----------------------------
DROP TABLE IF EXISTS "public"."is_lock_accounts_receivable";
CREATE TABLE "public"."is_lock_accounts_receivable" (
  "id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "ar_id" bool NOT NULL DEFAULT false,
  "name" bool NOT NULL DEFAULT false,
  "date_of_service" bool NOT NULL DEFAULT false,
  "amount" bool NOT NULL DEFAULT false,
  "date_recorded" bool NOT NULL DEFAULT false,
  "type" bool NOT NULL DEFAULT false,
  "notes" bool NOT NULL DEFAULT false,
  "ar_id_comment" text COLLATE "pg_catalog"."default",
  "name_comment" text COLLATE "pg_catalog"."default",
  "date_of_service_comment" text COLLATE "pg_catalog"."default",
  "amount_comment" text COLLATE "pg_catalog"."default",
  "date_recorded_comment" text COLLATE "pg_catalog"."default",
  "type_comment" text COLLATE "pg_catalog"."default",
  "notes_comment" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "month_key" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'legacy'::text
)
;
COMMENT ON COLUMN "public"."is_lock_accounts_receivable"."month_key" IS 'Matches clinic month key for AR: "YYYY-M" or "YYYY-M-P" when clinic payroll=2. Value "legacy" holds pre-migration locks copied into each month on first open.';

-- ----------------------------
-- Table structure for is_lock_billing_todo
-- ----------------------------
DROP TABLE IF EXISTS "public"."is_lock_billing_todo";
CREATE TABLE "public"."is_lock_billing_todo" (
  "id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "id_column" bool NOT NULL DEFAULT false,
  "status" bool NOT NULL DEFAULT false,
  "issue" bool NOT NULL DEFAULT false,
  "notes" bool NOT NULL DEFAULT false,
  "followup_notes" bool NOT NULL DEFAULT false,
  "id_column_comment" text COLLATE "pg_catalog"."default",
  "status_comment" text COLLATE "pg_catalog"."default",
  "issue_comment" text COLLATE "pg_catalog"."default",
  "notes_comment" text COLLATE "pg_catalog"."default",
  "followup_notes_comment" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;

-- ----------------------------
-- Table structure for is_lock_patients
-- ----------------------------
DROP TABLE IF EXISTS "public"."is_lock_patients";
CREATE TABLE "public"."is_lock_patients" (
  "id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "patient_id" bool NOT NULL DEFAULT false,
  "first_name" bool NOT NULL DEFAULT false,
  "last_name" bool NOT NULL DEFAULT false,
  "insurance" bool NOT NULL DEFAULT false,
  "copay" bool NOT NULL DEFAULT false,
  "coinsurance" bool NOT NULL DEFAULT false,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "patient_id_comment" text COLLATE "pg_catalog"."default",
  "first_name_comment" text COLLATE "pg_catalog"."default",
  "last_name_comment" text COLLATE "pg_catalog"."default",
  "insurance_comment" text COLLATE "pg_catalog"."default",
  "copay_comment" text COLLATE "pg_catalog"."default",
  "coinsurance_comment" text COLLATE "pg_catalog"."default"
)
;

-- ----------------------------
-- Table structure for is_lock_providers
-- ----------------------------
DROP TABLE IF EXISTS "public"."is_lock_providers";
CREATE TABLE "public"."is_lock_providers" (
  "id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "patient_id" bool NOT NULL DEFAULT false,
  "first_name" bool NOT NULL DEFAULT false,
  "last_initial" bool NOT NULL DEFAULT false,
  "insurance" bool NOT NULL DEFAULT false,
  "copay" bool NOT NULL DEFAULT false,
  "coinsurance" bool NOT NULL DEFAULT false,
  "date_of_service" bool NOT NULL DEFAULT false,
  "cpt_code" bool NOT NULL DEFAULT false,
  "appointment_note_status" bool NOT NULL DEFAULT false,
  "claim_status" bool NOT NULL DEFAULT false,
  "most_recent_submit_date" bool NOT NULL DEFAULT false,
  "ins_pay" bool NOT NULL DEFAULT false,
  "ins_pay_date" bool NOT NULL DEFAULT false,
  "pt_res" bool NOT NULL DEFAULT false,
  "collected_from_pt" bool NOT NULL DEFAULT false,
  "pt_pay_status" bool NOT NULL DEFAULT false,
  "pt_payment_ar_ref_date" bool NOT NULL DEFAULT false,
  "total" bool NOT NULL DEFAULT false,
  "notes" bool NOT NULL DEFAULT false,
  "patient_id_comment" text COLLATE "pg_catalog"."default",
  "first_name_comment" text COLLATE "pg_catalog"."default",
  "last_initial_comment" text COLLATE "pg_catalog"."default",
  "insurance_comment" text COLLATE "pg_catalog"."default",
  "copay_comment" text COLLATE "pg_catalog"."default",
  "coinsurance_comment" text COLLATE "pg_catalog"."default",
  "date_of_service_comment" text COLLATE "pg_catalog"."default",
  "cpt_code_comment" text COLLATE "pg_catalog"."default",
  "appointment_note_status_comment" text COLLATE "pg_catalog"."default",
  "claim_status_comment" text COLLATE "pg_catalog"."default",
  "most_recent_submit_date_comment" text COLLATE "pg_catalog"."default",
  "ins_pay_comment" text COLLATE "pg_catalog"."default",
  "ins_pay_date_comment" text COLLATE "pg_catalog"."default",
  "pt_res_comment" text COLLATE "pg_catalog"."default",
  "collected_from_pt_comment" text COLLATE "pg_catalog"."default",
  "pt_pay_status_comment" text COLLATE "pg_catalog"."default",
  "pt_payment_ar_ref_date_comment" text COLLATE "pg_catalog"."default",
  "total_comment" text COLLATE "pg_catalog"."default",
  "notes_comment" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "month_key" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'legacy'::text
)
;
COMMENT ON COLUMN "public"."is_lock_providers"."month_key" IS 'Matches provider sheet month key: "YYYY-M" or "YYYY-M-P" when clinic payroll=2. Value "legacy" holds pre-migration locks copied into each month on first open.';

-- ----------------------------
-- Table structure for notifications
-- ----------------------------
DROP TABLE IF EXISTS "public"."notifications";
CREATE TABLE "public"."notifications" (
  "id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "title" text COLLATE "pg_catalog"."default" NOT NULL,
  "message" text COLLATE "pg_catalog"."default" NOT NULL,
  "type" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'general'::text,
  "icon_type" text COLLATE "pg_catalog"."default",
  "is_read" bool DEFAULT false,
  "created_at" timestamptz(6) NOT NULL DEFAULT timezone('utc'::text, now()),
  "application_id" uuid,
  "message_id" uuid
)
;

-- ----------------------------
-- Table structure for patients
-- ----------------------------
DROP TABLE IF EXISTS "public"."patients";
CREATE TABLE "public"."patients" (
  "id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "patient_id" text COLLATE "pg_catalog"."default" NOT NULL,
  "first_name" text COLLATE "pg_catalog"."default",
  "last_name" text COLLATE "pg_catalog"."default",
  "date_of_birth" date,
  "phone" text COLLATE "pg_catalog"."default",
  "email" text COLLATE "pg_catalog"."default",
  "address" text COLLATE "pg_catalog"."default",
  "insurance" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "subscriber_id" text COLLATE "pg_catalog"."default",
  "copay" text COLLATE "pg_catalog"."default",
  "coinsurance" text COLLATE "pg_catalog"."default"
)
;
COMMENT ON TABLE "public"."patients" IS 'Co-patients only (shared by all providers in the clinic). Private sheet-only IDs use private_patient_claims + provider_sheet_rows.';

-- ----------------------------
-- Table structure for patients_backups
-- ----------------------------
DROP TABLE IF EXISTS "public"."patients_backups";
CREATE TABLE "public"."patients_backups" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "clinic_id" uuid NOT NULL,
  "version" int4 NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "file_path" text COLLATE "pg_catalog"."default" NOT NULL
)
;

-- ----------------------------
-- Table structure for private_patient_claims
-- ----------------------------
DROP TABLE IF EXISTS "public"."private_patient_claims";
CREATE TABLE "public"."private_patient_claims" (
  "id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "patient_id" text COLLATE "pg_catalog"."default" NOT NULL,
  "patient_id_key" text COLLATE "pg_catalog"."default" GENERATED ALWAYS AS (
lower(TRIM(BOTH FROM patient_id))
) STORED,
  "provider_id" uuid NOT NULL,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;
COMMENT ON TABLE "public"."private_patient_claims" IS 'Provider-scoped patient IDs not listed in patients; UNIQUE per clinic on normalized patient_id.';

-- ----------------------------
-- Table structure for provider_logins
-- ----------------------------
DROP TABLE IF EXISTS "public"."provider_logins";
CREATE TABLE "public"."provider_logins" (
  "id" uuid NOT NULL,
  "provider_id" uuid NOT NULL,
  "logged_at" timestamptz(6) NOT NULL DEFAULT now()
)
;
COMMENT ON TABLE "public"."provider_logins" IS 'One row per provider sign-in; used for clinic dashboard Visits count.';

-- ----------------------------
-- Table structure for provider_pay
-- ----------------------------
DROP TABLE IF EXISTS "public"."provider_pay";
CREATE TABLE "public"."provider_pay" (
  "id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "provider_id" uuid NOT NULL,
  "year" int2 NOT NULL,
  "month" int2 NOT NULL,
  "pay_date" text COLLATE "pg_catalog"."default",
  "pay_period" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "notes" text COLLATE "pg_catalog"."default",
  "payroll" int2 NOT NULL DEFAULT 1
)
;

-- ----------------------------
-- Table structure for provider_pay_backups
-- ----------------------------
DROP TABLE IF EXISTS "public"."provider_pay_backups";
CREATE TABLE "public"."provider_pay_backups" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "clinic_id" uuid NOT NULL,
  "version" int4 NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "file_path" text COLLATE "pg_catalog"."default" NOT NULL
)
;

-- ----------------------------
-- Table structure for provider_pay_rows
-- ----------------------------
DROP TABLE IF EXISTS "public"."provider_pay_rows";
CREATE TABLE "public"."provider_pay_rows" (
  "id" uuid NOT NULL,
  "provider_pay_id" uuid NOT NULL,
  "row_index" int2 NOT NULL,
  "description" text COLLATE "pg_catalog"."default",
  "amount" text COLLATE "pg_catalog"."default",
  "notes" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;

-- ----------------------------
-- Table structure for provider_schedules
-- ----------------------------
DROP TABLE IF EXISTS "public"."provider_schedules";
CREATE TABLE "public"."provider_schedules" (
  "id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "provider_id" uuid NOT NULL,
  "patient_id" text COLLATE "pg_catalog"."default",
  "patient_name" text COLLATE "pg_catalog"."default",
  "insurance" text COLLATE "pg_catalog"."default",
  "copay" numeric(10,2),
  "coinsurance" numeric(5,2),
  "date_of_service" date,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;

-- ----------------------------
-- Table structure for provider_sheet_backups
-- ----------------------------
DROP TABLE IF EXISTS "public"."provider_sheet_backups";
CREATE TABLE "public"."provider_sheet_backups" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "sheet_id" uuid NOT NULL,
  "version" int4 NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "file_path" text COLLATE "pg_catalog"."default" NOT NULL
)
;
COMMENT ON TABLE "public"."provider_sheet_backups" IS 'Versioned CSV backups of provider_sheet_rows. File stored in Supabase Storage bucket provider-sheet-backups at path {sheet_id}/v{version}.csv';

-- ----------------------------
-- Table structure for provider_sheet_rows
-- ----------------------------
DROP TABLE IF EXISTS "public"."provider_sheet_rows";
CREATE TABLE "public"."provider_sheet_rows" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "sheet_id" uuid NOT NULL,
  "sort_order" int4 NOT NULL DEFAULT 0,
  "patient_id" text COLLATE "pg_catalog"."default",
  "appointment_date" text COLLATE "pg_catalog"."default",
  "appointment_time" text COLLATE "pg_catalog"."default",
  "visit_type" text COLLATE "pg_catalog"."default",
  "notes" text COLLATE "pg_catalog"."default",
  "billing_code" text COLLATE "pg_catalog"."default",
  "billing_code_color" text COLLATE "pg_catalog"."default",
  "cpt_code" text COLLATE "pg_catalog"."default",
  "cpt_code_color" text COLLATE "pg_catalog"."default",
  "appointment_status" text COLLATE "pg_catalog"."default",
  "appointment_status_color" text COLLATE "pg_catalog"."default",
  "claim_status" text COLLATE "pg_catalog"."default",
  "claim_status_color" text COLLATE "pg_catalog"."default",
  "submit_date" text COLLATE "pg_catalog"."default",
  "insurance_payment" text COLLATE "pg_catalog"."default",
  "insurance_adjustment" text COLLATE "pg_catalog"."default",
  "invoice_amount" numeric(10,2),
  "collected_from_patient" text COLLATE "pg_catalog"."default",
  "patient_pay_status" text COLLATE "pg_catalog"."default",
  "patient_pay_status_color" text COLLATE "pg_catalog"."default",
  "payment_date" text COLLATE "pg_catalog"."default",
  "payment_date_color" text COLLATE "pg_catalog"."default",
  "ar_type" text COLLATE "pg_catalog"."default",
  "ar_amount" numeric(10,2),
  "ar_date" text COLLATE "pg_catalog"."default",
  "ar_date_color" text COLLATE "pg_catalog"."default",
  "ar_notes" text COLLATE "pg_catalog"."default",
  "provider_payment_amount" numeric(10,2),
  "provider_payment_date" text COLLATE "pg_catalog"."default",
  "provider_payment_notes" text COLLATE "pg_catalog"."default",
  "highlight_color" text COLLATE "pg_catalog"."default",
  "total" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;

-- ----------------------------
-- Table structure for provider_sheets
-- ----------------------------
DROP TABLE IF EXISTS "public"."provider_sheets";
CREATE TABLE "public"."provider_sheets" (
  "id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "provider_id" uuid NOT NULL,
  "month" int4 NOT NULL,
  "year" int4 NOT NULL,
  "locked" bool DEFAULT false,
  "locked_columns" text[] COLLATE "pg_catalog"."default" DEFAULT '{}'::text[],
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "payroll" int2 NOT NULL DEFAULT 1
)
;

-- ----------------------------
-- Table structure for providers
-- ----------------------------
DROP TABLE IF EXISTS "public"."providers";
CREATE TABLE "public"."providers" (
  "id" uuid NOT NULL,
  "first_name" text COLLATE "pg_catalog"."default" NOT NULL,
  "last_name" text COLLATE "pg_catalog"."default" NOT NULL,
  "specialty" text COLLATE "pg_catalog"."default",
  "npi" text COLLATE "pg_catalog"."default",
  "email" text COLLATE "pg_catalog"."default",
  "phone" text COLLATE "pg_catalog"."default",
  "active" bool NOT NULL DEFAULT true,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "clinic_ids" uuid[] NOT NULL DEFAULT '{}'::uuid[],
  "level" int2 NOT NULL DEFAULT 1,
  "provider_cut_percent" numeric DEFAULT 0.7,
  "show_visit_type_column" bool NOT NULL DEFAULT false
)
;
COMMENT ON COLUMN "public"."providers"."level" IS 'Provider access level: 1 or 2 (default 1). Set by super admin in User Management.';
COMMENT ON COLUMN "public"."providers"."provider_cut_percent" IS 'Provider cut percent 0–1 (default 0.7). Provider Cut = Total Payments × this. Set in Super Admin Settings.';
COMMENT ON COLUMN "public"."providers"."show_visit_type_column" IS 'When true, provider sheet shows Visit Type column (In-person / Telehealth). Toggled in User Management.';

-- ----------------------------
-- Table structure for server_refresh_tokens
-- ----------------------------
DROP TABLE IF EXISTS "public"."server_refresh_tokens";
CREATE TABLE "public"."server_refresh_tokens" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "token_hash" text COLLATE "pg_catalog"."default" NOT NULL,
  "expires_at" timestamptz(6) NOT NULL,
  "revoked_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
)
;

-- ----------------------------
-- Table structure for status_colors
-- ----------------------------
DROP TABLE IF EXISTS "public"."status_colors";
CREATE TABLE "public"."status_colors" (
  "id" uuid NOT NULL,
  "status" text COLLATE "pg_catalog"."default" NOT NULL,
  "color" text COLLATE "pg_catalog"."default" NOT NULL,
  "type" text COLLATE "pg_catalog"."default" NOT NULL,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "text_color" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT '#000000'::text
)
;

-- ----------------------------
-- Table structure for timecards
-- ----------------------------
DROP TABLE IF EXISTS "public"."timecards";
CREATE TABLE "public"."timecards" (
  "id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "clinic_id" uuid,
  "clock_in" timestamptz(6) NOT NULL,
  "clock_out" timestamptz(6),
  "hours" numeric(10,2),
  "amount_paid" numeric(10,2),
  "payment_date" date,
  "week_start_date" date NOT NULL,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "hourly_pay" numeric(10,2),
  "is_locked" bool NOT NULL DEFAULT false,
  "notes" text COLLATE "pg_catalog"."default"
)
;
COMMENT ON COLUMN "public"."timecards"."is_locked" IS 'When true, super admin has locked this row; edit/delete are disabled in UI until unlocked.';

-- ----------------------------
-- Table structure for todo_lists
-- ----------------------------
DROP TABLE IF EXISTS "public"."todo_lists";
CREATE TABLE "public"."todo_lists" (
  "id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "issue" text COLLATE "pg_catalog"."default",
  "status" text COLLATE "pg_catalog"."default" NOT NULL DEFAULT 'Open'::text,
  "notes" text COLLATE "pg_catalog"."default",
  "followup_notes" text COLLATE "pg_catalog"."default",
  "created_by" uuid NOT NULL,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "completed_at" timestamptz(6)
)
;

-- ----------------------------
-- Table structure for users
-- ----------------------------
DROP TABLE IF EXISTS "public"."users";
CREATE TABLE "public"."users" (
  "id" uuid NOT NULL,
  "email" text COLLATE "pg_catalog"."default" NOT NULL,
  "full_name" text COLLATE "pg_catalog"."default",
  "role" text COLLATE "pg_catalog"."default" NOT NULL,
  "clinic_ids" uuid[] DEFAULT '{}'::uuid[],
  "highlight_color" text COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "hourly_pay" numeric(10,2),
  "active" bool NOT NULL DEFAULT true,
  "password" varchar(255) COLLATE "pg_catalog"."default"
)
;

-- ----------------------------
-- Function structure for auto_confirm_user_email
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."auto_confirm_user_email"("user_id" uuid);
CREATE FUNCTION "public"."auto_confirm_user_email"("user_id" uuid)
  RETURNS "pg_catalog"."void" AS $BODY$
BEGIN
  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, NOW())
  WHERE id = user_id AND email_confirmed_at IS NULL;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  COST 100;

-- ----------------------------
-- Function structure for create_audit_log
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."create_audit_log"();
CREATE FUNCTION "public"."create_audit_log"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
DECLARE
  audit_clinic_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'providers' THEN
    IF TG_OP = 'INSERT' THEN audit_clinic_id := (NEW.clinic_ids)[1];
    ELSIF TG_OP = 'UPDATE' THEN audit_clinic_id := (NEW.clinic_ids)[1];
    ELSIF TG_OP = 'DELETE' THEN audit_clinic_id := (OLD.clinic_ids)[1];
    END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN audit_clinic_id := NEW.clinic_id;
    ELSIF TG_OP = 'UPDATE' THEN audit_clinic_id := NEW.clinic_id;
    ELSIF TG_OP = 'DELETE' THEN audit_clinic_id := OLD.clinic_id;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (user_id, clinic_id, action, table_name, record_id, new_values)
    VALUES (auth.uid(), audit_clinic_id, 'INSERT', TG_TABLE_NAME, NEW.id, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (user_id, clinic_id, action, table_name, record_id, old_values, new_values)
    VALUES (auth.uid(), audit_clinic_id, 'UPDATE', TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (user_id, clinic_id, action, table_name, record_id, old_values)
    VALUES (auth.uid(), audit_clinic_id, 'DELETE', TG_TABLE_NAME, OLD.id, to_jsonb(OLD));
    RETURN OLD;
  END IF;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  COST 100;

-- ----------------------------
-- Function structure for create_super_admin_profile
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."create_super_admin_profile"("user_id" uuid, "user_email" text, "user_full_name" text);
CREATE FUNCTION "public"."create_super_admin_profile"("user_id" uuid, "user_email" text, "user_full_name" text='Super Admin'::text)
  RETURNS "pg_catalog"."void" AS $BODY$
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
$BODY$
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  COST 100;

-- ----------------------------
-- Function structure for current_user_clinic_ids
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."current_user_clinic_ids"();
CREATE FUNCTION "public"."current_user_clinic_ids"()
  RETURNS "pg_catalog"."_uuid" AS $BODY$
  SELECT COALESCE(clinic_ids, '{}') FROM users WHERE id = auth.uid() LIMIT 1;
$BODY$
  LANGUAGE sql STABLE SECURITY DEFINER
  COST 100;

-- ----------------------------
-- Function structure for current_user_is_admin_or_super
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."current_user_is_admin_or_super"();
CREATE FUNCTION "public"."current_user_is_admin_or_super"()
  RETURNS "pg_catalog"."bool" AS $BODY$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  );
$BODY$
  LANGUAGE sql STABLE SECURITY DEFINER
  COST 100;

-- ----------------------------
-- Function structure for current_user_provider_id
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."current_user_provider_id"();
CREATE FUNCTION "public"."current_user_provider_id"()
  RETURNS "pg_catalog"."uuid" AS $BODY$
  SELECT p.id FROM public.providers p
  JOIN auth.users u ON u.email = p.email
  WHERE u.id = auth.uid()
  LIMIT 1
$BODY$
  LANGUAGE sql STABLE SECURITY DEFINER
  COST 100
  SET "search_path"="public";
COMMENT ON FUNCTION "public"."current_user_provider_id"() IS 'Returns the provider id for the current auth user (by email). Used by provider_schedules RLS so policies do not read public.users.';

-- ----------------------------
-- Function structure for ensure_provider_for_provider_user
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."ensure_provider_for_provider_user"();
CREATE FUNCTION "public"."ensure_provider_for_provider_user"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
DECLARE
  p_id UUID;
  fname TEXT;
  lname TEXT;
BEGIN
  IF NEW.role <> 'provider' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO p_id
  FROM public.providers
  WHERE email = NEW.email
  LIMIT 1;

  IF p_id IS NULL THEN
    fname := COALESCE(TRIM(SPLIT_PART(COALESCE(NEW.full_name, '') || ' ', ' ', 1)), 'User');
    lname := COALESCE(NULLIF(TRIM(SUBSTRING(COALESCE(NEW.full_name, '') FROM POSITION(' ' IN COALESCE(NEW.full_name, '') || ' ') + 1)), ''), '-');
    INSERT INTO public.providers (email, first_name, last_name, clinic_ids)
    VALUES (NEW.email, fname, lname, ARRAY[]::UUID[]);
  END IF;

  RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  COST 100;

-- ----------------------------
-- Function structure for handle_new_user
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."handle_new_user"();
CREATE FUNCTION "public"."handle_new_user"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
DECLARE
  user_role TEXT;
  user_full_name TEXT;
BEGIN
  -- Get role and full_name from user metadata (raw_user_meta_data)
  user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'provider');
  user_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  
  -- Auto-confirm email (using SECURITY DEFINER to bypass RLS)
  PERFORM public.auto_confirm_user_email(NEW.id);
  
  -- Create user profile in public.users
  INSERT INTO public.users (id, email, full_name, role, clinic_ids)
  VALUES (
    NEW.id,
    NEW.email,
    user_full_name,
    user_role,
    ARRAY[]::UUID[]
  )
  ON CONFLICT (id) DO UPDATE SET
    email = NEW.email,
    full_name = COALESCE(user_full_name, users.full_name),
    role = COALESCE(user_role, users.role);
  
  RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  COST 100;

-- ----------------------------
-- Function structure for is_super_admin
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."is_super_admin"();
CREATE FUNCTION "public"."is_super_admin"()
  RETURNS "pg_catalog"."bool" AS $BODY$
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
$BODY$
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  COST 100;

-- ----------------------------
-- Function structure for record_provider_login
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."record_provider_login"();
CREATE FUNCTION "public"."record_provider_login"()
  RETURNS "pg_catalog"."void" AS $BODY$
DECLARE
  pid UUID;
BEGIN
  pid := current_user_provider_id();
  IF pid IS NOT NULL THEN
    INSERT INTO provider_logins (provider_id, logged_at)
    VALUES (pid, NOW());
  END IF;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  COST 100
  SET "search_path"="public";
COMMENT ON FUNCTION "public"."record_provider_login"() IS 'Inserts one row into provider_logins for the current auth user if they are linked to a provider (by email). Call on sign-in.';

-- ----------------------------
-- Function structure for update_cell_comments_updated_at
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."update_cell_comments_updated_at"();
CREATE FUNCTION "public"."update_cell_comments_updated_at"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

-- ----------------------------
-- Function structure for update_column_locks_updated_at
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."update_column_locks_updated_at"();
CREATE FUNCTION "public"."update_column_locks_updated_at"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

-- ----------------------------
-- Function structure for update_is_lock_accounts_receivable_updated_at
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."update_is_lock_accounts_receivable_updated_at"();
CREATE FUNCTION "public"."update_is_lock_accounts_receivable_updated_at"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

-- ----------------------------
-- Function structure for update_is_lock_billing_todo_updated_at
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."update_is_lock_billing_todo_updated_at"();
CREATE FUNCTION "public"."update_is_lock_billing_todo_updated_at"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

-- ----------------------------
-- Function structure for update_is_lock_patients_updated_at
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."update_is_lock_patients_updated_at"();
CREATE FUNCTION "public"."update_is_lock_patients_updated_at"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

-- ----------------------------
-- Function structure for update_is_lock_providers_updated_at
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."update_is_lock_providers_updated_at"();
CREATE FUNCTION "public"."update_is_lock_providers_updated_at"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

-- ----------------------------
-- Function structure for update_private_patient_claims_updated_at
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."update_private_patient_claims_updated_at"();
CREATE FUNCTION "public"."update_private_patient_claims_updated_at"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

-- ----------------------------
-- Function structure for update_provider_schedules_updated_at
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."update_provider_schedules_updated_at"();
CREATE FUNCTION "public"."update_provider_schedules_updated_at"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

-- ----------------------------
-- Function structure for update_provider_sheet_rows_updated_at
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."update_provider_sheet_rows_updated_at"();
CREATE FUNCTION "public"."update_provider_sheet_rows_updated_at"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

-- ----------------------------
-- Function structure for update_updated_at_column
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."update_updated_at_column"();
CREATE FUNCTION "public"."update_updated_at_column"()
  RETURNS "pg_catalog"."trigger" AS $BODY$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

-- ----------------------------
-- Function structure for user_exists
-- ----------------------------
DROP FUNCTION IF EXISTS "public"."user_exists"("user_id" uuid);
CREATE FUNCTION "public"."user_exists"("user_id" uuid)
  RETURNS "pg_catalog"."bool" AS $BODY$
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
$BODY$
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  COST 100;

-- ----------------------------
-- Indexes structure for table accounts_receivables
-- ----------------------------
CREATE INDEX "idx_accounts_receivables_clinic_id" ON "public"."accounts_receivables" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_accounts_receivables_date_recorded" ON "public"."accounts_receivables" USING btree (
  "date_recorded" "pg_catalog"."date_ops" ASC NULLS LAST
);
CREATE INDEX "idx_accounts_receivables_payroll" ON "public"."accounts_receivables" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "payroll" "pg_catalog"."int2_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table accounts_receivables
-- ----------------------------
ALTER TABLE "public"."accounts_receivables" ADD CONSTRAINT "accounts_receivables_clinic_id_ar_id_key" UNIQUE ("clinic_id", "ar_id");

-- ----------------------------
-- Checks structure for table accounts_receivables
-- ----------------------------
ALTER TABLE "public"."accounts_receivables" ADD CONSTRAINT "accounts_receivables_payroll_check" CHECK (payroll = ANY (ARRAY[1, 2]));
ALTER TABLE "public"."accounts_receivables" ADD CONSTRAINT "accounts_receivables_type_check" CHECK (type = ANY (ARRAY['Patient'::text, 'Insurance'::text, 'Admin'::text]));

-- ----------------------------
-- Primary Key structure for table accounts_receivables
-- ----------------------------
ALTER TABLE "public"."accounts_receivables" ADD CONSTRAINT "accounts_receivables_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table ar_backups
-- ----------------------------
CREATE INDEX "idx_ar_backups_clinic_id" ON "public"."ar_backups" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ar_backups_created_at" ON "public"."ar_backups" USING btree (
  "created_at" "pg_catalog"."timestamptz_ops" DESC NULLS FIRST
);

-- ----------------------------
-- Uniques structure for table ar_backups
-- ----------------------------
ALTER TABLE "public"."ar_backups" ADD CONSTRAINT "ar_backups_clinic_id_version_key" UNIQUE ("clinic_id", "version");

-- ----------------------------
-- Primary Key structure for table ar_backups
-- ----------------------------
ALTER TABLE "public"."ar_backups" ADD CONSTRAINT "ar_backups_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table audit_logs
-- ----------------------------
CREATE INDEX "idx_audit_logs_clinic_id" ON "public"."audit_logs" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING btree (
  "created_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_audit_logs_user_id" ON "public"."audit_logs" USING btree (
  "user_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Primary Key structure for table audit_logs
-- ----------------------------
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Triggers structure for table billing_codes
-- ----------------------------
CREATE TRIGGER "update_billing_codes_updated_at" BEFORE UPDATE ON "public"."billing_codes"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_updated_at_column"();

-- ----------------------------
-- Uniques structure for table billing_codes
-- ----------------------------
ALTER TABLE "public"."billing_codes" ADD CONSTRAINT "billing_codes_code_key" UNIQUE ("code");

-- ----------------------------
-- Primary Key structure for table billing_codes
-- ----------------------------
ALTER TABLE "public"."billing_codes" ADD CONSTRAINT "billing_codes_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table cell_comments
-- ----------------------------
CREATE INDEX "idx_cell_comments_lookup" ON "public"."cell_comments" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "sheet_type" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table cell_comments
-- ----------------------------
CREATE TRIGGER "trigger_cell_comments_updated_at" BEFORE UPDATE ON "public"."cell_comments"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_cell_comments_updated_at"();

-- ----------------------------
-- Uniques structure for table cell_comments
-- ----------------------------
ALTER TABLE "public"."cell_comments" ADD CONSTRAINT "cell_comments_clinic_id_sheet_type_row_id_column_key_key" UNIQUE ("clinic_id", "sheet_type", "row_id", "column_key");

-- ----------------------------
-- Primary Key structure for table cell_comments
-- ----------------------------
ALTER TABLE "public"."cell_comments" ADD CONSTRAINT "cell_comments_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table cell_highlights
-- ----------------------------
CREATE INDEX "idx_cell_highlights_lookup" ON "public"."cell_highlights" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "sheet_type" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_cell_highlights_user_id" ON "public"."cell_highlights" USING btree (
  "user_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table cell_highlights
-- ----------------------------
ALTER TABLE "public"."cell_highlights" ADD CONSTRAINT "cell_highlights_clinic_id_sheet_type_row_id_column_key_key" UNIQUE ("clinic_id", "sheet_type", "row_id", "column_key");

-- ----------------------------
-- Primary Key structure for table cell_highlights
-- ----------------------------
ALTER TABLE "public"."cell_highlights" ADD CONSTRAINT "cell_highlights_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table clinic_addresses
-- ----------------------------
CREATE INDEX "idx_clinic_addresses_clinic_id" ON "public"."clinic_addresses" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table clinic_addresses
-- ----------------------------
ALTER TABLE "public"."clinic_addresses" ADD CONSTRAINT "clinic_addresses_clinic_id_line_index_key" UNIQUE ("clinic_id", "line_index");

-- ----------------------------
-- Checks structure for table clinic_addresses
-- ----------------------------
ALTER TABLE "public"."clinic_addresses" ADD CONSTRAINT "clinic_addresses_line_index_check" CHECK (line_index >= 1 AND line_index <= 6);

-- ----------------------------
-- Primary Key structure for table clinic_addresses
-- ----------------------------
ALTER TABLE "public"."clinic_addresses" ADD CONSTRAINT "clinic_addresses_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table clinic_invoice_notes
-- ----------------------------
CREATE INDEX "idx_clinic_invoice_notes_lookup" ON "public"."clinic_invoice_notes" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "year" "pg_catalog"."int2_ops" ASC NULLS LAST,
  "month" "pg_catalog"."int2_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table clinic_invoice_notes
-- ----------------------------
ALTER TABLE "public"."clinic_invoice_notes" ADD CONSTRAINT "clinic_invoice_notes_clinic_id_month_year_key" UNIQUE ("clinic_id", "month", "year");

-- ----------------------------
-- Checks structure for table clinic_invoice_notes
-- ----------------------------
ALTER TABLE "public"."clinic_invoice_notes" ADD CONSTRAINT "clinic_invoice_notes_month_check" CHECK (month >= 1 AND month <= 12);

-- ----------------------------
-- Primary Key structure for table clinic_invoice_notes
-- ----------------------------
ALTER TABLE "public"."clinic_invoice_notes" ADD CONSTRAINT "clinic_invoice_notes_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Triggers structure for table clinics
-- ----------------------------
CREATE TRIGGER "update_clinics_updated_at" BEFORE UPDATE ON "public"."clinics"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_updated_at_column"();

-- ----------------------------
-- Checks structure for table clinics
-- ----------------------------
ALTER TABLE "public"."clinics" ADD CONSTRAINT "clinics_payroll_check" CHECK (payroll = ANY (ARRAY[1, 2]));

-- ----------------------------
-- Primary Key structure for table clinics
-- ----------------------------
ALTER TABLE "public"."clinics" ADD CONSTRAINT "clinics_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table column_locks
-- ----------------------------
CREATE INDEX "idx_column_locks_clinic" ON "public"."column_locks" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_column_locks_column_name" ON "public"."column_locks" USING btree (
  "column_name" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_column_locks_provider" ON "public"."column_locks" USING btree (
  "provider_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table column_locks
-- ----------------------------
CREATE TRIGGER "trigger_column_locks_updated_at" BEFORE UPDATE ON "public"."column_locks"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_column_locks_updated_at"();

-- ----------------------------
-- Uniques structure for table column_locks
-- ----------------------------
ALTER TABLE "public"."column_locks" ADD CONSTRAINT "column_locks_clinic_id_provider_id_column_name_key" UNIQUE ("clinic_id", "provider_id", "column_name");

-- ----------------------------
-- Primary Key structure for table column_locks
-- ----------------------------
ALTER TABLE "public"."column_locks" ADD CONSTRAINT "column_locks_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Primary Key structure for table invite_tokens
-- ----------------------------
ALTER TABLE "public"."invite_tokens" ADD CONSTRAINT "invite_tokens_pkey" PRIMARY KEY ("token");

-- ----------------------------
-- Indexes structure for table is_lock_accounts_receivable
-- ----------------------------
CREATE INDEX "idx_is_lock_accounts_receivable_clinic" ON "public"."is_lock_accounts_receivable" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE UNIQUE INDEX "is_lock_accounts_receivable_clinic_id_month_key_key" ON "public"."is_lock_accounts_receivable" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "month_key" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table is_lock_accounts_receivable
-- ----------------------------
CREATE TRIGGER "trigger_is_lock_accounts_receivable_updated_at" BEFORE UPDATE ON "public"."is_lock_accounts_receivable"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_is_lock_accounts_receivable_updated_at"();

-- ----------------------------
-- Primary Key structure for table is_lock_accounts_receivable
-- ----------------------------
ALTER TABLE "public"."is_lock_accounts_receivable" ADD CONSTRAINT "is_lock_accounts_receivable_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table is_lock_billing_todo
-- ----------------------------
CREATE INDEX "idx_is_lock_billing_todo_clinic" ON "public"."is_lock_billing_todo" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table is_lock_billing_todo
-- ----------------------------
CREATE TRIGGER "trigger_is_lock_billing_todo_updated_at" BEFORE UPDATE ON "public"."is_lock_billing_todo"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_is_lock_billing_todo_updated_at"();

-- ----------------------------
-- Uniques structure for table is_lock_billing_todo
-- ----------------------------
ALTER TABLE "public"."is_lock_billing_todo" ADD CONSTRAINT "is_lock_billing_todo_clinic_id_key" UNIQUE ("clinic_id");

-- ----------------------------
-- Primary Key structure for table is_lock_billing_todo
-- ----------------------------
ALTER TABLE "public"."is_lock_billing_todo" ADD CONSTRAINT "is_lock_billing_todo_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table is_lock_patients
-- ----------------------------
CREATE INDEX "idx_is_lock_patients_clinic" ON "public"."is_lock_patients" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table is_lock_patients
-- ----------------------------
CREATE TRIGGER "trigger_is_lock_patients_updated_at" BEFORE UPDATE ON "public"."is_lock_patients"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_is_lock_patients_updated_at"();

-- ----------------------------
-- Uniques structure for table is_lock_patients
-- ----------------------------
ALTER TABLE "public"."is_lock_patients" ADD CONSTRAINT "is_lock_patients_clinic_id_key" UNIQUE ("clinic_id");

-- ----------------------------
-- Primary Key structure for table is_lock_patients
-- ----------------------------
ALTER TABLE "public"."is_lock_patients" ADD CONSTRAINT "is_lock_patients_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table is_lock_providers
-- ----------------------------
CREATE INDEX "idx_is_lock_providers_clinic" ON "public"."is_lock_providers" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE UNIQUE INDEX "is_lock_providers_clinic_id_month_key_key" ON "public"."is_lock_providers" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "month_key" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table is_lock_providers
-- ----------------------------
CREATE TRIGGER "trigger_is_lock_providers_updated_at" BEFORE UPDATE ON "public"."is_lock_providers"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_is_lock_providers_updated_at"();

-- ----------------------------
-- Primary Key structure for table is_lock_providers
-- ----------------------------
ALTER TABLE "public"."is_lock_providers" ADD CONSTRAINT "is_lock_providers_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table notifications
-- ----------------------------
CREATE INDEX "idx_notifications_created" ON "public"."notifications" USING btree (
  "created_at" "pg_catalog"."timestamptz_ops" DESC NULLS FIRST
);
CREATE INDEX "idx_notifications_read" ON "public"."notifications" USING btree (
  "is_read" "pg_catalog"."bool_ops" ASC NULLS LAST
);
CREATE INDEX "idx_notifications_user" ON "public"."notifications" USING btree (
  "user_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Checks structure for table notifications
-- ----------------------------
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_icon_type_check" CHECK (icon_type = ANY (ARRAY['exclamation'::text, 'document'::text, 'bell'::text, 'check'::text, 'warning'::text]));
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_type_check" CHECK (type = ANY (ARRAY['license_expiring'::text, 'license_expired'::text, 'application_update'::text, 'document_approved'::text, 'document_rejected'::text, 'staff_certification_expiring'::text, 'general'::text]));

-- ----------------------------
-- Primary Key structure for table notifications
-- ----------------------------
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table patients
-- ----------------------------
CREATE INDEX "idx_patients_clinic_id" ON "public"."patients" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_patients_patient_id" ON "public"."patients" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "patient_id" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table patients
-- ----------------------------
CREATE TRIGGER "update_patients_updated_at" BEFORE UPDATE ON "public"."patients"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_updated_at_column"();

-- ----------------------------
-- Uniques structure for table patients
-- ----------------------------
ALTER TABLE "public"."patients" ADD CONSTRAINT "patients_clinic_id_patient_id_key" UNIQUE ("clinic_id", "patient_id");

-- ----------------------------
-- Primary Key structure for table patients
-- ----------------------------
ALTER TABLE "public"."patients" ADD CONSTRAINT "patients_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table patients_backups
-- ----------------------------
CREATE INDEX "idx_patients_backups_clinic_id" ON "public"."patients_backups" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_patients_backups_created_at" ON "public"."patients_backups" USING btree (
  "created_at" "pg_catalog"."timestamptz_ops" DESC NULLS FIRST
);

-- ----------------------------
-- Uniques structure for table patients_backups
-- ----------------------------
ALTER TABLE "public"."patients_backups" ADD CONSTRAINT "patients_backups_clinic_id_version_key" UNIQUE ("clinic_id", "version");

-- ----------------------------
-- Primary Key structure for table patients_backups
-- ----------------------------
ALTER TABLE "public"."patients_backups" ADD CONSTRAINT "patients_backups_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table private_patient_claims
-- ----------------------------
CREATE INDEX "idx_private_patient_claims_clinic_id" ON "public"."private_patient_claims" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_private_patient_claims_provider_id" ON "public"."private_patient_claims" USING btree (
  "provider_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table private_patient_claims
-- ----------------------------
CREATE TRIGGER "trigger_private_patient_claims_updated_at" BEFORE UPDATE ON "public"."private_patient_claims"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_private_patient_claims_updated_at"();

-- ----------------------------
-- Uniques structure for table private_patient_claims
-- ----------------------------
ALTER TABLE "public"."private_patient_claims" ADD CONSTRAINT "private_patient_claims_clinic_id_patient_id_key_key" UNIQUE ("clinic_id", "patient_id_key");

-- ----------------------------
-- Primary Key structure for table private_patient_claims
-- ----------------------------
ALTER TABLE "public"."private_patient_claims" ADD CONSTRAINT "private_patient_claims_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table provider_logins
-- ----------------------------
CREATE INDEX "idx_provider_logins_logged_at" ON "public"."provider_logins" USING btree (
  "logged_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
);
CREATE INDEX "idx_provider_logins_provider_id" ON "public"."provider_logins" USING btree (
  "provider_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Primary Key structure for table provider_logins
-- ----------------------------
ALTER TABLE "public"."provider_logins" ADD CONSTRAINT "provider_logins_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table provider_pay
-- ----------------------------
CREATE INDEX "idx_provider_pay_clinic_provider_year_month" ON "public"."provider_pay" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "provider_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "year" "pg_catalog"."int2_ops" ASC NULLS LAST,
  "month" "pg_catalog"."int2_ops" ASC NULLS LAST
);
CREATE INDEX "idx_provider_pay_payroll" ON "public"."provider_pay" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "provider_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "year" "pg_catalog"."int2_ops" ASC NULLS LAST,
  "month" "pg_catalog"."int2_ops" ASC NULLS LAST,
  "payroll" "pg_catalog"."int2_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table provider_pay
-- ----------------------------
ALTER TABLE "public"."provider_pay" ADD CONSTRAINT "provider_pay_clinic_provider_year_month_payroll_key" UNIQUE ("clinic_id", "provider_id", "year", "month", "payroll");

-- ----------------------------
-- Checks structure for table provider_pay
-- ----------------------------
ALTER TABLE "public"."provider_pay" ADD CONSTRAINT "provider_pay_month_check" CHECK (month >= 1 AND month <= 12);
ALTER TABLE "public"."provider_pay" ADD CONSTRAINT "provider_pay_payroll_check" CHECK (payroll = ANY (ARRAY[1, 2]));

-- ----------------------------
-- Primary Key structure for table provider_pay
-- ----------------------------
ALTER TABLE "public"."provider_pay" ADD CONSTRAINT "provider_pay_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table provider_pay_backups
-- ----------------------------
CREATE INDEX "idx_provider_pay_backups_clinic_id" ON "public"."provider_pay_backups" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_provider_pay_backups_created_at" ON "public"."provider_pay_backups" USING btree (
  "created_at" "pg_catalog"."timestamptz_ops" DESC NULLS FIRST
);

-- ----------------------------
-- Uniques structure for table provider_pay_backups
-- ----------------------------
ALTER TABLE "public"."provider_pay_backups" ADD CONSTRAINT "provider_pay_backups_clinic_id_version_key" UNIQUE ("clinic_id", "version");

-- ----------------------------
-- Primary Key structure for table provider_pay_backups
-- ----------------------------
ALTER TABLE "public"."provider_pay_backups" ADD CONSTRAINT "provider_pay_backups_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table provider_pay_rows
-- ----------------------------
CREATE INDEX "idx_provider_pay_rows_provider_pay_id" ON "public"."provider_pay_rows" USING btree (
  "provider_pay_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table provider_pay_rows
-- ----------------------------
ALTER TABLE "public"."provider_pay_rows" ADD CONSTRAINT "provider_pay_rows_provider_pay_id_row_index_key" UNIQUE ("provider_pay_id", "row_index");

-- ----------------------------
-- Primary Key structure for table provider_pay_rows
-- ----------------------------
ALTER TABLE "public"."provider_pay_rows" ADD CONSTRAINT "provider_pay_rows_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table provider_schedules
-- ----------------------------
CREATE INDEX "idx_provider_schedules_clinic_provider" ON "public"."provider_schedules" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "provider_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_provider_schedules_date" ON "public"."provider_schedules" USING btree (
  "date_of_service" "pg_catalog"."date_ops" ASC NULLS LAST
);
CREATE INDEX "idx_provider_schedules_provider_id" ON "public"."provider_schedules" USING btree (
  "provider_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table provider_schedules
-- ----------------------------
CREATE TRIGGER "provider_schedules_updated_at" BEFORE UPDATE ON "public"."provider_schedules"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_provider_schedules_updated_at"();

-- ----------------------------
-- Primary Key structure for table provider_schedules
-- ----------------------------
ALTER TABLE "public"."provider_schedules" ADD CONSTRAINT "provider_schedules_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table provider_sheet_backups
-- ----------------------------
CREATE INDEX "idx_provider_sheet_backups_created_at" ON "public"."provider_sheet_backups" USING btree (
  "created_at" "pg_catalog"."timestamptz_ops" DESC NULLS FIRST
);
CREATE INDEX "idx_provider_sheet_backups_sheet_id" ON "public"."provider_sheet_backups" USING btree (
  "sheet_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table provider_sheet_backups
-- ----------------------------
ALTER TABLE "public"."provider_sheet_backups" ADD CONSTRAINT "provider_sheet_backups_sheet_id_version_key" UNIQUE ("sheet_id", "version");

-- ----------------------------
-- Primary Key structure for table provider_sheet_backups
-- ----------------------------
ALTER TABLE "public"."provider_sheet_backups" ADD CONSTRAINT "provider_sheet_backups_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table provider_sheet_rows
-- ----------------------------
CREATE INDEX "idx_provider_sheet_rows_sheet_id" ON "public"."provider_sheet_rows" USING btree (
  "sheet_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_provider_sheet_rows_sheet_sort" ON "public"."provider_sheet_rows" USING btree (
  "sheet_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "sort_order" "pg_catalog"."int4_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table provider_sheet_rows
-- ----------------------------
CREATE TRIGGER "update_provider_sheet_rows_updated_at" BEFORE UPDATE ON "public"."provider_sheet_rows"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_provider_sheet_rows_updated_at"();

-- ----------------------------
-- Primary Key structure for table provider_sheet_rows
-- ----------------------------
ALTER TABLE "public"."provider_sheet_rows" ADD CONSTRAINT "provider_sheet_rows_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table provider_sheets
-- ----------------------------
CREATE INDEX "idx_provider_sheets_clinic_provider" ON "public"."provider_sheets" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "provider_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_provider_sheets_month_year" ON "public"."provider_sheets" USING btree (
  "year" "pg_catalog"."int4_ops" ASC NULLS LAST,
  "month" "pg_catalog"."int4_ops" ASC NULLS LAST
);
CREATE INDEX "idx_provider_sheets_payroll" ON "public"."provider_sheets" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "provider_id" "pg_catalog"."uuid_ops" ASC NULLS LAST,
  "year" "pg_catalog"."int4_ops" ASC NULLS LAST,
  "month" "pg_catalog"."int4_ops" ASC NULLS LAST,
  "payroll" "pg_catalog"."int2_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table provider_sheets
-- ----------------------------
CREATE TRIGGER "update_provider_sheets_updated_at" BEFORE UPDATE ON "public"."provider_sheets"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_updated_at_column"();

-- ----------------------------
-- Uniques structure for table provider_sheets
-- ----------------------------
ALTER TABLE "public"."provider_sheets" ADD CONSTRAINT "provider_sheets_clinic_provider_month_year_payroll_key" UNIQUE ("clinic_id", "provider_id", "month", "year", "payroll");

-- ----------------------------
-- Checks structure for table provider_sheets
-- ----------------------------
ALTER TABLE "public"."provider_sheets" ADD CONSTRAINT "provider_sheets_month_check" CHECK (month >= 1 AND month <= 12);
ALTER TABLE "public"."provider_sheets" ADD CONSTRAINT "provider_sheets_payroll_check" CHECK (payroll = ANY (ARRAY[1, 2]));

-- ----------------------------
-- Primary Key structure for table provider_sheets
-- ----------------------------
ALTER TABLE "public"."provider_sheets" ADD CONSTRAINT "provider_sheets_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table providers
-- ----------------------------
CREATE INDEX "idx_providers_active" ON "public"."providers" USING btree (
  "active" "pg_catalog"."bool_ops" ASC NULLS LAST
);
CREATE INDEX "idx_providers_clinic_ids" ON "public"."providers" USING gin (
  "clinic_ids" "pg_catalog"."array_ops"
);

-- ----------------------------
-- Triggers structure for table providers
-- ----------------------------
CREATE TRIGGER "update_providers_updated_at" BEFORE UPDATE ON "public"."providers"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_updated_at_column"();

-- ----------------------------
-- Checks structure for table providers
-- ----------------------------
ALTER TABLE "public"."providers" ADD CONSTRAINT "providers_level_check" CHECK (level = ANY (ARRAY[1, 2]));

-- ----------------------------
-- Primary Key structure for table providers
-- ----------------------------
ALTER TABLE "public"."providers" ADD CONSTRAINT "providers_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table server_refresh_tokens
-- ----------------------------
CREATE INDEX "idx_server_refresh_tokens_expires_at" ON "public"."server_refresh_tokens" USING btree (
  "expires_at" "pg_catalog"."timestamptz_ops" ASC NULLS LAST
) WHERE revoked_at IS NULL;
CREATE INDEX "idx_server_refresh_tokens_user_id" ON "public"."server_refresh_tokens" USING btree (
  "user_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table server_refresh_tokens
-- ----------------------------
ALTER TABLE "public"."server_refresh_tokens" ADD CONSTRAINT "server_refresh_tokens_token_hash_key" UNIQUE ("token_hash");

-- ----------------------------
-- Primary Key structure for table server_refresh_tokens
-- ----------------------------
ALTER TABLE "public"."server_refresh_tokens" ADD CONSTRAINT "server_refresh_tokens_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table status_colors
-- ----------------------------
CREATE INDEX "idx_status_colors_type" ON "public"."status_colors" USING btree (
  "type" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Uniques structure for table status_colors
-- ----------------------------
ALTER TABLE "public"."status_colors" ADD CONSTRAINT "status_colors_status_type_key" UNIQUE ("status", "type");

-- ----------------------------
-- Checks structure for table status_colors
-- ----------------------------
ALTER TABLE "public"."status_colors" ADD CONSTRAINT "status_colors_type_check" CHECK (type = ANY (ARRAY['appointment'::text, 'claim'::text, 'patient_pay'::text, 'month'::text, 'ar_type'::text]));

-- ----------------------------
-- Primary Key structure for table status_colors
-- ----------------------------
ALTER TABLE "public"."status_colors" ADD CONSTRAINT "status_colors_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table timecards
-- ----------------------------
CREATE INDEX "idx_timecards_user_id" ON "public"."timecards" USING btree (
  "user_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_timecards_week_start" ON "public"."timecards" USING btree (
  "week_start_date" "pg_catalog"."date_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table timecards
-- ----------------------------
CREATE TRIGGER "update_timecards_updated_at" BEFORE UPDATE ON "public"."timecards"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_updated_at_column"();

-- ----------------------------
-- Primary Key structure for table timecards
-- ----------------------------
ALTER TABLE "public"."timecards" ADD CONSTRAINT "timecards_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table todo_lists
-- ----------------------------
CREATE INDEX "idx_todo_lists_clinic" ON "public"."todo_lists" USING btree (
  "clinic_id" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_todo_lists_created_by" ON "public"."todo_lists" USING btree (
  "created_by" "pg_catalog"."uuid_ops" ASC NULLS LAST
);
CREATE INDEX "idx_todo_lists_status" ON "public"."todo_lists" USING btree (
  "status" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Triggers structure for table todo_lists
-- ----------------------------
CREATE TRIGGER "update_todo_lists_updated_at" BEFORE UPDATE ON "public"."todo_lists"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_updated_at_column"();

-- ----------------------------
-- Primary Key structure for table todo_lists
-- ----------------------------
ALTER TABLE "public"."todo_lists" ADD CONSTRAINT "todo_lists_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Indexes structure for table users
-- ----------------------------
CREATE INDEX "idx_users_clinic_ids" ON "public"."users" USING gin (
  "clinic_ids" "pg_catalog"."array_ops"
);

-- ----------------------------
-- Triggers structure for table users
-- ----------------------------
CREATE TRIGGER "on_user_provider_ensure_level" AFTER INSERT ON "public"."users"
FOR EACH ROW
EXECUTE PROCEDURE "public"."ensure_provider_for_provider_user"();
CREATE TRIGGER "update_users_updated_at" BEFORE UPDATE ON "public"."users"
FOR EACH ROW
EXECUTE PROCEDURE "public"."update_updated_at_column"();

-- ----------------------------
-- Uniques structure for table users
-- ----------------------------
ALTER TABLE "public"."users" ADD CONSTRAINT "users_email_key" UNIQUE ("email");

-- ----------------------------
-- Checks structure for table users
-- ----------------------------
ALTER TABLE "public"."users" ADD CONSTRAINT "users_role_check" CHECK (role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'view_only_admin'::text, 'billing_staff'::text, 'view_only_billing'::text, 'provider'::text, 'office_staff'::text, 'official_staff'::text]));

-- ----------------------------
-- Primary Key structure for table users
-- ----------------------------
ALTER TABLE "public"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");

-- ----------------------------
-- Foreign Keys structure for table accounts_receivables
-- ----------------------------
ALTER TABLE "public"."accounts_receivables" ADD CONSTRAINT "accounts_receivables_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table ar_backups
-- ----------------------------
ALTER TABLE "public"."ar_backups" ADD CONSTRAINT "ar_backups_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table audit_logs
-- ----------------------------
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table cell_comments
-- ----------------------------
ALTER TABLE "public"."cell_comments" ADD CONSTRAINT "cell_comments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table cell_highlights
-- ----------------------------
ALTER TABLE "public"."cell_highlights" ADD CONSTRAINT "cell_highlights_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."cell_highlights" ADD CONSTRAINT "cell_highlights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table clinic_addresses
-- ----------------------------
ALTER TABLE "public"."clinic_addresses" ADD CONSTRAINT "clinic_addresses_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table clinic_invoice_notes
-- ----------------------------
ALTER TABLE "public"."clinic_invoice_notes" ADD CONSTRAINT "clinic_invoice_notes_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table column_locks
-- ----------------------------
ALTER TABLE "public"."column_locks" ADD CONSTRAINT "column_locks_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."column_locks" ADD CONSTRAINT "column_locks_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "public"."users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "public"."column_locks" ADD CONSTRAINT "column_locks_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."providers" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table is_lock_accounts_receivable
-- ----------------------------
ALTER TABLE "public"."is_lock_accounts_receivable" ADD CONSTRAINT "is_lock_accounts_receivable_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table is_lock_billing_todo
-- ----------------------------
ALTER TABLE "public"."is_lock_billing_todo" ADD CONSTRAINT "is_lock_billing_todo_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table is_lock_patients
-- ----------------------------
ALTER TABLE "public"."is_lock_patients" ADD CONSTRAINT "is_lock_patients_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table is_lock_providers
-- ----------------------------
ALTER TABLE "public"."is_lock_providers" ADD CONSTRAINT "is_lock_providers_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table patients
-- ----------------------------
ALTER TABLE "public"."patients" ADD CONSTRAINT "patients_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table patients_backups
-- ----------------------------
ALTER TABLE "public"."patients_backups" ADD CONSTRAINT "patients_backups_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table private_patient_claims
-- ----------------------------
ALTER TABLE "public"."private_patient_claims" ADD CONSTRAINT "private_patient_claims_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."private_patient_claims" ADD CONSTRAINT "private_patient_claims_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."providers" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table provider_logins
-- ----------------------------
ALTER TABLE "public"."provider_logins" ADD CONSTRAINT "provider_logins_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."providers" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table provider_pay
-- ----------------------------
ALTER TABLE "public"."provider_pay" ADD CONSTRAINT "provider_pay_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."provider_pay" ADD CONSTRAINT "provider_pay_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."providers" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table provider_pay_backups
-- ----------------------------
ALTER TABLE "public"."provider_pay_backups" ADD CONSTRAINT "provider_pay_backups_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table provider_pay_rows
-- ----------------------------
ALTER TABLE "public"."provider_pay_rows" ADD CONSTRAINT "provider_pay_rows_provider_pay_id_fkey" FOREIGN KEY ("provider_pay_id") REFERENCES "public"."provider_pay" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table provider_schedules
-- ----------------------------
ALTER TABLE "public"."provider_schedules" ADD CONSTRAINT "provider_schedules_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."provider_schedules" ADD CONSTRAINT "provider_schedules_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."providers" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table provider_sheet_backups
-- ----------------------------
ALTER TABLE "public"."provider_sheet_backups" ADD CONSTRAINT "provider_sheet_backups_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "public"."provider_sheets" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table provider_sheet_rows
-- ----------------------------
ALTER TABLE "public"."provider_sheet_rows" ADD CONSTRAINT "provider_sheet_rows_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "public"."provider_sheets" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table provider_sheets
-- ----------------------------
ALTER TABLE "public"."provider_sheets" ADD CONSTRAINT "provider_sheets_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."provider_sheets" ADD CONSTRAINT "provider_sheets_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."providers" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table server_refresh_tokens
-- ----------------------------
ALTER TABLE "public"."server_refresh_tokens" ADD CONSTRAINT "server_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table timecards
-- ----------------------------
ALTER TABLE "public"."timecards" ADD CONSTRAINT "timecards_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "public"."timecards" ADD CONSTRAINT "timecards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ----------------------------
-- Foreign Keys structure for table todo_lists
-- ----------------------------
ALTER TABLE "public"."todo_lists" ADD CONSTRAINT "todo_lists_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "public"."todo_lists" ADD CONSTRAINT "todo_lists_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
