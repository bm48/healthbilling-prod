/**
 * Periodic tab backups (ported from Supabase Edge Functions).
 * Writes CSV under STORAGE_ROOT using the same bucket/path layout as before (tab-backups, provider-sheet-backups).
 * AR monthly slice uses America/Los_Angeles calendar boundaries (not a fixed UTC-7 offset).
 */
import { writeFile } from 'node:fs/promises'
import type { Pool } from 'pg'
import { ensureDirFor, safeStoragePath } from '../routes/storageRoutes.js'

const TAB_BUCKET = 'tab-backups'
const SHEET_BUCKET = 'provider-sheet-backups'

/** AR backup month window follows US Pacific wall calendar (handles PST/PDT). */
const AR_BACKUP_TIME_ZONE = 'America/Los_Angeles'

/** Convert a wall-clock instant in `timeZone` to UTC milliseconds (ECMA-402 / ICU). */
function wallTimeToUtcMs(
  timeZone: string,
  calendarYear: number,
  calendarMonth1: number,
  calendarDay: number,
  hour: number,
  minute: number,
  second: number,
  millisecond = 0,
): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const read = (instant: number) => {
    const p = fmt.formatToParts(new Date(instant))
    const g = (ty: Intl.DateTimeFormatPartTypes) => parseInt(p.find((x) => x.type === ty)!.value, 10)
    return { y: g('year'), m: g('month'), d: g('day'), h: g('hour'), mi: g('minute'), s: g('second') }
  }
  let instant = Date.UTC(calendarYear, calendarMonth1 - 1, calendarDay, hour, minute, second, millisecond)
  for (let i = 0; i < 100; i++) {
    const z = read(instant)
    if (
      z.y === calendarYear &&
      z.m === calendarMonth1 &&
      z.d === calendarDay &&
      z.h === hour &&
      z.mi === minute &&
      z.s === second
    ) {
      return instant
    }
    instant +=
      Date.UTC(calendarYear, calendarMonth1 - 1, calendarDay, hour, minute, second, millisecond) -
      Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s, 0)
  }
  throw new Error(
    `wallTimeToUtcMs: could not converge for ${timeZone} ${calendarYear}-${calendarMonth1}-${calendarDay} ${hour}:${minute}:${second}`,
  )
}

/** First instant of current calendar month in AR_BACKUP_TIME_ZONE through last instant of that month (UTC ISO for Postgres `timestamptz`). */
function currentMonthCreatedRangePacific(now = new Date()): { createdSince: string; createdUntil: string } {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: AR_BACKUP_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const readYm = (d: Date) => {
    const p = f.formatToParts(d)
    const g = (ty: Intl.DateTimeFormatPartTypes) => parseInt(p.find((x) => x.type === ty)!.value, 10)
    return { y: g('year'), m: g('month') }
  }
  const { y, m } = readYm(now)
  const startMs = wallTimeToUtcMs(AR_BACKUP_TIME_ZONE, y, m, 1, 0, 0, 0)
  let ny = y
  let nm = m + 1
  if (nm > 12) {
    nm = 1
    ny += 1
  }
  const nextStartMs = wallTimeToUtcMs(AR_BACKUP_TIME_ZONE, ny, nm, 1, 0, 0, 0)
  const endMs = nextStartMs - 1
  return { createdSince: new Date(startMs).toISOString(), createdUntil: new Date(endMs).toISOString() }
}

export type TabBackupJobResult = {
  success: true
  clinics_total?: number
  sheets_total?: number
  backed_up: number
  errors?: string[]
}

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined || val === '') return ''
  const s = String(val).trim()
  if (s === '' || s.toLowerCase() === 'null') return ''
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toDateOnly(val: unknown): string {
  if (val === null || val === undefined || val === '') return ''
  const s = String(val).trim()
  if (s === '' || s.toLowerCase() === 'null') return ''
  const n = Number(val)
  if (!Number.isNaN(n) && n > 0) {
    const d = new Date(n > 1e12 ? n : n * 1000)
    if (!Number.isNaN(d.getTime())) {
      const y = d.getUTCFullYear()
      const m = String(d.getUTCMonth() + 1).padStart(2, '0')
      const day = String(d.getUTCDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }
  }
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) {
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return s
}

const AR_DISPLAY_HEADERS = ['ID', 'Name', 'Date of Service', 'Amount', 'Date Recorded', 'Type', 'Notes']

function arRowToDisplayValues(r: Record<string, unknown>): string[] {
  return [
    escapeCsvCell(r.ar_id ?? ''),
    escapeCsvCell(r.name ?? ''),
    escapeCsvCell(toDateOnly(r.date_of_service)),
    escapeCsvCell(r.amount ?? ''),
    escapeCsvCell(toDateOnly(r.date_recorded)),
    escapeCsvCell(r.type ?? ''),
    escapeCsvCell(r.notes ?? ''),
  ]
}

function arRowsToCsv(rows: Record<string, unknown>[]): string {
  const header = AR_DISPLAY_HEADERS.map((c) => escapeCsvCell(c)).join(',')
  const body = rows.map((r) => arRowToDisplayValues(r).join(',')).join('\n')
  return `${header}\n${body}`
}

const PATIENT_DISPLAY_HEADERS = ['Patient ID', 'Patient First', 'Patient Last', 'Insurance', 'Copay', 'Coinsurance']

function formatCopay(val: unknown): string {
  if (val === null || val === undefined || val === '') return ''
  const n = typeof val === 'number' ? val : Number(String(val).trim())
  if (Number.isNaN(n)) return ''
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function formatCoinsurance(val: unknown): string {
  if (val === null || val === undefined || val === '') return ''
  const n = typeof val === 'number' ? val : Number(String(val).trim())
  if (Number.isNaN(n)) return ''
  return `${Number(n).toFixed(2)}%`
}

function patientRowToDisplayValues(r: Record<string, unknown>): string[] {
  return [
    escapeCsvCell(r.patient_id ?? ''),
    escapeCsvCell(r.first_name ?? ''),
    escapeCsvCell(r.last_name ?? ''),
    escapeCsvCell(r.insurance ?? ''),
    escapeCsvCell(formatCopay(r.copay)),
    escapeCsvCell(formatCoinsurance(r.coinsurance)),
  ]
}

function patientRowsToCsv(rows: Record<string, unknown>[]): string {
  const header = PATIENT_DISPLAY_HEADERS.map((c) => escapeCsvCell(c)).join(',')
  const body = rows.map((r) => patientRowToDisplayValues(r).join(',')).join('\n')
  return `${header}\n${body}`
}

const PAY_COLS = ['clinic_id', 'provider_id', 'year', 'month', 'payroll', 'pay_date', 'pay_period', 'header_notes', 'row_index', 'description', 'amount', 'notes']

const CSV_HEADERS = [
  'ID', 'Date of Service', 'Cpt Code', 'Tele', 'Appt/Note Status',
  'Claim Status', 'Most Recent', 'Ins Pay', 'Ins Pay Date', 'Pt Res', 'Pt Paid', 'Pt Pay Status',
  'Pt Payment Ar Ref Date', 'Total', 'Notes',
]
const CSV_DB_COLUMNS = [
  'patient_id',
  'appointment_date', 'cpt_code', 'visit_type', 'appointment_status', 'claim_status', 'submit_date', 'insurance_payment',
  'payment_date', 'invoice_amount', 'collected_from_patient', 'patient_pay_status', 'payment_date_color',
  'total', 'notes',
]

const USD_COLUMNS = new Set(['insurance_payment', 'invoice_amount', 'collected_from_patient', 'total'])

function formatSheetCsvValue(col: string, val: unknown): unknown {
  if (val === null || val === undefined || val === '') return null
  const str = String(val).trim()
  if (str === '' || str.toLowerCase() === 'null') return null
  const num = parseFloat(str)
  if (USD_COLUMNS.has(col) && !Number.isNaN(num)) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num)
  }
  return val
}

function sheetRowsToCsv(rows: Record<string, unknown>[]): string {
  const header = CSV_HEADERS.map((h) => escapeCsvCell(h)).join(',')
  const body = rows
    .map((row) =>
      CSV_DB_COLUMNS.map((col) => escapeCsvCell(formatSheetCsvValue(col, row[col]))).join(','),
    )
    .join('\n')
  return `${header}\n${body}`
}

async function writeBucketCsv(bucket: string, objectPath: string, csv: string): Promise<void> {
  const fullPath = safeStoragePath(bucket, objectPath)
  await ensureDirFor(fullPath)
  await writeFile(fullPath, csv, 'utf8')
}

export async function runBackupAr(pool: Pool): Promise<TabBackupJobResult> {
  const { rows: clinicRows } = await pool.query<{ id: string }>(`SELECT id FROM public.clinics`)
  const clinicIds = clinicRows.map((c) => c.id)
  const { createdSince, createdUntil } = currentMonthCreatedRangePacific()
  let backedUp = 0
  const errors: string[] = []

  for (const clinicId of clinicIds) {
    const { rows } = await pool.query(
      `SELECT * FROM public.accounts_receivables
       WHERE clinic_id = $1::uuid
         AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz
       ORDER BY date_recorded ASC NULLS LAST`,
      [clinicId, createdSince, createdUntil],
    )
    const rowMaps = rows as Record<string, unknown>[]

    const { rows: verRows } = await pool.query<{ version: number }>(
      `SELECT version FROM public.ar_backups WHERE clinic_id = $1::uuid ORDER BY version DESC LIMIT 1`,
      [clinicId],
    )
    const nextVersion = (verRows[0]?.version ?? 0) + 1
    const filePath = `ar/${clinicId}/v${nextVersion}.csv`
    try {
      await writeBucketCsv(TAB_BUCKET, filePath, arRowsToCsv(rowMaps))
    } catch (e) {
      errors.push(`clinic ${clinicId} upload: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    try {
      await pool.query(
        `INSERT INTO public.ar_backups (clinic_id, version, file_path) VALUES ($1::uuid, $2, $3)`,
        [clinicId, nextVersion, filePath],
      )
    } catch (e) {
      errors.push(`clinic ${clinicId} insert: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    backedUp++
  }

  return {
    success: true,
    clinics_total: clinicIds.length,
    backed_up: backedUp,
    ...(errors.length > 0 ? { errors } : {}),
  }
}

export async function runBackupPatients(pool: Pool): Promise<TabBackupJobResult> {
  const { rows: clinicRows } = await pool.query<{ id: string }>(`SELECT id FROM public.clinics`)
  const clinicIds = clinicRows.map((c) => c.id)
  let backedUp = 0
  const errors: string[] = []

  for (const clinicId of clinicIds) {
    const { rows } = await pool.query(
      `SELECT * FROM public.patients WHERE clinic_id = $1::uuid ORDER BY created_at DESC NULLS LAST`,
      [clinicId],
    )
    const rowMaps = rows as Record<string, unknown>[]

    const { rows: verRows } = await pool.query<{ version: number }>(
      `SELECT version FROM public.patients_backups WHERE clinic_id = $1::uuid ORDER BY version DESC LIMIT 1`,
      [clinicId],
    )
    const nextVersion = (verRows[0]?.version ?? 0) + 1
    const filePath = `patients/${clinicId}/v${nextVersion}.csv`
    try {
      await writeBucketCsv(TAB_BUCKET, filePath, patientRowsToCsv(rowMaps))
    } catch (e) {
      errors.push(`clinic ${clinicId} upload: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    try {
      await pool.query(
        `INSERT INTO public.patients_backups (clinic_id, version, file_path) VALUES ($1::uuid, $2, $3)`,
        [clinicId, nextVersion, filePath],
      )
    } catch (e) {
      errors.push(`clinic ${clinicId} insert: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    backedUp++
  }

  return {
    success: true,
    clinics_total: clinicIds.length,
    backed_up: backedUp,
    ...(errors.length > 0 ? { errors } : {}),
  }
}

export async function runBackupProviderPay(pool: Pool): Promise<TabBackupJobResult> {
  const { rows: clinicRows } = await pool.query<{ id: string }>(`SELECT id FROM public.clinics`)
  const clinicIds = clinicRows.map((c) => c.id)
  let backedUp = 0
  const errors: string[] = []

  for (const clinicId of clinicIds) {
    const { rows: headers } = await pool.query<Record<string, unknown> & { id: string }>(
      `SELECT id, clinic_id, provider_id, year, month, payroll, pay_date, pay_period, notes
       FROM public.provider_pay
       WHERE clinic_id = $1::uuid
       ORDER BY year ASC, month ASC, provider_id ASC`,
      [clinicId],
    )

    const flatRows: Record<string, unknown>[] = []
    for (const h of headers) {
      const { rows: rowData } = await pool.query(
        `SELECT row_index, description, amount, notes FROM public.provider_pay_rows
         WHERE provider_pay_id = $1::uuid ORDER BY row_index ASC`,
        [h.id],
      )
      for (const r of rowData) {
        const rr = r as Record<string, unknown>
        flatRows.push({
          clinic_id: h.clinic_id,
          provider_id: h.provider_id,
          year: h.year,
          month: h.month,
          payroll: h.payroll ?? 1,
          pay_date: h.pay_date,
          pay_period: h.pay_period,
          header_notes: h.notes,
          row_index: rr.row_index,
          description: rr.description,
          amount: rr.amount,
          notes: rr.notes,
        })
      }
      if (!rowData.length) {
        flatRows.push({
          clinic_id: h.clinic_id,
          provider_id: h.provider_id,
          year: h.year,
          month: h.month,
          payroll: h.payroll ?? 1,
          pay_date: h.pay_date,
          pay_period: h.pay_period,
          header_notes: h.notes,
          row_index: 0,
          description: '',
          amount: '',
          notes: '',
        })
      }
    }

    const { rows: verRows } = await pool.query<{ version: number }>(
      `SELECT version FROM public.provider_pay_backups WHERE clinic_id = $1::uuid ORDER BY version DESC LIMIT 1`,
      [clinicId],
    )
    const nextVersion = (verRows[0]?.version ?? 0) + 1
    const filePath = `provider-pay/${clinicId}/v${nextVersion}.csv`
    const headerLine = PAY_COLS.map((c) => escapeCsvCell(c)).join(',')
    const bodyLines = flatRows.map((r) => PAY_COLS.map((c) => escapeCsvCell(r[c] ?? null)).join(','))
    const csv = `${headerLine}\n${bodyLines.join('\n')}`

    try {
      await writeBucketCsv(TAB_BUCKET, filePath, csv)
    } catch (e) {
      errors.push(`clinic ${clinicId} upload: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    try {
      await pool.query(
        `INSERT INTO public.provider_pay_backups (clinic_id, version, file_path) VALUES ($1::uuid, $2, $3)`,
        [clinicId, nextVersion, filePath],
      )
    } catch (e) {
      errors.push(`clinic ${clinicId} insert: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    backedUp++
  }

  return {
    success: true,
    clinics_total: clinicIds.length,
    backed_up: backedUp,
    ...(errors.length > 0 ? { errors } : {}),
  }
}

export async function runBackupProviderSheets(pool: Pool): Promise<TabBackupJobResult> {
  // eslint-disable-next-line no-console
  console.log('[cron] backup-provider-sheets: run started')

  let sheets: { id: string }[]
  try {
    const r = await pool.query<{ id: string }>(`SELECT id FROM public.provider_sheets`)
    sheets = r.rows
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // eslint-disable-next-line no-console
    console.error('[cron] backup-provider-sheets: FAILED to fetch sheets', msg)
    return { success: true, sheets_total: 0, backed_up: 0, errors: [msg] }
  }

  const sheetIds = sheets.map((s) => s.id)
  // eslint-disable-next-line no-console
  console.log('[cron] backup-provider-sheets: sheets to backup:', sheetIds.length)

  let backedUp = 0
  const errors: string[] = []

  for (const sheetId of sheetIds) {
    let rowsList: Record<string, unknown>[]
    try {
      const { rows: rowList } = await pool.query(
        `SELECT * FROM public.provider_sheet_rows WHERE sheet_id = $1::uuid ORDER BY sort_order ASC NULLS LAST`,
        [sheetId],
      )
      rowsList = rowList as Record<string, unknown>[]
    } catch (e) {
      const msg = `sheet ${sheetId}: ${e instanceof Error ? e.message : String(e)}`
      errors.push(msg)
      // eslint-disable-next-line no-console
      console.error('[cron] backup-provider-sheets:', msg)
      continue
    }

    const { rows: verRows } = await pool.query<{ version: number }>(
      `SELECT version FROM public.provider_sheet_backups WHERE sheet_id = $1::uuid ORDER BY version DESC LIMIT 1`,
      [sheetId],
    )
    const nextVersion = (verRows[0]?.version ?? 0) + 1
    const csv = sheetRowsToCsv(rowsList)
    const filePath = `${sheetId}/v${nextVersion}.csv`

    try {
      await writeBucketCsv(SHEET_BUCKET, filePath, csv)
    } catch (e) {
      const msg = `sheet ${sheetId} upload: ${e instanceof Error ? e.message : String(e)}`
      errors.push(msg)
      // eslint-disable-next-line no-console
      console.error('[cron] backup-provider-sheets:', msg)
      continue
    }

    try {
      await pool.query(
        `INSERT INTO public.provider_sheet_backups (sheet_id, version, file_path) VALUES ($1::uuid, $2, $3)`,
        [sheetId, nextVersion, filePath],
      )
    } catch (e) {
      const msg = `sheet ${sheetId} insert: ${e instanceof Error ? e.message : String(e)}`
      errors.push(msg)
      // eslint-disable-next-line no-console
      console.error('[cron] backup-provider-sheets:', msg)
      continue
    }
    backedUp++
    // eslint-disable-next-line no-console
    console.log('[cron] backup-provider-sheets: backed up sheet', `${sheetId.slice(0, 8)}...`, `v${nextVersion}`)
  }

  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('[cron] backup-provider-sheets: BACKUP_COMPLETED_WITH_ERRORS', {
      sheets_total: sheetIds.length,
      backed_up: backedUp,
      errors,
    })
  } else {
    // eslint-disable-next-line no-console
    console.log('[cron] backup-provider-sheets: BACKUP_SUCCESS', { sheets_total: sheetIds.length, backed_up: backedUp })
  }

  return {
    success: true,
    sheets_total: sheetIds.length,
    backed_up: backedUp,
    ...(errors.length > 0 ? { errors } : {}),
  }
}
