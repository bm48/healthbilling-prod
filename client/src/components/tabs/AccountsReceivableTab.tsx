import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { apiClient } from '@/lib/apiClient'
import { AccountsReceivable, ARType, StatusColor, IsLockAccountsReceivable, Patient } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { createBubbleDropdownRenderer, DateOfServiceEditor } from '@/lib/handsontableCustomRenderers'
import { ChevronLeft, ChevronRight, Lock, Unlock } from 'lucide-react'
import { isPastPeriodFromMonthKey } from '@/lib/monthPeriodLock'
import {
  toDisplayValue,
  toDisplayDate,
  toStoredString,
  parseDateOfServiceInput,
} from '@/lib/utils'
import {
  inferAccountsReceivableSheetYearMonth,
  isAccountsReceivableRowInMonth,
} from '@/lib/accountsReceivableInMonth'

function nextEmptyNumericIdSuffix(rows: { id: string }[]): number {
  let max = -1
  for (const r of rows) {
    const m = /^empty-(\d+)$/.exec(r.id)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max + 1
}

function isHandsontableUndoRedoSource(source?: string) {
  return source === 'UndoRedo.undo' || source === 'UndoRedo.redo'
}

/**
 * First name: only the first character uppercase (rest lowercase). Last: one uppercase initial.
 * Used when A-R "ID #" matches a {@link Patient} in the same clinic.
 */
function formatAccountsReceivablePatientName(p: Patient): string {
  const rawFirst = (p.first_name ?? '').trim()
  const first =
    rawFirst.length === 0
      ? ''
      : rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase()
  const last = (p.last_name ?? '').trim()
  const initial = last.length > 0 ? last.charAt(0).toUpperCase() : ''
  if (first && initial) return `${first} ${initial}`
  return first || initial || ''
}

/** DB-backed row fingerprint — only dirty rows are saved (same idea as PatientsTab lastSavedSnapshotRef). */
type LastSavedARSnapshot = {
  ar_id: string
  name: string | null
  date_of_service: string | null
  date_recorded: string | null
  amount: number | null
  type: ARType | null
  notes: string | null
  ar_year: number
  ar_month: number
}

function coerceARAmount(amount: AccountsReceivable['amount']): number | null {
  if (amount == null || (amount as unknown) === 'null') return null
  if (typeof amount === 'number') return Number.isNaN(amount) ? null : amount
  const n = parseFloat(String(amount))
  return Number.isNaN(n) ? null : n
}

function normalizeARForSnapshot(ar: AccountsReceivable): LastSavedARSnapshot {
  return {
    ar_id: ar.ar_id ?? '',
    name: (ar.name != null && ar.name !== 'null') ? ar.name : null,
    date_of_service: (ar.date_of_service != null && ar.date_of_service !== 'null') ? ar.date_of_service : null,
    date_recorded: (ar.date_recorded != null && ar.date_recorded !== 'null') ? ar.date_recorded : null,
    amount: coerceARAmount(ar.amount),
    type: (ar.type != null && (ar.type as unknown) !== 'null') ? ar.type : null,
    notes: (ar.notes != null && ar.notes !== 'null') ? ar.notes : null,
    ar_year: Number.isFinite(Number(ar.ar_year)) ? Math.trunc(Number(ar.ar_year)) : 0,
    ar_month: Number.isFinite(Number(ar.ar_month)) ? Math.trunc(Number(ar.ar_month)) : 0,
  }
}

function amountsSnapshotEqual(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return Math.abs(a - b) < 1e-6
}

function arSnapshotsEqual(a: LastSavedARSnapshot, b: LastSavedARSnapshot): boolean {
  return (
    a.ar_id === b.ar_id &&
    a.name === b.name &&
    a.date_of_service === b.date_of_service &&
    a.date_recorded === b.date_recorded &&
    amountsSnapshotEqual(a.amount, b.amount) &&
    a.type === b.type &&
    a.notes === b.notes &&
    a.ar_year === b.ar_year &&
    a.ar_month === b.ar_month
  )
}

function normalizeARFromDb(saved: AccountsReceivable): AccountsReceivable {
  const inferred = inferAccountsReceivableSheetYearMonth(saved)
  const yRaw = (saved as { ar_year?: unknown }).ar_year
  const mRaw = (saved as { ar_month?: unknown }).ar_month
  const ar_year =
    yRaw != null && Number.isFinite(Number(yRaw)) ? Math.trunc(Number(yRaw)) : inferred?.year ?? new Date().getFullYear()
  const ar_month =
    mRaw != null && Number.isFinite(Number(mRaw))
      ? Math.trunc(Number(mRaw))
      : inferred?.month ?? new Date().getMonth() + 1
  return {
    ...saved,
    ar_id: saved.ar_id != null && String(saved.ar_id) !== 'null' ? String(saved.ar_id) : '',
    name: (saved.name != null && saved.name !== 'null') ? saved.name : null,
    date_of_service: (saved.date_of_service != null && saved.date_of_service !== 'null') ? saved.date_of_service : null,
    date_recorded: (saved.date_recorded != null && saved.date_recorded !== 'null') ? saved.date_recorded : null,
    type: (saved.type != null && (saved.type as unknown) !== 'null') ? saved.type : null,
    notes: (saved.notes != null && saved.notes !== 'null') ? saved.notes : null,
    ar_year,
    ar_month,
  }
}

/** Same merge idea as PatientsTab after save + BillingTodoTab `setTodos`: keep in-flight grid edits; apply id/timestamps/clinic from DB; `ar_id` always from DB like `patient_id`. */
function mergeARRowAfterSave(row: AccountsReceivable, saved: AccountsReceivable): AccountsReceivable {
  const normalized = normalizeARFromDb(saved)
  const merged: AccountsReceivable = {
    ...row,
    id: normalized.id,
    created_at: normalized.created_at,
    updated_at: normalized.updated_at,
    clinic_id: normalized.clinic_id,
    payroll: normalized.payroll,
    ar_id: normalized.ar_id,
    name: row.name !== undefined ? row.name : normalized.name,
    date_of_service: row.date_of_service !== undefined ? row.date_of_service : normalized.date_of_service,
    amount: row.amount !== undefined ? row.amount : normalized.amount,
    date_recorded: row.date_recorded !== undefined ? row.date_recorded : normalized.date_recorded,
    type: row.type !== undefined ? row.type : normalized.type,
    notes: row.notes !== undefined ? row.notes : normalized.notes,
    ar_year: row.ar_year != null && row.ar_month != null ? row.ar_year : normalized.ar_year,
    ar_month: row.ar_year != null && row.ar_month != null ? row.ar_month : normalized.ar_month,
  }
  return merged
}

function buildSavedARLookup(savedARMap: Map<string, AccountsReceivable>) {
  const byNewId = new Map<string, AccountsReceivable>()
  savedARMap.forEach((saved, oldId) => {
    byNewId.set(saved.id, saved)
    if (oldId !== saved.id) byNewId.set(oldId, saved)
  })
  return byNewId
}

function mergeDisplayedARAfterSave(
  prev: AccountsReceivable[],
  savedARMap: Map<string, AccountsReceivable>
): AccountsReceivable[] {
  const byNewId = buildSavedARLookup(savedARMap)
  return prev.map((row) => {
    const saved = savedARMap.get(row.id) ?? byNewId.get(row.id)
    if (!saved) return row
    return mergeARRowAfterSave(row, saved)
  })
}

function mergeARFromGridRow(
  ar: AccountsReceivable,
  row: (string | number | null | undefined)[]
): AccountsReceivable {
  const ar_id = row[0] === '' || row[0] == null || row[0] === 'null' ? '' : String(row[0])
  const name = toStoredString(String(row[1] ?? ''))
  const date_of_service =
    row[2] === '' || row[2] == null || row[2] === 'null' ? null : parseDateOfServiceInput(String(row[2]))
  const amount =
    row[3] === '' || row[3] == null || row[3] === 'null'
      ? null
      : typeof row[3] === 'number'
        ? row[3]
        : parseFloat(String(row[3])) || null
  const date_recorded =
    row[4] === '' || row[4] == null || row[4] === 'null' ? null : parseDateOfServiceInput(String(row[4]))
  const typeStr = toStoredString(String(row[5] ?? ''))
  const type: ARType | null =
    typeStr === 'Patient' || typeStr === 'Insurance' || typeStr === 'Admin' ? typeStr : null
  const notes = toStoredString(String(row[6] ?? ''))
  return {
    ...ar,
    ar_id,
    name: name || null,
    date_of_service: date_of_service || null,
    amount,
    date_recorded: date_recorded || null,
    type,
    notes: notes || null,
  }
}

interface AccountsReceivableTabProps {
  clinicId: string
  /** 1 = default; 2 = clinic has two pay periods, show Payroll 1/2 selector */
  clinicPayroll?: 1 | 2
  canEdit: boolean
  /** Super-admin / admin: show lock control for past months/periods only. */
  canTogglePastMonthWholeSheetLock?: boolean
  wholeSheetLocked?: boolean
  onTogglePastMonthWholeSheetLock?: () => void
  onDelete?: (arId: string) => void
  isLockAccountsReceivable?: IsLockAccountsReceivable | null
  onLockColumn?: (columnName: string) => void
  isColumnLocked?: (columnName: keyof IsLockAccountsReceivable) => boolean
  isInSplitScreen?: boolean
  /** When viewing a backup version, parent passes the full AR list from backup (padded to 200). */
  overrideFullAR?: AccountsReceivable[] | null
  isViewingBackup?: boolean
  /** When viewing backup, a value that changes when the user selects a different version, so the grid refreshes. */
  backupVersionKey?: number
  /** Notifies parent of the month key used for AR data (and column locks): "Y-M" or "Y-M-P" when payroll=2. */
  onLocksMonthKeyChange?: (monthKey: string) => void
  /** Register a flush function the parent calls before switching away from this tab (so pending save completes). */
  onRegisterFlushBeforeTabLeave?: (flush: () => Promise<void>) => void
  /** Clinic patients: when ID # matches `patient_id`, Name auto-fills (same clinic only). */
  patients?: Patient[]
}

export default function AccountsReceivableTab({
  clinicId,
  clinicPayroll = 1,
  canEdit,
  canTogglePastMonthWholeSheetLock = false,
  wholeSheetLocked = false,
  onTogglePastMonthWholeSheetLock,
  onDelete,
  isLockAccountsReceivable,
  onLockColumn,
  isColumnLocked,
  isInSplitScreen,
  overrideFullAR = null,
  isViewingBackup = false,
  backupVersionKey = 0,
  onLocksMonthKeyChange,
  onRegisterFlushBeforeTabLeave,
  patients = [],
}: AccountsReceivableTabProps) {
  const { userProfile } = useAuth()
  const [statusColors, setStatusColors] = useState<StatusColor[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => new Date())
  const selectedMonthRef = useRef(selectedMonth)
  useEffect(() => {
    selectedMonthRef.current = selectedMonth
  }, [selectedMonth])
  /** Rows edited on the current sheet belong to the month shown in the selector (not claim `created_at`). */
  const applySheetPeriodToRow = useCallback((row: AccountsReceivable): AccountsReceivable => {
    const d = selectedMonthRef.current
    return { ...row, ar_year: d.getFullYear(), ar_month: d.getMonth() + 1 }
  }, [])
  const [selectedPayroll, setSelectedPayroll] = useState<1 | 2>(1)
  const fetchIdRef = useRef(0)
  /** Full list (all months) for save and month switching - like Patients has one list, we keep "all" in ref */
  const fullListRef = useRef<AccountsReceivable[]>([])
  const wasViewingBackupRef = useRef(false)
  /** Displayed list (current month, 200 rows) - same as Patients: state = what we show, grid row index = array index */
  const [displayedAR, setDisplayedAR] = useState<AccountsReceivable[]>([])
  const displayedARRef = useRef<AccountsReceivable[]>([])
  /** Stable temporary new- id per row (by current row id) so multiple cell edits on one row insert one record, not one per edit - same as Patients pendingPatientIdByRowIdRef */
  const pendingNewIdByRowIdRef = useRef<Map<string, string>>(new Map())
  const saveARTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Same as PatientsTab: only persist rows that differ from last successful save (avoids re-saving entire clinic on every keystroke). */
  const lastSavedSnapshotRef = useRef<Map<string, LastSavedARSnapshot>>(new Map())
  const saveInProgressRef = useRef(false)
  const savePendingRef = useRef(false)
  const [runPendingSaveTrigger, setRunPendingSaveTrigger] = useState(0)
  /** Resolves when the in-flight save finishes; flush() awaits this before running a final save. */
  const saveCompletePromiseRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null)
  /** True whenever there is data the user typed that hasn't been persisted yet (gates beforeunload + unmount flush). */
  const unsavedChangesRef = useRef(false)
  const saveAccountsReceivableRef = useRef<(rows: AccountsReceivable[]) => Promise<void>>(null as any)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState(600)
  const [structureVersion, setStructureVersion] = useState(0)
  const scrollToRowAfterUpdateRef = useRef<number | null>(null)
  const hotRef = useRef<Handsontable | null>(null)
  /** Handsontable row index can be visual when sorting exists; AR array is physical order (PatientsTab pattern). */
  const physicalRowFromHot = useCallback((visualRow: number) => {
    const hot = hotRef.current
    if (!hot || (hot as { isDestroyed?: boolean }).isDestroyed) return visualRow
    try {
      const p = hot.toPhysicalRow(visualRow)
      if (typeof p === 'number' && !Number.isNaN(p) && p >= 0) return p
    } catch {
      /* ignore */
    }
    return visualRow
  }, [])
  const lastEditedRowRef = useRef<number | null>(null)
  const lastSelectedRowRef = useRef<number | null>(null)
  const pendingRowLeaveSaveRef = useRef(false)
  const pendingRowLeaveSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set())

  /** When clinicPayroll=2 and payroll is passed, show "March 1st Half 2025"; otherwise "March 2025". */
  const formatMonthYear = useCallback((date: Date, payroll?: 1 | 2) => {
    if (clinicPayroll === 2 && payroll != null) {
      const monthName = date.toLocaleDateString('en-US', { month: 'long' })
      const half = payroll === 1 ? '1st' : '2nd'
      return `${monthName} ${half} Half ${date.getFullYear()}`
    }
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }, [clinicPayroll])

  // Use isLockAccountsReceivable from props directly - it will update when parent refreshes
  const lockData = isLockAccountsReceivable || null

  const arLocksMonthKeyForView = useMemo(() => {
    const y = selectedMonth.getFullYear()
    const m = selectedMonth.getMonth() + 1
    return clinicPayroll === 2 ? `${y}-${m}-${selectedPayroll}` : `${y}-${m}`
  }, [selectedMonth, clinicPayroll, selectedPayroll])

  useEffect(() => {
    onLocksMonthKeyChange?.(arLocksMonthKeyForView)
  }, [arLocksMonthKeyForView, onLocksMonthKeyChange])

  const payrollMode = clinicPayroll === 2 ? 2 : 1
  const isViewingPastPeriod = isPastPeriodFromMonthKey(arLocksMonthKeyForView, payrollMode)
  const effectiveCanEdit = useMemo(() => {
    if (!isViewingPastPeriod) return canEdit
    return canEdit && !wholeSheetLocked
  }, [canEdit, isViewingPastPeriod, wholeSheetLocked])

  const confirmAndTogglePastMonthWholeSheetLock = useCallback(() => {
    if (!onTogglePastMonthWholeSheetLock) return
    const message = wholeSheetLocked
      ? 'Unlock this accounts receivable period?'
      : 'Lock this accounts receivable period?'
    if (!window.confirm(message)) return
    onTogglePastMonthWholeSheetLock()
  }, [wholeSheetLocked, onTogglePastMonthWholeSheetLock])

  /** Build displayed list (200 rows) for selected month from a full list. Used for both live (fullListRef) and backup override. */
  const buildDisplayedFromList = useCallback((list: AccountsReceivable[]): AccountsReceivable[] => {
    let filtered = list.filter((ar) => isAccountsReceivableRowInMonth(ar, selectedMonth))
    if (clinicPayroll === 2) {
      filtered = filtered.filter((ar) => (ar.payroll ?? 1) === selectedPayroll)
    }
    if (filtered.length >= 200) return filtered
    const need = 200 - filtered.length
    const monthKey = selectedMonth.getTime()
    const placeholders: AccountsReceivable[] = Array.from({ length: need }, (_, i) => ({
      id: `placeholder-${monthKey}-${i}`,
      clinic_id: clinicId,
      ar_id: '',
      name: null,
      date_of_service: null,
      amount: null,
      date_recorded: null,
      type: null,
      notes: null,
      ar_year: selectedMonth.getFullYear(),
      ar_month: selectedMonth.getMonth() + 1,
      payroll: clinicPayroll === 2 ? selectedPayroll : 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))
    return [...filtered, ...placeholders]
  }, [selectedMonth, clinicPayroll, selectedPayroll, clinicId])

  const buildDisplayedFromFull = useCallback((): AccountsReceivable[] => {
    return buildDisplayedFromList(fullListRef.current)
  }, [buildDisplayedFromList])

  const currentPayrollForAR = clinicPayroll === 2 ? selectedPayroll : 1
  const createEmptyAR = useCallback((index: number): AccountsReceivable => ({
    id: `empty-${index}`,
    clinic_id: clinicId,
    ar_id: '',
    name: null,
    date_of_service: null,
    amount: null,
    date_recorded: null,
    type: null,
    notes: null,
    ar_year: selectedMonth.getFullYear(),
    ar_month: selectedMonth.getMonth() + 1,
    payroll: currentPayrollForAR,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }), [clinicId, currentPayrollForAR, selectedMonth])

  const fetchStatusColors = useCallback(async () => {
    try {
      const { data, error } = await apiClient
        .from('status_colors')
        .select('*')
        .in('type', ['ar_type', 'month'])

      if (error) throw error
      setStatusColors(data || [])
    } catch (error) {
      console.error('Error fetching status colors:', error)
    }
  }, [])

  const fetchAccountsReceivable = useCallback(async () => {
    const payrollFilter = clinicPayroll === 2 ? selectedPayroll : 1
    const thisFetchId = ++fetchIdRef.current
    try {
      const { data, error } = await apiClient
        .from('accounts_receivables')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('payroll', payrollFilter)
        .order('created_at', { ascending: false })

      if (error) throw error
      const rawList = (data || []) as AccountsReceivable[]
      let fetchedAR = rawList.map((ar) => normalizeARFromDb(ar))
      if (clinicPayroll === 2) {
        fetchedAR = fetchedAR.filter((row) => (row.payroll ?? 1) === payrollFilter)
      }

      // Only apply if no newer fetch started (user may have switched payroll before we completed)
      if (fetchIdRef.current !== thisFetchId) {
        return
      }

      const fetchedARMap = new Map<string, AccountsReceivable>()
      fetchedAR.forEach((ar) => {
        fetchedARMap.set(ar.id, ar)
      })

      const newFetchedAR = Array.from(fetchedARMap.values())

      if (clinicPayroll === 1) {
        const currentAR = fullListRef.current
        const preservedOrder: AccountsReceivable[] = []
        currentAR.forEach(ar => {
          if (ar.id.startsWith('new-') || ar.id.startsWith('empty-')) {
            preservedOrder.push(ar)
          } else {
            const freshData = fetchedARMap.get(ar.id)
            if (freshData) {
              preservedOrder.push(freshData)
              fetchedARMap.delete(ar.id)
            }
          }
        })
        const remainingFetched = Array.from(fetchedARMap.values())
        const updated = [...preservedOrder, ...remainingFetched]
        const emptyRowsNeeded = Math.max(0, 200 - updated.length)
        const existingEmptyCount = updated.filter(ar => ar.id.startsWith('empty-')).length
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) =>
          createEmptyAR(existingEmptyCount + i)
        )
        fullListRef.current = [...updated, ...newEmptyRows]
      } else {
        const updated = [...newFetchedAR]
        const emptyRowsNeeded = Math.max(0, 200 - updated.length)
        const existingEmptyCount = updated.filter(ar => ar.id.startsWith('empty-')).length
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) =>
          createEmptyAR(existingEmptyCount + i)
        )
        fullListRef.current = [...updated, ...newEmptyRows]
      }
      fullListRef.current.forEach((ar) => {
        if (!ar.id.startsWith('empty-') && !ar.id.startsWith('new-') && !ar.id.startsWith('placeholder-')) {
          lastSavedSnapshotRef.current.set(ar.id, normalizeARForSnapshot(ar))
        }
      })
      const nextDisplayed = buildDisplayedFromFull()
      setDisplayedAR(nextDisplayed)
    } catch (error) {
      console.error('Error fetching accounts receivable:', error)
    } finally {
      if (fetchIdRef.current === thisFetchId) {
        setLoading(false)
      }
    }
  }, [clinicId, clinicPayroll, selectedPayroll, createEmptyAR, buildDisplayedFromFull])

  // Like Providers tab: when viewing backup only switch what we display (via displayAR useMemo); do NOT overwrite fullListRef or displayedAR so "Back to current" shows current data immediately.
  useEffect(() => {
    if (!clinicId) return
    if (isViewingBackup) wasViewingBackupRef.current = true
    if (isViewingBackup && overrideFullAR) {
      setLoading(false)
      return
    }
    const returningFromBackup = wasViewingBackupRef.current
    if (returningFromBackup) wasViewingBackupRef.current = false
    if (clinicPayroll === 2 && !returningFromBackup) {
      fullListRef.current = []
      setDisplayedAR([])
      setLoading(true)
    }
    fetchStatusColors()
    fetchAccountsReceivable().then(() => {
      setDisplayedAR(buildDisplayedFromFull())
      setStructureVersion((v) => v + 1)
    })
  }, [clinicId, clinicPayroll, selectedPayroll, fetchStatusColors, fetchAccountsReceivable, isViewingBackup, overrideFullAR, buildDisplayedFromFull])

  /** Sync displayed ref from state - same as PatientsTab */
  useEffect(() => {
    displayedARRef.current = displayedAR
  }, [displayedAR])

  const prevSelectedMonthRef = useRef<number>(selectedMonth.getTime())
  /** When user changes month: merge current displayed back into full list, then show new month */
  useEffect(() => {
    const currentMonthKey = selectedMonth.getTime()
    if (prevSelectedMonthRef.current === currentMonthKey) return
    prevSelectedMonthRef.current = currentMonthKey
    const otherMonths = fullListRef.current.filter(ar => !isAccountsReceivableRowInMonth(ar, selectedMonth))
    const currentMonthRows = displayedARRef.current.filter(ar => !ar.id.startsWith('empty-'))
    fullListRef.current = [...otherMonths, ...currentMonthRows]
    const rebuilt = buildDisplayedFromFull()
    setDisplayedAR(rebuilt)
  }, [selectedMonth.getTime(), buildDisplayedFromFull])

  const saveAccountsReceivable = useCallback(async (arToSave: AccountsReceivable[]) => {
    if (!clinicId || !userProfile) {
      return
    }
    if (!effectiveCanEdit) {
      return
    }

    const arToProcess = arToSave.filter((ar) => {
      const hasData = !!(ar.ar_id || ar.name || ar.date_of_service || ar.amount !== null || ar.date_recorded || ar.type || ar.notes)
      if (!hasData) return false
      if (ar.id.startsWith('placeholder-')) return false
      if (ar.id.startsWith('empty-') || ar.id.startsWith('new-')) return true
      const snap = lastSavedSnapshotRef.current.get(ar.id)
      const current = normalizeARForSnapshot(ar)
      if (!snap) return true
      return !arSnapshotsEqual(snap, current)
    })

    if (arToProcess.length === 0) {
      unsavedChangesRef.current = false
      return
    }

    if (saveInProgressRef.current) {
      savePendingRef.current = true
      return
    }

    saveInProgressRef.current = true
    let resolveSaveComplete!: () => void
    const saveCompletePromise = new Promise<void>((r) => { resolveSaveComplete = r })
    saveCompletePromiseRef.current = { promise: saveCompletePromise, resolve: resolveSaveComplete }
    let saveSucceeded = false
    try {
      const savedARMap = new Map<string, AccountsReceivable>()

      for (let i = 0; i < arToProcess.length; i++) {
        const ar = arToProcess[i]
        const oldId = ar.id

        let finalArId = ar.ar_id || ''
        if (!finalArId) {
          finalArId = `AR-${Date.now()}-${i}`
        }

        const payrollValue = clinicPayroll === 2 ? selectedPayroll : 1
        const rawDos =
          ar.date_of_service != null && ar.date_of_service !== 'null' ? String(ar.date_of_service) : null
        const rawDr =
          ar.date_recorded != null && ar.date_recorded !== 'null' ? String(ar.date_recorded) : null
        const inferredPeriod = inferAccountsReceivableSheetYearMonth(ar)
        const arYear =
          ar.ar_year != null && Number.isFinite(Number(ar.ar_year))
            ? Math.trunc(Number(ar.ar_year))
            : inferredPeriod?.year ?? new Date().getFullYear()
        const arMonth =
          ar.ar_month != null && Number.isFinite(Number(ar.ar_month))
            ? Math.trunc(Number(ar.ar_month))
            : inferredPeriod?.month ?? new Date().getMonth() + 1
        const arData: any = {
          clinic_id: clinicId,
          ar_id: finalArId.trim(),
          name: (ar.name != null && ar.name !== 'null') ? ar.name : null,
          date_of_service: parseDateOfServiceInput(rawDos),
          amount: (ar.amount != null && (ar.amount as unknown) !== 'null') ? ar.amount : null,
          date_recorded: parseDateOfServiceInput(rawDr),
          type: (ar.type != null && (ar.type as unknown) !== 'null') ? ar.type : null,
          notes: (ar.notes != null && ar.notes !== 'null') ? ar.notes : null,
          payroll: payrollValue,
          ar_year: arYear,
          ar_month: arMonth,
          updated_at: new Date().toISOString(),
        }

        let savedAR: AccountsReceivable | null = null

        if (!ar.id.startsWith('new-') && !ar.id.startsWith('empty-')) {
          const { error: updateError, data: updateData } = await apiClient
            .from('accounts_receivables')
            .update(arData)
            .eq('id', ar.id)
            .select()

          if (!updateError && updateData && updateData.length > 0) {
            savedAR = updateData[0] as AccountsReceivable
            savedARMap.set(oldId, savedAR)
            pendingNewIdByRowIdRef.current.delete(oldId)
            const norm = normalizeARFromDb(savedAR)
            lastSavedSnapshotRef.current.set(norm.id, normalizeARForSnapshot(norm))
            if (oldId !== norm.id) lastSavedSnapshotRef.current.delete(oldId)
            continue
          }
        }

        const { error: insertError, data: insertedAR } = await apiClient
          .from('accounts_receivables')
          .insert(arData)
          .select()
          .maybeSingle()

        if (insertError) {
          console.error('[saveAR] INSERT failed row', i, 'id=', oldId, 'error=', insertError, 'code=', insertError.code, 'message=', insertError.message, 'arData=', arData)
          throw insertError
        }

        if (insertedAR) {
          savedAR = insertedAR as AccountsReceivable
          savedARMap.set(oldId, savedAR)
          pendingNewIdByRowIdRef.current.delete(oldId)
          const norm = normalizeARFromDb(savedAR)
          lastSavedSnapshotRef.current.set(norm.id, normalizeARForSnapshot(norm))
          if (oldId !== norm.id) lastSavedSnapshotRef.current.delete(oldId)
        }
      }

      const byNewId = buildSavedARLookup(savedARMap)
      fullListRef.current = fullListRef.current.map((ar) => {
        const savedAR = savedARMap.get(ar.id) ?? byNewId.get(ar.id)
        if (savedAR) return mergeARRowAfterSave(ar, savedAR)
        return ar
      })

      setDisplayedAR((prev) => {
        const merged = mergeDisplayedARAfterSave(prev, savedARMap)
        displayedARRef.current = merged
        return merged
      })
      saveSucceeded = true
    } catch (error: any) {
      console.error('[saveAR] catch error=', error, 'message=', error?.message, 'code=', error?.code, 'details=', error?.details)
      if (error?.message) console.error('[saveAR] full error message:', error.message)
      if (error?.stack) console.error('[saveAR] stack:', error.stack)
      const msg =
        error?.code === '401' || String(error?.message ?? '').toLowerCase().includes('unauthorized')
          ? 'Your session has expired. Refresh the page or sign in again, then save your Accounts Receivable changes.'
          : error?.message || 'Failed to save accounts receivable. Please try again.'
      alert(msg)
    } finally {
      saveInProgressRef.current = false
      saveCompletePromiseRef.current?.resolve()
      saveCompletePromiseRef.current = null
      if (saveSucceeded && !savePendingRef.current) {
        unsavedChangesRef.current = false
      }
      if (savePendingRef.current) {
        savePendingRef.current = false
        setRunPendingSaveTrigger((t) => t + 1)
      }
    }
  }, [clinicId, userProfile, clinicPayroll, selectedPayroll, effectiveCanEdit])

  saveAccountsReceivableRef.current = saveAccountsReceivable

  useEffect(() => {
    if (runPendingSaveTrigger === 0) return
    saveAccountsReceivableRef.current(fullListRef.current).catch((err) => {
      console.error('[AccountsReceivableTab] Error in pending save:', err)
    })
  }, [runPendingSaveTrigger])

  /**
   * Commits any open cell editor (so the typed value reaches state), then runs the save pipeline,
   * awaiting an in-flight save first. Mirrors PatientsTab's flush so the parent can call this
   * from `handleTabChange` before unmounting us.
   */
  const flushARSave = useCallback(async () => {
    const hot = hotRef.current
    try {
      const anyHot = hot as unknown as { isEditing?: () => boolean; getActiveEditor?: () => { finishEditing?: () => void } | null }
      if (anyHot?.isEditing?.()) {
        const editor = anyHot.getActiveEditor?.() ?? null
        editor?.finishEditing?.()
      }
    } catch {
      /* ignore */
    }
    try {
      ;(hot as unknown as { deselectCell?: () => void })?.deselectCell?.()
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )

    if (saveARTimeoutRef.current) {
      clearTimeout(saveARTimeoutRef.current)
      saveARTimeoutRef.current = null
    }

    const month = selectedMonthRef.current
    const displayed = displayedARRef.current
    const otherMonths = fullListRef.current.filter((ar) => !isAccountsReceivableRowInMonth(ar, month))
    const currentMonthRows = displayed.filter((ar) => !ar.id.startsWith('placeholder-'))
    fullListRef.current = [...otherMonths, ...currentMonthRows]

    if (saveInProgressRef.current && saveCompletePromiseRef.current) {
      await saveCompletePromiseRef.current.promise
    }
    await saveAccountsReceivableRef.current?.(fullListRef.current)

    while (savePendingRef.current || saveInProgressRef.current) {
      if (saveInProgressRef.current && saveCompletePromiseRef.current) {
        await saveCompletePromiseRef.current.promise
      } else {
        await new Promise<void>((r) => setTimeout(r, 0))
      }
    }
  }, [])

  useEffect(() => {
    if (!onRegisterFlushBeforeTabLeave) return
    onRegisterFlushBeforeTabLeave(flushARSave)
  }, [onRegisterFlushBeforeTabLeave, flushARSave])

  // Warn user if they try to reload / close the tab while a save is queued or in flight.
  // Browsers can't be told to wait for an async fetch, so this is the only reliable way to avoid losing data on reload.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const dirty =
        unsavedChangesRef.current ||
        saveARTimeoutRef.current !== null ||
        saveInProgressRef.current ||
        savePendingRef.current
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Last-resort flush when component unmounts without the parent calling flushARSave first.
  // We can't await here, but starting the fetch ensures the row is persisted server-side
  // even though we won't be able to update local state.
  useEffect(() => {
    return () => {
      if (saveARTimeoutRef.current) {
        clearTimeout(saveARTimeoutRef.current)
        saveARTimeoutRef.current = null
      }
      if (!unsavedChangesRef.current && !savePendingRef.current) return
      const displayed = displayedARRef.current
      const month = selectedMonthRef.current
      const otherMonths = fullListRef.current.filter((ar) => !isAccountsReceivableRowInMonth(ar, month))
      const currentMonthRows = displayed.filter((ar) => !ar.id.startsWith('placeholder-'))
      fullListRef.current = [...otherMonths, ...currentMonthRows]
      void saveAccountsReceivableRef.current?.(fullListRef.current)?.catch((err) => {
        console.error('[AccountsReceivableTab unmount] Error flushing save:', err)
      })
    }
  }, [])

  const handleDeleteAR = useCallback(async (arId: string) => {
    if (!effectiveCanEdit && !arId.startsWith('new-')) {
      return
    }
    if (arId.startsWith('new-')) {
      const next = displayedARRef.current.filter(a => a.id !== arId)
      const emptyNeeded = Math.max(0, 200 - next.length)
      const existingEmpty = next.filter(a => a.id.startsWith('empty-')).length
      const toDisplay = emptyNeeded > existingEmpty
        ? [...next, ...Array.from({ length: emptyNeeded - existingEmpty }, (_, i) => createEmptyAR(existingEmpty + i))]
        : next
      displayedARRef.current = toDisplay
      setDisplayedAR(toDisplay)
      fullListRef.current = [
        ...fullListRef.current.filter(a => !isAccountsReceivableRowInMonth(a, selectedMonth)),
        ...toDisplay.filter(a => !a.id.startsWith('empty-')),
      ]
      setStructureVersion(v => v + 1)
      return
    }

    try {
      const { error } = await apiClient
        .from('accounts_receivables')
        .delete()
        .eq('id', arId)

      if (error) throw error
      lastSavedSnapshotRef.current.delete(arId)
      await fetchAccountsReceivable()
      setStructureVersion(v => v + 1)
      if (onDelete) onDelete(arId)
    } catch (error) {
      console.error('Error deleting accounts receivable:', error)
      alert('Failed to delete accounts receivable record. Please try again.')
    }
  }, [fetchAccountsReceivable, onDelete, createEmptyAR, selectedMonth, effectiveCanEdit])

  const syncARFullListFromDisplay = useCallback(
    (toDisplay: AccountsReceivable[]) => {
      fullListRef.current = [
        ...fullListRef.current.filter((a) => !isAccountsReceivableRowInMonth(a, selectedMonth)),
        ...toDisplay.filter((a) => !a.id.startsWith('empty-')),
      ]
    },
    [selectedMonth]
  )

  const padARDisplayedTo200 = useCallback(
    (list: AccountsReceivable[]) => {
      const result = [...list]
      while (result.length > 200) {
        const last = result[result.length - 1]
        if (last && (last.id.startsWith('empty-') || last.id.startsWith('placeholder-'))) result.pop()
        else break
      }
      const trimmed = result.length > 200 ? result.slice(0, 200) : result
      const out = [...trimmed]
      while (out.length < 200) {
        out.push(createEmptyAR(nextEmptyNumericIdSuffix(out)))
      }
      return out
    },
    [createEmptyAR]
  )

  const syncDisplayedARFromHotAfterUndoRedo = useCallback(() => {
    const hot = hotRef.current
    if (!hot || (hot as any).isDestroyed) return
    if (!effectiveCanEdit) return
    const firstDay = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-01`
    try {
      const grid = hot.getData() as (string | number | null | undefined)[][]
      const prev = displayedARRef.current
      const next = [...prev]
      for (let v = 0; v < grid.length; v++) {
        const phys = physicalRowFromHot(v)
        if (phys < 0) continue
        const row = grid[v]
        while (next.length <= phys) {
          const existingEmptyCount = next.filter((a) => a.id.startsWith('empty-')).length
          next.push({ ...createEmptyAR(existingEmptyCount), date_of_service: firstDay })
        }
        let p = next[phys]
        if (!p) {
          const existingEmptyCount = next.filter((a) => a.id.startsWith('empty-')).length
          p = { ...createEmptyAR(existingEmptyCount), date_of_service: firstDay }
        }
        const merged = mergeARFromGridRow(p, row)
        next[phys] = merged
      }
      const padded = padARDisplayedTo200(next)
      displayedARRef.current = padded
      syncARFullListFromDisplay(padded)
      setDisplayedAR(padded)
      void saveAccountsReceivable(fullListRef.current).catch((err) =>
        console.error('saveAccountsReceivable after HOT undo/redo sync', err)
      )
    } catch (e) {
      console.error('syncDisplayedARFromHotAfterUndoRedo', e)
    }
  }, [effectiveCanEdit, selectedMonth, createEmptyAR, padARDisplayedTo200, syncARFullListFromDisplay, physicalRowFromHot, saveAccountsReceivable])

  const handleAfterCreateRow = useCallback(
    (index: number, amount: number, source?: string) => {
      if (!effectiveCanEdit) return
      if (source === 'loadData' || source === 'updateData') return
      if (isHandsontableUndoRedoSource(source)) return
      const physIndex = physicalRowFromHot(index)
      setDisplayedAR((prev) => {
        const next = [...prev]
        const base = nextEmptyNumericIdSuffix(next)
        for (let i = 0; i < amount; i++) {
          next.splice(physIndex + i, 0, createEmptyAR(base + i))
        }
        const padded = padARDisplayedTo200(next)
        displayedARRef.current = padded
        syncARFullListFromDisplay(padded)
        return padded
      })
      setStructureVersion((v) => v + 1)
      requestAnimationFrame(() => {
        saveAccountsReceivable(fullListRef.current).catch((err) =>
          console.error('saveAccountsReceivable after HOT create row', err)
        )
      })
    },
    [effectiveCanEdit, createEmptyAR, padARDisplayedTo200, syncARFullListFromDisplay, physicalRowFromHot, saveAccountsReceivable]
  )

  const handleAfterRemoveRow = useCallback(
    (_index: number, _amount: number, physicalRows: number[], source?: string) => {
      if (!effectiveCanEdit) return
      if (source === 'loadData' || source === 'updateData') return
      if (isHandsontableUndoRedoSource(source)) return
      const snap = [...displayedARRef.current]
      const removed = physicalRows.map((i) => snap[i]).filter(Boolean)
      removed.forEach((ar) => {
        if (ar.id.startsWith('empty-') || ar.id.startsWith('placeholder-')) return
        void handleDeleteAR(ar.id)
      })
      setDisplayedAR((prev) => {
        const rm = new Set(physicalRows)
        const next = padARDisplayedTo200(prev.filter((_, i) => !rm.has(i)))
        displayedARRef.current = next
        syncARFullListFromDisplay(next)
        return next
      })
      setStructureVersion((v) => v + 1)
      requestAnimationFrame(() => {
        saveAccountsReceivable(fullListRef.current).catch((err) =>
          console.error('saveAccountsReceivable after HOT remove row', err)
        )
      })
    },
    [effectiveCanEdit, handleDeleteAR, padARDisplayedTo200, syncARFullListFromDisplay, saveAccountsReceivable]
  )

  // Type color mapping
  const getTypeColor = useCallback((type: string | null): { color: string; textColor: string } | null => {
    if (!type) return null
    const typeColor = statusColors.find(s => s.status === type && s.type === 'ar_type')
    if (typeColor) {
      return { color: typeColor.color, textColor: typeColor.text_color || '#000000' }
    }
    return null
  }, [statusColors])

  // Month color for month selector (from status_colors type 'month')
  const getMonthColor = useCallback((month: string): { color: string; textColor: string } | null => {
    if (!month) return null
    const monthColor = statusColors.find(s => s.status === month && s.type === 'month')
    if (monthColor) {
      return { color: monthColor.color, textColor: monthColor.text_color || '#000000' }
    }
    return null
  }, [statusColors])

  /** When viewing backup, use override so the grid shows the correct version on first render (same fix as Patients tab). */
  const displayAR = useMemo(
    () => (isViewingBackup && overrideFullAR && overrideFullAR.length > 0 ? buildDisplayedFromList(overrideFullAR) : displayedAR),
    [isViewingBackup, overrideFullAR, displayedAR, buildDisplayedFromList]
  )

  /** Same as PatientsTab: data from display source (override when viewing backup, else state) */
  const getARHandsontableData = useCallback(() => {
    return displayAR.map(ar => [
      toDisplayValue(ar.ar_id),
      toDisplayValue(ar.name),
      toDisplayDate(ar.date_of_service),
      toDisplayValue(ar.amount),
      toDisplayDate(ar.date_recorded),
      toDisplayValue(ar.type),
      toDisplayValue(ar.notes),
    ])
  }, [displayAR])

  const totalARAmount = useMemo(() => {
    let sum = 0
    for (const ar of displayAR) {
      const n = coerceARAmount(ar.amount)
      if (n != null) sum += n
    }
    return sum
  }, [displayAR])

  const totalARAmountFormatted = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(totalARAmount),
    [totalARAmount]
  )

  // Column field names mapping to is_lock_accounts_receivable table columns
  const columnFields: Array<keyof IsLockAccountsReceivable> = ['ar_id', 'name', 'date_of_service', 'amount', 'date_recorded', 'type', 'notes']
  const columnTitles = ['ID #', 'Name', 'Date of Service', 'Amount', 'Date Recorded', 'Type', 'Notes']

  const arLocksHeaderKey = useMemo(() => {
    if (!lockData) return 'none'
    return columnFields.map((f) => (lockData[f] ? '1' : '0')).join('')
  }, [lockData, columnFields])

  const lockIconSrc = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}lock_icon.png`

  const afterGetARColHeader = useCallback(
    (col: number, TH: HTMLTableCellElement, headerLevel?: number) => {
      if (headerLevel != null && headerLevel !== 0) return
      TH.querySelector('.ar-col-header-lock-wrap')?.remove()
      if (col < 0) return
      const field = columnFields[col]
      if (!field || !lockData || !lockData[field]) return
      const wrap = document.createElement('span')
      wrap.className = 'ar-col-header-lock-wrap'
      wrap.title = 'Column locked'
      const img = document.createElement('img')
      img.className = 'ar-col-header-lock-img'
      img.src = lockIconSrc
      img.alt = ''
      img.width = 18
      img.height = 18
      wrap.appendChild(img)
      const inner = (TH.querySelector('div') as HTMLElement | null) || TH
      inner.appendChild(wrap)
    },
    [columnFields, lockData, lockIconSrc]
  )

  // Right-click on column headers to lock/unlock; locked columns show public/lock_icon.png via afterGetColHeader
  useEffect(() => {
    if (!canEdit || !onLockColumn || !isColumnLocked) return

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let menuEl: HTMLElement | null = null
    let closeListener: (() => void) | null = null

    const hideMenu = () => {
      if (menuEl?.parentNode) menuEl.parentNode.removeChild(menuEl)
      menuEl = null
      if (closeListener) {
        document.removeEventListener('click', closeListener)
        document.removeEventListener('contextmenu', closeListener)
        closeListener = null
      }
    }

    const showHeaderContextMenu = (e: MouseEvent, columnName: string) => {
      e.preventDefault()
      e.stopPropagation()
      hideMenu()
      const isLocked = isColumnLocked ? isColumnLocked(columnName as keyof IsLockAccountsReceivable) : false
      const menu = document.createElement('div')
      menu.className = 'ar-col-header-context-menu'
      menu.style.cssText = 'position:fixed;z-index:9999;background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.4);padding:4px 0;min-width:140px;'
      const item = document.createElement('div')
      item.style.cssText = 'padding:6px 12px;cursor:pointer;white-space:nowrap;font-size:13px;'
      item.textContent = isLocked ? 'Unlock column' : 'Lock column'
      item.onclick = () => {
        onLockColumn(columnName)
        hideMenu()
      }
      menu.appendChild(item)
      document.body.appendChild(menu)
      menuEl = menu
      const x = Math.min(e.clientX, window.innerWidth - 150)
      const y = Math.min(e.clientY, window.innerHeight - 40)
      menu.style.left = `${x}px`
      menu.style.top = `${y}px`
      closeListener = () => { hideMenu() }
      setTimeout(() => {
        document.addEventListener('click', closeListener!, true)
        document.addEventListener('contextmenu', closeListener!, true)
      }, 0)
    }

    const attachContextMenuToHeader = (headerRow: Element | null) => {
      if (!headerRow) return
      const headerCells = Array.from(headerRow.querySelectorAll('th'))
      headerCells.forEach((th) => {
        let cellText = (th.querySelector('.colHeader')?.textContent ?? th.textContent ?? '').replace(/🔒|🔓/g, '').trim()
        const columnIndex = columnTitles.findIndex(title => {
          const a = title.toLowerCase().trim()
          const b = cellText.toLowerCase().trim()
          return a === b || b.includes(a) || a.includes(b)
        })
        if (columnIndex === -1 || columnIndex >= columnFields.length) return
        const columnName = columnFields[columnIndex]
        const el = th as HTMLElement
        const prev = (el as any)._arHeaderContext
        if (prev) el.removeEventListener('contextmenu', prev)
        const handler = (e: MouseEvent) => showHeaderContextMenu(e, columnName as string)
        ;(el as any)._arHeaderContext = handler
        el.addEventListener('contextmenu', handler)
      })
    }

    const attachAll = () => {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }
      const table = document.querySelector('.ar-handsontable table.htCore')
      if (table) attachContextMenuToHeader(table.querySelector('thead tr'))
      const cloneTop = document.querySelector('.ar-handsontable .ht_clone_top table.htCore')
      if (cloneTop) attachContextMenuToHeader(cloneTop.querySelector('thead tr'))
    }

    timeoutId = setTimeout(attachAll, 300)
    const observer = new MutationObserver(() => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(attachAll, 200)
    })
    const tableContainer = document.querySelector('.ar-handsontable')
    if (tableContainer) observer.observe(tableContainer, { childList: true, subtree: true })

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      observer.disconnect()
      hideMenu()
      document.querySelectorAll('.ar-handsontable th').forEach((th) => {
        const h = (th as any)._arHeaderContext
        if (h) th.removeEventListener('contextmenu', h)
      })
    }
  }, [canEdit, onLockColumn, isColumnLocked, columnFields, columnTitles, isLockAccountsReceivable])

  const getReadOnly = useCallback(
    (columnName: keyof IsLockAccountsReceivable): boolean => {
      if (!effectiveCanEdit) return true
      if (!lockData) return false
      return Boolean(lockData[columnName])
    },
    [effectiveCanEdit, lockData]
  )

  /** Case-insensitive patient_id → patient for this clinic only (defense in depth if parent passes extra rows). */
  const patientByArIdKey = useMemo(() => {
    const m = new Map<string, Patient>()
    for (const p of patients) {
      if (p.clinic_id !== clinicId) continue
      const key = String(p.patient_id ?? '').trim().toLowerCase()
      if (key) m.set(key, p)
    }
    return m
  }, [patients, clinicId])

  // Create columns with custom renderers
  const arColumns = useMemo(() => [
    { 
      data: 0, 
      title: 'ID #', 
      type: 'text' as const, 
      width: 80,
      readOnly: !effectiveCanEdit || getReadOnly('ar_id')
    },
    { 
      data: 1, 
      title: 'Name', 
      type: 'text' as const, 
      width: 120,
      readOnly: !effectiveCanEdit || getReadOnly('name')
    },
    {
      data: 2,
      title: 'Date of Service',
      type: 'text' as const,
      width: 90,
      editor: DateOfServiceEditor,
      readOnly: !effectiveCanEdit || getReadOnly('date_of_service'),
    },
    { 
      data: 3, 
      title: 'Amount', 
      type: 'numeric' as const, 
      width: 100,
      numericFormat: {
        pattern: '0.00',
        culture: 'en-US'
      },
      readOnly: !effectiveCanEdit || getReadOnly('amount')
    },
    {
      data: 4,
      title: 'Date Recorded',
      type: 'text' as const,
      width: 90,
      editor: DateOfServiceEditor,
      readOnly: !effectiveCanEdit || getReadOnly('date_recorded'),
    },
    { 
      data: 5, 
      title: 'Type', 
      type: 'dropdown' as const, 
      width: 120,
      selectOptions: ['Patient', 'Insurance', 'Admin'],
      renderer: createBubbleDropdownRenderer(getTypeColor) as any,
      readOnly: !effectiveCanEdit || getReadOnly('type')
    },
    { 
      data: 6, 
      title: 'Notes', 
      type: 'text' as const, 
      width: 200,
      readOnly: !effectiveCanEdit || getReadOnly('notes')
    },
  ], [effectiveCanEdit, lockData, getTypeColor, getReadOnly])

  const arCellsCallback = useCallback(
    (row: number, col: number) => {
      const ar = displayAR[physicalRowFromHot(row)]
      const colKey = columnFields[col]
      if (!colKey) return {}
      const key = `${ar?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key) ? { className: 'cell-highlight-yellow' } : {}
    },
    [displayAR, columnFields, highlightedCells, physicalRowFromHot]
  )

  const getCellIsHighlighted = useCallback(
    (row: number, col: number) => {
      const ar = displayAR[physicalRowFromHot(row)]
      const colKey = columnFields[col]
      if (!colKey) return false
      const key = `${ar?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key)
    },
    [displayAR, columnFields, highlightedCells, physicalRowFromHot]
  )

  const handleCellHighlight = useCallback((row: number, col: number) => {
    const ar = displayAR[physicalRowFromHot(row)]
    const colKey = columnFields[col]
    if (!colKey) return
    const key = `${ar?.id ?? `row-${row}`}:${colKey}`
    setHighlightedCells((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [displayAR, columnFields, physicalRowFromHot])

  const firstDayOfSelectedMonth = useMemo(() => {
    return `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-01`
  }, [selectedMonth])

  const handleARRowMove = useCallback((movedRows: number[], finalIndex: number) => {
    if (!effectiveCanEdit) return
    const arr = [...(displayedARRef.current.length > 0 ? displayedARRef.current : displayedAR)]
    const toMove = movedRows.map(i => arr[i])
    movedRows.sort((a, b) => b - a).forEach(i => arr.splice(i, 1))
    const insertAt = Math.min(finalIndex, arr.length)
    toMove.forEach((item, i) => arr.splice(insertAt + i, 0, item))
    displayedARRef.current = arr
    setDisplayedAR(arr)
    fullListRef.current = [
      ...fullListRef.current.filter(ar => !isAccountsReceivableRowInMonth(ar, selectedMonth)),
      ...arr.filter(ar => !ar.id.startsWith('empty-')),
    ]
    const realAR = arr.filter(ar => !ar.id.startsWith('new-') && !ar.id.startsWith('empty-'))
    if (realAR.length > 0) {
      const baseTime = Date.now()
      Promise.all(
        realAR.map((ar, i) =>
          apiClient
            .from('accounts_receivables')
            .update({ created_at: new Date(baseTime - i * 1000).toISOString() })
            .eq('id', ar.id)
        )
      ).catch(err => console.error('Failed to persist AR order', err))
    }
    setStructureVersion(v => v + 1)
  }, [displayedAR, selectedMonth, effectiveCanEdit])

  const handleARAfterSelection = useCallback(
    (r: number, _c: number, _r2: number, _c2: number) => {
      const physR = physicalRowFromHot(r)
      const prev = lastSelectedRowRef.current
      if (prev !== null && physR !== prev && !saveInProgressRef.current) {
        pendingRowLeaveSaveRef.current = true
        if (pendingRowLeaveSaveTimeoutRef.current) clearTimeout(pendingRowLeaveSaveTimeoutRef.current)
        const FALLBACK_MS = 800
        pendingRowLeaveSaveTimeoutRef.current = setTimeout(() => {
          pendingRowLeaveSaveTimeoutRef.current = null
          if (!pendingRowLeaveSaveRef.current) return
          pendingRowLeaveSaveRef.current = false
          if (saveARTimeoutRef.current) {
            clearTimeout(saveARTimeoutRef.current)
            saveARTimeoutRef.current = null
          }
          if (!saveInProgressRef.current) {
            saveAccountsReceivable(fullListRef.current).catch((err) =>
              console.error('[AR] Error flushing save on selection change (fallback):', err)
            )
          } else {
            savePendingRef.current = true
          }
        }, FALLBACK_MS)
      }
      lastSelectedRowRef.current = physR
    },
    [physicalRowFromHot, saveAccountsReceivable]
  )

  const handleARAfterDeselect = useCallback(() => {
    if (saveInProgressRef.current) return
    if (lastSelectedRowRef.current === null) return
    if (pendingRowLeaveSaveTimeoutRef.current) {
      clearTimeout(pendingRowLeaveSaveTimeoutRef.current)
      pendingRowLeaveSaveTimeoutRef.current = null
    }
    pendingRowLeaveSaveRef.current = false
    if (saveARTimeoutRef.current) {
      clearTimeout(saveARTimeoutRef.current)
      saveARTimeoutRef.current = null
    }
    if (!saveInProgressRef.current) {
      saveAccountsReceivable(fullListRef.current).catch((err) =>
        console.error('[AR] Error flushing save on deselect (click outside):', err)
      )
    } else {
      savePendingRef.current = true
    }
  }, [saveAccountsReceivable])

  /** Same as PatientsTab: physical row index, ref + state, dirty-only save, row-leave flush, 500ms debounce with pending re-run while save in flight */
  const handleARHandsontableChange = useCallback((changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes || source === 'loadData') return

    const fields: Array<keyof AccountsReceivable> = ['ar_id', 'name', 'date_of_service', 'amount', 'date_recorded', 'type', 'notes']

    const rowsInChange = [...new Set(changes.map(([r]) => physicalRowFromHot(typeof r === 'number' ? r : 0)))]
    const primaryRow = rowsInChange[0] ?? null
    const prevRow = lastEditedRowRef.current
    const didLeaveRow = prevRow !== null && primaryRow !== null && !rowsInChange.includes(prevRow)

    const currentDisplayed = displayedARRef.current.length > 0 ? displayedARRef.current : displayedAR
    const updatedDisplayed = [...currentDisplayed]
    const invalidDateCells: { row: number; col: number }[] = []

    changes.forEach(([row, col, , newValue]) => {
      const phys = physicalRowFromHot(typeof row === 'number' ? row : 0)
      while (updatedDisplayed.length <= phys) {
        const existingEmptyCount = updatedDisplayed.filter((ar) => ar.id.startsWith('empty-')).length
        updatedDisplayed.push(
          applySheetPeriodToRow({
            ...createEmptyAR(existingEmptyCount),
            date_of_service: firstDayOfSelectedMonth,
          })
        )
      }
      const ar = updatedDisplayed[phys]
      if (!ar) return
      const colNum = typeof col === 'number' ? col : 0
      const field = fields[colNum]
      const needsNewId = ar.id.startsWith('empty-') || ar.id.startsWith('placeholder-')
      let newId: string
      if (needsNewId) {
        const existing = pendingNewIdByRowIdRef.current.get(ar.id)
        if (existing) {
          newId = existing
        } else {
          newId = `new-${Date.now()}-${phys}-${Math.random()}`
          pendingNewIdByRowIdRef.current.set(ar.id, newId)
        }
      } else {
        newId = ar.id
      }

      if (field === 'amount') {
        const numValue = (newValue === '' || newValue === null || newValue === 'null') ? null : (typeof newValue === 'number' ? newValue : parseFloat(String(newValue)) || null)
        updatedDisplayed[phys] = applySheetPeriodToRow({
          ...ar,
          id: newId,
          [field]: numValue,
          updated_at: new Date().toISOString(),
        } as AccountsReceivable)
      } else if (field === 'date_of_service' || field === 'date_recorded') {
        const str =
          newValue === '' || newValue === null || newValue === 'null' ? '' : String(newValue).trim()
        const value = str === '' ? null : parseDateOfServiceInput(str)
        updatedDisplayed[phys] = applySheetPeriodToRow({
          ...ar,
          id: newId,
          [field]: value,
          updated_at: new Date().toISOString(),
        } as AccountsReceivable)
        if (value == null && str !== '' && typeof row === 'number') {
          invalidDateCells.push({ row, col: colNum })
        }
      } else if (field === 'type' || field === 'notes') {
        const value = toStoredString(String(newValue ?? ''))
        updatedDisplayed[phys] = applySheetPeriodToRow({
          ...ar,
          id: newId,
          [field]: value,
          updated_at: new Date().toISOString(),
        } as AccountsReceivable)
      } else if (field === 'ar_id') {
        const raw = (newValue === '' || newValue === 'null') ? '' : String(newValue).trim()
        const idPart = raw ? (raw.split(' - ')[0]?.trim() || raw) : ''
        const value = idPart

        let nextName = ar.name
        if (!getReadOnly('name')) {
          if (value === '') {
            nextName = null
          } else {
            const matched = patientByArIdKey.get(value.toLowerCase())
            if (matched) {
              const formatted = formatAccountsReceivablePatientName(matched)
              nextName = toStoredString(formatted)
            }
          }
        }

        updatedDisplayed[phys] = applySheetPeriodToRow({
          ...ar,
          id: newId,
          ar_id: value,
          name: nextName,
          updated_at: new Date().toISOString(),
        } as AccountsReceivable)
      } else if (field) {
        const value = toStoredString(String(newValue ?? ''))
        updatedDisplayed[phys] = applySheetPeriodToRow({
          ...ar,
          id: newId,
          [field]: value,
          updated_at: new Date().toISOString(),
        } as AccountsReceivable)
      }
    })

    if (updatedDisplayed.length < 200) {
      const emptyRowsNeeded = 200 - updatedDisplayed.length
      const existingEmptyCount = updatedDisplayed.filter((ar) => ar.id.startsWith('empty-')).length
      updatedDisplayed.push(
        ...Array.from({ length: emptyRowsNeeded }, (_, i) => createEmptyAR(existingEmptyCount + i))
      )
    }

    lastEditedRowRef.current = primaryRow
    if (primaryRow !== null) lastSelectedRowRef.current = primaryRow

    unsavedChangesRef.current = true
    displayedARRef.current = updatedDisplayed
    setDisplayedAR(updatedDisplayed)

    const nameCellsToSync = new Map<number, string>()
    for (const ch of changes) {
      const row = ch[0]
      const col = ch[1]
      if (col !== 0) continue
      if (getReadOnly('name')) continue
      const phys = physicalRowFromHot(typeof row === 'number' ? row : 0)
      const arRow = updatedDisplayed[phys]
      if (!arRow) continue
      nameCellsToSync.set(typeof row === 'number' ? row : 0, toDisplayValue(arRow.name))
    }
    if (nameCellsToSync.size > 0) {
      queueMicrotask(() => {
        const hot = hotRef.current
        if (!hot || (hot as { isDestroyed?: boolean }).isDestroyed) return
        nameCellsToSync.forEach((name, visualRow) => {
          try {
            hot.setDataAtCell(visualRow, 1, name, 'loadData')
          } catch {
            /* ignore */
          }
        })
      })
    }

    if (invalidDateCells.length > 0) {
      queueMicrotask(() => {
        const hot = hotRef.current
        if (!hot) return
        for (const { row, col } of invalidDateCells) {
          hot.setDataAtCell(row, col, '', 'loadData')
        }
      })
    }

    const otherMonths = fullListRef.current.filter((ar) => !isAccountsReceivableRowInMonth(ar, selectedMonth))
    const currentMonthRows = updatedDisplayed.filter((ar) => !ar.id.startsWith('placeholder-'))
    fullListRef.current = [...otherMonths, ...currentMonthRows]

    if (didLeaveRow) {
      if (saveARTimeoutRef.current) {
        clearTimeout(saveARTimeoutRef.current)
        saveARTimeoutRef.current = null
      }
      if (!saveInProgressRef.current) {
        saveAccountsReceivable(fullListRef.current).catch((err) =>
          console.error('[AR] Error flushing save on row leave:', err)
        )
      } else {
        savePendingRef.current = true
      }
    }

    if (pendingRowLeaveSaveRef.current) {
      pendingRowLeaveSaveRef.current = false
      if (pendingRowLeaveSaveTimeoutRef.current) {
        clearTimeout(pendingRowLeaveSaveTimeoutRef.current)
        pendingRowLeaveSaveTimeoutRef.current = null
      }
      if (saveARTimeoutRef.current) {
        clearTimeout(saveARTimeoutRef.current)
        saveARTimeoutRef.current = null
      }
      if (!saveInProgressRef.current) {
        saveAccountsReceivable(fullListRef.current).catch((err) =>
          console.error('[AR] Error flushing save (pending row leave):', err)
        )
      } else {
        savePendingRef.current = true
      }
    }

    if (saveARTimeoutRef.current) clearTimeout(saveARTimeoutRef.current)
    saveARTimeoutRef.current = setTimeout(() => {
      saveARTimeoutRef.current = null
      if (saveInProgressRef.current) {
        savePendingRef.current = true
        return
      }
      saveAccountsReceivable(fullListRef.current).catch((err) => {
        console.error('[handleARHandsontableChange] Error in saveAccountsReceivable:', err)
      })
    }, 500)

    // Do not bump structureVersion on routine cell edits or after each save (same as Patients / Billing To-Do):
    // a full HOT data reload (dataVersion++) would wipe in-flight / adjacent cell state.
  }, [
    displayedAR,
    saveAccountsReceivable,
    selectedMonth,
    createEmptyAR,
    firstDayOfSelectedMonth,
    physicalRowFromHot,
    patientByArIdKey,
    getReadOnly,
    applySheetPeriodToRow,
  ])

  // ResizeObserver for split screen: fill table height (must run before any early return)
  useEffect(() => {
    if (!isInSplitScreen) return
    const el = tableContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setTableHeight(el.clientHeight)
    })
    ro.observe(el)
    setTableHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [isInSplitScreen])

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center text-white/70 py-8">Loading accounts receivable...</div>
      </div>
    )
  }

  
  return (
    <div 
      className="p-6" 
      style={
        isInSplitScreen
          ? { width: '100%', overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }
          : {}
      }
    >
      {!isInSplitScreen && (
        <div className="mb-4 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-white">ACCOUNTS RECEIVABLE</h2>
        </div>
      )}
      {/* Month selector - like Providers tab; when clinicPayroll=2 shows "March 1st Half" / "March 2nd Half" */}
      {(() => {
        const monthName = selectedMonth.toLocaleString('en-US', { month: 'long' })
        const monthColor = getMonthColor(monthName)
        const bgColor = monthColor?.color ?? 'rgba(30, 41, 59, 0.5)'
        const textColor = monthColor?.textColor ?? '#fff'
        return (
          <div
            className="relative flex items-center justify-center gap-4 rounded-lg border border-slate-700"
            style={{ backgroundColor: bgColor, color: textColor, maxWidth: '40%', margin: 'auto', marginBottom: '10px' }}
          >
            <button
              onClick={() => {
                if (clinicPayroll === 2) {
                  if (selectedPayroll === 2) {
                    setSelectedPayroll(1)
                  } else {
                    setSelectedPayroll(2)
                    setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
                  }
                } else {
                  setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
                }
              }}
              className="absolute left-0 p-2 hover:opacity-80 rounded-lg transition-opacity"
              style={{ color: textColor }}
              title={clinicPayroll === 2 ? 'Previous period' : 'Previous month'}
            >
              <ChevronLeft size={20} />
            </button>
            <div className="text-lg font-semibold min-w-[200px] text-center px-2">
              A-R for {formatMonthYear(selectedMonth, clinicPayroll === 2 ? selectedPayroll : undefined)}
            </div>
            {canTogglePastMonthWholeSheetLock && isViewingPastPeriod && onTogglePastMonthWholeSheetLock && (
              <button
                type="button"
                onClick={confirmAndTogglePastMonthWholeSheetLock}
                className="absolute right-9 p-1.5 rounded-lg hover:opacity-80 transition-opacity"
                style={{ color: textColor }}
                title={
                  wholeSheetLocked
                    ? 'Unlock sheet — allow editing this period'
                    : 'Lock sheet — make this period read-only for staff'
                }
                aria-label={wholeSheetLocked ? 'Unlock accounts receivable sheet' : 'Lock accounts receivable sheet'}
              >
                {wholeSheetLocked ? <Lock size={18} strokeWidth={2.25} /> : <Unlock size={18} strokeWidth={2.25} />}
              </button>
            )}
            <button
              onClick={() => {
                if (clinicPayroll === 2) {
                  if (selectedPayroll === 1) {
                    setSelectedPayroll(2)
                  } else {
                    setSelectedPayroll(1)
                    setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
                  }
                } else {
                  setSelectedMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
                }
              }}
              className="absolute right-0 p-2 hover:opacity-80 rounded-lg transition-opacity"
              style={{ color: textColor }}
              title={clinicPayroll === 2 ? 'Next period' : 'Next month'}
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )
      })()}
      <div 
        ref={tableContainerRef}
        className="table-container dark-theme" 
        style={{ 
          maxHeight: isInSplitScreen ? undefined : 'calc(100vh - 300px)',
          flex: isInSplitScreen ? 1 : undefined,
          minHeight: isInSplitScreen ? 0 : undefined,
          overflow: 'hidden',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          backgroundColor: '#d2dbe5',
          width: '100%',
          maxWidth: '100%',
        }}
      >
        <HandsontableWrapper
          key={`ar-${selectedMonth.getTime()}-${selectedPayroll}-${JSON.stringify(lockData)}-${wholeSheetLocked ? '1' : '0'}`}
          data={getARHandsontableData()}
          dataVersion={structureVersion + (isViewingBackup ? 1000000 + backupVersionKey : 0)}
          scrollToRowAfterUpdateRef={scrollToRowAfterUpdateRef}
          columns={arColumns}
          colHeaders={columnTitles}
          colHeaderRefreshKey={arLocksHeaderKey}
          afterGetColHeader={afterGetARColHeader}
          rowHeaders={true}
          width="100%"
          height={isInSplitScreen ? tableHeight : 600}
          afterChange={handleARHandsontableChange}
          afterSelection={handleARAfterSelection}
          afterDeselect={handleARAfterDeselect}
          onAfterRowMove={handleARRowMove}
          afterCreateRow={handleAfterCreateRow}
          afterRemoveRow={handleAfterRemoveRow}
          onAfterUndoRedoSync={syncDisplayedARFromHotAfterUndoRedo}
          hotInstanceRef={hotRef}
          contextMenuWithNativeRows
          onCellHighlight={handleCellHighlight}
          getCellIsHighlighted={getCellIsHighlighted}
          cells={arCellsCallback}
          enableFormula={true}
          readOnly={!effectiveCanEdit}
          style={{ backgroundColor: '#d2dbe5' }}
          className="handsontable-custom ar-handsontable"
        />
      </div>

      {/* Sum bar — same placement and chrome as billing sheet (ProvidersTab) */}
      <div
        className="mt-3 flex flex-col gap-2 px-4 py-3 rounded-lg border border-white/20 bg-slate-800/80 text-white"
        style={{ width: '100%', maxWidth: '100%' }}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-6 flex-wrap">
          <span className="font-medium text-red-500">Sums:</span>
          <span className="ml-2">
            <strong>Total amount:</strong>{' '}
            <span className="tabular-nums">{totalARAmountFormatted}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
