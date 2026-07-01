import { useState, useRef, useCallback, useEffect, useMemo, type CSSProperties } from 'react'
import { Lock, Unlock } from 'lucide-react'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import MonthYearTabs from '@/components/MonthYearTabs'
import Handsontable from 'handsontable'
import type { Provider, StatusColor } from '@/types'
import { fetchProviderPay, saveProviderPay, updateProviderPayWholeSheetLocked } from '@/lib/providerPay'
import { isPastPeriodFromMonthKey } from '@/lib/monthPeriodLock'
import { readableTextColor } from '@/lib/utils'

export type IsLockProviderPay = {
  description?: boolean
  amount?: boolean
  notes?: boolean
  description_comment?: string | null
  amount_comment?: string | null
  notes_comment?: string | null
}

/** Row indices for amount rows used to compute Total Payments. */
const ROWS_FOR_TOTAL = [1, 2, 3] as const // Patient Payments, Insurance Payments, A/R Payments
const ROW_TOTAL_PAYMENTS = 5
const ROW_PROVIDER_CUT = 6

/**
 * Row 7 is a fixed, read-only section header marking the start of the "Paystub Additional Pay"
 * range. Rows 8..16 (inclusive) are user-editable additional-pay slots — these are the ONLY rows
 * that flow into the paystub PDF (see PP_ROW_ADJUSTMENTS_START / _END in Invoices.tsx). Rows 17+
 * are free-form workspace that never appears on the paystub.
 */
export const ROW_PAYSTUB_ADDITIONAL_HEADER = 7
export const ROW_PAYSTUB_ADDITIONAL_FIRST = 8
export const ROW_PAYSTUB_ADDITIONAL_LAST = 16
export const PAYSTUB_ADDITIONAL_HEADER_LABEL = '── Paystub Additional Pay ──'

const DEFAULT_PROVIDER_CUT_PERCENT = 0.7

function parseAmount(val: unknown): number {
  if (val == null || val === '') return 0
  const s = String(val).replace(/,/g, '').replace(/\$/g, '').trim()
  if (s === '') return 0
  const n = parseFloat(s)
  return Number.isNaN(n) ? 0 : n
}

/** Format a number or string as currency $x,xxx.xx for display in the Amount column. */
function formatAmount(val: unknown): string {
  const n = parseAmount(val)
  if (n === 0 && (val == null || String(val).trim() === '')) return ''
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function computeTotalPayments(data: string[][]): string {
  let sum = 0
  for (const row of ROWS_FOR_TOTAL) {
    if (row < data.length && data[row][1] != null) sum += parseAmount(data[row][1])
  }
  return sum === 0 ? '' : String(sum)
}

function computeProviderCut(totalAmount: number, percent: number): string {
  if (totalAmount === 0 || percent <= 0) return ''
  const cut = totalAmount * percent
  return String(cut)
}

const INITIAL_TABLE_DATA: string[][] = (() => {
  const rows: string[][] = [
    ['Description', 'Amount', 'Notes'], // row 0 - header
    ['Patient Payments', '', ''],       // row 1
    ['Insurance Payments', '', ''],     // row 2
    ['A/R Payments', '', ''],           // row 3
    ['', '', ''],                       // row 4
    ['Total Payments', '', ''],         // row 5 - calculated
    ['Provider Cut', '', ''],           // row 6 - calculated
    [PAYSTUB_ADDITIONAL_HEADER_LABEL, '', ''], // row 7 - section header (read-only)
    ['', '', ''], // row 8  - paystub additional pay (editable)
    ['', '', ''], // row 9  - paystub additional pay
    ['', '', ''], // row 10 - paystub additional pay
    ['', '', ''], // row 11 - paystub additional pay
    ['', '', ''], // row 12 - paystub additional pay
    ['', '', ''], // row 13 - paystub additional pay
    ['', '', ''], // row 14 - paystub additional pay
    ['', '', ''], // row 15 - paystub additional pay
    ['', '', ''], // row 16 - paystub additional pay (last paystub slot)
    ['', '', ''], // row 17+ - internal workspace, not on paystub
  ]
  return rows
})()

/**
 * One-time data migration applied whenever rows come back from the DB. Old layouts had no section
 * header at row 7, so users typed paystub adjustments starting at row 7. With the new layout, row
 * 7 is reserved for the section header label. If we find user content at row 7 that isn't the
 * header label, shift rows 7..15 down by one (row 7 → 8, 8 → 9, ...) and force row 7 to the label.
 * Idempotent: once row 7 is the header label, no shift happens.
 */
function applyPaystubSectionHeaderMigration(rows: string[][]): string[][] {
  const out = rows.map((r) => [...r])
  const headerSlot = out[ROW_PAYSTUB_ADDITIONAL_HEADER]
  const headerHasUserContent =
    headerSlot &&
    (headerSlot[0] ?? '').trim() !== '' &&
    (headerSlot[0] ?? '').trim() !== PAYSTUB_ADDITIONAL_HEADER_LABEL
  const headerAmountFilled = headerSlot && (headerSlot[1] ?? '').trim() !== ''
  const headerNotesFilled = headerSlot && (headerSlot[2] ?? '').trim() !== ''
  if (headerHasUserContent || headerAmountFilled || headerNotesFilled) {
    // Shift right-to-left so we don't clobber. The cell at ROW_PAYSTUB_ADDITIONAL_LAST is overwritten
    // (or dropped) if the whole paystub block is full — that's the same fixed-9-slot constraint a
    // user would hit with a fresh layout, and it never hides data they put further down.
    for (let i = ROW_PAYSTUB_ADDITIONAL_LAST; i > ROW_PAYSTUB_ADDITIONAL_HEADER; i--) {
      while (out.length <= i) out.push(['', '', ''])
      out[i] = out[i - 1] ? [...out[i - 1]] : ['', '', '']
    }
  }
  while (out.length <= ROW_PAYSTUB_ADDITIONAL_HEADER) out.push(['', '', ''])
  out[ROW_PAYSTUB_ADDITIONAL_HEADER] = [PAYSTUB_ADDITIONAL_HEADER_LABEL, '', '']
  return out
}

export interface ProviderPayTabProps {
  clinicId: string
  /** 1 = default; 2 = clinic has two pay periods, show Payroll 1/2 selector */
  clinicPayroll?: 1 | 2
  /** When set, data is loaded and saved to the provider_pay database tables. */
  providerId?: string
  /** List of providers in the clinic for the provider dropdown. When provided, a select is shown and the chosen provider is used for load/save. */
  providers?: Provider[]
  canEdit: boolean
  /** Super-admin / admin: lock control for past months/periods on the pay sheet. */
  canTogglePastMonthWholeSheetLock?: boolean
  isInSplitScreen?: boolean
  selectedMonth: Date
  /** Preferred picker callback used by MonthYearTabs. */
  onSelectMonth?: (date: Date) => void
  /** Controlled payroll half (1 or 2) when clinicPayroll=2. Falls back to internal state when omitted. */
  selectedPayroll?: 1 | 2
  /** Notify parent when the user picks a payroll half so it can persist / use it for downstream lookups. */
  onPayrollChange?: (payroll: 1 | 2) => void
  statusColors: StatusColor[]
  isLockProviderPay?: IsLockProviderPay | null
  onLockColumn?: (columnName: string) => void
  isColumnLocked?: (columnName: keyof IsLockProviderPay) => boolean
  /** When viewing a backup version, parent passes table rows for current provider+month. */
  overrideTableData?: string[][] | null
  isViewingBackup?: boolean
  /** When viewing backup, a value that changes when the user selects a different version, so the grid refreshes. */
  backupVersionKey?: number
  /** Called when the user selects a provider (e.g. for backup download filename). */
  onSelectedProviderIdChange?: (providerId: string) => void
  /** Rendered to the right of the colored title pill (used for the Select Version button). */
  labelRightSlot?: React.ReactNode
  /** Rendered as its own row immediately below the colored title pill (above the months row). */
  belowTitleSlot?: React.ReactNode
}

export default function ProviderPayTab({
  clinicId,
  clinicPayroll = 1,
  providerId: providerIdProp,
  providers = [],
  canEdit,
  canTogglePastMonthWholeSheetLock = false,
  isInSplitScreen,
  selectedMonth,
  onSelectMonth,
  selectedPayroll: selectedPayrollProp,
  onPayrollChange,
  statusColors,
  isLockProviderPay,
  onLockColumn: _onLockColumn,
  isColumnLocked: _isColumnLocked,
  overrideTableData = null,
  isViewingBackup = false,
  backupVersionKey = 0,
  onSelectedProviderIdChange,
  labelRightSlot,
  belowTitleSlot,
}: ProviderPayTabProps) {
  const logProviderPay = useCallback((event: string, payload?: Record<string, unknown>) => {
    void event
    void payload
  }, [])
  const containerRef = useRef<HTMLDivElement>(null)
  /** True on narrow viewports (mobile / small tablets). Triggers the same compact layout that
   *  isInSplitScreen uses — Jenali was seeing the desktop layout on mobile, which compressed the
   *  month buttons, Pay Date row, and Provider select into an unreadable strip because the desktop
   *  branch assumed the panel was at least ~700px wide. */
  const NARROW_VIEWPORT_PX = 768
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < NARROW_VIEWPORT_PX,
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => setIsNarrowViewport(window.innerWidth < NARROW_VIEWPORT_PX)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  /** Combined flag used everywhere a compact layout is needed. Lets us drive the same UI from
   *  either an explicit Split Screen prop OR an automatic narrow-viewport detection. */
  const isCompactLayout = isInSplitScreen || isNarrowViewport
  const [tableHeight, setTableHeight] = useState(600)
  const [payDate, setPayDate] = useState('')
  const [payPeriodFrom, setPayPeriodFrom] = useState('')
  const [payPeriodTo, setPayPeriodTo] = useState('')
  const [tableData, setTableData] = useState<string[][]>(() => INITIAL_TABLE_DATA.map(row => [...row]))
  const [providerPayDataVersion, setProviderPayDataVersion] = useState(0)
  const [sideNotes, setSideNotes] = useState('')
  const [wholeSheetLocked, setWholeSheetLocked] = useState(false)
  const [internalSelectedPayroll, setInternalSelectedPayroll] = useState<1 | 2>(selectedPayrollProp ?? 1)
  const selectedPayroll: 1 | 2 = selectedPayrollProp ?? internalSelectedPayroll
  const setSelectedPayroll = useCallback(
    (next: 1 | 2) => {
      setInternalSelectedPayroll(next)
      onPayrollChange?.(next)
    },
    [onPayrollChange]
  )
  // Tracks which month/provider/payroll the in-memory form data belongs to.
  // Prevents autosave from writing stale data into a newly selected scope.
  const [hydratedScopeKey, setHydratedScopeKey] = useState('')

  type CachedPay = {
    payDate: string
    payPeriodFrom: string
    payPeriodTo: string
    sideNotes: string
    tableData: string[][]
    wholeSheetLocked: boolean
  }
  const [providerPayCache, setProviderPayCache] = useState<Record<string, CachedPay>>({})

  /** Serialize pay period for DB (single string). */
  const payPeriod = useMemo(
    () => [payPeriodFrom, payPeriodTo].filter(Boolean).join(' to ') || '',
    [payPeriodFrom, payPeriodTo]
  )
  const [selectedProviderId, setSelectedProviderId] = useState<string>(() =>
    providerIdProp ?? providers[0]?.id ?? ''
  )
  const [loading, setLoading] = useState(false)
  const fetchGenerationRef = useRef(0)
  const hasLoadedOnceRef = useRef(false)
  const restoredPendingKeyRef = useRef<string | null>(null)
  const skipAutosaveOnceRef = useRef(false)
  const previousScopeKeyRef = useRef<string | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savePayloadRef = useRef<{
    clinicId: string
    effectiveProviderId: string
    year: number
    month: number
    payDate: string
    payPeriod: string
    payPeriodFrom: string
    payPeriodTo: string
    tableData: string[][]
    sideNotes: string
    payrollForSave: number
  } | null>(null)
  const lockData = isLockProviderPay || null

  const year = selectedMonth.getFullYear()
  const month = selectedMonth.getMonth() + 1

  const effectiveProviderId = providers.length > 0 ? selectedProviderId : providerIdProp
  const providerCutPercent = useMemo(
    () => providers.find((p) => p.id === effectiveProviderId)?.provider_cut_percent ?? DEFAULT_PROVIDER_CUT_PERCENT,
    [providers, effectiveProviderId]
  )
  const payrollForCurrentScope = clinicPayroll === 2 ? selectedPayroll : 1
  const providerPayMonthKey = useMemo(
    () => (clinicPayroll === 2 ? `${year}-${month}-${payrollForCurrentScope}` : `${year}-${month}`),
    [clinicPayroll, year, month, payrollForCurrentScope]
  )
  const payrollModeForLock = clinicPayroll === 2 ? 2 : 1
  const isViewingPastPeriod = isPastPeriodFromMonthKey(providerPayMonthKey, payrollModeForLock)
  const effectiveCanEdit = useMemo(() => {
    if (!isViewingPastPeriod) return canEdit
    return canEdit && !wholeSheetLocked
  }, [canEdit, isViewingPastPeriod, wholeSheetLocked])
  const pendingStorageKey = useMemo(
    () =>
      clinicId && effectiveProviderId
        ? `provider_pay_pending_${clinicId}_${effectiveProviderId}_${year}-${month}-${payrollForCurrentScope}`
        : '',
    [clinicId, effectiveProviderId, year, month, payrollForCurrentScope]
  )
  const scopeKey = useMemo(
    () => (clinicId && effectiveProviderId ? `${clinicId}_${effectiveProviderId}_${year}-${month}-${payrollForCurrentScope}` : ''),
    [clinicId, effectiveProviderId, year, month, payrollForCurrentScope]
  )

  // Sync selectedProviderId when providerIdProp or providers list changes (e.g. initial load or provider no longer in list)
  useEffect(() => {
    if (providerIdProp && providers.some((p) => p.id === providerIdProp)) {
      setSelectedProviderId(providerIdProp)
    } else if (providers.length > 0 && !providers.some((p) => p.id === selectedProviderId)) {
      setSelectedProviderId(providers[0].id)
    }
  }, [providerIdProp, providers, selectedProviderId])

  // Notify parent of current provider selection (for backup download filename)
  useEffect(() => {
    if (effectiveProviderId) onSelectedProviderIdChange?.(effectiveProviderId)
  }, [effectiveProviderId, onSelectedProviderIdChange])

  // Fetch from DB when clinicId, effectiveProviderId, and selectedMonth are set. Use cache for instant display when switching month/provider.
  useEffect(() => {
    if (!clinicId || !effectiveProviderId) {
      logProviderPay('fetch skipped missing scope', { clinicId, effectiveProviderId })
      setLoading(false)
      return
    }
    if (isViewingBackup) {
      setTableData(overrideTableData && overrideTableData.length > 0 ? overrideTableData.map((r) => [...r]) : INITIAL_TABLE_DATA.map((row) => [...row]))
      setWholeSheetLocked(false)
      setLoading(false)
      return
    }
    const payrollForFetch = clinicPayroll === 2 ? selectedPayroll : 1
    const cacheKey = `${year}-${month}-${effectiveProviderId}-${payrollForFetch}`
    logProviderPay('fetch started', { clinicId, effectiveProviderId, year, month, payrollForFetch, cacheKey })

    const applyDataToState = (
      payDateVal: string,
      payPeriodFromVal: string,
      payPeriodToVal: string,
      notesVal: string,
      rows: string[][],
      wholeLocked: boolean
    ) => {
      skipAutosaveOnceRef.current = true
      setPayDate(payDateVal)
      setPayPeriodFrom(payPeriodFromVal)
      setPayPeriodTo(payPeriodToVal)
      setSideNotes(notesVal)
      setTableData(rows)
      setWholeSheetLocked(wholeLocked)
      setProviderPayDataVersion((v) => v + 1)
      setHydratedScopeKey(scopeKey)
    }

    const processFetchResult = (
      data: {
        payDate: string
        payPeriod: string
        notes: string
        wholeSheetLocked: boolean
        rows: string[][]
      } | null
    ): CachedPay => {
      if (data) {
        let payPeriodFromVal = ''
        let payPeriodToVal = ''
        const raw = (data.payPeriod ?? '').trim()
        const datePart = /^\d{4}-\d{2}-\d{2}$/
        if (raw.includes(' to ')) {
          const [a, b] = raw.split(' to ').map((s) => s.trim())
          payPeriodFromVal = datePart.test(a) ? a : ''
          payPeriodToVal = datePart.test(b) ? b : ''
        } else if (raw.includes(' - ')) {
          const [a, b] = raw.split(' - ').map((s) => s.trim())
          payPeriodFromVal = datePart.test(a) ? a : ''
          payPeriodToVal = datePart.test(b) ? b : ''
        } else if (datePart.test(raw)) {
          payPeriodFromVal = raw
        }
        // Shift any pre-section-header content out of row 7 before applying calc rows / formatting.
        const rows = applyPaystubSectionHeaderMigration(data.rows.map((r) => [...r]))
        if (rows.length > ROW_TOTAL_PAYMENTS) {
          rows[ROW_TOTAL_PAYMENTS][1] = formatAmount(computeTotalPayments(rows))
        }
        if (rows.length > ROW_PROVIDER_CUT) {
          rows[ROW_PROVIDER_CUT][1] = formatAmount(computeProviderCut(parseAmount(rows[ROW_TOTAL_PAYMENTS][1]), providerCutPercent))
        }
        for (const r of [1, 2, 3]) {
          if (rows[r]?.[1] != null && rows[r][1] !== '') rows[r][1] = formatAmount(rows[r][1])
        }
        return {
          payDate: data.payDate,
          payPeriodFrom: payPeriodFromVal,
          payPeriodTo: payPeriodToVal,
          sideNotes: data.notes ?? '',
          wholeSheetLocked: data.wholeSheetLocked,
          tableData: rows,
        }
      }
      const initial = INITIAL_TABLE_DATA.map((r) => [...r])
      if (initial.length > ROW_TOTAL_PAYMENTS) {
        initial[ROW_TOTAL_PAYMENTS][1] = formatAmount(computeTotalPayments(initial))
      }
      if (initial.length > ROW_PROVIDER_CUT) {
        initial[ROW_PROVIDER_CUT][1] = formatAmount(computeProviderCut(parseAmount(initial[ROW_TOTAL_PAYMENTS][1]), providerCutPercent))
      }
      for (const r of [1, 2, 3]) {
        if (initial[r]?.[1] != null && initial[r][1] !== '') initial[r][1] = formatAmount(initial[r][1])
      }
      return { payDate: '', payPeriodFrom: '', payPeriodTo: '', sideNotes: '', wholeSheetLocked: false, tableData: initial }
    }

    const cached = providerPayCache[cacheKey]
    if (cached) {
      logProviderPay('cache hit apply', {
        cacheKey,
        rows: cached.tableData.length,
        payDate: cached.payDate,
        payPeriodFrom: cached.payPeriodFrom,
        payPeriodTo: cached.payPeriodTo,
      })
      applyDataToState(
        cached.payDate,
        cached.payPeriodFrom,
        cached.payPeriodTo,
        cached.sideNotes,
        cached.tableData.map((r) => [...r]),
        cached.wholeSheetLocked ?? false
      )
      setLoading(false)
    } else {
      // Only show full-page loading on very first load; when switching month, fetch in background without replacing content
      if (!hasLoadedOnceRef.current) setLoading(true)
    }

    const fetchGen = ++fetchGenerationRef.current
    fetchProviderPay(clinicId, effectiveProviderId, year, month, payrollForFetch)
      .then((data) => {
        if (fetchGen !== fetchGenerationRef.current) return
        logProviderPay('fetch resolved', {
          clinicId,
          effectiveProviderId,
          year,
          month,
          payrollForFetch,
          hasData: Boolean(data),
          rows: data?.rows?.length ?? 0,
          payDate: data?.payDate ?? '',
          payPeriod: data?.payPeriod ?? '',
        })
        const entry = processFetchResult(data)
        applyDataToState(
          entry.payDate,
          entry.payPeriodFrom,
          entry.payPeriodTo,
          entry.sideNotes,
          entry.tableData.map((r) => [...r]),
          entry.wholeSheetLocked
        )
        setProviderPayCache((prev) => ({ ...prev, [cacheKey]: entry }))
      })
      .catch((err) => console.error('[ProviderPayTab] fetchProviderPay error:', err))
      .finally(() => {
        logProviderPay('fetch finished', { cacheKey })
        setLoading(false)
        hasLoadedOnceRef.current = true
      })
  }, [clinicId, effectiveProviderId, year, month, providerCutPercent, clinicPayroll, selectedPayroll, isViewingBackup, overrideTableData, logProviderPay])

  // Restore unsaved local snapshot for the current provider/month/payroll after refresh.
  useEffect(() => {
    if (!pendingStorageKey || restoredPendingKeyRef.current === pendingStorageKey || isViewingBackup) return
    restoredPendingKeyRef.current = pendingStorageKey
    try {
      const raw = localStorage.getItem(pendingStorageKey)
      if (!raw) {
        logProviderPay('pending snapshot restore miss', { pendingStorageKey })
        return
      }
      const payload = JSON.parse(raw) as {
        payDate?: string
        payPeriodFrom?: string
        payPeriodTo?: string
        sideNotes?: string
        tableData?: string[][]
      }
      if (!payload || !Array.isArray(payload.tableData)) return
      const rows = payload.tableData.map((r) => [String(r?.[0] ?? ''), String(r?.[1] ?? ''), String(r?.[2] ?? '')])
      logProviderPay('pending snapshot restored', {
        pendingStorageKey,
        rows: rows.length,
        payDate: payload.payDate ?? '',
        payPeriodFrom: payload.payPeriodFrom ?? '',
        payPeriodTo: payload.payPeriodTo ?? '',
      })
      skipAutosaveOnceRef.current = true
      setPayDate(payload.payDate ?? '')
      setPayPeriodFrom(payload.payPeriodFrom ?? '')
      setPayPeriodTo(payload.payPeriodTo ?? '')
      setSideNotes(payload.sideNotes ?? '')
      setTableData(rows)
      setProviderPayDataVersion((v) => v + 1)
      setHydratedScopeKey(scopeKey)
    } catch {
      logProviderPay('pending snapshot restore failed parse', { pendingStorageKey })
      // Ignore malformed local pending snapshots.
    }
  }, [pendingStorageKey, isViewingBackup, logProviderPay, scopeKey])

  // When switching scope, mark current form state as not yet hydrated for the new scope.
  useEffect(() => {
    if (!scopeKey) {
      setHydratedScopeKey('')
      return
    }
    if (hydratedScopeKey !== scopeKey) setHydratedScopeKey('')
  }, [scopeKey, hydratedScopeKey])

  /** When viewing backup, use override so the grid shows the correct version on first render (same fix as AR and Patients tabs). */
  const displayTableData = useMemo(
    () =>
      isViewingBackup && overrideTableData && overrideTableData.length > 0
        ? overrideTableData.map((r) => [...r])
        : tableData,
    [isViewingBackup, overrideTableData, tableData]
  )

  const handleToggleWholeSheetLock = useCallback(async () => {
    if (!clinicId || !effectiveProviderId || !canTogglePastMonthWholeSheetLock || !isViewingPastPeriod) return
    const confirmMessage = wholeSheetLocked
      ? 'Unlock this provider pay period?'
      : 'Lock this provider pay period?'
    if (!window.confirm(confirmMessage)) return
    const next = !wholeSheetLocked
    try {
      await updateProviderPayWholeSheetLocked(clinicId, effectiveProviderId, year, month, payrollForCurrentScope, next)
      setWholeSheetLocked(next)
      const ck = `${year}-${month}-${effectiveProviderId}-${payrollForCurrentScope}`
      setProviderPayCache((prev) => {
        const cur = prev[ck]
        if (!cur) return prev
        return { ...prev, [ck]: { ...cur, wholeSheetLocked: next } }
      })
    } catch (e) {
      console.error('[ProviderPayTab] toggle whole sheet lock', e)
      alert('Failed to update sheet lock. Ensure the database migration for whole_sheet_locked has been applied.')
    }
  }, [
    clinicId,
    effectiveProviderId,
    canTogglePastMonthWholeSheetLock,
    isViewingPastPeriod,
    wholeSheetLocked,
    year,
    month,
    payrollForCurrentScope,
  ])

  // Debounced save when payDate, payPeriod, tableData, or sideNotes change (only when effectiveProviderId is set and not loading).
  // Update cache on success so fetch effect re-runs don't overwrite state with stale cache. Flush on unmount and beforeunload.
  const runSave = useCallback((p: NonNullable<typeof savePayloadRef.current>) => {
    const cacheKey = `${p.year}-${p.month}-${p.effectiveProviderId}-${p.payrollForSave}`
    const pendingKey = `provider_pay_pending_${p.clinicId}_${p.effectiveProviderId}_${p.year}-${p.month}-${p.payrollForSave}`
    logProviderPay('save started', {
      clinicId: p.clinicId,
      effectiveProviderId: p.effectiveProviderId,
      year: p.year,
      month: p.month,
      payrollForSave: p.payrollForSave,
      rows: p.tableData.length,
      payDate: p.payDate,
      payPeriod: p.payPeriod,
    })
    saveProviderPay(
      p.clinicId,
      p.effectiveProviderId,
      p.year,
      p.month,
      p.payDate,
      p.payPeriod,
      p.tableData,
      p.sideNotes,
      p.payrollForSave
    )
      .then(() => {
        logProviderPay('save success', { cacheKey, pendingKey, rows: p.tableData.length })
        setProviderPayCache((prev) => ({
          ...prev,
          [cacheKey]: {
            payDate: p.payDate,
            payPeriodFrom: p.payPeriodFrom,
            payPeriodTo: p.payPeriodTo,
            sideNotes: p.sideNotes,
            tableData: p.tableData.map((r) => [...r]),
            wholeSheetLocked: prev[cacheKey]?.wholeSheetLocked ?? false,
          },
        }))
        try {
          localStorage.removeItem(pendingKey)
          logProviderPay('pending snapshot removed after save', { pendingKey })
        } catch {
          // Ignore storage failures.
        }
      })
      .catch((err) => console.error('[ProviderPayTab] saveProviderPay error:', err))
  }, [logProviderPay])

  useEffect(() => {
    if (!clinicId || !effectiveProviderId || !effectiveCanEdit || loading) return
    if (!scopeKey || hydratedScopeKey !== scopeKey) return
    if (skipAutosaveOnceRef.current) {
      skipAutosaveOnceRef.current = false
      return
    }
    const payrollForSave = clinicPayroll === 2 ? selectedPayroll : 1
    savePayloadRef.current = {
      clinicId,
      effectiveProviderId,
      year,
      month,
      payDate,
      payPeriod,
      payPeriodFrom,
      payPeriodTo,
      tableData: tableData.map((r) => [...r]),
      sideNotes,
      payrollForSave,
    }
    try {
      localStorage.setItem(
        pendingStorageKey,
        JSON.stringify({
          payDate,
          payPeriodFrom,
          payPeriodTo,
          sideNotes,
          tableData,
          savedAt: Date.now(),
        })
      )
      logProviderPay('pending snapshot written', {
        pendingStorageKey,
        rows: tableData.length,
        payDate,
        payPeriodFrom,
        payPeriodTo,
      })
    } catch {
      // Ignore storage quota and JSON errors.
    }
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null
      const p = savePayloadRef.current
      if (p) {
        logProviderPay('debounced save firing', {
          clinicId: p.clinicId,
          effectiveProviderId: p.effectiveProviderId,
          year: p.year,
          month: p.month,
          payrollForSave: p.payrollForSave,
          rows: p.tableData.length,
        })
        savePayloadRef.current = null
        runSave(p)
      }
    }, 300)
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
    }
  }, [clinicId, effectiveProviderId, year, month, effectiveCanEdit, loading, payDate, payPeriod, payPeriodFrom, payPeriodTo, tableData, sideNotes, clinicPayroll, selectedPayroll, runSave, pendingStorageKey, logProviderPay, scopeKey, hydratedScopeKey])

  // Flush pending save when provider/month/payroll scope changes.
  useEffect(() => {
    if (!scopeKey) return
    if (previousScopeKeyRef.current == null) {
      previousScopeKeyRef.current = scopeKey
      return
    }
    if (previousScopeKeyRef.current !== scopeKey) {
      const p = savePayloadRef.current
      if (p) {
        logProviderPay('scope change flush save', {
          fromScope: previousScopeKeyRef.current,
          toScope: scopeKey,
          clinicId: p.clinicId,
          effectiveProviderId: p.effectiveProviderId,
          year: p.year,
          month: p.month,
          payrollForSave: p.payrollForSave,
          rows: p.tableData.length,
        })
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
          saveTimeoutRef.current = null
        }
        savePayloadRef.current = null
        runSave(p)
      }
      previousScopeKeyRef.current = scopeKey
    }
  }, [scopeKey, runSave, logProviderPay])

  // Flush pending save only on unmount.
  useEffect(() => {
    return () => {
      const p = savePayloadRef.current
      if (p) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
          saveTimeoutRef.current = null
        }
        logProviderPay('unmount flush save', {
          clinicId: p.clinicId,
          effectiveProviderId: p.effectiveProviderId,
          year: p.year,
          month: p.month,
          payrollForSave: p.payrollForSave,
          rows: p.tableData.length,
        })
        savePayloadRef.current = null
        runSave(p)
      }
    }
  }, [runSave, logProviderPay])

  // Flush pending save when user refreshes or closes tab so data persists
  useEffect(() => {
    const onBeforeUnload = () => {
      const p = savePayloadRef.current
      if (saveTimeoutRef.current && p) {
        logProviderPay('beforeunload flush save', {
          clinicId: p.clinicId,
          effectiveProviderId: p.effectiveProviderId,
          year: p.year,
          month: p.month,
          payrollForSave: p.payrollForSave,
          rows: p.tableData.length,
        })
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
        savePayloadRef.current = null
        saveProviderPay(
          p.clinicId,
          p.effectiveProviderId,
          p.year,
          p.month,
          p.payDate,
          p.payPeriod,
          p.tableData,
          p.sideNotes,
          p.payrollForSave
        )
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [logProviderPay])

  const getMonthColor = useCallback(
    (month: string): { color: string; textColor: string } | null => {
      const monthColor = statusColors.find((s) => s.status === month && s.type === 'month')
      // Derive contrast from the bg luminance so the Pay Date / Pay Period banner stays readable
      // regardless of the configured text_color (some configs leave dark text on a dark month bg).
      if (monthColor) {
        return { color: monthColor.color, textColor: readableTextColor(monthColor.color) }
      }
      return null
    },
    [statusColors]
  )

  const headerStyle = useMemo(() => {
    const monthName = selectedMonth.toLocaleString('en-US', { month: 'long' })
    const monthColor = getMonthColor(monthName)
    const bgColor = monthColor?.color ?? 'rgba(30, 41, 59, 0.95)'
    const textColor = monthColor?.textColor ?? '#ffffff'
    return { bgColor, textColor }
  }, [selectedMonth, getMonthColor])

  /** Handsontable adds `htDimmed` to read-only cells (gray text in full.css). Re-apply header colors on every render so lock/unlock cannot leave row 0 looking black. */
  const applyProviderPayHeaderVisuals = useCallback(
    (hot: Handsontable) => {
      const htRoot = hot.rootElement as HTMLElement | null
      if (!htRoot) return
      const { bgColor, textColor } = headerStyle
      const varHost = (htRoot.closest('.provider-pay-table') as HTMLElement | null) ?? htRoot
      varHost.style.setProperty('--provider-pay-header-bg', bgColor)
      varHost.style.setProperty('--provider-pay-header-text', textColor)
      htRoot.querySelectorAll('.ht_master thead th, .ht_clone_top thead th').forEach((th) => {
        if (th instanceof HTMLElement) {
          th.style.background = bgColor
          th.style.color = textColor
          th.style.fontWeight = 'bold'
          th.style.borderColor = '#1e293b'
        }
      })
      htRoot.querySelectorAll('.ht_master table.htCore tbody tr:first-child td').forEach((td) => {
        if (td instanceof HTMLElement) {
          td.style.background = bgColor
          td.style.color = textColor
          td.style.fontWeight = 'bold'
          td.style.borderColor = 'rgba(0,0,0,0.2)'
        }
      })
      htRoot.querySelectorAll('.ht_clone_left table.htCore tbody tr:first-child td').forEach((td) => {
        if (td instanceof HTMLElement) {
          td.style.background = bgColor
          td.style.color = textColor
          td.style.fontWeight = 'bold'
        }
      })
    },
    [headerStyle]
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateHeight = () => {
      const h = el.clientHeight
      if (h > 0) setTableHeight(h - 12)
    }
    updateHeight()
    const ro = new ResizeObserver(updateHeight)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isInSplitScreen])

  const getReadOnly = useCallback(
    (columnName: keyof IsLockProviderPay): boolean => {
      if (!effectiveCanEdit) return true
      if (!lockData) return false
      return Boolean(lockData[columnName])
    },
    [effectiveCanEdit, lockData]
  )

  const columns = useMemo(
    () => [
      {
        data: 0,
        title: 'Description',
        type: 'text' as const,
        width: 200,
        readOnly: false,
      },
      {
        data: 1,
        title: 'Amount',
        type: 'numeric' as const,
        width: 120,
        readOnly: !effectiveCanEdit || getReadOnly('amount'),
      },
      {
        data: 2,
        title: 'Notes',
        type: 'text' as const,
        width: 200,
        readOnly: !effectiveCanEdit || getReadOnly('notes'),
      },
    ],
    [effectiveCanEdit, lockData, getReadOnly]
  )

  const cellsCallback = useCallback(
    (row: number, col: number) => {
      const props: { readOnly?: boolean; className?: string } = {}
      if (row === 0) {
        props.className = 'provider-pay-table-header-row'
        props.readOnly = true
        return props
      }
      // Section header row marking the start of the "Paystub Additional Pay" range.
      // All three columns are read-only and visually distinct so users know the rows below
      // (up to ROW_PAYSTUB_ADDITIONAL_LAST) are the ones that flow onto the provider's paystub.
      if (row === ROW_PAYSTUB_ADDITIONAL_HEADER) {
        props.className = 'provider-pay-table-section-header-row'
        props.readOnly = true
        return props
      }
      if (col === 0) {
        props.readOnly = row <= 6 ? true : !effectiveCanEdit
      }
      // Total Payments amount is calculated from Patient + Insurance + A/R
      if (row === ROW_TOTAL_PAYMENTS && col === 1) {
        props.readOnly = true
      }
      // Provider Cut amount is calculated as Total Payments × provider cut %
      if (row === ROW_PROVIDER_CUT && col === 1) {
        props.readOnly = true
      }
      return props
    },
    [effectiveCanEdit]
  )

  const afterChange = useCallback(
    (changes: Handsontable.CellChange[] | null, _source?: Handsontable.ChangeSource) => {
      if (!changes?.length || !effectiveCanEdit) return
      logProviderPay('table afterChange', {
        changes: changes.length,
        source: String(_source ?? ''),
      })
      setTableData((prev) => {
        const next = prev.map((r) => [...r])
        for (const change of changes) {
          const row = typeof change[0] === 'number' ? change[0] : -1
          const col = typeof change[1] === 'number' ? change[1] : -1
          const newVal = change[3]
          if (row <= 0 || row >= next.length || col < 0 || col >= 3) continue
          if (col === 0 && row <= 6) continue
          // Section header is read-only — drop any edit that slips past the cellsCallback guard
          // (e.g., from a paste range that spans it) so the label stays canonical.
          if (row === ROW_PAYSTUB_ADDITIONAL_HEADER) continue
          let val = newVal == null ? '' : String(newVal)
          if (col === 1 && (row === 1 || row === 2 || row === 3)) val = formatAmount(val)
          if (next[row][col] !== val) next[row][col] = val
        }
        // Recalculate Total Payments when amount in Patient/Insurance/A/R row changes
        if (next.length > ROW_TOTAL_PAYMENTS) {
          next[ROW_TOTAL_PAYMENTS][1] = formatAmount(computeTotalPayments(next))
        }
        // Recalculate Provider Cut = Total Payments × provider cut %
        if (next.length > ROW_PROVIDER_CUT) {
          next[ROW_PROVIDER_CUT][1] = formatAmount(computeProviderCut(parseAmount(next[ROW_TOTAL_PAYMENTS][1]), providerCutPercent))
        }
        return next
      })
      setProviderPayDataVersion((v) => v + 1)
    },
    [effectiveCanEdit, providerCutPercent]
  )

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-slate-500" />
      </div>
    )
  }

  // Border and color-scheme derive from the header's readable text color so empty date inputs
  // stay visible on both dark and light month backgrounds. Previously the CSS forced a transparent
  // placeholder + white/30 border, which made the boxes invisible on light-colored month headers
  // ("Provider Pay - boxes should have blank text instead of white and you can't see the box/text
  // until after it's typed in").
  const isDarkHeaderText = headerStyle.textColor === '#ffffff'
  const dateInputBorderColor = isDarkHeaderText ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'
  const dateInputClass = (_empty: boolean) =>
    `bg-transparent border rounded outline-none text-inherit ${
      isDarkHeaderText ? '[color-scheme:dark]' : '[color-scheme:light]'
    } ${
      isCompactLayout
        ? 'w-full min-w-0 max-w-full box-border px-2 py-1 text-sm'
        : 'text-sm'
    }`

  return (
    <div
      className={`min-w-0 ${isCompactLayout ? 'p-3 split-pane-tab' : 'p-6'}`}
      style={
        // On a narrow viewport (mobile) we drop the 45vw cap so the content fills the device width
        // instead of being squashed to ~170px. The split-screen prop already enforces its own width
        // via the parent panel, so no style override needed there.
        isInSplitScreen
          ? undefined
          : isNarrowViewport
            ? { width: '100%', maxWidth: '100%' }
            : { maxWidth: '45vw', width: '100%' }
      }
    >
      <MonthYearTabs
        selectedMonth={selectedMonth}
        selectedPayroll={selectedPayroll}
        clinicPayroll={clinicPayroll}
        statusColors={statusColors}
        label="Provider Pay for"
        isInSplitScreen={isCompactLayout}
        labelRightSlot={labelRightSlot}
        belowTitleSlot={belowTitleSlot}
        compactMonthsLayout
        onChange={(date, payroll) => {
          if (onSelectMonth) onSelectMonth(date)
          if (clinicPayroll === 2) setSelectedPayroll(payroll)
        }}
        rightSlot={canTogglePastMonthWholeSheetLock && isViewingPastPeriod ? (
          <button
            type="button"
            onClick={handleToggleWholeSheetLock}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white"
            title={
              wholeSheetLocked
                ? 'Unlock sheet — allow editing this period'
                : 'Lock sheet — make this period read-only for staff'
            }
            aria-label={wholeSheetLocked ? 'Unlock provider pay sheet' : 'Lock provider pay sheet'}
          >
            {wholeSheetLocked ? <Lock size={18} strokeWidth={2.25} /> : <Unlock size={18} strokeWidth={2.25} />}
          </button>
        ) : undefined}
      />
      <div
        className={
          isCompactLayout
            ? 'flex flex-col gap-2 w-full min-w-0 mb-2 shrink-0'
            : 'flex items-center gap-2 justify-between'
        }
      >
        {/* Provider select - when providers list is provided */}
        {providers.length > 0 && (
          <div
            className={
              isCompactLayout
                ? 'flex flex-col gap-1 w-full min-w-0'
                : 'mb-3 flex items-center gap-2'
            }
          >
            <label htmlFor="provider-pay-provider-select" className="text-sm font-medium text-slate-300 whitespace-nowrap">
              Provider:
            </label>
            <select
              id="provider-pay-provider-select"
              value={selectedProviderId}
              onChange={(e) => {
                const id = e.target.value
                setSelectedProviderId(id)
                onSelectedProviderIdChange?.(id)
              }}
              className={`cursor-pointer rounded-lg border border-slate-600 bg-slate-800 text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isCompactLayout ? 'w-full min-w-0' : 'min-w-[200px]'
              }`}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.first_name} {p.last_name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>


      {/* Pay Date and Pay Period - header color same as selected month */}
      <div
        className={`rounded-t-lg border border-b-0 border-slate-700 shrink-0 min-w-0 ${
          isCompactLayout ? 'w-full overflow-hidden' : ''
        }`}
        style={{
          backgroundColor: headerStyle.bgColor,
          color: headerStyle.textColor,
        }}
      >
        <div
          className={
            isCompactLayout
              ? 'flex items-center flex-wrap gap-x-1.5 gap-y-0.5 px-2 py-1 border-b border-slate-600/50 min-w-0'
              : 'flex items-center justify-center gap-3 px-4 py-2 border-b border-slate-600/50'
          }
        >
          <span
            className={
              isCompactLayout ? 'font-bold text-xs shrink-0' : 'font-bold shrink-0'
            }
          >
            Pay Date:
          </span>
          <input
            type="date"
            value={payDate}
            onChange={(e) => setPayDate(e.target.value)}
            disabled={!effectiveCanEdit}
            className={`${dateInputClass(!payDate)} ${
              isCompactLayout ? 'w-[6.25rem] px-0.5 py-0 text-xs shrink-0' : 'w-[12rem] px-2 py-1'
            }`}
            style={{ color: headerStyle.textColor, borderColor: dateInputBorderColor }}
          />
        </div>
        {isCompactLayout ? (
          // Single-row Pay Period for compact mode: "Pay Period: From [d] To [d]". flex-wrap lets
          // the row break gracefully if the container is too narrow for the full line.
          // Tightened padding + smaller inputs so the whole banner is half the previous height.
          <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 px-2 py-1 min-w-0">
            <span className="font-bold text-xs shrink-0">Pay Period:</span>
            <label className="text-xs font-medium opacity-90 shrink-0">From</label>
            <input
              type="date"
              value={payPeriodFrom}
              onChange={(e) => setPayPeriodFrom(e.target.value)}
              disabled={!effectiveCanEdit}
              className={`${dateInputClass(!payPeriodFrom)} w-[6.25rem] px-0.5 py-0 text-xs shrink-0`}
              style={{ color: headerStyle.textColor, borderColor: dateInputBorderColor }}
            />
            <label className="text-xs font-medium opacity-90 shrink-0">To</label>
            <input
              type="date"
              value={payPeriodTo}
              onChange={(e) => setPayPeriodTo(e.target.value)}
              disabled={!effectiveCanEdit}
              className={`${dateInputClass(!payPeriodTo)} w-[6.25rem] px-0.5 py-0 text-xs shrink-0`}
              style={{ color: headerStyle.textColor, borderColor: dateInputBorderColor }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3 px-4 py-2">
            <span className="font-bold shrink-0">Pay Period:</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-sm font-medium opacity-90 whitespace-nowrap">From</label>
              <input
                type="date"
                value={payPeriodFrom}
                onChange={(e) => setPayPeriodFrom(e.target.value)}
                disabled={!effectiveCanEdit}
                className={`w-[8.5rem] ${dateInputClass(!payPeriodFrom)} px-1.5 py-1`}
                style={{ color: headerStyle.textColor, borderColor: dateInputBorderColor }}
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-sm font-medium opacity-90 whitespace-nowrap">To</label>
              <input
                type="date"
                value={payPeriodTo}
                onChange={(e) => setPayPeriodTo(e.target.value)}
                disabled={!effectiveCanEdit}
                className={`w-[8.5rem] ${dateInputClass(!payPeriodTo)} px-1.5 py-1`}
                style={{ color: headerStyle.textColor, borderColor: dateInputBorderColor }}
              />
            </div>
          </div>
        )}
      </div>

      <div
        className={
          isCompactLayout
            ? 'mt-2 flex flex-col flex-1 min-h-0 min-w-0 gap-2'
            : 'mt-4 flex gap-4'
        }
      >
        <div
          ref={containerRef}
          className="table-container dark-theme flex-1 min-w-0 min-h-0"
          style={
            {
              height: isCompactLayout ? undefined : '50vh',
              maxHeight: isCompactLayout ? undefined : '50vh',
              flex: isCompactLayout ? 1 : undefined,
              minHeight: isCompactLayout ? 0 : undefined,
              overflow: isCompactLayout ? undefined : 'hidden' as const,
              border: '1px solid rgba(0,0,0,0.2)',
              borderTop: 'none',
              borderRadius: '0 0 8px 8px',
              backgroundColor: '#fff',
              '--provider-pay-header-bg': headerStyle.bgColor,
              '--provider-pay-header-text': headerStyle.textColor,
            } as CSSProperties
          }
        >
          <HandsontableWrapper
            key={`provider-pay-${clinicId}-${effectiveProviderId}-${JSON.stringify(lockData)}`}
            data={displayTableData}
            dataVersion={providerPayDataVersion + selectedMonth.getTime() + (isViewingBackup ? 1000000 + backupVersionKey : 0)}
            columns={columns}
            colHeaders={false}
            rowHeaders={false}
            width="100%"
            height={tableHeight}
            stretchH={isCompactLayout ? "none" : "all"}
            readOnly={!effectiveCanEdit}
            afterChange={afterChange}
            cells={cellsCallback}
            afterRenderCallback={applyProviderPayHeaderVisuals}
            style={{ backgroundColor: '#fff' }}
            className="handsontable-custom provider-pay-table"
            enableFormula={true}
          />
        </div>

      </div>

      <style>{`
        .provider-pay-table .provider-pay-table-header-row,
        .provider-pay-table td.provider-pay-table-header-row.htDimmed {
          background: var(--provider-pay-header-bg, rgba(30, 41, 59, 0.95)) !important;
          color: var(--provider-pay-header-text, #fff) !important;
          font-weight: bold !important;
        }
        .provider-pay-table .provider-pay-table-section-header-row,
        .provider-pay-table td.provider-pay-table-section-header-row.htDimmed {
          background: var(--provider-pay-section-header-bg, rgba(59, 130, 246, 0.18)) !important;
          color: var(--provider-pay-section-header-text, #1e3a8a) !important;
          font-weight: 600 !important;
          font-style: italic !important;
          text-align: center !important;
        }
        .provider-pay-table .htCore td {
          border-color: rgba(0,0,0,0.2);
        }
      `}</style>

      
        {/* Side notes/description on the right */}

            {/* <div className="w-[30rem] flex-1 flex-col absolute top-7 right-0 min-w-0">
            <label className="text-sm font-semibold text-slate-100 mb-2 text-[2rem]">
              Description / Notes
            </label>
            <textarea
              value={sideNotes}
              onChange={(e) => setSideNotes(e.target.value)}
              disabled={!canEdit}
              className="mt-8 w-full h-[29.5rem] flex-1 min-h-[200px] rounded-md border border-slate-600 bg-slate-900/60 text-slate-50 text-sm px-3 py-2 resize-vertical focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter overall description or notes for this provider pay period..."
            />
          </div> */}
          
    </div>
  )
}
