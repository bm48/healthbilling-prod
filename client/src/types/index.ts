export type UserRole = 
  | 'super_admin'
  | 'admin'
  | 'view_only_admin'
  | 'billing_staff'
  | 'view_only_billing'
  | 'provider'
  | 'office_staff'
  | 'official_staff'

export type AppointmentStatus = 
  | 'Complete'
  | 'PP Complete'
  | 'Charge NS/LC'
  | 'RS No Charge'
  | 'NS No Charge'
  | 'Note not complete'

export type ClaimStatus = 
  | 'Claim Sent'
  | 'RS'
  | 'IP'
  | 'Paid'
  | 'Deductible'
  | 'N/A'
  | 'PP'
  | 'Denial'
  | 'Rejection'
  | 'No Coverage'

export type PatientPayStatus = 
  | 'Paid'
  | 'CC declined'
  | 'Secondary'
  | 'Refunded'
  | 'Payment Plan'
  | 'Waiting on Claims'

export type ARType = 'Insurance' | 'Patient' | 'Admin' | null

export interface User {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  clinic_ids: string[]
  highlight_color: string | null
  hourly_pay: number | null
  /** When false, user is hidden from lists and dashboard. Default true. Super admin can toggle in User Management. */
  active?: boolean
  created_at: string
  updated_at: string
}

export interface Clinic {
  id: string
  name: string
  phone: string | null
  fax?: string | null
  npi?: string | null
  ein?: string | null
  /** 1 = default/original; 2 = two pay periods per month (24-item date dropdowns, dual AR/Provider Pay tables) */
  payroll?: 1 | 2
  /** Decimal rate for invoice total (e.g. 0.05 = 5%). Invoice Total = (Ins + Patient + AR) * invoice_rate. Set in Clinic Management. */
  invoice_rate?: number | null
  created_at: string
  updated_at: string
}

/** One address line (1–6) for a clinic. Stored in clinic_addresses table. */
export interface ClinicAddress {
  id: string
  clinic_id: string
  line_index: number
  address: string | null
  created_at: string
  updated_at: string
}

export interface Provider {
  id: string
  clinic_ids: string[]
  first_name: string
  last_name: string
  specialty: string | null
  npi: string | null
  email: string | null
  phone: string | null
  active: boolean
  /** Provider access level: 1 or 2 (default 1). Set by super admin in User Management. */
  level?: 1 | 2
  /** Provider cut percent 0–1 (default 0.7). Provider Cut = Total Payments × this. Set in Super Admin Settings. */
  provider_cut_percent?: number
  /** When true, Providers tab shows a "Visit Type" column (In-person / Telehealth) for this provider. Toggled in User Management. */
  show_visit_type_column?: boolean
  created_at: string
  updated_at: string
}

export interface Patient {
  id: string
  clinic_id: string
  patient_id: string
  first_name: string
  last_name: string
  subscriber_id: string | null
  insurance: string | null
  copay: string | number | null
  coinsurance: string | number | null
  date_of_birth: string | null
  phone: string | null
  email: string | null
  address: string | null
  created_at: string
  updated_at: string
}

/** Provider schedule entry – independent of patients table; clinic_id, provider_id, patient info. */
export interface ProviderScheduleEntry {
  id: string
  clinic_id: string
  provider_id: string
  patient_id: string | null
  patient_name: string | null
  insurance: string | null
  copay: string | number | null
  coinsurance: string | number | null
  date_of_service: string | null
  created_at: string
  updated_at: string
}

export interface ProviderSheet {
  id: string
  clinic_id: string
  provider_id: string
  month: number
  year: number
  locked: boolean
  locked_columns: string[]
  created_at: string
  updated_at: string
}

export interface SheetRow {
  id: string
  // Columns A-G: Scheduling
  patient_id: string | null
  patient_first_name: string | null
  patient_last_name: string | null
  patient_insurance: string | null
  patient_copay: string | number | null
  patient_coinsurance: string | number | null
  appointment_date: string | null
  appointment_time: string | null
  visit_type: string | null
  notes: string | null
  
  // Columns H-I: Provider billing
  billing_code: string | null
  billing_code_color: string | null
  appointment_status: AppointmentStatus | null
  appointment_status_color: string | null
  
  // Columns J-M: Claim status
  claim_status: ClaimStatus | null
  claim_status_color: string | null
  submit_date: string | null
  insurance_payment: string | null
  insurance_adjustment: string | null
  
  // Columns N-Q: Patient invoice/payment
  invoice_amount: number | null
  collected_from_patient: string | null
  patient_pay_status: PatientPayStatus | null
  patient_pay_status_color: string | null
  payment_date: string | null
  payment_date_color: string | null
  
  // Columns U-AA: Accounts Receivable
  ar_type: ARType | null
  ar_amount: number | null
  ar_date: string | null
  ar_date_color: string | null
  ar_notes: string | null
  
  // Columns AC-AE: Provider Payment
  provider_payment_amount: number | null
  provider_payment_date: string | null
  provider_payment_notes: string | null
  
  highlight_color: string | null
  created_at: string
  updated_at: string

  // additional column
  total: string | null
  last_initial: string | null
  cpt_code: string | null
  cpt_code_color: string | null
}

export interface BillingCode {
  id: string
  code: string
  description: string | null
  color: string
  /** Text color (hex) for the code label. Defaults to #000000 if not set (e.g. before migration). */
  text_color?: string
  created_at: string
  updated_at: string
}

export interface StatusColor {
  id: string
  status: string
  color: string
  text_color: string
  type: 'appointment' | 'claim' | 'patient_pay' | 'month' | 'ar_type'
  created_at: string
  updated_at: string
}

export interface AccountsReceivable {
  id: string
  clinic_id: string
  ar_id: string
  name: string | null
  date_of_service: string | null
  amount: number | null
  date_recorded: string | null
  type: ARType | null
  notes: string | null
  /** 1 or 2 when clinic has payroll 2; otherwise 1 */
  payroll?: 1 | 2
  created_at: string
  updated_at: string
}

/** Provider Pay header: one per provider per month (pay date, pay period). */
export interface ProviderPay {
  id: string
  clinic_id: string
  provider_id: string
  year: number
  month: number
  pay_date: string | null
  pay_period: string | null
  /** Freeform notes/description for the Provider Pay sheet (shown on the right side). */
  notes?: string | null
  created_at: string
  updated_at: string
}

/** One row in the Provider Pay table (description, amount, notes). Amount is text to support formulas. */
export interface ProviderPayRow {
  id: string
  provider_pay_id: string
  row_index: number
  description: string | null
  amount: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ColumnLock {
  id: string
  clinic_id: string
  provider_id: string | null
  column_name: string
  is_locked: boolean
  comment: string | null
  locked_by: string | null
  locked_at: string
  created_at: string
  updated_at: string
}

export interface IsLockBillingTodo {
  id: string
  clinic_id: string
  id_column: boolean
  status: boolean
  issue: boolean
  notes: boolean
  followup_notes: boolean
  id_column_comment: string | null
  status_comment: string | null
  issue_comment: string | null
  notes_comment: string | null
  followup_notes_comment: string | null
  created_at: string
  updated_at: string
}

export interface IsLockAccountsReceivable {
  id: string
  clinic_id: string
  /** Same month key as provider sheets / AR tab: "YYYY-M" or "YYYY-M-P". Value "legacy" for pre-migration rows. */
  month_key: string
  ar_id: boolean
  name: boolean
  date_of_service: boolean
  amount: boolean
  date_recorded: boolean
  type: boolean
  notes: boolean
  ar_id_comment: string | null
  name_comment: string | null
  date_of_service_comment: string | null
  amount_comment: string | null
  date_recorded_comment: string | null
  type_comment: string | null
  notes_comment: string | null
  created_at: string
  updated_at: string
}

export interface IsLockProviders {
  id: string
  clinic_id: string
  /** Provider sheet month key, e.g. "2025-3" or "2025-3-2". Value "legacy" is used for rows migrated from the old single-row-per-clinic model. */
  month_key: string
  patient_id: boolean
  first_name: boolean
  last_initial: boolean
  insurance: boolean
  copay: boolean
  coinsurance: boolean
  date_of_service: boolean
  cpt_code: boolean
  appointment_note_status: boolean
  claim_status: boolean
  most_recent_submit_date: boolean
  ins_pay: boolean
  ins_pay_date: boolean
  pt_res: boolean
  collected_from_pt: boolean
  pt_pay_status: boolean
  pt_payment_ar_ref_date: boolean
  total: boolean
  notes: boolean
  patient_id_comment: string | null
  first_name_comment: string | null
  last_initial_comment: string | null
  insurance_comment: string | null
  copay_comment: string | null
  coinsurance_comment: string | null
  date_of_service_comment: string | null
  cpt_code_comment: string | null
  appointment_note_status_comment: string | null
  claim_status_comment: string | null
  most_recent_submit_date_comment: string | null
  ins_pay_comment: string | null
  ins_pay_date_comment: string | null
  pt_res_comment: string | null
  collected_from_pt_comment: string | null
  pt_pay_status_comment: string | null
  pt_payment_ar_ref_date_comment: string | null
  total_comment: string | null
  notes_comment: string | null
  created_at: string
  updated_at: string
}

export interface IsLockPatients {
  id: string
  clinic_id: string
  patient_id: boolean
  first_name: boolean
  last_name: boolean
  insurance: boolean
  copay: boolean
  coinsurance: boolean
  patient_id_comment: string | null
  first_name_comment: string | null
  last_name_comment: string | null
  insurance_comment: string | null
  copay_comment: string | null
  coinsurance_comment: string | null
  created_at: string
  updated_at: string
}

export interface TodoItem {
  id: string
  clinic_id: string
  issue: string | null
  status: string
  notes: string | null
  followup_notes: string | null
  created_by: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface Timecard {
  id: string
  user_id: string
  clinic_id: string | null
  clock_in: string
  clock_out: string | null
  hours: number | null
  hourly_pay: number | null
  notes: string | null
  amount_paid: number | null
  payment_date: string | null
  week_start_date: string
  /** When true, super admin has locked this row; edit/delete disabled until unlocked. */
  is_locked?: boolean
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: string
  user_id: string
  clinic_id: string | null
  action: string
  table_name: string
  record_id: string
  old_values: Record<string, any> | null
  new_values: Record<string, any> | null
  created_at: string
}

export interface ReportFilters {
  start_date: string
  end_date: string
  clinic_id?: string
  provider_id?: string
  group_by?: 'provider' | 'clinic' | 'claim' | 'patient' | 'labor' | 'invoices'
}
