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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(id: string): boolean {
  return UUID_REGEX.test(id)
}

/** sessionStorage key for temp-id → UUID promotions within this browser tab. */
const TEMP_ID_PROMOTIONS_STORAGE_KEY = 'provider_sheet_temp_id_promotions'

export function sheetTempIdPromotionKey(clinicId: string, providerId: string, monthKey: string): string {
  return `${clinicId}|${providerId}|${monthKey}`
}

function readTempIdPromotionStore(): Record<string, Record<string, string>> {
  try {
    const raw = sessionStorage.getItem(TEMP_ID_PROMOTIONS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, Record<string, string>>
  } catch {
    return {}
  }
}

function writeTempIdPromotionStore(store: Record<string, Record<string, string>>): void {
  try {
    sessionStorage.setItem(TEMP_ID_PROMOTIONS_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Quota / private mode: in-memory callers still have the Map for this save.
  }
}

/** Load known `new-*` / `empty-*` → UUID remaps for this sheet (same tab, survives remount). */
export function getTempIdPromotions(sheetKey: string): Map<string, string> {
  const bucket = readTempIdPromotionStore()[sheetKey] ?? {}
  return new Map(Object.entries(bucket))
}

/** Merge newly returned promotions and persist them for later saves / pagehide / restore. */
export function mergeTempIdPromotions(sheetKey: string, additions: Map<string, string>): Map<string, string> {
  if (additions.size === 0) return getTempIdPromotions(sheetKey)
  const store = readTempIdPromotionStore()
  const merged = { ...(store[sheetKey] ?? {}) }
  for (const [tempId, uuid] of additions) {
    if (tempId && uuid && !isUuid(tempId) && isUuid(uuid)) merged[tempId] = uuid
  }
  store[sheetKey] = merged
  writeTempIdPromotionStore(store)
  return new Map(Object.entries(merged))
}

/** Replace temp ids that the server already assigned so a later POST UPDATEs instead of INSERTing. */
export function applyTempIdPromotions<T extends { id: string }>(rows: T[], promotions: Map<string, string>): T[] {
  if (promotions.size === 0) return rows
  let changed = false
  const next = rows.map((row) => {
    const uuid = promotions.get(row.id)
    if (uuid && uuid !== row.id) {
      changed = true
      return { ...row, id: uuid }
    }
    return row
  })
  return changed ? next : rows
}

export function collectTempIdPromotions(
  sentRows: Array<{ id: string }>,
  savedRows: Array<{ id: string } | undefined | null>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (let i = 0; i < sentRows.length; i++) {
    const sent = sentRows[i]
    const saved = savedRows[i]
    if (!sent || !saved) continue
    if (!isUuid(sent.id) && isUuid(saved.id)) out.set(sent.id, saved.id)
  }
  return out
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

/** Optional observability hints supplied to the server audit log. Never affect the write. */
export interface SaveObservability {
  /** Human-readable trigger for the save. Enum-ish; the audit viewer groups by this. Examples:
   *  'debounced' (400ms after typing), 'pagehide-keepalive' (tab hidden mid-edit),
   *  'restore' (auto-backup restore), 'manual' (an explicit Save button), 'unknown' (default). */
  source?: string
  /** Rarely provided by the caller — usually generated inside saveSheetRowsViaApi via
   *  crypto.randomUUID(). Only pass an override if you're threading a correlation ID from a
   *  larger flow that already has one (e.g., restore → save → post-restore fetch). */
  correlationId?: string
}

/** UUID for `correlationId` when the browser exposes crypto.randomUUID (all modern browsers +
 *  our SSR-free deploy). Falls back to a timestamped random string so tests / older environments
 *  don't crash — the audit column is a plain text so any unique-ish value works. */
function generateCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `corr-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

async function saveSheetRowsViaApi(
  rows: SheetRow[],
  context: SaveSheetRowsContext,
  knownDeletedIds?: string[],
  observability?: SaveObservability,
): Promise<SheetRow[]> {
  const token = getAuthToken()
  if (!token) throw new Error('Not signed in')

  const body: Record<string, unknown> = {
    clinicId: context.clinicId,
    providerId: context.providerId,
    selectedMonthKey: context.selectedMonthKey,
    rows,
    correlationId: observability?.correlationId ?? generateCorrelationId(),
    source: observability?.source ?? 'unknown',
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
 * Save rows via the server API — the only sanctioned write path.
 *
 * The API carries the server-side write guard that protects appointment_date / claim_status /
 * submit_date from being nulled by a stale-snapshot payload (see serviceRoutes.saveProviderSheetRowsCore),
 * and it recomputes the clinic invoice. There is no fallback: if the caller isn't authenticated or the
 * sheet context can't be resolved, we throw so the caller's catch surfaces the failure via the save
 * error banner. The previous direct-DB fallback wrote every column including nulls and hid failures
 * from the banner — that was the path that caused Jenali's "data was there, then gone hours later"
 * loss (silent direct-DB fallback → nulls written → optimistic UI hides it → later fetch reveals the gap).
 *
 * - Existing rows (UUID ids) update; new rows (non-UUID ids) insert with a server-generated UUID.
 * - Deletes ONLY rows the caller explicitly enumerates in `knownDeletedIds`. The previous "orphan sweep"
 *   (DELETE everything not in the batch when knownDeletedIds was omitted) destroyed months of provider
 *   data when a stale or partial batch was saved and has been removed.
 *
 * Returns saved rows with real UUIDs in the same order as `rows`.
 */
export async function saveSheetRows(
  db: NativeClient,
  sheetId: string,
  rows: SheetRow[],
  knownDeletedIds?: string[],
  saveContext?: SaveSheetRowsContext,
  observability?: SaveObservability,
): Promise<SheetRow[]> {
  const context = await resolveSaveContext(db, sheetId, saveContext)
  if (!context) {
    throw new Error('saveSheetRows: unable to resolve save context (sheet not found or not accessible)')
  }
  if (!getAuthToken()) {
    throw new Error('saveSheetRows: not signed in')
  }
  return await saveSheetRowsViaApi(rows, context, knownDeletedIds, observability)
}
