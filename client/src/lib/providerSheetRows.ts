import type { SheetRow } from '@/types'
import type { NativeClient } from '@/lib/nativeClient'

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
 * - Orphan deletion: if `knownDeletedIds` is supplied the caller tells us exactly which DB
 *   rows disappeared (no SELECT needed). When omitted we fall back to a SELECT + DELETE so
 *   the behaviour is identical to the old implementation for callers that don't track deletes.
 *
 * Returns saved rows with real UUIDs in the same order as `rows`.
 */
export async function saveSheetRows(
  db: NativeClient,
  sheetId: string,
  rows: SheetRow[],
  knownDeletedIds?: string[],
): Promise<SheetRow[]> {
  let saved: SheetRow[]

  if (rows.length > 0) {
    // Build one payload per row. Existing rows carry their UUID so the server resolves
    // ON CONFLICT (id) → UPDATE. New rows omit id so the server INSERTs with a fresh UUID.
    const upsertPayloads = rows.map((row, i) => {
      const base = sheetRowToDbPayload(row, sheetId, i)
      if (isUuid(row.id)) {
        return { id: row.id, ...base, updated_at: new Date().toISOString() } as Record<string, unknown>
      }
      return { ...base, updated_at: new Date().toISOString() } as Record<string, unknown>
    })

    // One network round-trip for all rows (replaces N individual UPDATE/INSERT calls).
    const { data, error } = await db
      .from('provider_sheet_rows')
      .upsert(upsertPayloads, { onConflict: 'id' })
      .select()

    if (error) throw error

    // Map returned rows back to the original order.
    // Existing rows match by UUID; new rows match by sort_order (= their index in the array).
    const byUUID = new Map<string, SheetRow>()
    const bySortOrder = new Map<number, SheetRow>()
    for (const raw of (data ?? []) as ProviderSheetRowDb[]) {
      const sr = dbToSheetRow(raw)
      byUUID.set(raw.id, sr)
      bySortOrder.set(raw.sort_order, sr)
    }
    saved = rows.map((row, i) =>
      isUuid(row.id) ? (byUUID.get(row.id) ?? row) : (bySortOrder.get(i) ?? row)
    )
  } else {
    saved = []
  }

  // ── Orphan cleanup ────────────────────────────────────────────────────────────
  // Only needed when rows were actually removed from the list.
  if (knownDeletedIds !== undefined) {
    // Caller knows exactly which IDs were deleted — no extra SELECT required.
    if (knownDeletedIds.length > 0) {
      const { error: deleteError } = await db
        .from('provider_sheet_rows')
        .delete()
        .in('id', knownDeletedIds)
      if (deleteError) throw deleteError
    }
  } else {
    // Legacy path: fetch all DB ids for this sheet and delete anything not in our list.
    const idsToKeep = new Set(saved.filter(r => isUuid(r.id)).map(r => r.id))
    const { data: existing } = await db
      .from('provider_sheet_rows')
      .select('id')
      .eq('sheet_id', sheetId)
    const idsToDelete = ((existing ?? []) as { id: string }[])
      .map(r => r.id)
      .filter(id => !idsToKeep.has(id))
    if (idsToDelete.length > 0) {
      const { error: deleteError } = await db
        .from('provider_sheet_rows')
        .delete()
        .in('id', idsToDelete)
      if (deleteError) throw deleteError
    }
  }

  return saved
}
