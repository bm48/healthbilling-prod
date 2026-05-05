import type { SheetRow } from '@/types'
import type { NativeClient } from '@/lib/nativeClient'

const BUCKET = 'provider-sheet-backups'
const SIGNED_URL_EXPIRY_SEC = 60

/** Map CSV headers (18-column format) back to DB column names. Accepts both new UI headers and legacy DB names. */
const UI_HEADER_TO_DB: Record<string, string> = {
  'id': 'patient_id',
  'first name': 'patient_first_name',
  'li': 'last_initial',
  'ins': 'patient_insurance',
  'co-pay': 'patient_copay',
  'co-ins': 'patient_coinsurance',
  'date of service': 'appointment_date',
  'cpt code': 'cpt_code',
  'tele': 'visit_type',
  'appt/note status': 'appointment_status',
  'claim status': 'claim_status',
  'most recent': 'submit_date',
  'ins pay': 'insurance_payment',
  'ins pay date': 'payment_date',
  'pt res': 'invoice_amount',
  'pt paid': 'collected_from_patient',
  'pt pay status': 'patient_pay_status',
  'pt payment ar ref date': 'payment_date_color',
  'total': 'total',
  'notes': 'notes',
  // Legacy DB column names (old backups)
  'patient_id': 'patient_id',
  'patient_first_name': 'patient_first_name',
  'last_initial': 'last_initial',
  'patient_insurance': 'patient_insurance',
  'patient_copay': 'patient_copay',
  'patient_coinsurance': 'patient_coinsurance',
  'appointment_date': 'appointment_date',
  'cpt_code': 'cpt_code',
  'visit_type': 'visit_type',
  'appointment_status': 'appointment_status',
  'claim_status': 'claim_status',
  'submit_date': 'submit_date',
  'insurance_payment': 'insurance_payment',
  'payment_date': 'payment_date',
  'invoice_amount': 'invoice_amount',
  'collected_from_patient': 'collected_from_patient',
  'patient_pay_status': 'patient_pay_status',
  'payment_date_color': 'payment_date_color',
}

export interface BackupVersion {
  id: string
  sheet_id: string
  version: number
  created_at: string
  file_path: string
}

/**
 * List backup versions for a provider sheet (newest first).
 */
export async function listBackupVersions(
  db: NativeClient,
  sheetId: string
): Promise<BackupVersion[]> {
  const { data, error } = await db
    .from('provider_sheet_backups')
    .select('id, sheet_id, version, created_at, file_path')
    .eq('sheet_id', sheetId)
    .order('version', { ascending: false })
  if (error) throw error
  return (data || []) as BackupVersion[]
}

const listBackupVersionsInflight = new Map<string, Promise<BackupVersion[]>>()

/** One in-flight list per sheet so remounts / Strict Mode do not duplicate the backup-versions query. */
export function listBackupVersionsDeduped(db: NativeClient, sheetId: string): Promise<BackupVersion[]> {
  const existing = listBackupVersionsInflight.get(sheetId)
  if (existing) return existing
  const p = listBackupVersions(db, sheetId).finally(() => {
    listBackupVersionsInflight.delete(sheetId)
  })
  listBackupVersionsInflight.set(sheetId, p)
  return p
}

/**
 * Get a signed URL to download a backup file (CSV).
 */
export async function getBackupDownloadUrl(
  db: NativeClient,
  filePath: string
): Promise<string> {
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(filePath, SIGNED_URL_EXPIRY_SEC, { download: true })
  if (error) throw error
  if (!data?.signedUrl) throw new Error('No signed URL')
  return data.signedUrl
}

const ROWS_PER_PROVIDER = 200

function createEmptySheetRow(index: number): SheetRow {
  const iso = new Date().toISOString()
  return {
    id: `empty-backup-${index}`,
    patient_id: null,
    patient_first_name: null,
    patient_last_name: null,
    last_initial: null,
    patient_insurance: null,
    patient_copay: null,
    patient_coinsurance: null,
    appointment_date: null,
    appointment_time: null,
    visit_type: null,
    notes: null,
    billing_code: null,
    billing_code_color: null,
    cpt_code: null,
    cpt_code_color: null,
    appointment_status: null,
    appointment_status_color: null,
    claim_status: null,
    claim_status_color: null,
    submit_date: null,
    insurance_payment: null,
    insurance_adjustment: null,
    invoice_amount: null,
    collected_from_patient: null,
    patient_pay_status: null,
    patient_pay_status_color: null,
    payment_date: null,
    payment_date_color: null,
    ar_type: null,
    ar_amount: null,
    ar_date: null,
    ar_date_color: null,
    ar_notes: null,
    provider_payment_amount: null,
    provider_payment_date: null,
    provider_payment_notes: null,
    highlight_color: null,
    total: null,
    created_at: iso,
    updated_at: iso,
  }
}

/**
 * Pad rows to ROWS_PER_PROVIDER (200) so the table displays the same height as the live view.
 */
export function padSheetRowsTo200(rows: SheetRow[]): SheetRow[] {
  if (rows.length >= ROWS_PER_PROVIDER) return rows
  const padding = Array.from({ length: ROWS_PER_PROVIDER - rows.length }, (_, i) =>
    createEmptySheetRow(rows.length + i)
  )
  return [...rows, ...padding]
}

/**
 * Fetch backup CSV and parse into SheetRow[] (same shape as provider_sheet_rows for display).
 */
export async function fetchBackupCsvAsSheetRows(
  db: NativeClient,
  filePath: string
): Promise<SheetRow[]> {
  const { data, error } = await db.storage.from(BUCKET).download(filePath)
  if (error) throw error
  if (!data) throw new Error('No file data')
  const text = await data.text()
  return parseCsvToSheetRows(text)
}

/**
 * Parse CSV string (from backup) into SheetRow[]. Accepts both UI headers (new backups) and DB column names (old backups).
 */
export function parseCsvToSheetRows(csv: string): SheetRow[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length < 2) return []
  const headerRaw = parseCsvLine(lines[0])
  const headerToDb = headerRaw.map((h) => UI_HEADER_TO_DB[h.trim().toLowerCase()] ?? h.trim())
  const rows: SheetRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    const row: Record<string, unknown> = {}
    headerToDb.forEach((dbKey, idx) => {
      row[dbKey] = values[idx] ?? null
    })
    if (row.id == null) row.id = `backup-${i - 1}`
    rows.push(csvRowToSheetRow(row))
  }
  return rows
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] === '"') {
      let cell = ''
      i++
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            cell += '"'
            i += 2
          } else {
            i++
            break
          }
        } else {
          cell += line[i]
          i++
        }
      }
      out.push(cell)
      if (line[i] === ',') i++
    } else {
      const comma = line.indexOf(',', i)
      const end = comma === -1 ? line.length : comma
      out.push(line.slice(i, end).trim())
      i = comma === -1 ? line.length : comma + 1
    }
  }
  return out
}

function csvRowToSheetRow(row: Record<string, unknown>): SheetRow {
  const num = (k: string): number | null => {
    const v = row[k]
    if (v === null || v === undefined || v === '') return null
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    return Number.isNaN(n) ? null : n
  }
  const str = (k: string): string | null => {
    const v = row[k]
    if (v === null || v === undefined) return null
    const s = String(v).trim()
    return s === '' ? null : s
  }
  return {
    id: str('id') ?? '',
    patient_id: str('patient_id'),
    patient_first_name: str('patient_first_name'),
    patient_last_name: str('patient_last_name'),
    last_initial: str('last_initial'),
    patient_insurance: str('patient_insurance'),
    patient_copay: row.patient_copay != null && row.patient_copay !== '' ? num('patient_copay') ?? str('patient_copay') : null,
    patient_coinsurance: row.patient_coinsurance != null && row.patient_coinsurance !== '' ? num('patient_coinsurance') ?? str('patient_coinsurance') : null,
    appointment_date: str('appointment_date'),
    appointment_time: str('appointment_time'),
    visit_type: str('visit_type'),
    notes: str('notes'),
    billing_code: str('billing_code'),
    billing_code_color: str('billing_code_color'),
    cpt_code: str('cpt_code'),
    cpt_code_color: str('cpt_code_color'),
    appointment_status: str('appointment_status') as SheetRow['appointment_status'],
    appointment_status_color: str('appointment_status_color'),
    claim_status: str('claim_status') as SheetRow['claim_status'],
    claim_status_color: str('claim_status_color'),
    submit_date: str('submit_date'),
    insurance_payment: str('insurance_payment'),
    insurance_adjustment: str('insurance_adjustment'),
    invoice_amount: num('invoice_amount'),
    collected_from_patient: str('collected_from_patient'),
    patient_pay_status: str('patient_pay_status') as SheetRow['patient_pay_status'],
    patient_pay_status_color: str('patient_pay_status_color'),
    payment_date: str('payment_date'),
    payment_date_color: str('payment_date_color'),
    ar_type: str('ar_type') as SheetRow['ar_type'],
    ar_amount: num('ar_amount'),
    ar_date: str('ar_date'),
    ar_date_color: str('ar_date_color'),
    ar_notes: str('ar_notes'),
    provider_payment_amount: num('provider_payment_amount'),
    provider_payment_date: str('provider_payment_date'),
    provider_payment_notes: str('provider_payment_notes'),
    highlight_color: str('highlight_color'),
    total: str('total'),
    created_at: str('created_at') ?? new Date().toISOString(),
    updated_at: str('updated_at') ?? new Date().toISOString(),
  }
}
