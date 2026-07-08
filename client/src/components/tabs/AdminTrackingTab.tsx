import { useEffect, useMemo, useRef, useState } from 'react'
import type { Patient, Provider, SheetRow, StatusColor } from '@/types'
import MonthYearTabs from '@/components/MonthYearTabs'

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
 * Slimmed column set Jenali locked in for the Admin Tracking view. Each column reads/writes a
 * `provider_sheet_rows` field — mirroring the Billing sheet's underlying state so edits sync in
 * real time without a separate save path.
 *
 * "Most Recent" and "Ins Pay Date" are Jenali's Admin-view labels; the underlying columns are the
 * Billing sheet's `submit_date` (K) and `payment_date` (Q) respectively. These labels came from the
 * `is_lock_providers` payload (`most_recent_submit_date`, `ins_pay_date`) which is the closest
 * thing we have to a source of truth for Jenali's naming. If she says either label is mapped to
 * the wrong field, only this table needs updating.
 */
type TrackingColumn =
  | { key: 'patient_id'; label: 'ID'; kind: 'text' }
  | { key: 'patient_first_name'; label: 'First Name'; kind: 'text' }
  | { key: 'last_initial'; label: 'LI'; kind: 'text' }
  | { key: 'patient_insurance'; label: 'Ins'; kind: 'text' }
  | { key: 'appointment_date'; label: 'Date of Service'; kind: 'date' }
  | { key: 'claim_status'; label: 'Claim Status'; kind: 'select-claim' }
  | { key: 'submit_date'; label: 'Most Recent'; kind: 'date' }
  | { key: 'insurance_payment'; label: 'Ins Pay'; kind: 'currency' }
  | { key: 'payment_date'; label: 'Ins Pay Date'; kind: 'date' }
  | { key: 'invoice_amount'; label: 'PT RES'; kind: 'currency' }
  | { key: 'collected_from_patient'; label: 'PT Paid'; kind: 'currency' }
  | { key: 'patient_pay_status'; label: 'PT Pay Status'; kind: 'select-patient-pay' }

const COLUMNS: TrackingColumn[] = [
  { key: 'patient_id', label: 'ID', kind: 'text' },
  { key: 'patient_first_name', label: 'First Name', kind: 'text' },
  { key: 'last_initial', label: 'LI', kind: 'text' },
  { key: 'patient_insurance', label: 'Ins', kind: 'text' },
  { key: 'appointment_date', label: 'Date of Service', kind: 'date' },
  { key: 'claim_status', label: 'Claim Status', kind: 'select-claim' },
  { key: 'submit_date', label: 'Most Recent', kind: 'date' },
  { key: 'insurance_payment', label: 'Ins Pay', kind: 'currency' },
  { key: 'payment_date', label: 'Ins Pay Date', kind: 'date' },
  { key: 'invoice_amount', label: 'PT RES', kind: 'currency' },
  { key: 'collected_from_patient', label: 'PT Paid', kind: 'currency' },
  { key: 'patient_pay_status', label: 'PT Pay Status', kind: 'select-patient-pay' },
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
  'Waiting on Claims',
] as const

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
    COLUMNS.map((c) => csvEscape(toDisplay(row, c.key))).join(',')
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
              <option key={p.id} value={p.id}>
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

      <div className="overflow-auto rounded border border-white/20 bg-white/5">
        <table className="min-w-full text-sm text-white">
          <thead>
            <tr className="bg-slate-800/80 text-white/80 text-xs uppercase">
              <th className="px-2 py-1 text-left w-10 border-b border-white/10">#</th>
              {COLUMNS.map((col) => (
                <th key={col.key} className="px-2 py-1 text-left border-b border-white/10 whitespace-nowrap">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayedRows.map((row, idx) => (
              <tr key={row.id} className="odd:bg-white/5 even:bg-white/0">
                <td className="px-2 py-1 text-white/60 border-b border-white/5">{idx + 1}</td>
                {COLUMNS.map((col) => (
                  <td key={col.key} className="px-1 py-0.5 border-b border-white/5 align-top">
                    <TrackingCell
                      row={row}
                      column={col}
                      canEdit={canEdit}
                      onEdit={(value) => applyEdit(row.id, col.key, value)}
                    />
                  </td>
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
  onEdit: (value: string) => void
}

/** Value coerced to a string for the input. Currency/decimal fields stringify whatever the row
 *  holds; that keeps the UI stateless and lets React's controlled input take the current value. */
function toDisplay(row: SheetRow, key: TrackingColumn['key']): string {
  const raw = (row as any)[key]
  if (raw == null) return ''
  return String(raw)
}

function TrackingCell({ row, column, canEdit, onEdit }: TrackingCellProps) {
  const [draft, setDraft] = useState<string>(toDisplay(row, column.key))
  useEffect(() => {
    setDraft(toDisplay(row, column.key))
  }, [row, column.key])

  const readOnly = !canEdit
  const baseInput = 'w-full px-1.5 py-1 rounded bg-transparent border border-transparent hover:border-white/20 focus:border-primary-400 focus:outline-none text-white text-sm disabled:opacity-60'

  if (column.kind === 'select-claim' || column.kind === 'select-patient-pay') {
    const options = column.kind === 'select-claim' ? CLAIM_STATUSES : PATIENT_PAY_STATUSES
    return (
      <select
        value={draft}
        onChange={(e) => {
          const next = e.target.value
          setDraft(next)
          onEdit(next)
        }}
        disabled={readOnly}
        className={`${baseInput} bg-slate-800/70`}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt || '—'}</option>
        ))}
      </select>
    )
  }

  const inputType = column.kind === 'date' ? 'date' : column.kind === 'currency' ? 'text' : 'text'
  const placeholder = column.kind === 'currency' ? '$0.00' : ''

  return (
    <input
      type={inputType}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== toDisplay(row, column.key)) onEdit(draft)
      }}
      disabled={readOnly}
      placeholder={placeholder}
      className={baseInput}
    />
  )
}
