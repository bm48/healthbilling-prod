import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { Patient, Provider, SheetRow, StatusColor } from '@/types'
import MonthYearTabs from '@/components/MonthYearTabs'
import { readableTextColor, toDisplayDate } from '@/lib/utils'

export interface AdminTrackingTabProps {
  clinicId: string
  clinicPayroll?: 1 | 2
  providerId?: string
  providers: Provider[]
  /** Patients list is passed so future changes can enrich unlinked rows; currently the display reads
   *  patient_first_name / last_initial / patient_insurance straight off the row, which the Billing
   *  tab keeps in sync via enrichSheetRowsFromPatients. */
  patients: Patient[]
  statusColors: StatusColor[]
  /** Rows for the currently selected provider + month, sourced from `provider_sheet_rows` and used
   *  as the READ-ONLY base for this view. Admin edits are layered on top locally (see overlay
   *  below) and never propagate back to `provider_sheet_rows` — per Jenali's ask, Billing → Admin
   *  Tracking is one-way. */
  rows: SheetRow[]
  canEdit: boolean
  isInSplitScreen?: boolean
  selectedMonth: Date
  /** MonthYearTabs' single onChange fires with (date, payroll). We split it in the parent because
   *  the Billing month + payroll state is separate from the Provider-Pay clock. */
  onSelectMonth: (date: Date, payroll: 1 | 2) => void
  selectedPayroll?: 1 | 2
  onProviderChange?: (providerId: string) => void
}

/**
 * Column set for Admin Tracking, mapped to the exact same `provider_sheet_rows` fields the Billing
 * sheet uses (see ProvidersTab's `columnFieldsFullBase` + the column defs at ~line 1710-1794 in
 * that file). The Billing sheet's field order:
 *
 *   patient_id, patient_first_name, last_initial, patient_insurance,
 *   [copay, coinsurance hidden],
 *   appointment_date (Date of Service — real MM-DD-YY text),
 *   [cpt_code, appointment_status hidden],
 *   claim_status (colored dropdown),
 *   submit_date ("Most Recent" — free-form text),
 *   insurance_payment ("Ins Pay" — currency),
 *   payment_date ("Ins Pay Date" — colored MONTH dropdown, uses `payment_date_color`),
 *   insurance_adjustment ("PT RES" — currency),
 *   collected_from_patient ("PT Paid" — currency),
 *   patient_pay_status (colored dropdown),
 *   ar_date ("Patient Paid Month" — colored MONTH dropdown, uses `ar_date_color`).
 *
 * The `payment_date` / `ar_date` fields store month NAMES ("January", or "1st January" for biweekly
 * clinics), NOT calendar dates. This was called out in the ProvidersTab comment about
 * `PROVIDER_GRID_TEXT_FIELDS_FORMERLY_DATE` — routing them through a date parser nulls the column.
 */
type TrackingColumn =
  | { key: 'patient_id'; label: 'ID'; kind: 'text' }
  | { key: 'patient_first_name'; label: 'First Name'; kind: 'text' }
  | { key: 'last_initial'; label: 'LI'; kind: 'text' }
  | { key: 'patient_insurance'; label: 'Ins'; kind: 'text' }
  | { key: 'appointment_date'; label: 'Date of Service'; kind: 'date-text' }
  | { key: 'claim_status'; label: 'Claim Status'; kind: 'select-claim' }
  | { key: 'submit_date'; label: 'Most Recent'; kind: 'text' }
  | { key: 'insurance_payment'; label: 'Ins Pay'; kind: 'currency' }
  | { key: 'payment_date'; label: 'Ins Pay Date'; kind: 'select-month-payment' }
  | { key: 'insurance_adjustment'; label: 'PT RES'; kind: 'currency' }
  | { key: 'collected_from_patient'; label: 'PT Paid'; kind: 'currency' }
  | { key: 'patient_pay_status'; label: 'PT Pay Status'; kind: 'select-patient-pay' }
  | { key: 'ar_date'; label: 'Patient Paid Month'; kind: 'select-month-ar' }

const COLUMNS: TrackingColumn[] = [
  { key: 'patient_id', label: 'ID', kind: 'text' },
  { key: 'patient_first_name', label: 'First Name', kind: 'text' },
  { key: 'last_initial', label: 'LI', kind: 'text' },
  { key: 'patient_insurance', label: 'Ins', kind: 'text' },
  { key: 'appointment_date', label: 'Date of Service', kind: 'date-text' },
  { key: 'claim_status', label: 'Claim Status', kind: 'select-claim' },
  { key: 'submit_date', label: 'Most Recent', kind: 'text' },
  { key: 'insurance_payment', label: 'Ins Pay', kind: 'currency' },
  { key: 'payment_date', label: 'Ins Pay Date', kind: 'select-month-payment' },
  { key: 'insurance_adjustment', label: 'PT RES', kind: 'currency' },
  { key: 'collected_from_patient', label: 'PT Paid', kind: 'currency' },
  { key: 'patient_pay_status', label: 'PT Pay Status', kind: 'select-patient-pay' },
  { key: 'ar_date', label: 'Patient Paid Month', kind: 'select-month-ar' },
]

const CLAIM_STATUSES = [
  '',
  'Claim Sent',
  'N/A',
  'Paid',
  'Deductible',
  'RS',
  'IP',
  'Pending Pay',
  'Denial',
  'Rejected',
  'No Coverage',
] as const

const PATIENT_PAY_STATUSES = [
  '',
  'Paid',
  'CC declined',
  'Secondary',
  'Refunded',
  'Payment Plan',
  'Waiting on Claim',
  'Collections',
] as const

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Month options for the payment_date / ar_date dropdowns. Matches ProvidersTab's `months` array:
 *  biweekly clinics get "1st January" / "2nd January" pairs so the color-per-half stripes work. */
function getMonthOptions(clinicPayroll: 1 | 2 | undefined): readonly string[] {
  if (clinicPayroll === 2) {
    return ['', ...MONTH_NAMES.flatMap((m) => [`1st ${m}`, `2nd ${m}`])]
  }
  return ['', ...MONTH_NAMES]
}

const BASE_VISIBLE_ROWS = 20
const ADD_ROWS_STEP = 50

/** Parse currency-ish input ($1,234.56, "1234.56", or empty). Returns 0 for anything unparseable
 *  so a stray character in one cell never nukes the whole sum. */
function parseAmount(val: unknown): number {
  if (val == null || val === '') return 0
  const s = String(val).replace(/[,$\s]/g, '').trim()
  if (s === '') return 0
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** True if a currency raw parses to exactly zero. We treat these as "no value" everywhere in this
 *  tab — a lot of `provider_sheet_rows` rows come back with "0" / "0.00" in currency columns as a
 *  placeholder, and Jenali reported those "0"s were sticking around when she typed (bug: input
 *  starts with "0", "5" becomes "05"). Zero displays blank; typing into a blank cell starts fresh. */
function isZeroCurrencyRaw(raw: string): boolean {
  if (raw === '') return false
  const n = parseFloat(raw.replace(/[,$\s]/g, ''))
  return Number.isFinite(n) && n === 0
}

/** True if the row is not just an empty placeholder — used for #visits and the CSV export.
 *  We treat any row with a patient_id, name, appointment_date, or claim_status as a real visit. */
function isRealRow(row: SheetRow): boolean {
  return !!(
    row.patient_id ||
    row.patient_first_name ||
    row.last_initial ||
    row.appointment_date ||
    row.claim_status ||
    row.insurance_payment ||
    row.collected_from_patient
  )
}

interface TrackingSummary {
  insPay: number
  collectedFromPt: number
  total: number
  arTotal: number
  visits: number
  noShowsAndCancels: number
  paid: number
  claimSent: number
  other: number
}

function computeSummary(rows: SheetRow[]): TrackingSummary {
  let insPay = 0
  let collectedFromPt = 0
  let arTotal = 0
  let visits = 0
  let noShowsAndCancels = 0
  let paid = 0
  let claimSent = 0
  let other = 0
  for (const row of rows) {
    if (!isRealRow(row)) continue
    visits += 1
    insPay += parseAmount(row.insurance_payment)
    collectedFromPt += parseAmount(row.collected_from_patient)
    arTotal += parseAmount(row.ar_amount)
    if (row.appointment_status === 'No Show' || row.appointment_status === 'Cancellation') {
      noShowsAndCancels += 1
    }
    if (row.claim_status === 'Paid') paid += 1
    else if (row.claim_status === 'Claim Sent') claimSent += 1
    else if (row.claim_status) other += 1
  }
  return {
    insPay,
    collectedFromPt,
    total: insPay + collectedFromPt,
    arTotal,
    visits,
    noShowsAndCancels,
    paid,
    claimSent,
    other,
  }
}

function csvEscape(s: string): string {
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function downloadCsv(providerName: string, monthLabel: string, rows: SheetRow[]) {
  const header = COLUMNS.map((c) => csvEscape(c.label)).join(',')
  const dataRows = rows.filter(isRealRow).map((row) =>
    COLUMNS.map((c) => csvEscape(toDisplayed(row, c))).join(',')
  )
  // UTF-8 BOM so Excel opens as UTF-8 and doesn't fall into SYLK detection on the first cell.
  const csv = '﻿' + header + '\n' + dataRows.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const safeProvider = providerName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'Provider'
  const safeMonth = monthLabel.replace(/[^a-zA-Z0-9_\- ]/g, '').trim()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeProvider}_AdminTracking_${safeMonth}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function pickProviderForFallback(providers: Provider[], preferId?: string): Provider | null {
  if (preferId) {
    const match = providers.find((p) => p.id === preferId)
    if (match) return match
  }
  return providers.find((p) => !p.id.startsWith('new-')) ?? null
}

/** Overlay = per-cell edits made in Admin Tracking that must NOT reach Billing. Keyed by row.id →
 *  partial patch of the row. Persisted to localStorage so a refresh preserves the admin's work,
 *  scoped by clinic + provider + month (+ payroll half for biweekly clinics) so switching context
 *  loads the right slice. */
type OverlayMap = Record<string, Partial<SheetRow>>

function overlayStorageKey(
  clinicId: string,
  providerId: string | undefined,
  selectedMonth: Date,
  clinicPayroll: 1 | 2 | undefined,
  selectedPayroll: 1 | 2 | undefined,
): string {
  const y = selectedMonth.getFullYear()
  const m = String(selectedMonth.getMonth() + 1).padStart(2, '0')
  const base = `admin_tracking_overlay:${clinicId}:${providerId ?? ''}:${y}-${m}`
  return clinicPayroll === 2 ? `${base}:${selectedPayroll ?? 1}` : base
}

function loadOverlay(key: string): OverlayMap {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as OverlayMap) : {}
  } catch {
    return {}
  }
}

function persistOverlay(key: string, overlay: OverlayMap): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(key, JSON.stringify(overlay))
  } catch {
    // Storage full / disabled — silently ignore; the in-memory overlay still works for the session.
  }
}

/** Fields that carry a sibling `_color` cache. When the admin overrides the value, we must also
 *  null out the cached color so `statusColorForCell`'s fallback recomputes the color from the new
 *  value; otherwise the stale color (from the Billing row) would keep painting the cell. */
const COLOR_LINKED_FIELDS: Record<string, keyof SheetRow> = {
  claim_status: 'claim_status_color',
  patient_pay_status: 'patient_pay_status_color',
  payment_date: 'payment_date_color',
  ar_date: 'ar_date_color',
}

export default function AdminTrackingTab({
  clinicId,
  clinicPayroll,
  providerId,
  providers,
  statusColors,
  rows,
  canEdit,
  isInSplitScreen,
  selectedMonth,
  onSelectMonth,
  selectedPayroll,
  onProviderChange,
}: AdminTrackingTabProps) {
  const effectiveProvider = pickProviderForFallback(providers, providerId)
  const effectiveProviderId = effectiveProvider?.id

  const [visibleRowCount, setVisibleRowCount] = useState<number>(BASE_VISIBLE_ROWS)
  useEffect(() => {
    setVisibleRowCount((prev) => Math.max(prev, BASE_VISIBLE_ROWS))
  }, [effectiveProviderId])

  const overlayKey = useMemo(
    () => overlayStorageKey(clinicId, effectiveProviderId, selectedMonth, clinicPayroll, selectedPayroll),
    [clinicId, effectiveProviderId, selectedMonth, clinicPayroll, selectedPayroll],
  )
  const [overlay, setOverlay] = useState<OverlayMap>(() => loadOverlay(overlayKey))
  useEffect(() => {
    setOverlay(loadOverlay(overlayKey))
  }, [overlayKey])

  /** Merged rows = Billing base + admin overlay applied on top. Every derived value (displayed
   *  rows, summary, CSV) reads from this, never from `rows` directly, so the admin sees a
   *  consistent view of their edits without any of them leaking back to Billing. */
  const mergedRows = useMemo(() => {
    if (Object.keys(overlay).length === 0) return rows
    return rows.map((row) => {
      const patch = overlay[row.id]
      return patch ? { ...row, ...patch } : row
    })
  }, [rows, overlay])

  // Never hide a populated row. When the user has more than BASE_VISIBLE_ROWS of real data, extend
  // the visible range to cover every populated row plus a small buffer of empties so they can still
  // add new rows without immediately hitting "+ Add 50 rows". Without this cap-bump, rows past
  // row 20 were rendered as hidden even though `rows` had 200 entries from the parent's pad.
  const populatedRowCount = useMemo(() => {
    for (let i = mergedRows.length - 1; i >= 0; i--) {
      if (isRealRow(mergedRows[i])) return i + 1
    }
    return 0
  }, [mergedRows])
  const effectiveVisibleCount = Math.min(
    mergedRows.length,
    Math.max(visibleRowCount, populatedRowCount + BASE_VISIBLE_ROWS),
  )
  const displayedRows = useMemo(
    () => mergedRows.slice(0, effectiveVisibleCount),
    [mergedRows, effectiveVisibleCount],
  )
  const summary = useMemo(() => computeSummary(mergedRows), [mergedRows])
  const monthLabelForCsv = useMemo(
    () => selectedMonth.toLocaleString(undefined, { year: 'numeric', month: '2-digit' }),
    [selectedMonth]
  )

  const applyEdit = useCallback(
    (rowId: string, field: keyof SheetRow, rawValue: string) => {
      if (!canEdit) return
      const trimmed = rawValue === '' ? null : rawValue
      setOverlay((prev) => {
        const rowPatch: Partial<SheetRow> = { ...(prev[rowId] ?? {}), [field]: trimmed as any }
        const colorField = COLOR_LINKED_FIELDS[field as string]
        if (colorField) {
          // Null the cached color; statusColorForCell will re-derive from the new value via
          // status_colors so the swatch matches (e.g., Paid → green, Denial → red).
          ;(rowPatch as any)[colorField] = null
        }
        const next: OverlayMap = { ...prev, [rowId]: rowPatch }
        persistOverlay(overlayKey, next)
        return next
      })
    },
    [canEdit, overlayKey],
  )

  // Refs for Enter-key row navigation. Keyed by `${rowIdx}:${colIdx}` — cells register their
  // editable element on mount and unregister on unmount. Pressing Enter in a cell focuses the same
  // column in the next row (spreadsheet-like), per Jenali's ask.
  const inputRefs = useRef<Map<string, HTMLInputElement | HTMLSelectElement>>(new Map())
  const registerCellRef = useCallback(
    (rowIdx: number, colIdx: number, el: HTMLInputElement | HTMLSelectElement | null) => {
      const key = `${rowIdx}:${colIdx}`
      if (el) inputRefs.current.set(key, el)
      else inputRefs.current.delete(key)
    },
    [],
  )
  const focusNextRowCell = useCallback((rowIdx: number, colIdx: number) => {
    const target = inputRefs.current.get(`${rowIdx + 1}:${colIdx}`)
    if (!target) return
    target.focus()
    if (target instanceof HTMLInputElement) {
      // Select all so the next Enter-then-type overwrites cleanly, matching Excel/Sheets behavior.
      target.select()
    }
  }, [])

  const handleAddRows = () => {
    setVisibleRowCount((n) => n + ADD_ROWS_STEP)
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-white/80 text-sm">Provider:</span>
          <select
            value={effectiveProviderId ?? ''}
            onChange={(e) => onProviderChange?.(e.target.value)}
            className="px-2 py-1 rounded border border-white/20 bg-slate-800/80 text-white text-sm min-w-[10rem]"
            disabled={providers.length === 0}
          >
            {providers.filter((p) => !p.id.startsWith('new-')).map((p) => (
              <option key={p.id} value={p.id} style={{ backgroundColor: '#1e293b', color: '#ffffff' }}>
                {p.first_name} {p.last_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <MonthYearTabs
        selectedMonth={selectedMonth}
        selectedPayroll={selectedPayroll ?? 1}
        clinicPayroll={clinicPayroll ?? 1}
        statusColors={statusColors}
        onChange={onSelectMonth}
        label="Admin Tracking"
        isInSplitScreen={isInSplitScreen}
      />

      {/* Table styled to match the real Billing sheet (`.table-spreadsheet` in table-styles.css) but
       *  swapped to a light-grey base instead of white so super-admin can tell at a glance which
       *  view they're on. Header stays dark-blue (#1e3a8a) like Billing.
       *  max-height + overflow-auto so the body scrolls inside the container while the sticky
       *  header stays pinned. Without this, the container grew past the viewport and page-scroll
       *  pushed the header off-screen. Split-screen gets less height for the same reason
       *  MonthYearTabs does — the pane's already inside a fixed-height frame. */}
      <div
        className="overflow-auto rounded border border-slate-300 shadow-sm"
        style={{
          backgroundColor: '#f1f5f9',
          maxHeight: isInSplitScreen ? 'calc(100vh - 340px)' : 'calc(100vh - 300px)',
        }}
      >
        <table className="min-w-full text-sm border-collapse" style={{ color: '#212529' }}>
          <thead>
            <tr style={{ backgroundColor: '#1e3a8a', color: '#ffffff' }} className="text-xs uppercase">
              <th className="px-2 py-1.5 text-left w-10 border border-blue-500 sticky top-0 z-10">#</th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="px-2 py-1.5 text-left border border-blue-500 whitespace-nowrap sticky top-0 z-10"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayedRows.map((row, idx) => (
              <tr
                key={row.id}
                // Alternating: odd rows are the light-grey base, even rows a shade lighter for
                // the same "banded" feel the Billing sheet has.
                style={{ backgroundColor: idx % 2 === 0 ? '#f8fafc' : '#e2e8f0' }}
              >
                <td className="px-2 py-0.5 border border-slate-300 text-slate-500 text-xs text-center">
                  {idx + 1}
                </td>
                {COLUMNS.map((col, colIdx) => (
                  <TrackingCell
                    key={col.key}
                    row={row}
                    column={col}
                    canEdit={canEdit}
                    clinicPayroll={clinicPayroll}
                    statusColors={statusColors}
                    rowIdx={idx}
                    colIdx={colIdx}
                    registerRef={registerCellRef}
                    onEnterNext={() => focusNextRowCell(idx, colIdx)}
                    onEdit={(value) => applyEdit(row.id, col.key, value)}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-4 rounded border border-white/20 bg-slate-900/60 px-3 py-2 text-white text-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="font-semibold text-white/70">Sums:</span>
          <SummaryValue label="Ins Pay" value={formatCurrency(summary.insPay)} />
          <SummaryValue label="Collected from PT" value={formatCurrency(summary.collectedFromPt)} />
          <SummaryValue label="Total" value={formatCurrency(summary.total)} />
          <SummaryValue label="AR Total" value={formatCurrency(summary.arTotal)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded border border-white/20 bg-slate-900/60 px-3 py-2 text-white text-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <SummaryValue label="#visits" value={String(summary.visits)} />
          <SummaryValue label="#No shows/cancels" value={String(summary.noShowsAndCancels)} />
          <SummaryValue label="#Paid" value={String(summary.paid)} />
          <SummaryValue label="#Claim Sent" value={String(summary.claimSent)} />
          {/* Per Jenali: everything not Paid or Claim Sent (RS, Denial, No Coverage, etc.) */}
          <SummaryValue label="#Other" value={String(summary.other)} />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            const providerName = effectiveProvider ? `${effectiveProvider.first_name} ${effectiveProvider.last_name}` : 'Provider'
            downloadCsv(providerName, monthLabelForCsv, mergedRows)
          }}
          className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20"
        >
          Download CSV
        </button>
        <button
          type="button"
          onClick={handleAddRows}
          className="px-3 py-1.5 rounded bg-primary-500/20 hover:bg-primary-500/40 text-white text-sm border border-primary-400/60"
        >
          + Add {ADD_ROWS_STEP} rows
        </button>
      </div>

      {rows.length === 0 && (
        <div className="text-white/60 text-sm italic">
          No rows loaded for this provider / month yet.
        </div>
      )}
    </div>
  )
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-white/70">{label}:</span>
      <span className="font-medium">{value}</span>
    </span>
  )
}

interface TrackingCellProps {
  row: SheetRow
  column: TrackingColumn
  canEdit: boolean
  clinicPayroll?: 1 | 2
  statusColors: StatusColor[]
  rowIdx: number
  colIdx: number
  registerRef: (rowIdx: number, colIdx: number, el: HTMLInputElement | HTMLSelectElement | null) => void
  onEnterNext: () => void
  onEdit: (value: string) => void
}

/** Which `status_colors.type` a dropdown column pulls its per-option colors from. */
function statusColorTypeForColumn(column: TrackingColumn): StatusColor['type'] | null {
  if (column.kind === 'select-claim') return 'claim'
  if (column.kind === 'select-patient-pay') return 'patient_pay'
  if (column.kind === 'select-month-payment' || column.kind === 'select-month-ar') return 'month'
  return null
}

/** Look up { bg, fg } for a single dropdown option label. Matches ProvidersTab's `getStatusColor` /
 *  `getMonthColor`: month values may be prefixed with "1st " / "2nd " for biweekly clinics, but the
 *  `status_colors` row is stored under the plain month name. */
function optionColor(
  statusColors: StatusColor[],
  type: StatusColor['type'],
  value: string,
): { bg: string; fg: string } | null {
  if (!value) return null
  const lookup = type === 'month' ? value.replace(/^(1st|2nd)\s+/i, '').trim() : value
  const match = statusColors.find((s) => s.status === lookup && s.type === type)
  if (!match) return null
  return { bg: match.color, fg: match.text_color || readableTextColor(match.color) }
}

/** Raw stored value as a string, unformatted. This is what goes into `<input>` when focused (so the
 *  user can edit the actual digits without fighting a formatter) and what we save back to the row. */
function toRaw(row: SheetRow, key: TrackingColumn['key']): string {
  const raw = (row as any)[key]
  if (raw == null || raw === '') return ''
  return String(raw)
}

/** Raw value tuned for editing: same as toRaw, except zero-valued currency is returned as ''.
 *  This is what fills the input's `draft` so the user typing "5" into a "0"-backed cell doesn't
 *  produce "05". */
function editableRawFor(row: SheetRow, column: TrackingColumn): string {
  const raw = toRaw(row, column.key)
  if (column.kind === 'currency' && isZeroCurrencyRaw(raw)) return ''
  return raw
}

/** Formatted value for display when NOT focused — matches the Billing sheet's presentation:
 *  MM-DD-YY for real dates, "$1,234.56" for currency, raw text for everything else. Empty stays
 *  empty (no "$0.00" or "mm/dd/yyyy" filler, per Jenali). Zero-valued currency also renders as
 *  blank, since Billing sometimes seeds those columns with "0" as a placeholder. */
function toDisplayed(row: SheetRow, column: TrackingColumn): string {
  const raw = toRaw(row, column.key)
  if (raw === '') return ''
  if (column.kind === 'date-text') return toDisplayDate(raw)
  if (column.kind === 'currency') {
    const n = parseFloat(raw.replace(/[,$\s]/g, ''))
    if (!Number.isFinite(n)) return raw
    if (n === 0) return ''
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return raw
}

/** Read the per-row status color for a cell. Prefer the `_color` sibling on the row (that's what
 *  the Billing sheet writes when Jenali picks a status), but fall back to a fresh `status_colors`
 *  lookup by the current value. Without the fallback, rows saved before the color-derivation was in
 *  place — or rows saved through a code path that skips derivation — render as plain grey even
 *  when the value is a well-known status like "Paid". */
function statusColorForCell(
  row: SheetRow,
  column: TrackingColumn,
  statusColors: StatusColor[],
): { bg?: string; fg?: string } {
  let cachedBg: string | null | undefined
  let value: string | null | undefined
  let type: StatusColor['type'] | null = null
  if (column.kind === 'select-claim') {
    cachedBg = row.claim_status_color
    value = row.claim_status
    type = 'claim'
  } else if (column.kind === 'select-patient-pay') {
    cachedBg = row.patient_pay_status_color
    value = row.patient_pay_status
    type = 'patient_pay'
  } else if (column.kind === 'select-month-payment') {
    cachedBg = row.payment_date_color
    value = row.payment_date
    type = 'month'
  } else if (column.kind === 'select-month-ar') {
    cachedBg = row.ar_date_color
    value = row.ar_date
    type = 'month'
  }
  if (cachedBg) return { bg: cachedBg, fg: readableTextColor(cachedBg) }
  if (!value || !type) return {}
  const looked = optionColor(statusColors, type, value)
  return looked ? { bg: looked.bg, fg: looked.fg } : {}
}

function TrackingCell({
  row,
  column,
  canEdit,
  clinicPayroll,
  statusColors,
  rowIdx,
  colIdx,
  registerRef,
  onEnterNext,
  onEdit,
}: TrackingCellProps) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState<string>(() => editableRawFor(row, column))
  useEffect(() => {
    if (!focused) setDraft(editableRawFor(row, column))
  }, [row, column, focused])

  const readOnly = !canEdit
  // Transparent-bg input so the <td>'s status color (when present) shows through. Dark text so
  // it reads on the light table body — matches the Billing sheet's black-on-white cells.
  const baseInput =
    'w-full px-1.5 py-0.5 bg-transparent border border-transparent hover:border-slate-400 focus:bg-white focus:border-primary-500 focus:outline-none text-slate-900 text-sm disabled:opacity-60'

  const { bg, fg } = statusColorForCell(row, column, statusColors)
  const tdStyle: CSSProperties = {
    borderColor: '#cbd5e1',
    ...(bg ? { backgroundColor: bg, color: fg } : {}),
  }
  const inputStyle: CSSProperties = fg ? { color: fg } : {}

  const isDropdown =
    column.kind === 'select-claim' ||
    column.kind === 'select-patient-pay' ||
    column.kind === 'select-month-payment' ||
    column.kind === 'select-month-ar'

  const handleEnter = (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    // For text-like cells commit the pending draft first (blur would do this, but Enter skips blur
    // because we call focus() on the next cell — which does fire our onBlur, but only AFTER the
    // committed value has been read from state). Belt-and-braces: commit synchronously here so
    // the overlay sees the edit before focus moves.
    if (!isDropdown && draft !== editableRawFor(row, column)) onEdit(draft)
    onEnterNext()
  }

  if (isDropdown) {
    let options: readonly string[]
    if (column.kind === 'select-claim') options = CLAIM_STATUSES
    else if (column.kind === 'select-patient-pay') options = PATIENT_PAY_STATUSES
    else options = getMonthOptions(clinicPayroll)
    const colorType = statusColorTypeForColumn(column)
    return (
      <td className="px-0.5 py-0 border border-slate-300 align-middle" style={tdStyle}>
        <select
          ref={(el) => registerRef(rowIdx, colIdx, el)}
          value={draft}
          onChange={(e) => {
            const next = e.target.value
            setDraft(next)
            onEdit(next)
          }}
          onKeyDown={handleEnter}
          disabled={readOnly}
          className={baseInput}
          style={inputStyle}
        >
          {options.map((opt) => {
            // Paint each option with its status color (Paid=green, Denial=red, etc.) to match the
            // Billing sheet's colored dropdown list. Native <option> ignores Tailwind but respects
            // inline background-color / color in every browser we support (Chrome/Edge/Firefox).
            const color = colorType ? optionColor(statusColors, colorType, opt) : null
            const style = color
              ? { backgroundColor: color.bg, color: color.fg }
              : { backgroundColor: '#ffffff', color: '#212529' }
            return (
              <option key={opt} value={opt} style={style}>
                {opt || ''}
              </option>
            )
          })}
        </select>
      </td>
    )
  }

  // Text-like cells (text, date-text, currency): show raw digits while focused (so the user can
  // edit without fighting the formatter), show formatted value when unfocused. No placeholder — an
  // empty box stays empty, per Jenali's "no filler" ask.
  const shownValue = focused ? draft : toDisplayed(row, column)
  const inputAlign =
    column.kind === 'currency' ? 'text-right' : column.kind === 'date-text' ? 'text-center' : ''

  return (
    <td className="px-0.5 py-0 border border-slate-300 align-middle" style={tdStyle}>
      <input
        ref={(el) => registerRef(rowIdx, colIdx, el)}
        type="text"
        value={shownValue}
        onFocus={() => {
          setDraft(editableRawFor(row, column))
          setFocused(true)
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleEnter}
        onBlur={() => {
          setFocused(false)
          if (draft !== editableRawFor(row, column)) onEdit(draft)
        }}
        disabled={readOnly}
        className={`${baseInput} ${inputAlign}`}
        style={inputStyle}
      />
    </td>
  )
}
