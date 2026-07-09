import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
  /** Rows for the currently selected provider + month, sourced from `provider_sheet_rows`.
   *  Same underlying state as the Billing tab so edits mirror automatically. */
  rows: SheetRow[]
  canEdit: boolean
  isInSplitScreen?: boolean
  selectedMonth: Date
  /** MonthYearTabs' single onChange fires with (date, payroll). We split it in the parent because
   *  the Billing month + payroll state is separate from the Provider-Pay clock. */
  onSelectMonth: (date: Date, payroll: 1 | 2) => void
  selectedPayroll?: 1 | 2
  /** Update a single cell on the provider's sheet. Same callback the Billing tab uses. */
  onUpdateRow: (providerId: string, rowId: string, field: string, value: any) => void
  /** Immediate save trigger — parent's `saveProviderSheetRowsDirect`. We debounce edits here and
   *  call this with the latest rows once the debounce window closes. */
  onSaveRows: (providerId: string, rows: SheetRow[]) => Promise<void>
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
const DEBOUNCE_MS = 400

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

export default function AdminTrackingTab({
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
  onUpdateRow,
  onSaveRows,
  onProviderChange,
}: AdminTrackingTabProps) {
  const effectiveProvider = pickProviderForFallback(providers, providerId)
  const effectiveProviderId = effectiveProvider?.id

  const [visibleRowCount, setVisibleRowCount] = useState<number>(BASE_VISIBLE_ROWS)
  useEffect(() => {
    setVisibleRowCount((prev) => Math.max(prev, BASE_VISIBLE_ROWS))
  }, [effectiveProviderId])

  const displayedRows = useMemo(() => rows.slice(0, visibleRowCount), [rows, visibleRowCount])
  const summary = useMemo(() => computeSummary(rows), [rows])
  const monthLabelForCsv = useMemo(
    () => selectedMonth.toLocaleString(undefined, { year: 'numeric', month: '2-digit' }),
    [selectedMonth]
  )

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRowsRef = useRef<SheetRow[]>(rows)
  useEffect(() => { latestRowsRef.current = rows }, [rows])
  const pendingSavePidRef = useRef<string | null>(null)
  const onSaveRowsRef = useRef(onSaveRows)
  useEffect(() => { onSaveRowsRef.current = onSaveRows }, [onSaveRows])

  useEffect(() => () => {
    // If the user switches tabs while a save is scheduled, don't drop it — fire immediately so their
    // edit reaches the DB. Silent drop was the class of bug the "Silent save guards" memory calls out.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      const pid = pendingSavePidRef.current
      if (pid) {
        void onSaveRowsRef.current(pid, latestRowsRef.current).catch((err) => {
          console.error('[AdminTrackingTab] unmount-flush save failed:', err)
        })
      }
    }
    pendingSavePidRef.current = null
  }, [])

  const scheduleSave = () => {
    if (!effectiveProviderId) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    pendingSavePidRef.current = effectiveProviderId
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      const pid = pendingSavePidRef.current
      pendingSavePidRef.current = null
      if (!pid) return
      void onSaveRowsRef.current(pid, latestRowsRef.current).catch((err) => {
        console.error('[AdminTrackingTab] debounced save failed:', err)
      })
    }, DEBOUNCE_MS)
  }

  const applyEdit = (rowId: string, field: string, rawValue: string) => {
    if (!canEdit || !effectiveProviderId) return
    const trimmed = rawValue === '' ? null : rawValue
    onUpdateRow(effectiveProviderId, rowId, field, trimmed)
    scheduleSave()
  }

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
       *  view they're on. Header stays dark-blue (#1e3a8a) like Billing. */}
      <div className="overflow-auto rounded border border-slate-300 shadow-sm" style={{ backgroundColor: '#f1f5f9' }}>
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
                {COLUMNS.map((col) => (
                  <TrackingCell
                    key={col.key}
                    row={row}
                    column={col}
                    canEdit={canEdit}
                    clinicPayroll={clinicPayroll}
                    statusColors={statusColors}
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
            downloadCsv(providerName, monthLabelForCsv, rows)
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

/** Formatted value for display when NOT focused — matches the Billing sheet's presentation:
 *  MM-DD-YY for real dates, "$1,234.56" for currency, raw text for everything else. Empty stays
 *  empty (no "$0.00" or "mm/dd/yyyy" filler, per Jenali). */
function toDisplayed(row: SheetRow, column: TrackingColumn): string {
  const raw = toRaw(row, column.key)
  if (raw === '') return ''
  if (column.kind === 'date-text') return toDisplayDate(raw)
  if (column.kind === 'currency') {
    const n = parseFloat(raw.replace(/[,$\s]/g, ''))
    if (!Number.isFinite(n)) return raw
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return raw
}

/** Read the per-row status color from the same fields the Billing sheet writes: the `_color`
 *  siblings on SheetRow. Painting the whole cell (not just a badge) matches Handsontable's look
 *  and keeps #Paid/#Claim Sent/#Other recognizable at a glance without a legend. */
function statusColorForCell(row: SheetRow, column: TrackingColumn): { bg?: string; fg?: string } {
  let bg: string | null | undefined
  if (column.kind === 'select-claim') bg = row.claim_status_color
  else if (column.kind === 'select-patient-pay') bg = row.patient_pay_status_color
  else if (column.kind === 'select-month-payment') bg = row.payment_date_color
  else if (column.kind === 'select-month-ar') bg = row.ar_date_color
  if (!bg) return {}
  return { bg, fg: readableTextColor(bg) }
}

function TrackingCell({ row, column, canEdit, clinicPayroll, statusColors, onEdit }: TrackingCellProps) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState<string>(toRaw(row, column.key))
  useEffect(() => {
    if (!focused) setDraft(toRaw(row, column.key))
  }, [row, column.key, focused])

  const readOnly = !canEdit
  // Transparent-bg input so the <td>'s status color (when present) shows through. Dark text so
  // it reads on the light table body — matches the Billing sheet's black-on-white cells.
  const baseInput =
    'w-full px-1.5 py-0.5 bg-transparent border border-transparent hover:border-slate-400 focus:bg-white focus:border-primary-500 focus:outline-none text-slate-900 text-sm disabled:opacity-60'

  const { bg, fg } = statusColorForCell(row, column)
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

  if (isDropdown) {
    let options: readonly string[]
    if (column.kind === 'select-claim') options = CLAIM_STATUSES
    else if (column.kind === 'select-patient-pay') options = PATIENT_PAY_STATUSES
    else options = getMonthOptions(clinicPayroll)
    const colorType = statusColorTypeForColumn(column)
    return (
      <td className="px-0.5 py-0 border border-slate-300 align-middle" style={tdStyle}>
        <select
          value={draft}
          onChange={(e) => {
            const next = e.target.value
            setDraft(next)
            onEdit(next)
          }}
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
        type="text"
        value={shownValue}
        onFocus={() => {
          setDraft(toRaw(row, column.key))
          setFocused(true)
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false)
          if (draft !== toRaw(row, column.key)) onEdit(draft)
        }}
        disabled={readOnly}
        className={`${baseInput} ${inputAlign}`}
        style={inputStyle}
      />
    </td>
  )
}
