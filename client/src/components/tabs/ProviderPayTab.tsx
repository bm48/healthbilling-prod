import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import type { Provider, StatusColor } from '@/types'
import { fetchProviderPay, saveProviderPay } from '@/lib/providerPay'

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
    ['Patient Payments', '', ''],
    ['Insurance Payments', '', ''],
    ['A/R Payments', '', ''],
    ['', '', ''],
    // ['', '', ''],
    // ['', '', ''],
    ['Total Payments', '', ''],
    ['Provider Cut', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
  ]
  return rows
})()

export interface ProviderPayTabProps {
  clinicId: string
  /** 1 = default; 2 = clinic has two pay periods, show Payroll 1/2 selector */
  clinicPayroll?: 1 | 2
  /** When set, data is loaded and saved to the provider_pay database tables. */
  providerId?: string
  /** List of providers in the clinic for the provider dropdown. When provided, a select is shown and the chosen provider is used for load/save. */
  providers?: Provider[]
  canEdit: boolean
  isInSplitScreen?: boolean
  selectedMonth: Date
  onPreviousMonth: () => void
  onNextMonth: () => void
  /** When payroll=2, second arg is used to show "January 1st Half" / "January 2nd Half". */
  formatMonthYear: (date: Date, payroll?: 1 | 2) => string
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
}

export default function ProviderPayTab({
  clinicId,
  clinicPayroll = 1,
  providerId: providerIdProp,
  providers = [],
  canEdit,
  isInSplitScreen,
  selectedMonth,
  onPreviousMonth,
  onNextMonth,
  formatMonthYear,
  statusColors,
  isLockProviderPay,
  onLockColumn: _onLockColumn,
  isColumnLocked: _isColumnLocked,
  overrideTableData = null,
  isViewingBackup = false,
  backupVersionKey = 0,
  onSelectedProviderIdChange,
}: ProviderPayTabProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState(600)
  const [payDate, setPayDate] = useState('')
  const [payPeriodFrom, setPayPeriodFrom] = useState('')
  const [payPeriodTo, setPayPeriodTo] = useState('')
  const [tableData, setTableData] = useState<string[][]>(() => INITIAL_TABLE_DATA.map(row => [...row]))
  const [providerPayDataVersion, setProviderPayDataVersion] = useState(0)
  const [sideNotes, setSideNotes] = useState('')
  const [selectedPayroll, setSelectedPayroll] = useState<1 | 2>(1)

  type CachedPay = { payDate: string; payPeriodFrom: string; payPeriodTo: string; sideNotes: string; tableData: string[][] }
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
  const hasLoadedOnceRef = useRef(false)
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
      setLoading(false)
      return
    }
    if (isViewingBackup) {
      setTableData(overrideTableData && overrideTableData.length > 0 ? overrideTableData.map((r) => [...r]) : INITIAL_TABLE_DATA.map((row) => [...row]))
      setLoading(false)
      return
    }
    const payrollForFetch = clinicPayroll === 2 ? selectedPayroll : 1
    const cacheKey = `${year}-${month}-${effectiveProviderId}-${payrollForFetch}`

    const applyDataToState = (payDateVal: string, payPeriodFromVal: string, payPeriodToVal: string, notesVal: string, rows: string[][]) => {
      setPayDate(payDateVal)
      setPayPeriodFrom(payPeriodFromVal)
      setPayPeriodTo(payPeriodToVal)
      setSideNotes(notesVal)
      setTableData(rows)
      setProviderPayDataVersion((v) => v + 1)
    }

    const processFetchResult = (data: { payDate: string; payPeriod: string; notes: string; rows: string[][] } | null): CachedPay => {
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
        const rows = data.rows.map((r) => [...r])
        if (rows.length > ROW_TOTAL_PAYMENTS) {
          rows[ROW_TOTAL_PAYMENTS][1] = formatAmount(computeTotalPayments(rows))
        }
        if (rows.length > ROW_PROVIDER_CUT) {
          rows[ROW_PROVIDER_CUT][1] = formatAmount(computeProviderCut(parseAmount(rows[ROW_TOTAL_PAYMENTS][1]), providerCutPercent))
        }
        for (const r of [1, 2, 3]) {
          if (rows[r]?.[1] != null && rows[r][1] !== '') rows[r][1] = formatAmount(rows[r][1])
        }
        return { payDate: data.payDate, payPeriodFrom: payPeriodFromVal, payPeriodTo: payPeriodToVal, sideNotes: data.notes ?? '', tableData: rows }
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
      return { payDate: '', payPeriodFrom: '', payPeriodTo: '', sideNotes: '', tableData: initial }
    }

    const cached = providerPayCache[cacheKey]
    if (cached) {
      applyDataToState(cached.payDate, cached.payPeriodFrom, cached.payPeriodTo, cached.sideNotes, cached.tableData.map((r) => [...r]))
      setLoading(false)
    } else {
      // Only show full-page loading on very first load; when switching month, fetch in background without replacing content
      if (!hasLoadedOnceRef.current) setLoading(true)
    }

    fetchProviderPay(clinicId, effectiveProviderId, year, month, payrollForFetch)
      .then((data) => {
        const entry = processFetchResult(data)
        applyDataToState(entry.payDate, entry.payPeriodFrom, entry.payPeriodTo, entry.sideNotes, entry.tableData.map((r) => [...r]))
        setProviderPayCache((prev) => ({ ...prev, [cacheKey]: entry }))
      })
      .catch((err) => console.error('[ProviderPayTab] fetchProviderPay error:', err))
      .finally(() => {
        setLoading(false)
        hasLoadedOnceRef.current = true
      })
  }, [clinicId, effectiveProviderId, year, month, providerCutPercent, clinicPayroll, selectedPayroll, isViewingBackup, overrideTableData])

  /** When viewing backup, use override so the grid shows the correct version on first render (same fix as AR and Patients tabs). */
  const displayTableData = useMemo(
    () =>
      isViewingBackup && overrideTableData && overrideTableData.length > 0
        ? overrideTableData.map((r) => [...r])
        : tableData,
    [isViewingBackup, overrideTableData, tableData]
  )

  // Debounced save when payDate, payPeriod, tableData, or sideNotes change (only when effectiveProviderId is set and not loading).
  // Update cache on success so fetch effect re-runs don't overwrite state with stale cache. Flush on unmount and beforeunload.
  const runSave = useCallback((p: NonNullable<typeof savePayloadRef.current>) => {
    const cacheKey = `${p.year}-${p.month}-${p.effectiveProviderId}-${p.payrollForSave}`
    saveProviderPay(p.clinicId, p.effectiveProviderId, p.year, p.month, p.payDate, p.payPeriod, p.tableData, p.sideNotes, p.payrollForSave)
      .then(() => {
        setProviderPayCache((prev) => ({
          ...prev,
          [cacheKey]: {
            payDate: p.payDate,
            payPeriodFrom: p.payPeriodFrom,
            payPeriodTo: p.payPeriodTo,
            sideNotes: p.sideNotes,
            tableData: p.tableData.map((r) => [...r]),
          },
        }))
      })
      .catch((err) => console.error('[ProviderPayTab] saveProviderPay error:', err))
  }, [])

  useEffect(() => {
    if (!clinicId || !effectiveProviderId || !canEdit || loading) return
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
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null
      const p = savePayloadRef.current
      if (p) {
        savePayloadRef.current = null
        runSave(p)
      }
    }, 300)
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
        const p = savePayloadRef.current
        if (p) {
          savePayloadRef.current = null
          runSave(p)
        }
      }
    }
  }, [clinicId, effectiveProviderId, year, month, canEdit, loading, payDate, payPeriod, payPeriodFrom, payPeriodTo, tableData, sideNotes, clinicPayroll, selectedPayroll, runSave])

  // Flush pending save when user refreshes or closes tab so data persists
  useEffect(() => {
    const onBeforeUnload = () => {
      const p = savePayloadRef.current
      if (saveTimeoutRef.current && p) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
        savePayloadRef.current = null
        saveProviderPay(p.clinicId, p.effectiveProviderId, p.year, p.month, p.payDate, p.payPeriod, p.tableData, p.sideNotes, p.payrollForSave)
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const getMonthColor = useCallback(
    (month: string): { color: string; textColor: string } | null => {
      const monthColor = statusColors.find((s) => s.status === month && s.type === 'month')
      if (monthColor) {
        return { color: monthColor.color, textColor: monthColor.text_color || '#000000' }
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

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateHeight = () => {
      const h = el.clientHeight
      if (h > 0) setTableHeight(h)
    }
    updateHeight()
    const ro = new ResizeObserver(updateHeight)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isInSplitScreen])

  const getReadOnly = (columnName: keyof IsLockProviderPay): boolean => {
    if (!canEdit) return true
    if (!lockData) return false
    return Boolean(lockData[columnName])
  }

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
        readOnly: !canEdit || getReadOnly('amount'),
      },
      {
        data: 2,
        title: 'Notes',
        type: 'text' as const,
        width: 200,
        readOnly: !canEdit || getReadOnly('notes'),
      },
    ],
    [canEdit, lockData]
  )

  const cellsCallback = useCallback(
    (row: number, col: number) => {
      const props: { readOnly?: boolean; className?: string } = {}
      if (row === 0) {
        props.className = 'provider-pay-table-header-row'
        props.readOnly = true
        return props
      }
      if (col === 0) {
        props.readOnly = row <= 6 ? true : !canEdit
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
    [canEdit]
  )

  const afterChange = useCallback(
    (changes: Handsontable.CellChange[] | null, _source?: Handsontable.ChangeSource) => {
      if (!changes?.length || !canEdit) return
      setTableData((prev) => {
        const next = prev.map((r) => [...r])
        for (const change of changes) {
          const row = typeof change[0] === 'number' ? change[0] : -1
          const col = typeof change[1] === 'number' ? change[1] : -1
          const newVal = change[3]
          if (row <= 0 || row >= next.length || col < 0 || col >= 3) continue
          if (col === 0 && row <= 6) continue
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
    [canEdit, providerCutPercent]
  )

  // Apply header color to thead and to row 0 (first data row) via CSS variables
  useEffect(() => {
    const applyHeaderStyle = () => {
      const root = document.querySelector('.handsontable-custom.provider-pay-table')
      if (!root || !(root instanceof HTMLElement)) return
      root.style.setProperty('--provider-pay-header-bg', headerStyle.bgColor)
      root.style.setProperty('--provider-pay-header-text', headerStyle.textColor)
      const thead = root.querySelector('.ht_master thead th, .ht_clone_top thead th')
      if (thead) {
        const ths = root.querySelectorAll('.ht_master thead th, .ht_clone_top thead th')
        ths.forEach((th) => {
          if (th instanceof HTMLElement) {
            th.style.background = headerStyle.bgColor
            th.style.color = headerStyle.textColor
            th.style.fontWeight = 'bold'
            th.style.borderColor = '#1e293b'
          }
        })
      }
      const core = root.querySelector('.ht_master table.htCore tbody tr:first-child td')
      if (core) {
        const firstRowCells = root.querySelectorAll('.ht_master table.htCore tbody tr:first-child td')
        firstRowCells.forEach((td) => {
          if (td instanceof HTMLElement) {
            td.style.background = headerStyle.bgColor
            td.style.color = headerStyle.textColor
            td.style.fontWeight = 'bold'
            td.style.borderColor = 'rgba(0,0,0,0.2)'
          }
        })
      }
      const cloneLeft = root.querySelector('.ht_clone_left table.htCore tbody tr:first-child td')
      if (cloneLeft) {
        const leftCells = root.querySelectorAll('.ht_clone_left table.htCore tbody tr:first-child td')
        leftCells.forEach((td) => {
          if (td instanceof HTMLElement) {
            td.style.background = headerStyle.bgColor
            td.style.color = headerStyle.textColor
            td.style.fontWeight = 'bold'
          }
        })
      }
    }
    const t = setTimeout(applyHeaderStyle, 100)
    return () => clearTimeout(t)
  }, [headerStyle, displayTableData])

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-slate-500" />
      </div>
    )
  }

  return (
    <div
      className="p-6 min-w-0"
      style={
        isInSplitScreen
          ? { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }
          : { maxWidth: '45vw', width: '100%' }
      }
    >
      {clinicPayroll === 2 && (
        <div className="flex items-center gap-3 mb-3">
          <label className="text-white font-medium">Payroll:</label>
          <select
            value={selectedPayroll}
            onChange={(e) => setSelectedPayroll(Number(e.target.value) as 1 | 2)}
            className="px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-white"
          >
            <option value={1}>Payroll 1</option>
            <option value={2}>Payroll 2</option>
          </select>
        </div>
      )}
      <div className="flex items-center gap-2 justify-between">
        {/* Month selector - same style as other tabs */}
        {(() => {
          const monthName = selectedMonth.toLocaleString('en-US', { month: 'long' })
          const monthColor = getMonthColor(monthName)
          const bgColor = monthColor?.color ?? 'rgba(30, 41, 59, 0.5)'
          const textColor = monthColor?.textColor ?? '#fff'
          return (
            <div
              className="relative flex h-9 mb-3 items-center justify-center gap-4 rounded-lg border border-slate-700"
              style={{
                backgroundColor: bgColor,
                color: textColor,
                width: '25rem',
                // margin: 'auto',
                // marginBottom: '10px',
              }}
            >
              <button
                onClick={onPreviousMonth}
                className="absolute left-0 p-2 hover:opacity-80 rounded-lg transition-opacity"
                style={{ color: textColor }}
                title="Previous month"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="text-lg font-semibold min-w-[200px] text-center">{formatMonthYear(selectedMonth, clinicPayroll === 2 ? selectedPayroll : undefined)}</div>
              <button
                onClick={onNextMonth}
                className="absolute right-0 p-2 hover:opacity-80 rounded-lg transition-opacity"
                style={{ color: textColor }}
                title="Next month"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )
        })()}

        {/* Provider select - when providers list is provided */}
        {providers.length > 0 && (
          <div className="mb-3 flex items-center gap-2">
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
              className="cursor-pointer rounded-lg border border-slate-600 bg-slate-800 text-slate-100 px-3 py-2 text-sm min-w-[200px] focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        className="rounded-t-lg border border-b-0 border-slate-700"
        style={{
          backgroundColor: headerStyle.bgColor,
          color: headerStyle.textColor,
        }}
      >
        <div className="flex items-center px-4 py-2 border-b border-slate-600/50">
          <span className="font-bold w-28">Pay Date:</span>
          <input
            type="date"
            value={payDate}
            onChange={(e) => setPayDate(e.target.value)}
            className={`flex-1 max-w-[12rem] bg-transparent border border-white/30 rounded px-2 py-1 outline-none text-inherit [color-scheme:dark] ${!payDate ? 'provider-pay-date-empty' : ''}`}
            style={{ color: headerStyle.textColor }}
          />
        </div>
        <div className="flex items-center gap-3 px-4 py-2">
          <span className="font-bold w-28 shrink-0">Pay Period:</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <label className="text-sm font-medium opacity-90 whitespace-nowrap">From</label>
            <input
              type="date"
              value={payPeriodFrom}
              onChange={(e) => setPayPeriodFrom(e.target.value)}
              className={`w-[8.5rem] bg-transparent border border-white/30 rounded px-1.5 py-1 text-sm outline-none text-inherit [color-scheme:dark] ${!payPeriodFrom ? 'provider-pay-date-empty' : ''}`}
              style={{ color: headerStyle.textColor }}
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <label className="text-sm font-medium opacity-90 whitespace-nowrap">To</label>
            <input
              type="date"
              value={payPeriodTo}
              onChange={(e) => setPayPeriodTo(e.target.value)}
              className={`w-[8.5rem] bg-transparent border border-white/30 rounded px-1.5 py-1 text-sm outline-none text-inherit [color-scheme:dark] ${!payPeriodTo ? 'provider-pay-date-empty' : ''}`}
              style={{ color: headerStyle.textColor }}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-4">
        <div
          ref={containerRef}
          className="table-container dark-theme flex-1"
          style={{
            height: isInSplitScreen ? undefined : '50vh',
            maxHeight: isInSplitScreen ? undefined : '50vh',
            flex: isInSplitScreen ? 1 : undefined,
            minHeight: isInSplitScreen ? 0 : undefined,
            overflow: 'hidden',
            border: '1px solid rgba(0,0,0,0.2)',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
            backgroundColor: '#fff',
          }}
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
            readOnly={!canEdit}
            afterChange={afterChange}
            cells={cellsCallback}
            style={{ backgroundColor: '#fff' }}
            className="handsontable-custom provider-pay-table"
            enableFormula={true}
          />
        </div>

      </div>

      <style>{`
        .provider-pay-table .provider-pay-table-header-row {
          background: var(--provider-pay-header-bg, rgba(30, 41, 59, 0.95)) !important;
          color: var(--provider-pay-header-text, #fff) !important;
          font-weight: bold !important;
        }
        .provider-pay-table .htCore td {
          border-color: rgba(0,0,0,0.2);
        }
        /* Hide browser date format placeholder when value is empty */
        .provider-pay-date-empty::-webkit-datetime-edit,
        .provider-pay-date-empty::-webkit-datetime-edit-fields-wrapper {
          color: transparent;
        }
        .provider-pay-date-empty::-moz-placeholder {
          color: transparent;
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
