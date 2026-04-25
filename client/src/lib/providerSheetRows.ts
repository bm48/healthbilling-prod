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
function isUuid(id: string): boolean {
  return UUID_REGEX.test(id)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency))
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= items.length) return
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  })

  await Promise.all(workers)
  return results
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
 * Save rows to provider_sheet_rows. Rows with id matching existing UUID are updated;
 * rows with client ids (new-*, empty-*) are inserted. Any existing DB rows for this sheet
 * that are not in the given list are deleted (so deletes persist to the database).
 * Returns saved rows with real ids in same order.
 */
export async function saveSheetRows(
  db: NativeClient,
  sheetId: string,
  rows: SheetRow[]
): Promise<SheetRow[]> {
  const ROW_SAVE_CONCURRENCY = 12
  const saved = await mapWithConcurrency(rows, ROW_SAVE_CONCURRENCY, async (row, i) => {
    const payload = sheetRowToDbPayload(row, sheetId, i)

    if (isUuid(row.id)) {
      // Use .select() without .maybeSingle() so 0 rows (e.g. RLS or missing row) returns [] instead of 406 Not Acceptable
      const { data, error } = await db
        .from('provider_sheet_rows')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('sheet_id', sheetId)
        .select()

      if (error) throw error
      if (data && data.length > 0) return dbToSheetRow(data[0] as ProviderSheetRowDb)
      return row
    } else {
      const { data, error } = await db
        .from('provider_sheet_rows')
        .insert(payload)
        .select()
        .single()

      if (error) throw error
      return dbToSheetRow(data)
    }
  })

  // Delete any rows in the DB for this sheet that are no longer in our list (so deletes persist)
  const idsToKeep = saved.map(r => r.id)
  const { data: existing } = await db
    .from('provider_sheet_rows')
    .select('id')
    .eq('sheet_id', sheetId)
  const existingIds = (existing || []).map((r: { id: string }) => r.id)
  const idsToDelete = existingIds.filter(id => !idsToKeep.includes(id))
  if (idsToDelete.length > 0) {
    const { error: deleteError } = await db
      .from('provider_sheet_rows')
      .delete()
      .in('id', idsToDelete)
    if (deleteError) throw deleteError
  }

  return saved
}
