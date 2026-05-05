import type { AccountsReceivable, Patient } from '@/types'
import type { NativeClient } from '@/lib/nativeClient'

const BUCKET = 'tab-backups'
const SIGNED_URL_EXPIRY_SEC = 60

export type TabBackupType = 'ar' | 'provider_pay' | 'patients'

const TABLE_BY_TYPE: Record<TabBackupType, string> = {
  ar: 'ar_backups',
  provider_pay: 'provider_pay_backups',
  patients: 'patients_backups',
}

export interface TabBackupVersion {
  id: string
  clinic_id: string
  version: number
  created_at: string
  file_path: string
}

export async function listTabBackupVersions(
  db: NativeClient,
  type: TabBackupType,
  clinicId: string
): Promise<TabBackupVersion[]> {
  const table = TABLE_BY_TYPE[type]
  const { data, error } = await db
    .from(table)
    .select('id, clinic_id, version, created_at, file_path')
    .eq('clinic_id', clinicId)
    .order('version', { ascending: false })
  if (error) throw error
  return (data || []) as TabBackupVersion[]
}

const listTabBackupVersionsInflight = new Map<string, Promise<TabBackupVersion[]>>()

/** One in-flight list per (type, clinic) so remounts / Strict Mode do not duplicate the backup-versions query. */
export function listTabBackupVersionsDeduped(
  db: NativeClient,
  type: TabBackupType,
  clinicId: string
): Promise<TabBackupVersion[]> {
  const k = `${type}:${clinicId}`
  const existing = listTabBackupVersionsInflight.get(k)
  if (existing) return existing
  const p = listTabBackupVersions(db, type, clinicId).finally(() => {
    listTabBackupVersionsInflight.delete(k)
  })
  listTabBackupVersionsInflight.set(k, p)
  return p
}

export async function getTabBackupDownloadUrl(
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

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (inQuotes) {
      current += c
    } else if (c === ',') {
      result.push(current)
      current = ''
    } else {
      current += c
    }
  }
  result.push(current)
  return result
}

function parseCsv(text: string): string[][] {
  return text.split(/\r?\n/).filter((line) => line.length > 0).map(parseCsvLine)
}

/** Parse amount from CSV (plain number or legacy). */
function parseAmountFromCsv(v: unknown): number | null {
  if (v == null || v === '') return null
  const s = String(v).trim().replace(/\$/g, '').replace(/,/g, '').trim()
  if (s === '' || s.toLowerCase() === 'null') return null
  const n = Number(s)
  return Number.isNaN(n) ? null : n
}

/** Fetch AR backup CSV and parse into AccountsReceivable[]. Supports legacy (DB columns) and display-format CSV (ID, Name, etc.). */
export async function fetchBackupCsvAsAR(
  db: NativeClient,
  filePath: string,
  clinicId?: string
): Promise<AccountsReceivable[]> {
  const { data, error } = await db.storage.from(BUCKET).download(filePath)
  if (error) throw error
  if (!data) throw new Error('No file data')
  const text = await data.text()
  const rows = parseCsv(text)
  if (rows.length < 2) return []
  const headers = rows[0].map((h) => h.trim().toLowerCase())
  const list: AccountsReceivable[] = []
  const iso = new Date().toISOString()
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i]
    const row: Record<string, unknown> = {}
    headers.forEach((h, idx) => {
      const v = values[idx]
      row[h] = v === '' || v == null ? null : v
    })
    // Support display headers ("id", "name", "date of service", …) and legacy ("ar_id", "clinic_id", …)
    const isLegacyFormat = headers.includes('clinic_id')
    const ar_id = (row['id'] ?? row.ar_id ?? '') as string
    const name = (row.name ?? null) as string | null
    const date_of_service = (row['date of service'] ?? row.date_of_service ?? null) as string | null
    const amount = row.amount != null && row.amount !== '' ? parseAmountFromCsv(row.amount) : null
    const date_recorded = (row['date recorded'] ?? row.date_recorded ?? null) as string | null
    const type = (row.type ?? null) as 'Insurance' | 'Patient' | 'Admin' | null
    const notes = (row.notes ?? null) as string | null
    const id = isLegacyFormat ? ((row.id as string) || `backup-ar-${i}`) : `backup-ar-${i}`
    list.push({
      id,
      clinic_id: (row.clinic_id as string) ?? clinicId ?? '',
      ar_id: ar_id ?? '',
      name: name ?? null,
      date_of_service: date_of_service ?? null,
      amount: amount ?? null,
      date_recorded: date_recorded ?? null,
      type: type ?? null,
      notes: notes ?? null,
      payroll: row.payroll != null && Number(row.payroll) === 2 ? 2 : 1,
      created_at: (row.created_at as string) ?? iso,
      updated_at: (row.updated_at as string) ?? iso,
    })
  }
  return list
}

/** Parse CSV copay: supports "$10.00" (display) or "10" (legacy). */
function parseCopayFromCsv(v: unknown): number | null {
  if (v == null || v === '') return null
  const s = String(v).trim().replace(/\$/g, '').replace(/,/g, '').trim()
  if (s === '' || s.toLowerCase() === 'null') return null
  const n = Number(s)
  return Number.isNaN(n) ? null : n
}

/** Parse CSV coinsurance: supports "10.00%" (display) or "10" (legacy). */
function parseCoinsuranceFromCsv(v: unknown): number | null {
  if (v == null || v === '') return null
  const s = String(v).trim().replace(/%/g, '').trim()
  if (s === '' || s.toLowerCase() === 'null') return null
  const n = Number(s)
  return Number.isNaN(n) ? null : n
}

/** Fetch patients backup CSV and parse into Patient[]. Supports both legacy (DB columns) and display-format CSV (Patient ID, Copay as $, Coinsurance as %). */
export async function fetchBackupCsvAsPatients(
  db: NativeClient,
  filePath: string,
  clinicId?: string
): Promise<Patient[]> {
  const { data, error } = await db.storage.from(BUCKET).download(filePath)
  if (error) throw error
  if (!data) throw new Error('No file data')
  const text = await data.text()
  const rows = parseCsv(text)
  if (rows.length < 2) return []
  const headers = rows[0].map((h) => h.trim().toLowerCase())
  const list: Patient[] = []
  const iso = new Date().toISOString()
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i]
    const row: Record<string, unknown> = {}
    headers.forEach((h, idx) => {
      const v = values[idx]
      row[h] = v === '' || v == null ? null : v
    })
    // Support display headers ("patient id", "patient first", …) and legacy ("patient_id", …)
    const patientId = (row['patient id'] ?? row.patient_id ?? '') as string
    const firstName = (row['patient first'] ?? row.first_name ?? '') as string
    const lastName = (row['patient last'] ?? row.last_name ?? '') as string
    const insurance = (row.insurance ?? null) as string | null
    const copay = parseCopayFromCsv(row['copay'] ?? row.copay)
    const coinsurance = parseCoinsuranceFromCsv(row['coinsurance'] ?? row.coinsurance)
    const id = (row.id as string) || `backup-patient-${i}`
    const clinic_id = (row.clinic_id as string) ?? clinicId ?? ''
    list.push({
      id: id && String(id).trim() ? id : `backup-patient-${i}`,
      clinic_id,
      patient_id: patientId ?? '',
      first_name: firstName ?? '',
      last_name: lastName ?? '',
      subscriber_id: (row.subscriber_id as string) ?? null,
      insurance: insurance ?? null,
      copay: copay ?? null,
      coinsurance: coinsurance ?? null,
      date_of_birth: (row.date_of_birth as string) ?? null,
      phone: (row.phone as string) ?? null,
      email: (row.email as string) ?? null,
      address: (row.address as string) ?? null,
      created_at: (row.created_at as string) ?? iso,
      updated_at: (row.updated_at as string) ?? iso,
    })
  }
  return list
}

/** Provider pay backup: one row per table row with header fields. Returns { byKey: string[][] } where key = providerId-year-month-payroll */
export interface ProviderPayBackupData {
  byKey: Record<string, string[][]>
}

export async function fetchBackupCsvAsProviderPay(
  db: NativeClient,
  filePath: string
): Promise<ProviderPayBackupData> {
  const { data, error } = await db.storage.from(BUCKET).download(filePath)
  if (error) throw error
  if (!data) throw new Error('No file data')
  const text = await data.text()
  const rows = parseCsv(text)
  if (rows.length < 2) return { byKey: {} }
  const headers = rows[0].map((h) => h.trim().toLowerCase())
  const byKey: Record<string, string[][]> = {}
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i]
    const row: Record<string, unknown> = {}
    headers.forEach((h, idx) => {
      const v = values[idx]
      row[h] = v === '' || v == null ? null : v
    })
    const providerId = String(row.provider_id ?? '')
    const year = Number(row.year ?? 0)
    const month = Number(row.month ?? 0)
    const payroll = Number(row.payroll ?? 1)
    const key = `${providerId}-${year}-${month}-${payroll}`
    if (!byKey[key]) byKey[key] = []
    const desc = row.description ?? ''
    const amount = row.amount ?? ''
    const notes = row.notes ?? ''
    byKey[key].push([String(desc), String(amount), String(notes)])
  }
  return { byKey }
}

const AR_PLACEHOLDER_ROWS = 200
/** Pad AR list to 200 rows for display like live tab */
export function padARTo200(list: AccountsReceivable[], clinicId: string): AccountsReceivable[] {
  if (list.length >= AR_PLACEHOLDER_ROWS) return list
  const iso = new Date().toISOString()
  const need = AR_PLACEHOLDER_ROWS - list.length
  const placeholders: AccountsReceivable[] = Array.from({ length: need }, (_, i) => ({
    id: `empty-backup-ar-${list.length + i}`,
    clinic_id: clinicId,
    ar_id: '',
    name: null,
    date_of_service: null,
    amount: null,
    date_recorded: null,
    type: null,
    notes: null,
    payroll: 1,
    created_at: iso,
    updated_at: iso,
  }))
  return [...list, ...placeholders]
}

const PATIENTS_PLACEHOLDER_ROWS = 500
/** Pad patients list for display (optional; Patient Info tab doesn't force 200 rows but we can cap) */
export function padPatientsTo500(list: Patient[], clinicId: string): Patient[] {
  if (list.length >= PATIENTS_PLACEHOLDER_ROWS) return list
  const iso = new Date().toISOString()
  const need = PATIENTS_PLACEHOLDER_ROWS - list.length
  const placeholders: Patient[] = Array.from({ length: need }, (_, i) => ({
    id: `empty-backup-patient-${list.length + i}`,
    clinic_id: clinicId,
    patient_id: '',
    first_name: '',
    last_name: '',
    subscriber_id: null,
    insurance: null,
    copay: null,
    coinsurance: null,
    date_of_birth: null,
    phone: null,
    email: null,
    address: null,
    created_at: iso,
    updated_at: iso,
  }))
  return [...list, ...placeholders]
}
