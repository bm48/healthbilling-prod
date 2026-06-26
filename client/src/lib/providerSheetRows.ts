import type { SheetRow } from '@/types'
import type { NativeClient } from '@/lib/nativeClient'
import { getApiBase, getAuthToken } from '@/lib/invoiceApi'

/** DB row shape for provider_sheet_rows (snake_case, id is UUID). Patient demographics live in `patients`. */
export interface ProviderSheetRowDb {
  id: string
  sheet_id: string
  sort_order: number
  patient_id: string | null
  appointment_date: string | null
  appointment_time: string | null
  visit_type: string | null
  notes: string | null
  billing_code: string | null
  billing_code_color: string | null
  cpt_code: string | null
  cpt_code_color: string | null
  appointment_status: string | null
  appointment_status_color: string | null
  claim_status: string | null
  claim_status_color: string | null
  submit_date: string | null
  insurance_payment: string | null
  insurance_adjustment: string | null
  invoice_amount: number | null
  collected_from_patient: string | null
  patient_pay_status: string | null
  patient_pay_status_color: string | null
  payment_date: string | null
  payment_date_color: string | null
  ar_type: string | null
  ar_amount: number | null
  ar_date: string | null
  ar_date_color: string | null
  ar_notes: string | null
  provider_payment_amount: number | null
  provider_payment_date: string | null
  provider_payment_notes: string | null
  highlight_color: string | null
  total: string | null
  created_at: string
  updated_at: string
}

function dbToSheetRow(db: ProviderSheetRowDb): SheetRow {
  return {
    id: db.id,
    patient_id: db.patient_id,
    patient_first_name: null,
    patient_last_name: null,
    last_initial: null,
    patient_insurance: null,
    patient_copay: null,
    patient_coinsurance: null,
    appointment_date: db.appointment_date,
    appointment_time: db.appointment_time,
    visit_type: db.visit_type,
    notes: db.notes,
    billing_code: db.billing_code,
    billing_code_color: db.billing_code_color,
    cpt_code: db.cpt_code,
    cpt_code_color: db.cpt_code_color,
    appointment_status: db.appointment_status as SheetRow['appointment_status'],
    appointment_status_color: db.appointment_status_color,
    claim_status: db.claim_status as SheetRow['claim_status'],
    claim_status_color: db.claim_status_color,
    submit_date: db.submit_date,
    insurance_payment: db.insurance_payment,
    insurance_adjustment: db.insurance_adjustment,
    invoice_amount: db.invoice_amount,
    collected_from_patient: db.collected_from_patient,
    patient_pay_status: db.patient_pay_status as SheetRow['patient_pay_status'],
    patient_pay_status_color: db.patient_pay_status_color,
    payment_date: db.payment_date,
    payment_date_color: db.payment_date_color,
    ar_type: db.ar_type as SheetRow['ar_type'],
    ar_amount: db.ar_amount,
    ar_date: db.ar_date,
    ar_date_color: db.ar_date_color,
    ar_notes: db.ar_notes,
    provider_payment_amount: db.provider_payment_amount,
    provider_payment_date: db.provider_payment_date,
    provider_payment_notes: db.provider_payment_notes,
    highlight_color: db.highlight_color,
    total: db.total,
    created_at: db.created_at,
    updated_at: db.updated_at,
  }
}

function sheetRowToDbPayload(row: SheetRow, sheetId: string, sortOrder: number): Omit<ProviderSheetRowDb, 'id' | 'created_at' | 'updated_at'> {
  return {
    sheet_id: sheetId,
    sort_order: sortOrder,
    patient_id: row.patient_id ?? null,
    appointment_date: row.appointment_date ?? null,
    appointment_time: row.appointment_time ?? null,
    visit_type: row.visit_type ?? null,
    notes: row.notes ?? null,
    billing_code: row.billing_code ?? null,
    billing_code_color: row.billing_code_color ?? null,
    cpt_code: row.cpt_code ?? null,
    cpt_code_color: row.cpt_code_color ?? null,
    appointment_status: row.appointment_status ?? null,
    appointment_status_color: row.appointment_status_color ?? null,
    claim_status: row.claim_status ?? null,
    claim_status_color: row.claim_status_color ?? null,
    submit_date: row.submit_date ?? null,
    insurance_payment: row.insurance_payment ?? null,
    insurance_adjustment: row.insurance_adjustment ?? null,
    invoice_amount: row.invoice_amount ?? null,
    collected_from_patient: row.collected_from_patient ?? null,
    patient_pay_status: row.patient_pay_status ?? null,
    patient_pay_status_color: row.patient_pay_status_color ?? null,
    payment_date: row.payment_date ?? null,
    payment_date_color: row.payment_date_color ?? null,
    ar_type: row.ar_type ?? null,
    ar_amount: row.ar_amount ?? null,
    ar_date: row.ar_date ?? null,
    ar_date_color: row.ar_date_color ?? null,
    ar_notes: row.ar_notes ?? null,
    provider_payment_amount: row.provider_payment_amount ?? null,
    provider_payment_date: row.provider_payment_date ?? null,
    provider_payment_notes: row.provider_payment_notes ?? null,
    highlight_color: row.highlight_color ?? null,
    total: row.total ?? null,
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(id: string): boolean {
  return UUID_REGEX.test(id)
}

/** Aligns with server `rowHasData` so API save indices match returned rows. */
export function rowHasDataForSave(row: SheetRow): boolean {
  if (!row.id.startsWith('empty-')) return true
  return !!(
    row.patient_id ||
    row.appointment_date ||
    row.cpt_code ||
    row.appointment_status ||
    row.claim_status ||
    row.submit_date ||
    row.insurance_payment ||
    row.payment_date ||
    row.insurance_adjustment ||
    row.collected_from_patient ||
    row.patient_pay_status ||
    row.ar_date ||
    row.total !== null ||
    row.notes
  )
}

export type SaveSheetRowsContext = {
  clinicId: string
  providerId: string
  selectedMonthKey: string
}

function buildMonthKey(year: number, month: number, payroll: number): string {
  return payroll === 2 ? `${year}-${month}-2` : `${year}-${month}`
}

async function resolveSaveContext(
  db: NativeClient,
  sheetId: string,
  explicit?: SaveSheetRowsContext,
): Promise<SaveSheetRowsContext | null> {
  if (explicit) return explicit
  const { data, error } = await db
    .from('provider_sheets')
    .select('clinic_id, provider_id, month, year, payroll')
    .eq('id', sheetId)
    .maybeSingle()
  if (error || !data) return null
  const payroll = Number(data.payroll) === 2 ? 2 : 1
  return {
    clinicId: String(data.clinic_id),
    providerId: String(data.provider_id),
    selectedMonthKey: buildMonthKey(Number(data.year), Number(data.month), payroll),
  }
}

async function saveSheetRowsViaApi(
  rows: SheetRow[],
  context: SaveSheetRowsContext,
  knownDeletedIds?: string[],
): Promise<SheetRow[]> {
  const token = getAuthToken()
  if (!token) throw new Error('Not signed in')

  const body: Record<string, unknown> = {
    clinicId: context.clinicId,
    providerId: context.providerId,
    selectedMonthKey: context.selectedMonthKey,
    rows,
  }
  if (knownDeletedIds !== undefined) {
    body.knownDeletedIds = knownDeletedIds.filter((id) => isUuid(id))
  }

  const base = getApiBase()
  const res = await fetch(`${base}/api/save-provider-sheet-rows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Save failed (${res.status})`)
  }

  const apiRows = (payload?.rows ?? []) as ProviderSheetRowDb[]
  let apiIdx = 0
  return rows.map((row) => {
    if (!rowHasDataForSave(row)) return row
    const dbRow = apiRows[apiIdx++]
    if (!dbRow) return row
    return dbToSheetRow(dbRow)
  })
}

async function saveSheetRowsDirectDb(
  db: NativeClient,
  sheetId: string,
  rows: SheetRow[],
  knownDeletedIds?: string[],
): Promise<SheetRow[]> {
  let saved: SheetRow[]

  if (rows.length > 0) {
    const upsertPayloads = rows.map((row, i) => {
      const base = sheetRowToDbPayload(row, sheetId, i)
      if (isUuid(row.id)) {
        return { id: row.id, ...base, updated_at: new Date().toISOString() } as Record<string, unknown>
      }
      return { ...base, updated_at: new Date().toISOString() } as Record<string, unknown>
    })

    const { data, error } = await db
      .from('provider_sheet_rows')
      .upsert(upsertPayloads, { onConflict: 'id' })
      .select()

    if (error) throw error

    const byUUID = new Map<string, SheetRow>()
    const bySortOrder = new Map<number, SheetRow>()
    for (const raw of (data ?? []) as ProviderSheetRowDb[]) {
      const sr = dbToSheetRow(raw)
      byUUID.set(raw.id, sr)
      bySortOrder.set(raw.sort_order, sr)
    }
    saved = rows.map((row, i) =>
      isUuid(row.id) ? (byUUID.get(row.id) ?? row) : (bySortOrder.get(i) ?? row),
    )
  } else {
    saved = []
  }

  // Deletes ONLY when caller explicitly enumerates them. The implicit orphan sweep (SELECT all, DELETE
  // anything not in this batch) was the root cause of months-of-data being wiped when stale/partial
  // batches were saved. Mirrors the server-side guard in serviceRoutes.ts.
  if (knownDeletedIds !== undefined && knownDeletedIds.length > 0) {
    const { error: deleteError } = await db
      .from('provider_sheet_rows')
      .delete()
      .in('id', knownDeletedIds)
    if (deleteError) throw deleteError
  }

  return saved
}

/**
 * Fetch all rows for a provider sheet from provider_sheet_rows, ordered by sort_order.
 */
export async function fetchSheetRows(db: NativeClient, sheetId: string): Promise<SheetRow[]> {
  const { data, error } = await db
    .from('provider_sheet_rows')
    .select('*')
    .eq('sheet_id', sheetId)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data || []).map(dbToSheetRow)
}

/**
 * Load rows for many sheets in a single query (one round-trip per clinic month load).
 * Each sheet's rows are sorted by `sort_order`. Unknown sheet ids map to `[]`.
 */
export async function fetchSheetRowsForSheetIds(
  db: NativeClient,
  sheetIds: string[],
): Promise<Map<string, SheetRow[]>> {
  const out = new Map<string, SheetRow[]>()
  const unique = [...new Set(sheetIds.filter(Boolean))]
  for (const id of unique) out.set(id, [])
  if (unique.length === 0) return out

  const { data, error } = await db.from('provider_sheet_rows').select('*').in('sheet_id', unique)

  if (error) throw error

  const bySheet = new Map<string, ProviderSheetRowDb[]>()
  for (const id of unique) bySheet.set(id, [])
  for (const raw of (data || []) as ProviderSheetRowDb[]) {
    const sid = raw.sheet_id
    if (!bySheet.has(sid)) bySheet.set(sid, [])
    bySheet.get(sid)!.push(raw)
  }
  for (const [sid, dbRows] of bySheet) {
    dbRows.sort((a, b) => a.sort_order - b.sort_order)
    out.set(sid, dbRows.map(dbToSheetRow))
  }
  return out
}

/**
 * Save rows to provider_sheet_rows in as few requests as possible.
 *
 * - One batch UPSERT covers all rows: existing rows (UUID ids) update via ON CONFLICT (id),
 *   new rows (non-UUID ids) insert with a server-generated UUID.
 * - Deletes ONLY rows the caller explicitly enumerates in `knownDeletedIds`. The previous
 *   "orphan sweep" behaviour (DELETE everything not in the batch when knownDeletedIds was
 *   omitted) was removed after it destroyed months of provider data when a stale or partial
 *   batch was saved. Callers that legitimately delete rows MUST pass the deleted ids.
 *
 * Returns saved rows with real UUIDs in the same order as `rows`.
 */
/**
 * Save rows via server API (updates `invoices` for the clinic/month) when context is available.
 * Falls back to direct DB upsert only if the API cannot be used.
 */
export async function saveSheetRows(
  db: NativeClient,
  sheetId: string,
  rows: SheetRow[],
  knownDeletedIds?: string[],
  saveContext?: SaveSheetRowsContext,
): Promise<SheetRow[]> {
  const context = await resolveSaveContext(db, sheetId, saveContext)
  if (context && getAuthToken()) {
    // When authenticated, the API endpoint is the only sanctioned write path — it carries the
    // server-side write guard that protects appointment_date / claim_status / submit_date from being
    // nulled by a stale-snapshot payload (see serviceRoutes.saveProviderSheetRowsCore). The previous
    // try/catch swallowed API failures and silently fell back to the direct DB write, which (a) wrote
    // every column including nulls and (b) hid the failure from the user's error banner. That's the
    // path that caused Jenali's "data was there, then gone hours later" loss: an API hiccup → silent
    // direct-DB fallback → nulls written → optimistic UI hides the loss → later fetch reveals the gap.
    // Re-throw so the caller's catch surfaces the error.
    return await saveSheetRowsViaApi(rows, context, knownDeletedIds)
  }
  return saveSheetRowsDirectDb(db, sheetId, rows, knownDeletedIds)
}
