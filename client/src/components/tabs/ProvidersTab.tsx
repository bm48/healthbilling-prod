import { Provider, SheetRow, BillingCode, StatusColor, Patient, IsLockProviders, AccountsReceivable } from '@/types'
import { X } from 'lucide-react'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import MonthYearTabs from '@/components/MonthYearTabs'
import Handsontable from 'handsontable'
import { createBubbleDropdownRenderer, createMultiBubbleDropdownRenderer, MultiSelectCptEditor, DateOfServiceEditor, currencyCellRenderer, copayTextCellRenderer, coinsuranceTextCellRenderer, createColoredAutocompleteDropdown } from '@/lib/handsontableCustomRenderers'
import { useCallback, useMemo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiClient } from '@/lib/apiClient'
import { useAuth } from '@/contexts/AuthContext'
import { parseDateOfServiceInput, toStoredString } from '@/lib/utils'
import { computeBillingMetrics } from '@/lib/billingMetrics'
import { isAccountsReceivableRowInMonth } from '@/lib/accountsReceivableInMonth'
import {
  sheetRowsToUiMatrix,
  providerSheetUiExportHeaders,
  coPatientByIdKey,
  type ProviderSheetUiExportLayout,
} from '@/lib/providerSheetBackupUiExport'

/** Only defer patient_id to DB validation for paste / fill / multi-cell — not per-keystroke cell edits. */
function shouldBatchDeferPatientId(source: string, nonNullChangeCount: number): boolean {
  if (nonNullChangeCount > 1) return true
  const s = String(source)
  if (s === 'CopyPaste') return true
  if (s.includes('Autofill')) return true
  if (s === 'fill') return true
  return false
}

function isHandsontableUndoRedoSource(source?: string) {
  return source === 'UndoRedo.undo' || source === 'UndoRedo.redo'
}

function providersDebugTab(event: string, payload?: Record<string, unknown>) {
  void event
  void payload
}

// Only appointment_date is a true date column (parsed via parseDateOfServiceInput).
// submit_date is free text ("Most Recent Submit Date"); payment_date / ar_date are month-name
// dropdowns ("May", "September", ...). Routing those through the date parser on undo/redo sync
// nulled out the whole column (parser returns null for non-MM-DD-YY values).
const PROVIDER_GRID_DATE_FIELDS: (keyof SheetRow)[] = ['appointment_date']
const PROVIDER_GRID_TEXT_FIELDS_FORMERLY_DATE: (keyof SheetRow)[] = ['submit_date', 'payment_date', 'ar_date']

/** Matches `columnFieldsFullBase` / row order used by `getTableDataFromRows` for full sheets (before optional Tele column insert). */
const IS_LOCK_PROVIDERS_FIELD_ORDER: Array<keyof IsLockProviders> = [
  'patient_id',
  'first_name',
  'last_initial',
  'insurance',
  'copay',
  'coinsurance',
  'date_of_service',
  'cpt_code',
  'appointment_note_status',
  'claim_status',
  'most_recent_submit_date',
  'ins_pay',
  'ins_pay_date',
  'pt_res',
  'collected_from_pt',
  'pt_pay_status',
  'pt_payment_ar_ref_date',
  'total',
  'notes',
]

/**
 * Map Handsontable row-array index (`columns[].data`) → `is_lock_providers` field for header lock icons.
 * Layouts differ for office staff vs full sheet vs level-1 provider (see `getTableDataFromRows`).
 */
function lockFieldFromProvidersRowDataIndex(
  rowDataIndex: number,
  opts: {
    showVisitTypeColumn: boolean
    officeStaffView: boolean
    isProviderView: boolean
    providerLevel: number
  }
): keyof IsLockProviders | null {
  const { showVisitTypeColumn, officeStaffView, isProviderView, providerLevel } = opts
  const full = IS_LOCK_PROVIDERS_FIELD_ORDER

  if (officeStaffView) {
    if (showVisitTypeColumn) {
      if (rowDataIndex === 9) return null
      if (rowDataIndex >= 0 && rowDataIndex < 9) return full[rowDataIndex]
      if (rowDataIndex === 10) return 'collected_from_pt'
      if (rowDataIndex === 11) return 'pt_pay_status'
      if (rowDataIndex === 12) return 'pt_payment_ar_ref_date'
      return null
    }
    if (rowDataIndex >= 0 && rowDataIndex < 9) return full[rowDataIndex]
    if (rowDataIndex === 9) return 'collected_from_pt'
    if (rowDataIndex === 10) return 'pt_pay_status'
    if (rowDataIndex === 11) return 'pt_payment_ar_ref_date'
    return null
  }

  if (isProviderView && providerLevel !== 2) {
    if (showVisitTypeColumn && rowDataIndex === 9) return null
    if (rowDataIndex >= 0 && rowDataIndex <= 8) return full[rowDataIndex]
    return null
  }

  if (showVisitTypeColumn) {
    if (rowDataIndex === 9) return null
    if (rowDataIndex >= 0 && rowDataIndex < 9) return full[rowDataIndex]
    if (rowDataIndex >= 10 && rowDataIndex <= 19) return full[rowDataIndex - 1]
    return null
  }
  if (rowDataIndex >= 0 && rowDataIndex < full.length) return full[rowDataIndex]
  return null
}

/** Map visible grid columns → SheetRow fields for undo/redo sync (matches handleProviderRowsHandsontableChange layout). */
function mergeProviderRowFromGridRowForSync(
  prev: SheetRow,
  gridRow: (string | number | boolean | null | undefined)[],
  fields: Array<keyof SheetRow>
): SheetRow {
  const next: SheetRow = { ...prev }
  for (let col = 0; col < fields.length && col < gridRow.length; col++) {
    const field = fields[col]
    const raw = gridRow[col]
    if (field === 'visit_type') {
      if (raw === true || raw === false) {
        next.visit_type = raw === true ? 'Telehealth' : 'In-person'
      } else if (raw === '' || raw == null) {
        next.visit_type = null
      } else {
        next.visit_type = String(raw) === 'Telehealth' ? 'Telehealth' : 'In-person'
      }
      continue
    }
    if (field === 'patient_id') {
      const s = String(raw ?? '').trim()
      const pid = s ? (s.split(' - ')[0]?.trim() || s) : ''
      next.patient_id = toStoredString(pid) ?? null
      continue
    }
    if (field === 'total') {
      const num =
        raw === '' || raw == null || raw === 'null'
          ? null
          : typeof raw === 'number'
            ? raw
            : parseFloat(String(raw))
      next.total = num != null && Number.isFinite(num) ? String(num) : null
      continue
    }
    if (field === 'insurance_payment' || field === 'collected_from_patient') {
      const num =
        raw === '' || raw == null || raw === 'null' || raw === undefined
          ? null
          : typeof raw === 'number'
            ? raw
            : parseFloat(String(raw))
      const n = num != null && Number.isFinite(num) ? String(num) : null
      if (field === 'insurance_payment') next.insurance_payment = n
      else next.collected_from_patient = n
      continue
    }
    if (PROVIDER_GRID_DATE_FIELDS.includes(field)) {
      const d = raw === '' || raw == null || raw === 'null' ? null : parseDateOfServiceInput(String(raw))
      if (field === 'appointment_date') next.appointment_date = d
      continue
    }
    if (PROVIDER_GRID_TEXT_FIELDS_FORMERLY_DATE.includes(field)) {
      let value = raw === '' || raw == null || raw === 'null' ? null : String(raw)
      // Match afterChange guard: reject purely numeric input for submit_date so the prior value sticks.
      if (field === 'submit_date' && value !== null) {
        const s = value.trim()
        if (s !== '' && /^-?\d*\.?\d*$/.test(s)) value = prev.submit_date ?? null
      }
      if (field === 'submit_date') next.submit_date = value
      else if (field === 'payment_date') next.payment_date = value
      else if (field === 'ar_date') next.ar_date = value
      continue
    }
    if (field === 'appointment_status') {
      if (raw === true || raw === false) continue
      const strVal = raw === '' || raw == null || raw === 'null' ? null : String(raw)
      next.appointment_status = strVal as SheetRow['appointment_status']
      continue
    }
    const str =
      raw === '' || raw == null || raw === 'null' || raw === undefined ? null : String(raw)
    ;(next as unknown as Record<string, string | null>)[field] = str
  }
  next.updated_at = new Date().toISOString()
  return next
}

function buildSheetRowWithPatientIdMerge(baseRow: SheetRow, patientId: string, db: Patient | null): SheetRow {
  const newId = baseRow.id.startsWith('empty-') ? `new-${Date.now()}-${Math.random()}` : baseRow.id
  const merged: SheetRow = {
    ...baseRow,
    id: newId,
    patient_id: patientId,
    updated_at: new Date().toISOString(),
  }
  if (db) {
    merged.patient_first_name = db.first_name || null
    merged.last_initial = db.last_name ? db.last_name.charAt(0) : null
    merged.patient_insurance = db.insurance || null
    merged.patient_copay = db.copay ?? null
    merged.patient_coinsurance = db.coinsurance ?? null
  }
  return merged
}

interface ProvidersTabProps {
  /** Required for loading/saving cell highlights and comments; from URL on provider side when they click a clinic */
  clinicId?: string
  /** 1 = default (12 month options); 2 = two pay periods per month (24 options: 1st/2nd January, ...) */
  clinicPayroll?: 1 | 2
  providers: Provider[]
  providerSheetRows: Record<string, SheetRow[]>
  /** Bumped by parent on row reorder so grid refreshes with new order */
  providerRowsVersion?: number
  billingCodes: BillingCode[]
  statusColors: StatusColor[]
  patients: Patient[]
  selectedMonth: Date
  /** When clinicPayroll=2, which half (1 or 2) is selected; used for label "January 1st Half". */
  selectedPayroll?: 1 | 2
  /** Same key parent uses for providerSheetRowsByMonth (e.g. "2025-3" or "2025-3-1"); used to backup pending rows on unload so refresh doesn't lose data. */
  selectedMonthKey?: string
  providerId?: string
  /** Current provider (for context); optional, passed by ClinicDetail and ProviderSheetPage */
  currentProvider?: Provider | null
  canEdit: boolean
  isInSplitScreen: boolean
  /** When true, show provider columns. providerLevel 1 = columns up to Appt/Note Status; providerLevel 2 = all columns. */
  isProviderView?: boolean
  /** Provider level (1 or 2). Level 1 (partial) sees columns up to Appt/Note Status; level 2 (full access) sees all columns. Providers can edit ID (patient_id), Date of Service, CPT Code, Appt/Note Status, and Visit Type when shown (subject to column locks). */
  providerLevel?: 1 | 2
  onUpdateProviderSheetRow: (providerId: string, rowId: string, field: string, value: any) => void
  /** Atomic row replacement path (preferred): avoids row-id race when empty- row becomes new- during multi-cell edit. */
  onReplaceProviderSheetRows?: (providerId: string, rows: SheetRow[]) => void
  onSaveProviderSheetRowsDirect: (providerId: string, rows: SheetRow[]) => Promise<void>
  /** Bulk-delete prop: one call removes N rows. The singular per-row delete pattern lost
   * knownDeletedIds on the save-serialization queue, so multi-row deletes left orphan rows that
   * resurrected on next load. Pass [rowId] for single-row deletes. */
  onDeleteRows?: (providerId: string, rowIds: string[]) => Promise<void> | void
  onAddRowBelow?: (providerId: string, afterRowId: string) => void
  onAddRowAbove?: (providerId: string, beforeRowId: string) => void
  onPreviousMonth?: () => void
  onNextMonth?: () => void
  /** When clinicPayroll=2, second arg shows "January 1st Half" / "January 2nd Half". */
  formatMonthYear?: (date: Date, payroll?: 1 | 2) => string
  /** Preferred month picker callback used by MonthYearTabs (year dropdown + month buttons). */
  onSelectMonth?: (date: Date, payroll: 1 | 2) => void
  filterRowsByMonth: (rows: SheetRow[]) => SheetRow[]
  isLockProviders?: IsLockProviders | null
  onLockProviderColumn?: (columnName: string) => void
  isProviderColumnLocked?: (columnName: keyof IsLockProviders) => boolean
  /** Called when rows are reordered by drag. Parent should update providerSheetRows for the given provider. */
  onReorderProviderRows?: (providerId: string, movedRows: number[], finalIndex: number) => void
  /** When true (e.g. official_staff), only columns ID through Date of Service are editable; rest read-only */
  restrictEditToSchedulingColumns?: boolean
  /** When true (office_staff), show only columns ID through Appt/Note Status and Collected from PT through PT Payment AR Ref Date; office staff can edit Patient ID, First Name, LI, Date of Service, and payment columns. */
  officeStaffView?: boolean
  /** When true (super_admin or office_staff), user can add/see/edit comments in the modal and "See comment" context menu is shown */
  canEditComment?: boolean
  /** Current user's highlight color (from User Management). Used to paint highlighted cells. Super admin uses #2d7e83; default yellow (#eab308). */
  userHighlightColor?: string | null
  /** When true, show an extra "Visit Type" column (In-person / Telehealth) after Appt/Note Status. Set per provider in User Management. */
  showVisitTypeColumn?: boolean
  /** When false, Co-pay (data index 4) and Co-Ins (data index 5) columns are hidden clinic-wide. Set per clinic in Clinic Management. Default true. */
  showCopayCoinsuranceColumns?: boolean
  /** When true, parent is showing backup override rows; always use props and do not prefer ref (so backup data displays after edits). */
  isViewingBackup?: boolean
  /** When viewing backup, a value that changes when the user selects a different version (e.g. version number), so the grid refreshes. */
  backupVersionKey?: number
  /** Bumped when patient table data changes; keeps Providers tab display in sync. */
  patientAssignmentRevision?: number
  /** Register a flush function to run before leaving Providers tab. */
  onRegisterFlushBeforeTabLeave?: (flush: () => Promise<void>) => void
  /** Current grid layout for CSV export (backup download matches visible columns / condensed mode). */
  onExportLayoutChange?: (layout: ProviderSheetUiExportLayout) => void
  /** Rendered inline with the colored "Billing sheet for ..." title pill (e.g. Select Version button). */
  labelRightSlot?: React.ReactNode
  /** Rendered as its own row below the colored title pill (above the months row). */
  belowTitleSlot?: React.ReactNode
}

export default function ProvidersTab({
  clinicId,
  clinicPayroll = 1,
  providers,
  providerSheetRows,
  providerRowsVersion,
  billingCodes,
  statusColors,
  patients,
  selectedMonth,
  selectedMonthKey,
  providerId,
  currentProvider: _currentProvider,
  canEdit,
  isInSplitScreen,
  isProviderView = false,
  providerLevel = 1,
  onUpdateProviderSheetRow,
  onReplaceProviderSheetRows,
  onSaveProviderSheetRowsDirect,
  onDeleteRows,
  onAddRowBelow,
  onAddRowAbove,
  onSelectMonth,
  selectedPayroll,
  filterRowsByMonth,
  isLockProviders,
  onLockProviderColumn,
  isProviderColumnLocked,
  onReorderProviderRows,
  restrictEditToSchedulingColumns = false,
  officeStaffView = false,
  canEditComment = false,
  userHighlightColor = '#eab308',
  showVisitTypeColumn = false,
  showCopayCoinsuranceColumns = true,
  isViewingBackup = false,
  backupVersionKey = 0,
  patientAssignmentRevision = 0,
  onRegisterFlushBeforeTabLeave,
  onExportLayoutChange,
  labelRightSlot,
  belowTitleSlot,
}: ProvidersTabProps) {
  
  const { userProfile } = useAuth()
  // Use isLockProviders from props directly - it will update when parent refreshes
  const lockData = isLockProviders || null
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set())
  /** Per-cell highlight color (of the user who highlighted that cell) */
  const [highlightColorByKey, setHighlightColorByKey] = useState<Map<string, string>>(new Map())
  const [commentsMap, setCommentsMap] = useState<Map<string, string>>(new Map())
  const [resolvedCells, setResolvedCells] = useState<Set<string>>(new Set())
  const [commentModal, setCommentModal] = useState<{ row: number; col: number; rowId: string; colKey: string } | null>(null)
  const [commentText, setCommentText] = useState('')
  const [commentModalLoading, setCommentModalLoading] = useState(false)
  /** Set while a delete batch is in flight so the table can show a "Deleting…" indicator. */
  const [isDeletingRows, setIsDeletingRows] = useState(false)
  /** Billing-sheet "Add 50 rows" button: bumps the pad-to target so the user can scroll into more
   * empty rows when 200 isn't enough. Persisted to localStorage per clinic so a refresh keeps the
   * grid at the size the user grew it to. */
  const BILLING_SHEET_BASE_ROWS = 200
  const BILLING_SHEET_ROWS_STEP = 50
  const extraEmptyRowsStorageKey = clinicId ? `providers-extra-rows-${clinicId}` : null
  const [extraEmptyRows, setExtraEmptyRows] = useState(() => {
    if (!clinicId) return 0
    try {
      const raw = localStorage.getItem(`providers-extra-rows-${clinicId}`)
      const n = raw == null ? 0 : parseInt(raw, 10)
      return Number.isFinite(n) && n >= 0 ? n : 0
    } catch {
      return 0
    }
  })
  useEffect(() => {
    if (!extraEmptyRowsStorageKey) return
    try {
      localStorage.setItem(extraEmptyRowsStorageKey, String(extraEmptyRows))
    } catch {
      // ignore: persistence is best-effort.
    }
  }, [extraEmptyRowsStorageKey, extraEmptyRows])
  const padTargetRows = BILLING_SHEET_BASE_ROWS + extraEmptyRows
  // Cached matrix in latestTableDataRef is built off the old (smaller) row count; invalidate when
  // the user grows the grid so getProviderRowsHandsontableData rebuilds with the padded row set.
  useEffect(() => {
    latestTableDataRef.current = null
    matrixSourceRevisionsRef.current = null
  }, [extraEmptyRows])

  const [isExportingCurrentSheet, setIsExportingCurrentSheet] = useState(false)
  /** Set while a paste / drag-fill batch is in flight so the table can show a "Saving…" indicator.
   * Paste and fill events go through the same 400ms debounced save as a single edit, but the payload
   * and downstream invoice recompute can take seconds — without a visible indicator the user has no
   * way to tell whether their paste actually landed. */
  const [isBulkSaving, setIsBulkSaving] = useState(false)
  /** Wall-clock at which the bulk toast was shown, so the debounced save can keep it on at least
   * BULK_SAVE_TOAST_MIN_MS even if the save itself returns faster than that. Null = no pending bulk. */
  const bulkSaveStartedAtRef = useRef<number | null>(null)
  /** Minimum visible duration (ms) for the deleting toast so it doesn't flash off on fast local saves. */
  const DELETE_TOAST_MIN_MS = 700
  const BULK_SAVE_TOAST_MIN_MS = 700
  const runWithDeleteToast = useCallback((promiseOrValue: Promise<unknown> | void) => {
    setIsDeletingRows(true)
    const startedAt = Date.now()
    const p = Promise.resolve(promiseOrValue)
    p.catch((err) => console.error('Bulk row delete failed:', err))
      .finally(() => {
        const elapsed = Date.now() - startedAt
        const remaining = Math.max(0, DELETE_TOAST_MIN_MS - elapsed)
        if (remaining === 0) {
          setIsDeletingRows(false)
        } else {
          setTimeout(() => setIsDeletingRows(false), remaining)
        }
      })
  }, [])
  /**
   * Tri-state condense:
   *  - 'full'      → all columns
   *  - 'condensed' → ID through Appt/Note Status (+ Visit Type when on)
   *  - 'minimal'   → First Name, LI, Date of Service, then Claim Status onward
   */
  type CondenseMode = 'full' | 'condensed' | 'minimal'
  const [condenseMode, setCondenseMode] = useState<CondenseMode>('full')
  const isCondensed = condenseMode === 'condensed'
  const isMinimal = condenseMode === 'minimal'
  const [arSumFromDb, setArSumFromDb] = useState<number | null>(null)
  /** Bumped to force Handsontable to resync from props. */
  const [structureVersion, setStructureVersion] = useState(0)
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null)
  const commentModalContainerRef = useRef<HTMLDivElement>(null)
  const hotInstanceRef = useRef<Handsontable | null>(null)

  const showCondenseButton = !officeStaffView && !isProviderView

  /** Drop visual positions 4 (Co-pay) and 5 (Co-Ins) from any visual-order array when the clinic flag is off.
   *  Source data positions are preserved (Handsontable still reads source col 4/5 via column `data` props for rows that
   *  still hold per-patient values) — only the rendered/visual layout drops them. */
  const dropCopayCoinsFromVisualArr = <T,>(arr: T[]): T[] =>
    showCopayCoinsuranceColumns ? arr : [...arr.slice(0, 4), ...arr.slice(6)]

  const providerSheetUiLayout = useMemo(
    (): ProviderSheetUiExportLayout => ({
      showVisitTypeColumn,
      showCopayCoinsuranceColumns,
      officeStaffView,
      isProviderView,
      providerLevel,
      isCondensed,
      isMinimal,
    }),
    [showVisitTypeColumn, showCopayCoinsuranceColumns, officeStaffView, isProviderView, providerLevel, isCondensed, isMinimal]
  )

  /** Indices kept (in the visual column order incl. Visit Type) for minimal-condense mode.
   *  Includes index 0 (ID / Patient ID) so the patient identifier is always visible — without it
   *  Jenali can't tell rows apart when she's only looking at First Name + dates + claim info. */
  const minimalVisualIndices = useMemo(() => {
    const vtShift = showVisitTypeColumn ? 1 : 0
    const indices: number[] = [0, 1, 2, 6]
    for (let i = 9 + vtShift; i <= 18 + vtShift; i++) indices.push(i)
    return indices
  }, [showVisitTypeColumn])

  useEffect(() => {
    onExportLayoutChange?.(providerSheetUiLayout)
  }, [providerSheetUiLayout, onExportLayoutChange])

  const providersToShow = providerId 
    ? providers.filter(p => p.id === providerId)
    : providers

  // Get rows for the first provider (or selected provider) to display in Handsontable
  const activeProvider = providersToShow.length > 0 ? providersToShow[0] : null
  const activeProviderRows = activeProvider ? filterRowsByMonth(providerSheetRows[activeProvider.id] || []) : []
  // Always-current mirror of activeProviderRows — updated every render so callbacks with stale closures
  // (e.g. HOT afterChange fired before React has updated the callback) still see the latest UUIDs.
  const activeProviderRowsRef = useRef<SheetRow[]>(activeProviderRows)
  activeProviderRowsRef.current = activeProviderRows

  /** Manual "Download CSV" of the CURRENT billing sheet (active provider × selected month × payroll).
   * Matches what's on screen exactly — same column order, same headers, same values — so the user
   * can copy any row out of the CSV and paste it straight back into the live grid. We use HOT's
   * own getData() because that's the source of truth for "what the user is looking at right now",
   * including their sort + condense + visit-type column choices, and any unsaved edits. */
  const exportCurrentSheetAsCsv = useCallback(async () => {
    if (!clinicId || !activeProvider) return
    if (isExportingCurrentSheet) return
    const month = selectedMonth.getMonth() + 1
    const year = selectedMonth.getFullYear()
    const payroll: 1 | 2 = clinicPayroll === 2 ? (selectedPayroll ?? 1) : 1
    setIsExportingCurrentSheet(true)
    try {
      const clinicRes = await apiClient
        .from('clinics')
        .select('name')
        .eq('id', clinicId)
        .maybeSingle()
      const clinicNameRaw = (clinicRes.data as { name?: string } | null)?.name ?? ''
      const safeClinicName = clinicNameRaw
        .replace(/\s+/g, ' ')
        .replace(/[^a-zA-Z0-9_\- ]/g, '')
        .trim() || clinicId

      const hot = hotInstanceRef.current
      if (!hot || (hot as { isDestroyed?: boolean }).isDestroyed) {
        alert('The table isn\'t ready yet — wait a second and try again.')
        return
      }
      const grid = hot.getData() as Array<Array<string | number | boolean | null | undefined>>
      /** Excel reads bare strings like "6-8" as "June 8" and silently mangles them. The standard
       *  workaround is to write `="6-8"` — Excel treats that as a formula whose value is the literal
       *  text "6-8" and skips its date-detection. Triggers:
       *   - digit[-/]digit anywhere (e.g. "6-8", "5/1", "11-23-11"): date-like
       *   - leading-zero number ("01234"): Excel strips the zero
       *   - very long pure-digit strings (≥12 chars): Excel renders as scientific notation
       *  Doesn't apply to boolean / empty / things that already have non-date punctuation. */
      const needsExcelTextGuard = (s: string): boolean => {
        if (s === '') return false
        if (/\d[-/]\d/.test(s)) return true
        if (/^0\d+$/.test(s)) return true
        if (/^\d{12,}$/.test(s)) return true
        return false
      }
      const escape = (val: unknown): string => {
        if (val == null || val === 'null') return ''
        if (typeof val === 'boolean') return val ? 'TRUE' : ''
        const s = String(val)
        if (needsExcelTextGuard(s)) {
          // Build `="...inner..."` with inner double-quotes escaped, then wrap the whole thing
          // in CSV double-quotes (and double-up any quotes for CSV escaping).
          const innerCsvSafe = s.replace(/"/g, '""')
          return `"=""${innerCsvSafe}"""`
        }
        if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
        return s
      }
      const isRowEmpty = (row: Array<string | number | boolean | null | undefined>): boolean =>
        row.every((c) => c == null || (typeof c === 'boolean' ? !c : String(c).trim() === ''))
      const body = grid
        .filter((row) => !isRowEmpty(row))
        .map((row) => row.map((c) => escape(c)).join(','))
      const header = columnTitles.map((t) => escape(t)).join(',')
      const csv = '﻿' + [header, ...body].join('\n')

      const safe = (s: string) =>
        s.replace(/\s+/g, ' ').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'Provider'
      const providerName = safe(
        `${(activeProvider.first_name ?? '').trim()} ${(activeProvider.last_name ?? '').trim()}`,
      )
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const today = new Date()
      const Y = today.getFullYear()
      const M = String(today.getMonth() + 1).padStart(2, '0')
      const D = String(today.getDate()).padStart(2, '0')
      const H = String(today.getHours()).padStart(2, '0')
      const Mi = String(today.getMinutes()).padStart(2, '0')
      const payrollLabel = clinicPayroll === 2 ? `-half${payroll}` : ''
      a.download = `BillingSheet_${safeClinicName}_${providerName}_${year}-${String(month).padStart(2, '0')}${payrollLabel}_savedAt-${Y}-${M}-${D}_${H}${Mi}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('[ProvidersTab export] failed:', e)
      const msg = e instanceof Error ? e.message : 'Failed to export billing sheet.'
      alert(`Export failed: ${msg}\n\nYour data hasn't been changed; nothing was written. Try again, and if it still fails contact your administrator.`)
    } finally {
      setIsExportingCurrentSheet(false)
    }
  }, [clinicId, activeProvider, selectedMonth, selectedPayroll, clinicPayroll, isExportingCurrentSheet])

  /** Bumps Handsontable dataVersion when Patient Info (or elsewhere) updates patients so rows with matching ID show filled fields — without auto-adding provider rows. */
  const patientsDisplayRevision = useMemo(() => {
    let h = patientAssignmentRevision * 1000003
    const s = patients
      .map((p) =>
        [
          p.patient_id ?? '',
          p.first_name ?? '',
          p.last_name ?? '',
          p.insurance ?? '',
          p.copay ?? '',
          p.coinsurance ?? '',
          p.updated_at ?? '',
        ].join('\t')
      )
      .join('\n')
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
    return h
  }, [patients, patientAssignmentRevision])

  /** Revisions captured when `latestTableDataRef` was built — if patients/rows changed externally, ignore stale matrix (fixes missing DOS / wrong patient cells after tab switch + fetchPatients). */
  const patientsDisplayRevisionForMatrixRef = useRef(patientsDisplayRevision)
  patientsDisplayRevisionForMatrixRef.current = patientsDisplayRevision
  const providerRowsVersionForMatrixRef = useRef(providerRowsVersion ?? 0)
  providerRowsVersionForMatrixRef.current = providerRowsVersion ?? 0

  const handleProviderRowMove = useCallback((movedRows: number[], finalIndex: number) => {
    if (!activeProvider || !onReorderProviderRows) return
    onReorderProviderRows(activeProvider.id, movedRows, finalIndex)
  }, [activeProvider, onReorderProviderRows])

  // Ref for latest table data from change handler so we don't pass stale data when parent re-renders before state updates
  const latestTableDataRef = useRef<any[][] | null>(null)
  /** Revisions under which `latestTableDataRef` was materialized; must match current revisions or matrix is stale. */
  const matrixSourceRevisionsRef = useRef<{ patientsRev: number; rowsVer: number } | null>(null)
  /** Latest rows from change handler so rapid edits accumulate and flush-on-unmount has current data (like PatientsTab patientsRef). */
  const latestProviderRowsRef = useRef<{ providerId: string; rows: SheetRow[] } | null>(null)
  const saveProviderSheetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingProviderSheetSaveRef = useRef<{ providerId: string; rows: SheetRow[] } | null>(null)
  /** Local co-patient draft values while typing; prevents stale patients-table values from overriding in-flight edits. */
  const coPatientDraftByIdKeyRef = useRef<
    Map<
      string,
      {
        patient_first_name: string | null
        patient_insurance: string | null
        patient_copay: string | number | null
        patient_coinsurance: string | number | null
      }
    >
  >(new Map())
  /** Always latest — flush-on-unmount must not depend on callback identity (parent save fn changes when providerSheets updates). */
  const onSaveProviderSheetRowsDirectRef = useRef(onSaveProviderSheetRowsDirect)
  onSaveProviderSheetRowsDirectRef.current = onSaveProviderSheetRowsDirect
  const clinicIdForPendingRef = useRef(clinicId)
  clinicIdForPendingRef.current = clinicId
  const selectedMonthKeyForPendingRef = useRef(selectedMonthKey)
  selectedMonthKeyForPendingRef.current = selectedMonthKey

  /** Patient rows to merge after `patientIdDbValidated` setDataAtCell (from DB lookup). */
  const pendingPatientMergeByRowRef = useRef<Map<number, Patient | null>>(new Map())
  /** Latest non-empty patient_id per row while typing (debounced validation). */
  const patientIdEditLatestPidRef = useRef<Map<number, string>>(new Map())
  const patientIdEditDebounceRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const patientIdDeferredQueueRef = useRef<Array<{ row: number; col: number | string; newVal: string }>>([])
  const patientIdFlushScheduledRef = useRef(false)
  /** Serialized tail so tab-leave flush can await paste/typed patient_id DB validation + merge. */
  const patientIdAsyncTailRef = useRef<Promise<void>>(Promise.resolve())
  const activeProviderRef = useRef(activeProvider)
  const clinicIdForValidationRef = useRef(clinicId)
  const isViewingBackupRef = useRef(isViewingBackup)
  activeProviderRef.current = activeProvider
  clinicIdForValidationRef.current = clinicId
  isViewingBackupRef.current = isViewingBackup
  /**
   * Tab-leave flush awaits save before parent switches tabs; ProvidersTab then unmounts and its cleanup
   * used to save again with the same temp row ids — second INSERT duplicates in DB. Skip unmount save when flush already persisted.
   */
  const tabLeaveFlushPersistedRef = useRef(false)

  /** Prefer parent-loaded patients; avoids a full-clinic `patients` query on every patient_id edit/batch. */
  const patientsForLookupRef = useRef(patients)
  patientsForLookupRef.current = patients

  const resolvePatientsListForValidation = useCallback(async (): Promise<Patient[]> => {
    const local = patientsForLookupRef.current
    if (local.length > 0) return local
    const cid = clinicIdForValidationRef.current
    if (!cid) return []
    providersDebugTab('resolvePatientsListForValidation → patients select (props list was empty)', {
      clinicId: cid,
    })
    const { data, error } = await apiClient.from('patients').select('*').eq('clinic_id', cid)
    if (error) {
      console.error('[ProvidersTab] patient list for validation failed', error)
      return []
    }
    return (data || []) as Patient[]
  }, [])

  /** Commit open HOT editor into React state (afterChange) before persisting — same idea as AccountsReceivableTab.flushARSave. */
  const commitProviderHandsontableBeforePersist = useCallback(async () => {
    const hot = hotInstanceRef.current as
      | (Handsontable & { isDestroyed?: boolean; deselectCell?: () => void })
      | null
    if (!hot || hot.isDestroyed) {
      await new Promise<void>((r) => queueMicrotask(r))
      return
    }
    try {
      hot.getActiveEditor?.()?.finishEditing?.(false)
    } catch {
      /* ignore */
    }
    try {
      hot.deselectCell?.()
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await new Promise<void>((r) => queueMicrotask(r))
  }, [])

  const localRowsProviderKeyRef = useRef<string | null>(null)

  /** Column `data` for Patient ID is always 0 in this grid. */
  const isPatientIdSheetColumnProp = (prop: string | number): boolean =>
    prop === 0 || prop === '0' || Number(prop) === 0

  // Clear refs when provider/month changes or when viewing backup (so backup rows from props are used).
  // Do NOT clear on providerRowsVersion — parent bumps that after each save merge; clearing wiped latestProviderRowsRef
  // before tab-leave flush could read it (empty flush → duplicate rows / lost DOS). Stale matrix is handled by getProviderRowsHandsontableData revision checks.
  useEffect(() => {
    latestTableDataRef.current = null
    matrixSourceRevisionsRef.current = null
    latestProviderRowsRef.current = null
    localRowsProviderKeyRef.current = null
    coPatientDraftByIdKeyRef.current.clear()
    patientIdDeferredQueueRef.current = []
    patientIdFlushScheduledRef.current = false
    pendingPatientMergeByRowRef.current.clear()
    patientIdEditLatestPidRef.current.clear()
    for (const t of patientIdEditDebounceRef.current.values()) clearTimeout(t)
    patientIdEditDebounceRef.current.clear()
    patientIdAsyncTailRef.current = Promise.resolve()
  }, [activeProvider?.id, selectedMonth.getTime(), isViewingBackup])

  useEffect(() => {
    tabLeaveFlushPersistedRef.current = false
  }, [activeProvider?.id])

  // Keep ref in sync for provider/month/backup so change handler and flush-on-unmount have correct key
  useEffect(() => {
    if (!activeProvider) return
    localRowsProviderKeyRef.current = `${activeProvider.id}-${selectedMonth.getTime()}`
  }, [activeProvider?.id, selectedMonth.getTime(), isViewingBackup])

  // Load persisted highlights and comments for this clinic (so they survive reload and show for providers)
  useEffect(() => {
    if (!clinicId) return
    providersDebugTab('useEffect[clinicId] → load cell_highlights + cell_comments (parallel)', { clinicId })
    const loadHighlights = async () => {
      const { data } = await apiClient
        .from('cell_highlights')
        .select('row_id, column_key, highlight_color')
        .eq('clinic_id', clinicId)
        .eq('sheet_type', 'providers')
      if (data) {
        const keys = data.map((r: { row_id: string; column_key: string }) => `${r.row_id}:${r.column_key}`)
        setHighlightedCells(new Set(keys))
        const colorMap = new Map<string, string>()
        data.forEach((r: { row_id: string; column_key: string; highlight_color?: string | null }) => {
          const key = `${r.row_id}:${r.column_key}`
          colorMap.set(key, (r.highlight_color && r.highlight_color.trim()) ? r.highlight_color.trim() : '#eab308')
        })
        setHighlightColorByKey(colorMap)
      }
    }
    const loadComments = async () => {
      const { data } = await apiClient
        .from('cell_comments')
        .select('row_id, column_key, comment, resolved')
        .eq('clinic_id', clinicId)
        .eq('sheet_type', 'providers')
      if (data) {
        setCommentsMap(new Map(data.map((r: { row_id: string; column_key: string; comment: string }) => [`${r.row_id}:${r.column_key}`, r.comment ?? ''])))
        setResolvedCells(new Set((data as { row_id: string; column_key: string; resolved?: boolean }[]).filter(r => r.resolved === true).map(r => `${r.row_id}:${r.column_key}`)))
      }
    }
    loadHighlights()
    loadComments()
  }, [clinicId])

  // Color mapping functions
  const getCPTColor = useCallback((code: string): { color: string; textColor: string } | null => {
    if (!code) return null
    const primaryCode = code.split(',')[0].trim()
    const billingCode = billingCodes.find(c => c.code === primaryCode)
    if (billingCode) {
      return { color: billingCode.color, textColor: billingCode.text_color ?? '#000000' }
    }
    return null
  }, [billingCodes])

  const getStatusColor = useCallback((status: string, type: 'appointment' | 'claim' | 'patient_pay' | 'month' | 'cpt_code'): { color: string; textColor: string } | null => {
    if (!status) return null
    const statusColor = statusColors.find(s => s.status === status && s.type === type)
    if (statusColor) {
      return { color: statusColor.color, textColor: statusColor.text_color || '#000000' }
    }
    return null
  }, [statusColors])

  const getMonthColor = useCallback((month: string): { color: string; textColor: string } | null => {
    if (!month) return null
    // Support "1st January" / "2nd January" (payroll 2) by normalizing to month name for status_colors lookup
    const monthName = month.replace(/^(1st|2nd)\s+/i, '').trim()
    const monthColor = statusColors.find(s => s.status === monthName && s.type === 'month')
    if (monthColor) {
      return { color: monthColor.color, textColor: monthColor.text_color || '#000000' }
    }
    return null
  }, [statusColors])

  useEffect(() => {
    // Clear drafts once DB catches up (or patient no longer exists), so source-of-truth returns to patients table.
    const drafts = coPatientDraftByIdKeyRef.current
    if (drafts.size === 0) return
    const byKey = new Map<string, Patient>()
    for (const p of patients) {
      const k = String(p.patient_id ?? '').trim().toLowerCase()
      if (k) byKey.set(k, p)
    }
    const norm = (v: unknown): string => (v == null ? '' : String(v).trim())
    const keysToDelete: string[] = []
    for (const [k, d] of drafts.entries()) {
      const p = byKey.get(k)
      if (!p) {
        keysToDelete.push(k)
        continue
      }
      if (
        norm(d.patient_first_name) === norm(p.first_name) &&
        norm(d.patient_insurance) === norm(p.insurance) &&
        norm(d.patient_copay) === norm(p.copay) &&
        norm(d.patient_coinsurance) === norm(p.coinsurance)
      ) {
        keysToDelete.push(k)
      }
    }
    if (keysToDelete.length > 0) {
      for (const k of keysToDelete) drafts.delete(k)
    }
  }, [patients])

  // Build the patient_id → Patient lookup once per `patients` reference so sheetRowsToUiMatrix
  // (called per matrix rebuild, which previously fired O(rows) work per cached miss) doesn't
  // re-iterate the full patient list every call.
  const patientsLookup = useMemo(() => coPatientByIdKey(patients), [patients])

  // Map rows to Handsontable 2D array format (shared with provider backup CSV export in `providerSheetBackupUiExport`).
  // Override the condense flags so the matrix is always built at full width — the column.data props
  // in providerColumnsWithLocks reference ORIGINAL row positions (e.g. data:11 for Ins Pay, data:6 for
  // DOS), so a compacted matrix would index those props into the wrong slots. The visual hiding of
  // unwanted columns happens via the columns filter, not by shortening the matrix. CSV export is
  // unaffected — it still calls sheetRowsToUiMatrix with the real (compacted) layout.
  const fullGridLayout = useMemo(
    (): ProviderSheetUiExportLayout => ({ ...providerSheetUiLayout, isCondensed: false, isMinimal: false }),
    [providerSheetUiLayout],
  )
  const getTableDataFromRows = useCallback(
    (rows: SheetRow[]) =>
      sheetRowsToUiMatrix(rows, patients, fullGridLayout, patientsLookup) as (string | number | boolean)[][],
    [patients, fullGridLayout, patientsLookup]
  )

  // Convert rows to Handsontable data format; prefer latest from change handler, then props, to avoid losing typed data when parent re-renders after load (like PatientsTab).
  // When viewing backup, always use backup rows from props. When not viewing backup and ref is null, use props (activeProviderRows) so "Back to current" shows current data immediately instead of stale local state.
  /** Display rows = activeProviderRows padded up to padTargetRows so the "Add 50 rows" button
   *  actually grows the grid even before the user types (the inline pad logic in afterChange only
   *  runs on edit, so it can't grow the grid by itself). */
  const displayActiveProviderRows = useMemo(() => {
    if (!activeProvider) return activeProviderRows
    if (activeProviderRows.length >= padTargetRows) return activeProviderRows
    const needed = padTargetRows - activeProviderRows.length
    const existingEmpty = activeProviderRows.filter((r) => r.id.startsWith('empty-')).length
    const iso = new Date().toISOString()
    const extras: SheetRow[] = Array.from({ length: needed }, (_, i) => ({
      id: `empty-${activeProvider.id}-${existingEmpty + i}`,
      patient_id: null, patient_first_name: null, patient_last_name: null, last_initial: null,
      patient_insurance: null, patient_copay: null, patient_coinsurance: null,
      appointment_date: null, appointment_time: null, visit_type: null, notes: null,
      billing_code: null, billing_code_color: null, cpt_code: null, cpt_code_color: null,
      appointment_status: null, appointment_status_color: null,
      claim_status: null, claim_status_color: null,
      submit_date: null, insurance_payment: null, insurance_adjustment: null, invoice_amount: null,
      collected_from_patient: null, patient_pay_status: null, patient_pay_status_color: null,
      payment_date: null, payment_date_color: null,
      ar_type: null, ar_amount: null, ar_date: null, ar_date_color: null, ar_notes: null,
      provider_payment_amount: null, provider_payment_date: null, provider_payment_notes: null,
      highlight_color: null, total: null,
      created_at: iso, updated_at: iso,
    }))
    return [...activeProviderRows, ...extras]
  }, [activeProvider, activeProviderRows, padTargetRows])

  const getProviderRowsHandsontableData = useCallback(() => {
    if (!activeProvider) return []
    if (isViewingBackup) {
      return getTableDataFromRows(displayActiveProviderRows)
    }
    const obs = matrixSourceRevisionsRef.current
    const rowsVer = providerRowsVersion ?? 0
    const useCachedMatrix =
      latestTableDataRef.current != null &&
      obs != null &&
      obs.patientsRev === patientsDisplayRevision &&
      obs.rowsVer === rowsVer
    if (useCachedMatrix) {
      return latestTableDataRef.current as (string | number | boolean)[][]
    }
    return getTableDataFromRows(displayActiveProviderRows)
  }, [activeProvider, displayActiveProviderRows, getTableDataFromRows, isViewingBackup, patientsDisplayRevision, providerRowsVersion])

  /** Column → SheetRow field mapping for current grid layout (must match handleProviderRowsHandsontableChange). */
  const providerSheetColumnFieldsForSync = useMemo((): Array<keyof SheetRow> => {
    const fieldsFullBase: Array<keyof SheetRow> = [
      'patient_id',
      'patient_first_name',
      'last_initial',
      'patient_insurance',
      'patient_copay',
      'patient_coinsurance',
      'appointment_date',
      'cpt_code',
      'appointment_status',
      'claim_status',
      'submit_date',
      'insurance_payment',
      'payment_date',
      'insurance_adjustment',
      'collected_from_patient',
      'patient_pay_status',
      'ar_date',
      'total',
      'notes',
    ]
    const fieldsFull = showVisitTypeColumn
      ? ([...fieldsFullBase.slice(0, 9), 'visit_type', ...fieldsFullBase.slice(9)] as Array<keyof SheetRow>)
      : fieldsFullBase
    const fieldsProviderViewBase: Array<keyof SheetRow> = [
      'patient_id',
      'patient_first_name',
      'last_initial',
      'patient_insurance',
      'patient_copay',
      'patient_coinsurance',
      'appointment_date',
      'cpt_code',
      'appointment_status',
    ]
    const fieldsProviderView = showVisitTypeColumn
      ? ([...fieldsProviderViewBase, 'visit_type'] as Array<keyof SheetRow>)
      : fieldsProviderViewBase
    const fieldsOfficeStaffBase: Array<keyof SheetRow> = [
      'patient_id',
      'patient_first_name',
      'last_initial',
      'patient_insurance',
      'patient_copay',
      'patient_coinsurance',
      'appointment_date',
      'cpt_code',
      'appointment_status',
      'collected_from_patient',
      'patient_pay_status',
      'ar_date',
    ]
    const fieldsOfficeStaff = showVisitTypeColumn
      ? ([...fieldsOfficeStaffBase.slice(0, 9), 'visit_type', ...fieldsOfficeStaffBase.slice(9)] as Array<keyof SheetRow>)
      : fieldsOfficeStaffBase
    if (officeStaffView) return fieldsOfficeStaff
    if (isProviderView) return providerLevel === 2 ? fieldsFull : fieldsProviderView
    // Minimal & condensed return fieldsFull: hot.getData() returns the underlying matrix at full
    // width (because getTableDataFromRows now forces isMinimal/isCondensed false on the layout), so
    // sync must iterate the full row positions.
    return fieldsFull
  }, [officeStaffView, isProviderView, providerLevel, showVisitTypeColumn])

  // Sum of Ins Pay, Collected from PT, AR, Total (computed from current rows; not stored in DB)
  // For provider level 2 (full) we show full tally; for admin/billing we show insPay, collectedFromPt, total; AR only for provider level 2
  const providerSums = useMemo(() => {
    const parse = (v: unknown): number => {
      if (v == null || v === '' || v === 'null') return 0
      const n = typeof v === 'number' ? v : parseFloat(String(v))
      return Number.isNaN(n) ? 0 : n
    }
    let insPay = 0
    let collectedFromPt = 0
    let arTotal = 0
    let total = 0
    activeProviderRows.forEach((row) => {
      insPay += parse(row.insurance_payment)
      collectedFromPt += parse(row.collected_from_patient)
      arTotal += parse(row.ar_amount)
      total += parse(row.total)
    })
    return { insPay, collectedFromPt, arTotal, total }
  }, [activeProviderRows])

  // AR total: same rows/amounts as Accounts Receivable tab (month + payroll), not date_recorded-only range query.
  //
  // Provider scope must match the AR tab (see AccountsReceivableTab.buildDisplayedFromList): when the
  // Billing sheet is scoped to a single provider, the AR total in this bottom bar should show only
  // that provider's ARs. Previously the query filtered by clinic + payroll only, so the summary showed
  // the whole clinic's AR total against a single-provider Billing sheet (e.g. $17,728.55 clinic-wide
  // vs $1,356.16 for the provider actually being viewed). Now we pull provider_id and apply the same
  // client-side filter the AR tab uses — including intentionally excluding legacy NULL-provider rows
  // when scoped, per the comment there.
  useEffect(() => {
    if (!clinicId) {
      setArSumFromDb(null)
      return
    }
    const payrollFilter = clinicPayroll === 2 ? (selectedPayroll ?? 1) : 1
    let cancelled = false
    setArSumFromDb(null)
    providersDebugTab('useEffect[clinicId, selectedMonth, payroll, providerId] → accounts_receivables sum (A-R tab rules)', {
      clinicId,
      payrollFilter,
      providerId,
      month: selectedMonth.toISOString(),
    })
    apiClient
      .from('accounts_receivables')
      .select('id, amount, ar_year, ar_month, payroll, provider_id, created_at, date_of_service, date_recorded')
      .eq('clinic_id', clinicId)
      .eq('payroll', payrollFilter)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled || error) {
          if (!cancelled && error) console.error('Fetch accounts_receivables sum:', error)
          return
        }
        const rows = (data || []) as AccountsReceivable[]
        const inMonth = rows.filter((row) => isAccountsReceivableRowInMonth(row, selectedMonth))
        const scoped = providerId
          ? inMonth.filter((row) => {
              const owner = (row as { provider_id?: string | null }).provider_id ?? null
              return owner === providerId
            })
          : inMonth
        const sum = scoped.reduce((acc, row) => {
          const raw = row.amount
          if (raw == null || (raw as unknown) === 'null') return acc
          const n = typeof raw === 'number' ? raw : parseFloat(String(raw))
          return acc + (Number.isFinite(n) ? n : 0)
        }, 0)
        if (!cancelled) setArSumFromDb(sum)
      })
    return () => {
      cancelled = true
    }
  }, [clinicId, selectedMonth, clinicPayroll, selectedPayroll, providerId])

  // Billing metrics (visits, no shows, paid claims, etc.) for the selected month – admin/billing only
  const billingMetrics = useMemo(() => {
    if (isProviderView) return null
    return computeBillingMetrics(activeProviderRows)
  }, [activeProviderRows, isProviderView])

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  // Column field names mapping to is_lock_providers table columns (visit_type is optional, not in IsLockProviders).
  // These arrays are in VISUAL column order and must stay in lockstep with `columnTitles` (used by the
  // right-click-to-lock handler that maps header text → columnIndex → columnFields[idx]).
  const columnFieldsFullBase: Array<keyof IsLockProviders> = [
    'patient_id', 'first_name', 'last_initial', 'insurance', 'copay', 'coinsurance',
    'date_of_service', 'cpt_code', 'appointment_note_status', 'claim_status',
    'most_recent_submit_date', 'ins_pay', 'ins_pay_date', 'pt_res', 'collected_from_pt',
    'pt_pay_status', 'pt_payment_ar_ref_date', 'total', 'notes'
  ]
  const columnFieldsFullWithVisitType: string[] = showVisitTypeColumn
    ? [...columnFieldsFullBase.slice(0, 9), 'visit_type', ...columnFieldsFullBase.slice(9)]
    : columnFieldsFullBase
  const columnFieldsFull = dropCopayCoinsFromVisualArr(columnFieldsFullWithVisitType)
  // Kept in lockstep with `columnTitlesProviderView` in `providerSheetUiExportHeaders`. The partial view itself
  // never renders Insurance / Co-pay / Co-Ins headers, but the titles array still includes them so right-click
  // lock attachment via `columnTitles.findIndex` aligns with the existing field order. When the clinic flag is
  // off, both arrays drop Co-pay and Co-Ins together.
  const columnFieldsProviderViewWithVisitType: string[] = showVisitTypeColumn
    ? ['patient_id', 'first_name', 'last_initial', 'insurance', 'copay', 'coinsurance', 'date_of_service', 'cpt_code', 'appointment_note_status', 'visit_type']
    : ['patient_id', 'first_name', 'last_initial', 'insurance', 'copay', 'coinsurance', 'date_of_service', 'cpt_code', 'appointment_note_status']
  const columnFieldsProviderView = dropCopayCoinsFromVisualArr(columnFieldsProviderViewWithVisitType)
  const columnFieldsOfficeStaffBase: Array<keyof IsLockProviders> = [
    'patient_id', 'first_name', 'last_initial', 'insurance', 'copay', 'coinsurance',
    'date_of_service', 'cpt_code', 'appointment_note_status',
    'collected_from_pt', 'pt_pay_status', 'pt_payment_ar_ref_date'
  ]
  const columnFieldsOfficeStaffWithVisitType: string[] = showVisitTypeColumn
    ? [...columnFieldsOfficeStaffBase.slice(0, 9), 'visit_type', ...columnFieldsOfficeStaffBase.slice(9)]
    : columnFieldsOfficeStaffBase
  const columnFieldsOfficeStaff = dropCopayCoinsFromVisualArr(columnFieldsOfficeStaffWithVisitType)
  // columnFieldsFull is post-copayCoins-filter; positions 4 (Co-pay) and 5 (Co-Ins) are gone when the flag is off,
  // so the original visual indices ≥ 6 shift down by 2. Indices < 4 stay the same.
  const shiftForCopayCoins = (i: number) => (showCopayCoinsuranceColumns ? i : i >= 6 ? i - 2 : i)
  const columnFields = officeStaffView
    ? columnFieldsOfficeStaff
    : isProviderView
      ? (providerLevel === 2 ? columnFieldsFull : columnFieldsProviderView)
      : (showCondenseButton && isMinimal
          ? minimalVisualIndices.map(shiftForCopayCoins).map((i) => columnFieldsFull[i])
          : showCondenseButton && isCondensed
            ? columnFieldsFull.slice(0, showCopayCoinsuranceColumns ? 9 : 7)
            : columnFieldsFull)
  const columnTitles = useMemo(
    () => providerSheetUiExportHeaders(providerSheetUiLayout),
    [providerSheetUiLayout]
  )

  /**
   * Visual column -> persisted providers column key mapping for highlights/comments.
   * Must match `providerColumnsWithLocks` visual order exactly (including hidden data indexes and Visit Type placement).
   */
  const visualColumnKeys = useMemo((): Array<keyof IsLockProviders | null> => {
    const full: Array<keyof IsLockProviders | null> = [
      'patient_id',
      'first_name',
      'last_initial',
      'insurance',
      'copay',
      'coinsurance',
      'date_of_service',
      'cpt_code',
      'appointment_note_status',
      'claim_status',
      'most_recent_submit_date',
      'ins_pay',
      'ins_pay_date',
      'pt_res',
      'collected_from_pt',
      'pt_pay_status',
      'pt_payment_ar_ref_date',
      'total',
      'notes',
    ]
    // dropCopayCoinsFromVisualArr is closed over `showCopayCoinsuranceColumns`; safe inside this memo because
    // the useMemo deps below include the flag.
    if (officeStaffView) {
      const office: Array<keyof IsLockProviders | null> = [
        'patient_id',
        'first_name',
        'last_initial',
        'insurance',
        'copay',
        'coinsurance',
        'date_of_service',
        'cpt_code',
      ]
      if (showVisitTypeColumn) office.push(null)
      office.push('appointment_note_status', 'collected_from_pt', 'pt_pay_status', 'pt_payment_ar_ref_date')
      return dropCopayCoinsFromVisualArr(office)
    }
    if (isProviderView && providerLevel !== 2) {
      const partial: Array<keyof IsLockProviders | null> = [
        'patient_id',
        'first_name',
        'last_initial',
        'date_of_service',
        'cpt_code',
      ]
      if (showVisitTypeColumn) partial.push(null)
      partial.push('appointment_note_status')
      return partial
    }
    const fullVisible: Array<keyof IsLockProviders | null> = [...full.slice(0, 8)]
    if (showVisitTypeColumn) fullVisible.push(null)
    fullVisible.push(...full.slice(8))
    const fullVisibleFiltered = dropCopayCoinsFromVisualArr(fullVisible)
    if (!isProviderView && showCondenseButton && isMinimal) {
      // After dropCopayCoins, original indices ≥ 6 shift down by 2 when copayCoins is off (indices 4 and 5 are gone).
      return minimalVisualIndices
        .map((i) => (showCopayCoinsuranceColumns ? i : i >= 6 ? i - 2 : i))
        .map((i) => fullVisibleFiltered[i] ?? null)
    }
    if (!isProviderView && showCondenseButton && isCondensed) {
      // Condense keeps the first 9 (or 10 with visit type) visible columns of the full layout. When co-pay/co-ins
      // are off, the same "through Appt/Note Status (+ Visit Type)" slice ends 2 columns earlier.
      const condensedCount = (showVisitTypeColumn ? 10 : 9) - (showCopayCoinsuranceColumns ? 0 : 2)
      return fullVisibleFiltered.slice(0, condensedCount)
    }
    return fullVisibleFiltered
  }, [officeStaffView, isProviderView, providerLevel, showVisitTypeColumn, showCopayCoinsuranceColumns, showCondenseButton, isCondensed, isMinimal, minimalVisualIndices])

  /** Bumps when lock flags change so Handsontable re-renders headers (see `afterGetColHeader` + `colHeaderRefreshKey`). */
  const providerLocksKey = useMemo(() => {
    if (!lockData) return 'none'
    return columnFields
      .map((f) => {
        if (!f || f === 'visit_type') return '-'
        return lockData[f as keyof IsLockProviders] ? '1' : '0'
      })
      .join('')
  }, [lockData, columnFields])

  const lockIconSrc = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}lock_icon.png`

  /** In provider view (full and partial), providers can edit ID (0), Date of Service (6), CPT Code (7), Appt/Note Status (8), and when enabled Visit Type (9) */
  const isProviderEditableColumn = (dataIndex: number) =>
    dataIndex === 0 || dataIndex === 6 || dataIndex === 7 || dataIndex === 8 || (showVisitTypeColumn && dataIndex === 9)
  const getReadOnlyProviderView = (dataIndex: number) =>
    !canEdit || !isProviderEditableColumn(dataIndex)

  const getReadOnly = (columnName: keyof IsLockProviders): boolean => {
    if (!canEdit) return true
    if (!lockData) return false
    return Boolean(lockData[columnName])
  }

  const visitTypeColOffset = showVisitTypeColumn ? 1 : 0
  /** For official_staff: columns 0-6 (ID through Date of Service) and Most Recent are editable. For office_staff: columns 0,1,2,6 and Collected/PT Pay/AR Ref Date are editable. */
  const isSchedulingColumn = (dataIndex: number) => dataIndex <= 6
  const isMostRecentColumn = (dataIndex: number) => dataIndex === 10 + visitTypeColOffset
  const isOfficeStaffEditableColumn = (dataIndex: number) =>
    dataIndex === 0 || dataIndex === 1 || dataIndex === 2 || dataIndex === 6 || dataIndex === 9 + visitTypeColOffset || dataIndex === 10 + visitTypeColOffset || dataIndex === 11 + visitTypeColOffset
  const getReadOnlyForColumn = (dataIndex: number, baseReadOnly: boolean) => {
    if (officeStaffView) return baseReadOnly || !isOfficeStaffEditableColumn(dataIndex)
    return baseReadOnly || (restrictEditToSchedulingColumns && !isSchedulingColumn(dataIndex) && !isMostRecentColumn(dataIndex))
  }

  // Right-click on column headers to lock/unlock; locked columns show public/lock_icon.png via afterGetColHeader
  useEffect(() => {
    if (isProviderView || !canEdit || !onLockProviderColumn || !isProviderColumnLocked) return

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let menuEl: HTMLElement | null = null
    let closeListener: ((e: Event) => void) | null = null
    let openedAt = 0

    const hideMenu = () => {
      if (menuEl?.parentNode) menuEl.parentNode.removeChild(menuEl)
      menuEl = null
      if (closeListener) {
        document.removeEventListener('pointerdown', closeListener, true)
        document.removeEventListener('contextmenu', closeListener, true)
        closeListener = null
      }
    }

    const showHeaderContextMenu = (e: MouseEvent, columnName: string) => {
      e.preventDefault()
      e.stopPropagation()
      hideMenu()
      const isLocked = isProviderColumnLocked ? isProviderColumnLocked(columnName as keyof IsLockProviders) : false
      const menu = document.createElement('div')
      menu.className = 'provider-col-header-context-menu'
      menu.style.cssText = 'position:fixed;z-index:9999;background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.4);padding:4px 0;min-width:140px;'
      const item = document.createElement('div')
      item.style.cssText = 'padding:6px 12px;cursor:pointer;white-space:nowrap;font-size:13px;'
      item.textContent = isLocked ? 'Unlock column' : 'Lock column'
      item.onclick = () => {
        onLockProviderColumn(columnName)
        hideMenu()
      }
      menu.appendChild(item)
      document.body.appendChild(menu)
      menuEl = menu
      openedAt = Date.now()
      const x = Math.min(e.clientX, window.innerWidth - 150)
      const y = Math.min(e.clientY, window.innerHeight - 40)
      menu.style.left = `${x}px`
      menu.style.top = `${y}px`
      closeListener = (evt: Event) => {
        // Ignore immediate follow-up events emitted by Handsontable after opening.
        if (Date.now() - openedAt < 120) return
        const target = evt.target as Node | null
        if (menuEl && target && menuEl.contains(target)) return
        hideMenu()
      }
      setTimeout(() => {
        document.addEventListener('pointerdown', closeListener!, true)
        document.addEventListener('contextmenu', closeListener!, true)
      }, 0)
    }

    const attachContextMenuToHeader = (headerRow: Element | null) => {
      if (!headerRow) return
      const headerCells = Array.from(headerRow.querySelectorAll('th'))
      headerCells.forEach((th) => {
        let cellText = th.textContent?.trim() || th.innerText?.trim() || ''
        const existingWrapper = th.querySelector('div')
        if (existingWrapper) {
          const titleSpan = existingWrapper.querySelector('span')
          if (titleSpan) cellText = titleSpan.textContent?.trim() || cellText
        }
        cellText = cellText.replace(/🔒|🔓/g, '').trim()
        const columnIndex = columnTitles.findIndex(title => {
          const a = title.toLowerCase().trim()
          const b = cellText.toLowerCase().trim()
          return a === b || b.includes(a) || a.includes(b)
        })
        if (columnIndex === -1 || columnIndex >= columnFields.length) return
        const columnName = columnFields[columnIndex]
        if (columnName === 'visit_type') return
        const el = th as HTMLElement
        const prev = (el as any)._providerHeaderContext
        if (prev) {
          el.removeEventListener('contextmenu', prev)
        }
        const handler = (e: MouseEvent) => showHeaderContextMenu(e, columnName as string)
        ;(el as any)._providerHeaderContext = handler
        el.addEventListener('contextmenu', handler)
      })
    }

    const attachAll = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      const table = document.querySelector('.providers-handsontable table.htCore')
      if (table) attachContextMenuToHeader(table.querySelector('thead tr'))
      const cloneTop = document.querySelector('.providers-handsontable .ht_clone_top table.htCore')
      if (cloneTop) attachContextMenuToHeader(cloneTop.querySelector('thead tr'))
    }

    const debouncedAttach = () => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(attachAll, 200)
    }

    timeoutId = setTimeout(attachAll, 300)
    const observer = new MutationObserver(() => debouncedAttach())
    const tableContainer = document.querySelector('.providers-handsontable')
    if (tableContainer) observer.observe(tableContainer, { childList: true, subtree: true })

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      observer.disconnect()
      hideMenu()
      document.querySelectorAll('.providers-handsontable th').forEach((th) => {
        const h = (th as any)._providerHeaderContext
        if (h) th.removeEventListener('contextmenu', h)
      })
    }
  }, [isProviderView, canEdit, onLockProviderColumn, isProviderColumnLocked, columnFields, columnTitles, isLockProviders])

  const providerCellsCallback = useCallback(
    (row: number, col: number) => {
      const sheetRow = activeProviderRows[row]
      const colKey = visualColumnKeys[col]
      if (!colKey) return {}
      const key = `${sheetRow?.id ?? `row-${row}`}:${colKey}`
      const isResolved = resolvedCells.has(key)
      const isHighlighted = highlightedCells.has(key)
      const classes = [
        isHighlighted && !highlightColorByKey.get(key) ? 'cell-highlight-yellow' : '',
        commentsMap.has(key) && !isResolved ? 'cell-has-comment' : '',
        isResolved ? 'cell-comment-resolved' : '',
      ].filter(Boolean).join(' ')
      const color = (highlightColorByKey.get(key) || userHighlightColor || '#eab308').trim()
      const highlightStyle = isHighlighted && color
        ? { backgroundColor: `${color}40` }
        : undefined
      if (classes || highlightStyle) {
        return { className: classes || undefined, style: highlightStyle }
      }
      return {}
    },
    [activeProviderRows, visualColumnKeys, highlightedCells, highlightColorByKey, commentsMap, resolvedCells, userHighlightColor]
  )

  // Tooltip for cells with comments (e.g. on provider side when hovering)
  const getCellTitle = useCallback(
    (row: number, col: number) => {
      const sheetRow = activeProviderRows[row]
      const colKey = visualColumnKeys[col]
      if (!colKey) return undefined
      const key = `${sheetRow?.id ?? `row-${row}`}:${colKey}`
      return commentsMap.get(key) ?? undefined
    },
    [activeProviderRows, visualColumnKeys, commentsMap]
  )

  const handleCellRemoveComment = useCallback(
    async (row: number, col: number) => {
      if (!clinicId) return
      const sheetRow = activeProviderRows[row]
      const colKey = visualColumnKeys[col]
      if (!colKey) return
      const rowId = sheetRow?.id ?? `row-${row}`
      const key = `${rowId}:${colKey}`
      await apiClient
        .from('cell_comments')
        .delete()
        .eq('clinic_id', clinicId)
        .eq('sheet_type', 'providers')
        .eq('row_id', rowId)
        .eq('column_key', colKey)
      setCommentsMap((prev) => {
        const next = new Map(prev)
        next.delete(key)
        return next
      })
      setResolvedCells((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    },
    [activeProviderRows, visualColumnKeys, clinicId]
  )

  const getCellIsHighlighted = useCallback(
    (row: number, col: number) => {
      const sheetRow = activeProviderRows[row]
      const colKey = visualColumnKeys[col]
      if (!colKey) return false
      const key = `${sheetRow?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key)
    },
    [activeProviderRows, visualColumnKeys, highlightedCells]
  )

  const handleCellHighlight = useCallback(async (row: number, col: number) => {
    if (!clinicId) return
    const sheetRow = activeProviderRows[row]
    const colKey = visualColumnKeys[col]
    if (!colKey) return
    const rowId = sheetRow?.id ?? `row-${row}`
    const key = `${rowId}:${colKey}`
    const isHighlighted = highlightedCells.has(key)
    const currentUserColor = (userHighlightColor || '').trim() || '#eab308'
    if (isHighlighted) {
      await apiClient
        .from('cell_highlights')
        .delete()
        .eq('clinic_id', clinicId)
        .eq('sheet_type', 'providers')
        .eq('row_id', rowId)
        .eq('column_key', colKey)
      setHighlightedCells((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      setHighlightColorByKey((prev) => {
        const next = new Map(prev)
        next.delete(key)
        return next
      })
    } else {
      await apiClient.from('cell_highlights').upsert(
        {
          clinic_id: clinicId,
          sheet_type: 'providers',
          row_id: rowId,
          column_key: colKey,
          user_id: userProfile?.id ?? null,
          highlight_color: currentUserColor,
        },
        { onConflict: 'clinic_id,sheet_type,row_id,column_key' }
      )
      setHighlightedCells((prev) => new Set(prev).add(key))
      setHighlightColorByKey((prev) => new Map(prev).set(key, currentUserColor))
    }
  }, [activeProviderRows, visualColumnKeys, clinicId, highlightedCells, userHighlightColor, userProfile?.id])

  const handleCellSeeComment = useCallback((row: number, col: number) => {
    if (!clinicId) return
    const sheetRow = activeProviderRows[row]
    const colKey = visualColumnKeys[col]
    if (!colKey) return
    const rowId = sheetRow?.id ?? `row-${row}`
    const key = `${rowId}:${colKey}`
    const existing = commentsMap.get(key)
    // Defer opening the modal so the context menu closes first; then blur so the grid doesn't steal focus
    const openModal = () => {
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
      hotInstanceRef.current?.rootElement?.blur?.()
      if (existing !== undefined) {
        setCommentText(existing)
        setCommentModalLoading(false)
      } else {
        setCommentText('')
        setCommentModalLoading(true)
        apiClient
          .from('cell_comments')
          .select('comment, resolved')
          .eq('clinic_id', clinicId)
          .eq('sheet_type', 'providers')
          .eq('row_id', rowId)
          .eq('column_key', colKey)
          .maybeSingle()
          .then(({ data }) => {
            setCommentModalLoading(false)
            if (data?.comment != null) setCommentText(data.comment)
          })
      }
      setCommentModal({ row, col, rowId, colKey })
    }
    requestAnimationFrame(() => {
      openModal()
    })
  }, [activeProviderRows, visualColumnKeys, commentsMap, clinicId])

  const handleSaveComment = useCallback(async () => {
    if (!commentModal || !clinicId) return
    const key = `${commentModal.rowId}:${commentModal.colKey}`
    const text = commentTextareaRef.current?.value ?? commentText
    await apiClient.from('cell_comments').upsert(
      {
        clinic_id: clinicId,
        sheet_type: 'providers',
        row_id: commentModal.rowId,
        column_key: commentModal.colKey,
        comment: text,
        resolved: resolvedCells.has(key),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clinic_id,sheet_type,row_id,column_key' }
    )
    setCommentsMap((prev) => new Map(prev).set(key, text))
    setCommentModal(null)
    setCommentText('')
  }, [commentModal, clinicId, commentText, resolvedCells])

  const handleResolveComment = useCallback(async () => {
    if (!commentModal || !clinicId) return
    const key = `${commentModal.rowId}:${commentModal.colKey}`
    const text = commentTextareaRef.current?.value ?? commentText
    await apiClient.from('cell_comments').upsert(
      {
        clinic_id: clinicId,
        sheet_type: 'providers',
        row_id: commentModal.rowId,
        column_key: commentModal.colKey,
        comment: text,
        resolved: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clinic_id,sheet_type,row_id,column_key' }
    )
    setResolvedCells((prev) => new Set(prev).add(key))
    if (!commentsMap.has(key)) setCommentsMap((prev) => new Map(prev).set(key, text))
    setCommentModal(null)
    setCommentText('')
  }, [commentModal, clinicId, commentText, commentsMap])

  // When comment modal opens, focus the textarea immediately and again on delays so typing goes there
  useLayoutEffect(() => {
    if (commentModal && canEditComment && !commentModalLoading) {
      commentTextareaRef.current?.focus()
      const focus = () => commentTextareaRef.current?.focus()
      const id1 = setTimeout(focus, 80)
      const id2 = setTimeout(focus, 250)
      const id3 = setTimeout(focus, 450)
      return () => {
        clearTimeout(id1)
        clearTimeout(id2)
        clearTimeout(id3)
      }
    }
  }, [commentModal, canEditComment, commentModalLoading])

  // Light focus trap: only refocus when focus actually moves to the Handsontable (not on every focus change, which was breaking typing)
  useEffect(() => {
    if (!commentModal || !canEditComment) return
    const container = commentModalContainerRef.current
    const tableRoot = hotInstanceRef.current?.rootElement
    if (!container || !tableRoot) return
    let lastRefocusAt = 0
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as Node
      if (container.contains(target)) return
      if (!tableRoot.contains(target)) return
      if (Date.now() - lastRefocusAt < 400) return
      lastRefocusAt = Date.now()
      requestAnimationFrame(() => commentTextareaRef.current?.focus())
    }
    document.addEventListener('focusin', handleFocusIn, true)
    return () => document.removeEventListener('focusin', handleFocusIn, true)
  }, [commentModal, canEditComment])

  // Update columns with readOnly based on lock state
  const providerColumnsWithLocks = useMemo(() => {
    if (!activeProvider) return []
    
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const months = clinicPayroll === 2
      ? monthNames.flatMap(m => [`1st ${m}`, `2nd ${m}`])
      : monthNames

    const visitTypeCol = showVisitTypeColumn
      ? (readOnly: boolean) => ({
          data: 9,
          title: 'Tele',
          type: 'checkbox' as const,
          width: 50,
          readOnly,
        })
      : null
    /** Drop the visible Co-pay (data:4) and Co-Ins (data:5) column entries when the clinic flag is off.
     *  Source 2D data still has those positions (Handsontable reads other columns by data prop), so the
     *  data-index offsets used elsewhere (visit type at 9, claim status at 10, etc.) don't shift. */
    const filterHiddenCopayCoins = <C extends { data: number | string }>(cols: C[]): C[] =>
      showCopayCoinsuranceColumns
        ? cols
        : cols.filter((c) => c.data !== 4 && c.data !== 5)
    const officeStaffColOffset = showVisitTypeColumn ? 1 : 0
    if (officeStaffView) {
      const base = [
        { data: 0, title: 'ID', type: 'text' as const, width: 60, readOnly: getReadOnlyForColumn(0, !canEdit || getReadOnly('patient_id')) },
        { data: 1, title: 'First Name', type: 'text' as const, width: 90, readOnly: true },
        { data: 2, title: 'LI', type: 'text' as const, width: 40, readOnly: true },
        { data: 3, title: 'Ins', type: 'text' as const, width: 90, readOnly: true },
        { data: 4, title: 'Co-pay', type: 'text' as const, width: 80, renderer: copayTextCellRenderer, readOnly: true },
        { data: 5, title: 'Co-Ins', type: 'text' as const, width: 80, renderer: coinsuranceTextCellRenderer, readOnly: true },
        { data: 6, title: 'Date of Service', type: 'text' as const, width: 90, editor: DateOfServiceEditor, readOnly: getReadOnlyForColumn(6, !canEdit || getReadOnly('date_of_service')) },
        { data: 7, title: 'CPT Code', type: 'dropdown' as const, width: 160, editor: MultiSelectCptEditor, selectOptions: billingCodes.map(c => c.code), renderer: createMultiBubbleDropdownRenderer((val) => getCPTColor(val)) as any, cptColorMap: (val: string) => getCPTColor(val), readOnly: getReadOnlyForColumn(7, !canEdit || getReadOnly('cpt_code')) },
        ...(visitTypeCol ? [visitTypeCol(getReadOnlyForColumn(9, !canEdit))] : []),
        { data: 8, title: 'Appt/Note Status', type: 'dropdown' as const, width: 90, selectOptions: ['Complete', 'PP Complete', 'No Show', 'Rescheduled', 'Cancellation', 'Note Not Complete'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'appointment')) as any, editor: createColoredAutocompleteDropdown((val) => getStatusColor(val, 'appointment')), readOnly: getReadOnlyForColumn(8, !canEdit || getReadOnly('appointment_note_status')) },
        { data: 9 + officeStaffColOffset, title: 'Collected from PT', type: 'text' as const, width: 120, renderer: currencyCellRenderer, readOnly: getReadOnlyForColumn(9 + officeStaffColOffset, !canEdit || getReadOnly('collected_from_pt')) },
        { data: 10 + officeStaffColOffset, title: 'PT Pay Status', type: 'dropdown' as const, width: 120, selectOptions: ['Paid', 'CC declined', 'Secondary', 'Refunded', 'Payment Plan', 'Waiting on Claim', 'Collections'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'patient_pay')) as any, editor: createColoredAutocompleteDropdown((val) => getStatusColor(val, 'patient_pay')), readOnly: getReadOnlyForColumn(10 + officeStaffColOffset, !canEdit || getReadOnly('pt_pay_status')) },
        { data: 11 + officeStaffColOffset, title: 'PT Payment AR Ref Date', type: 'dropdown' as const, width: 120, selectOptions: months, renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any, editor: createColoredAutocompleteDropdown((val) => getMonthColor(val)), readOnly: getReadOnlyForColumn(11 + officeStaffColOffset, !canEdit || getReadOnly('pt_payment_ar_ref_date')) },
      ]
      return filterHiddenCopayCoins(base)
    }
    const pvOffset = showVisitTypeColumn ? 1 : 0
    if (isProviderView && providerLevel !== 2) {
      const base = [
        { data: 0, title: 'ID', type: 'text' as const, width: 60, readOnly: getReadOnlyProviderView(0) || getReadOnly('patient_id') },
        { data: 1, title: 'First Name', type: 'text' as const, width: 90, readOnly: true },
        { data: 2, title: 'LI', type: 'text' as const, width: 80, readOnly: true },
        // { data: 3, title: 'Ins', type: 'text' as const, width: 90, readOnly: getReadOnlyProviderView(3) },
        // { data: 4, title: 'Co-pay', type: 'text' as const, width: 80, renderer: copayTextCellRenderer, readOnly: getReadOnlyProviderView(4) },
        // { data: 5, title: 'Co-Ins', type: 'text' as const, width: 80, renderer: coinsuranceTextCellRenderer, readOnly: getReadOnlyProviderView(5) },
        { data: 6, title: 'Date of Service', type: 'text' as const, width: 90, editor: DateOfServiceEditor, readOnly: getReadOnlyProviderView(6) || getReadOnly('date_of_service') },
        { data: 7, title: 'CPT Code', type: 'dropdown' as const, width: 160, editor: MultiSelectCptEditor, selectOptions: billingCodes.map(c => c.code), renderer: createMultiBubbleDropdownRenderer((val) => getCPTColor(val)) as any, cptColorMap: (val: string) => getCPTColor(val), readOnly: getReadOnlyProviderView(7) || getReadOnly('cpt_code') },
        ...(visitTypeCol ? [visitTypeCol(getReadOnlyProviderView(9))] : []),
        { data: 8, title: 'Appt/Note Status', type: 'dropdown' as const, width: 90, selectOptions: ['Complete', 'PP Complete', 'No Show', 'Rescheduled', 'Cancellation', 'Note Not Complete'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'appointment')) as any, editor: createColoredAutocompleteDropdown((val) => getStatusColor(val, 'appointment')), readOnly: getReadOnlyProviderView(8) || getReadOnly('appointment_note_status') },
      ]
      // Partial provider view already excludes data:3/4/5; filter is a no-op but consistent.
      return filterHiddenCopayCoins(base)
    }
    if (isProviderView && providerLevel === 2) {
      return filterHiddenCopayCoins([
        { data: 0, title: 'ID', type: 'text' as const, width: 60, readOnly: getReadOnlyProviderView(0) || getReadOnly('patient_id') },
        { data: 1, title: 'First Name', type: 'text' as const, width: 90, readOnly: true },
        { data: 2, title: 'LI', type: 'text' as const, width: 40, readOnly: true },
        { data: 3, title: 'Ins', type: 'text' as const, width: 90, readOnly: true },
        { data: 4, title: 'Co-pay', type: 'text' as const, width: 80, renderer: copayTextCellRenderer, readOnly: true },
        { data: 5, title: 'Co-Ins', type: 'text' as const, width: 80, renderer: coinsuranceTextCellRenderer, readOnly: true },
        { data: 6, title: 'Date of Service', type: 'text' as const, width: 90, editor: DateOfServiceEditor, readOnly: getReadOnlyProviderView(6) || getReadOnly('date_of_service') },
        { data: 7, title: 'CPT Code', type: 'dropdown' as const, width: 160, editor: MultiSelectCptEditor, selectOptions: billingCodes.map(c => c.code), renderer: createMultiBubbleDropdownRenderer((val) => getCPTColor(val)) as any, cptColorMap: (val: string) => getCPTColor(val), readOnly: getReadOnlyProviderView(7) || getReadOnly('cpt_code') },
        ...(visitTypeCol ? [visitTypeCol(getReadOnlyProviderView(9))] : []),
        { data: 8, title: 'Appt/Note Status', type: 'dropdown' as const, width: 90, selectOptions: ['Complete', 'PP Complete', 'No Show', 'Rescheduled', 'Cancellation', 'Note Not Complete'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'appointment')) as any, editor: createColoredAutocompleteDropdown((val) => getStatusColor(val, 'appointment')), readOnly: getReadOnlyProviderView(8) || getReadOnly('appointment_note_status') },
        { data: 9 + pvOffset, title: 'Claim Status', type: 'dropdown' as const, width: 90, selectOptions: ['Claim Sent', 'N/A', 'Paid', 'Deductible', 'RS', 'IP', 'Pending Pay', 'Denial', 'Rejected', 'No Coverage'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'claim')) as any, editor: createColoredAutocompleteDropdown((val) => getStatusColor(val, 'claim')), readOnly: getReadOnlyProviderView(9 + pvOffset) || getReadOnly('claim_status') },
        { data: 10 + pvOffset, title: 'Most Recent Submit Date', type: 'text' as const, width: 120, editor: 'text', readOnly: getReadOnlyProviderView(10 + pvOffset) || getReadOnly('most_recent_submit_date') },
        { data: 11 + pvOffset, title: 'Ins Pay', type: 'text' as const, width: 100, renderer: currencyCellRenderer, readOnly: getReadOnlyProviderView(11 + pvOffset) || getReadOnly('ins_pay') },
        { data: 12 + pvOffset, title: 'Ins Pay Date', type: 'dropdown' as const, width: 100, selectOptions: months, renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any, editor: createColoredAutocompleteDropdown((val) => getMonthColor(val)), readOnly: getReadOnlyProviderView(12 + pvOffset) || getReadOnly('ins_pay_date') },
        { data: 13 + pvOffset, title: 'PT RES', type: 'text' as const, width: 100, renderer: currencyCellRenderer, readOnly: getReadOnlyProviderView(13 + pvOffset) || getReadOnly('pt_res') },
        { data: 14 + pvOffset, title: 'Collected from PT', type: 'text' as const, width: 120, renderer: currencyCellRenderer, readOnly: getReadOnlyProviderView(14 + pvOffset) || getReadOnly('collected_from_pt') },
        { data: 15 + pvOffset, title: 'PT Pay Status', type: 'dropdown' as const, width: 120, selectOptions: ['Paid', 'CC declined', 'Secondary', 'Refunded', 'Payment Plan', 'Waiting on Claim', 'Collections'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'patient_pay')) as any, editor: createColoredAutocompleteDropdown((val) => getStatusColor(val, 'patient_pay')), readOnly: getReadOnlyProviderView(15 + pvOffset) || getReadOnly('pt_pay_status') },
        { data: 16 + pvOffset, title: 'PT Payment AR Ref Date', type: 'dropdown' as const, width: 120, selectOptions: months, renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any, editor: createColoredAutocompleteDropdown((val) => getMonthColor(val)), readOnly: getReadOnlyProviderView(16 + pvOffset) || getReadOnly('pt_payment_ar_ref_date') },
        { data: 17 + pvOffset, title: 'Total', type: 'text' as const, width: 100, renderer: currencyCellRenderer, readOnly: getReadOnlyProviderView(17 + pvOffset) || getReadOnly('total') },
        { data: 18 + pvOffset, title: 'Notes', type: 'text' as const, width: 150, readOnly: getReadOnlyProviderView(18 + pvOffset) || getReadOnly('notes') },
      ])
    }

    const fullProviderColumns = filterHiddenCopayCoins([
      { 
        data: 0, 
        title: 'ID', 
        type: 'text' as const, 
        width: 60,
        readOnly: getReadOnlyForColumn(0, !canEdit || getReadOnly('patient_id'))
      },
      { 
        data: 1, 
        title: 'First Name', 
        type: 'text' as const, 
        width: 90,
        readOnly: true
      },
      { 
        data: 2, 
        title: 'LI', 
        type: 'text' as const, 
        width: 40,
        readOnly: true
      },
      { 
        data: 3, 
        title: 'Ins', 
        type: 'text' as const, 
        width: 90,
        readOnly: true
      },
      { 
        data: 4, 
        title: 'Co-pay', 
        type: 'text' as const, 
        width: 80,
        renderer: copayTextCellRenderer,
        readOnly: true
      },
      { 
        data: 5, 
        title: 'Co-Ins', 
        type: 'text' as const, 
        width: 80,
        renderer: coinsuranceTextCellRenderer,
        readOnly: true
      },
      { 
        data: 6, 
        title: 'Date of Service', 
        type: 'text' as const, 
        width: 90, 
        editor: DateOfServiceEditor,
        readOnly: getReadOnlyForColumn(6, !canEdit || getReadOnly('date_of_service'))
      },
      { 
        data: 7, 
        title: 'CPT Code', 
        type: 'dropdown' as const, 
        width: 160,
        editor: MultiSelectCptEditor,
        selectOptions: billingCodes.map(c => c.code),
        renderer: createMultiBubbleDropdownRenderer((val) => getCPTColor(val)) as any, cptColorMap: (val: string) => getCPTColor(val),
        readOnly: getReadOnlyForColumn(7, !canEdit || getReadOnly('cpt_code'))
      },
      ...(visitTypeCol ? [visitTypeCol(getReadOnlyForColumn(9, !canEdit))] : []),
      { 
        data: 8, 
        title: 'Appt/Note Status', 
        type: 'dropdown' as const, 
        width: 90,
        selectOptions: ['Complete', 'PP Complete', 'No Show', 'Rescheduled', 'Cancellation', 'Note Not Complete'],
        renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'appointment')) as any, editor: createColoredAutocompleteDropdown((val) => getStatusColor(val, 'appointment')),
        readOnly: getReadOnlyForColumn(8, !canEdit || getReadOnly('appointment_note_status'))
      },
      { 
        data: 9 + (showVisitTypeColumn ? 1 : 0), 
        title: 'Claim Status', 
        type: 'dropdown' as const, 
        width: 90,
        selectOptions: ['Claim Sent', 'N/A', 'Paid', 'Deductible', 'RS', 'IP', 'Pending Pay', 'Denial', 'Rejected', 'No Coverage'],
        renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'claim')) as any, editor: createColoredAutocompleteDropdown((val) => getStatusColor(val, 'claim')),
        readOnly: getReadOnlyForColumn(9 + (showVisitTypeColumn ? 1 : 0), !canEdit || getReadOnly('claim_status'))
      },
      { 
        data: 10 + (showVisitTypeColumn ? 1 : 0), 
        title: 'Most Recent', 
        type: 'text' as const, 
        width: 120,
        editor: 'text',
        readOnly: getReadOnlyForColumn(10 + (showVisitTypeColumn ? 1 : 0), !canEdit || getReadOnly('most_recent_submit_date'))
      },
      {
        data: 11 + (showVisitTypeColumn ? 1 : 0),
        title: 'Ins Pay',
        type: 'text' as const,
        width: 100,
        renderer: currencyCellRenderer,
        readOnly: getReadOnlyForColumn(11 + (showVisitTypeColumn ? 1 : 0), !canEdit || getReadOnly('ins_pay'))
      },
      { 
        data: 12 + (showVisitTypeColumn ? 1 : 0), 
        title: 'Ins Pay Date', 
        type: 'dropdown' as const, 
        width: 100,
        selectOptions: months,
        renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any, editor: createColoredAutocompleteDropdown((val) => getMonthColor(val)),
        readOnly: getReadOnlyForColumn(12 + (showVisitTypeColumn ? 1 : 0), !canEdit || getReadOnly('ins_pay_date'))
      },
      {
        data: 13 + (showVisitTypeColumn ? 1 : 0),
        title: 'PT RES',
        type: 'text' as const,
        width: 100,
        renderer: currencyCellRenderer,
        readOnly: getReadOnlyForColumn(13 + (showVisitTypeColumn ? 1 : 0), !canEdit || getReadOnly('pt_res'))
      },
      {
        data: 14 + (showVisitTypeColumn ? 1 : 0),
        title: 'PT Paid',
        type: 'text' as const,
        width: 120,
        renderer: currencyCellRenderer,
        readOnly: getReadOnlyForColumn(14 + (showVisitTypeColumn ? 1 : 0), !canEdit || getReadOnly('collected_from_pt'))
      },
      { 
        data: 15 + (showVisitTypeColumn ? 1 : 0), 
        title: 'PT Pay Status', 
        type: 'dropdown' as const, 
        width: 120,
        selectOptions: ['Paid', 'CC declined', 'Secondary', 'Refunded', 'Payment Plan', 'Waiting on Claim', 'Collections'],
        renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'patient_pay')) as any, editor: createColoredAutocompleteDropdown((val) => getStatusColor(val, 'patient_pay')),
        readOnly: getReadOnlyForColumn(15 + (showVisitTypeColumn ? 1 : 0), !canEdit || getReadOnly('pt_pay_status'))
      },
      { 
        data: 16 + (showVisitTypeColumn ? 1 : 0), 
        title: 'PT Payment AR Ref Date', 
        type: 'dropdown' as const, 
        width: 120,
        selectOptions: months,
        renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any, editor: createColoredAutocompleteDropdown((val) => getMonthColor(val)),
        readOnly: getReadOnlyForColumn(16 + (showVisitTypeColumn ? 1 : 0), !canEdit || getReadOnly('pt_payment_ar_ref_date'))
      },
      {
        data: 17 + (showVisitTypeColumn ? 1 : 0),
        title: 'Total',
        type: 'text' as const,
        width: 100,
        renderer: currencyCellRenderer,
        readOnly: getReadOnlyForColumn(17 + (showVisitTypeColumn ? 1 : 0), !canEdit || getReadOnly('total'))
      },
      {
        data: 18 + (showVisitTypeColumn ? 1 : 0),
        title: 'Notes',
        type: 'text' as const,
        width: 150,
        readOnly: getReadOnlyForColumn(18 + (showVisitTypeColumn ? 1 : 0), !canEdit || getReadOnly('notes'))
      },
    ])
    if (showCondenseButton && isMinimal) {
      // Minimal keeps ID (data:0), First Name (data:1), LI (data:2), DOS (data:6), and Claim
      // Status onward. ID is always included so the user can tell which patient each row belongs
      // to — without it, Minimal mode shows only First Name / dates / claim info and rows blur
      // together when multiple patients share the same first name.
      // Each column's `data` prop is the underlying SheetRow array index, which is preserved
      // across copay/coins hiding — so filtering by data:N is robust to that flag.
      const VToffset = showVisitTypeColumn ? 1 : 0
      const keep = new Set<number>([0, 1, 2, 6])
      for (let i = 9 + VToffset; i <= 18 + VToffset; i++) keep.add(i)
      return fullProviderColumns.filter((c) => typeof c.data === 'number' && keep.has(c.data))
    }
    if (showCondenseButton && isCondensed) {
      // Condense shows ID through Appt/Note Status (+ Visit Type when on). With Co-pay/Co-Ins hidden,
      // that's 2 fewer columns at the front of the array, so the slice end shrinks by 2.
      const condensedCount = (showVisitTypeColumn ? 10 : 9) - (showCopayCoinsuranceColumns ? 0 : 2)
      return fullProviderColumns.slice(0, condensedCount)
    }
    return fullProviderColumns
  }, [activeProvider, clinicPayroll, billingCodes, statusColors, getCPTColor, getStatusColor, getMonthColor, patients, canEdit, lockData, getReadOnly, isProviderView, providerLevel, officeStaffView, showCondenseButton, isCondensed, isMinimal, showVisitTypeColumn, showCopayCoinsuranceColumns, restrictEditToSchedulingColumns])

  const afterGetProviderColHeader = useCallback(
    (col: number, TH: HTMLTableCellElement, headerLevel?: number) => {
      if (headerLevel != null && headerLevel !== 0) return
      TH.querySelector('.providers-col-header-lock-wrap')?.remove()
      if (col < 0) return
      const colDef = providerColumnsWithLocks[col] as { data?: number | string } | undefined
      if (!colDef || typeof colDef.data !== 'number') return
      const field = lockFieldFromProvidersRowDataIndex(colDef.data, {
        showVisitTypeColumn,
        officeStaffView,
        isProviderView,
        providerLevel,
      })
      if (!field || !lockData || !lockData[field]) return
      const wrap = document.createElement('span')
      wrap.className = 'providers-col-header-lock-wrap'
      wrap.title = 'Column locked'
      const img = document.createElement('img')
      img.className = 'providers-col-header-lock-img'
      img.src = lockIconSrc
      img.alt = ''
      img.width = 18
      img.height = 18
      wrap.appendChild(img)
      const inner = (TH.querySelector('div') as HTMLElement | null) || TH
      inner.appendChild(wrap)
    },
    [providerColumnsWithLocks, lockData, lockIconSrc, showVisitTypeColumn, officeStaffView, isProviderView, providerLevel]
  )

  // Before Handsontable applies edits: non-empty patient_id values are deferred — we revert the cell in this hook,
  // then resolve the patient from the clinic list and only then setDataAtCell(..., 'patientIdDbValidated').
  // When Visit Type column is present, fill/drag can copy boolean into Appt/Note Status (col 8). Replace with source cell value so fill works.
  const beforeChangeCorrectProviderRows = useCallback(
    (
      changes: Handsontable.CellChange[] | null,
      source: Handsontable.ChangeSource,
      hotInstance?: Handsontable | null
    ): void | false => {
      if (!changes?.length) return

      const src = String(source)
      const deferPatientIds =
        src !== 'loadData' &&
        src !== 'updateData' &&
        clinicIdForValidationRef.current &&
        activeProviderRef.current &&
        !isViewingBackup

      const changeCount = changes.filter((c) => c != null).length
      if (deferPatientIds && shouldBatchDeferPatientId(src, changeCount)) {
        for (const ch of changes) {
          if (!ch) continue
          const colProp = ch[1] as string | number
          if (!isPatientIdSheetColumnProp(colProp)) continue
          const newValue = ch[3]
          const raw = String(newValue ?? '').trim()
          const patientIdOrNull = raw ? (raw.split(' - ')[0]?.trim() || raw) : null
          if (!patientIdOrNull) continue
          const oldVal = ch[2]
          ;(ch as unknown[])[3] = oldVal
          patientIdDeferredQueueRef.current.push({
            row: ch[0] as number,
            col: colProp,
            newVal: patientIdOrNull,
          })
        }

        if (patientIdDeferredQueueRef.current.length > 0 && hotInstance && !hotInstance.isDestroyed) {
          const hot = hotInstance
          if (!patientIdFlushScheduledRef.current) {
            patientIdFlushScheduledRef.current = true
            queueMicrotask(() => {
              patientIdFlushScheduledRef.current = false
              const batch = patientIdDeferredQueueRef.current.splice(0)
              const ap = activeProviderRef.current
              const cid = clinicIdForValidationRef.current
              if (!hot.isDestroyed && ap && cid && batch.length > 0) {
                const work = (async () => {
                  const data = await resolvePatientsListForValidation()
                  const byKey = new Map<string, Patient>()
                  for (const p of data) {
                    const k = String(p.patient_id ?? '').trim().toLowerCase()
                    if (k) byKey.set(k, p as Patient)
                  }
                  const byRow = new Map<number, { col: string | number; newVal: string }>()
                  for (const item of batch) {
                    byRow.set(item.row, { col: item.col, newVal: item.newVal })
                  }
                  for (const [row, { col, newVal }] of byRow) {
                    const key = newVal.trim().toLowerCase()
                    const rec = byKey.get(key)
                    pendingPatientMergeByRowRef.current.set(row, rec ?? null)
                    try {
                      hot.setDataAtCell(row, col as number, newVal, 'patientIdDbValidated')
                    } catch (e) {
                      console.error('[ProvidersTab] setDataAtCell after patient ID validation failed', e)
                    }
                  }
                })()
                patientIdAsyncTailRef.current = patientIdAsyncTailRef.current.then(() => work).catch(() => {})
              }
            })
          }
        }
      }

      if (!showVisitTypeColumn) return
    const APPT_NOTE_STATUS_COL = 8
    const badChanges = changes.filter(
      (ch) => ch[1] === APPT_NOTE_STATUS_COL && (ch[3] === true || ch[3] === false)
    )
    if (badChanges.length === 0) return
    // Fill-down: source is the row above the first filled row; use its value for all bad cells
    const minRow = Math.min(...badChanges.map((ch) => ch[0]))
    const sourceRow = minRow - 1
    const sourceValue =
      hotInstance && sourceRow >= 0
        ? hotInstance.getDataAtCell(sourceRow, APPT_NOTE_STATUS_COL)
        : undefined
    const valueToApply =
      sourceValue !== undefined && sourceValue !== null && sourceValue !== true && sourceValue !== false
        ? sourceValue
        : null
    badChanges.forEach((change) => {
      ;(change as unknown[])[3] = valueToApply
    })
  }, [showVisitTypeColumn, isViewingBackup, resolvePatientsListForValidation])

  const handleProviderRowsHandsontableChange = useCallback((changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes || source === 'loadData' || !activeProvider) return

    // Bail out early if no cell value actually changed (e.g. user double-clicked a cell but typed nothing).
    // Handsontable fires afterChange with source='edit' even when oldValue === newValue, which would
    // otherwise trigger a full save of all rows — matching how PatientsTab skips unchanged saves.
    const isEmpty = (v: unknown) => v === null || v === undefined || v === ''
    const hasRealChange = changes.some(([, , oldValue, newValue]) => {
      if (isEmpty(oldValue) && isEmpty(newValue)) return false
      return oldValue !== newValue
    })
    if (!hasRealChange) return

    // Detect paste / drag-fill — these batch many cells into one afterChange call, so the user
    // benefits from a visible "Saving…" indicator (the save is still 400ms debounced + server
    // recompute downstream, which on a large paste can run 2–5s). The toast shows up immediately
    // on the bulk afterChange and the setTimeout below clears it once the actual save resolves.
    const srcStr = String(source)
    const isBulkChange =
      srcStr === 'CopyPaste' ||
      srcStr.includes('Autofill') ||
      srcStr === 'fill' ||
      changes.length > 1
    if (isBulkChange && bulkSaveStartedAtRef.current == null) {
      bulkSaveStartedAtRef.current = Date.now()
      setIsBulkSaving(true)
    }

    // Column index -> SheetRow field (visit_type inserted at 9 when showVisitTypeColumn)
    const fieldsFullBase: Array<keyof SheetRow> = [
      'patient_id', 'patient_first_name', 'last_initial', 'patient_insurance', 'patient_copay', 'patient_coinsurance',
      'appointment_date', 'cpt_code', 'appointment_status', 'claim_status', 'submit_date', 'insurance_payment',
      'payment_date', 'insurance_adjustment', 'collected_from_patient', 'patient_pay_status', 'ar_date', 'total', 'notes'
    ]
    const fieldsFull = showVisitTypeColumn
      ? ([...fieldsFullBase.slice(0, 9), 'visit_type', ...fieldsFullBase.slice(9)] as Array<keyof SheetRow>)
      : fieldsFullBase
    const fieldsProviderViewBase: Array<keyof SheetRow> = [
      'patient_id', 'patient_first_name', 'last_initial', 'patient_insurance', 'patient_copay', 'patient_coinsurance',
      'appointment_date', 'cpt_code', 'appointment_status'
    ]
    const fieldsProviderView = showVisitTypeColumn
      ? ([...fieldsProviderViewBase, 'visit_type'] as Array<keyof SheetRow>)
      : fieldsProviderViewBase
    const fieldsOfficeStaffBase: Array<keyof SheetRow> = [
      'patient_id', 'patient_first_name', 'last_initial', 'patient_insurance', 'patient_copay', 'patient_coinsurance',
      'appointment_date', 'cpt_code', 'appointment_status', 'collected_from_patient', 'patient_pay_status', 'ar_date'
    ]
    const fieldsOfficeStaff = showVisitTypeColumn
      ? ([...fieldsOfficeStaffBase.slice(0, 9), 'visit_type', ...fieldsOfficeStaffBase.slice(9)] as Array<keyof SheetRow>)
      : fieldsOfficeStaffBase
    // Minimal & condensed modes use fieldsFull (NOT a compacted slice) because Handsontable passes
    // the column's `data:` prop as `col` to afterChange, and `data:` props in providerColumnsWithLocks
    // reference ORIGINAL row positions (data:11 for Ins Pay, data:6 for DOS, etc.). A compacted
    // fields array would map data:11 → wrong field (ar_date instead of insurance_payment), which
    // is the bug that surfaced when editing Ins Pay in minimal mode cleared DOS/Claim/MostRecent.
    const fields: Array<keyof SheetRow> = officeStaffView
      ? fieldsOfficeStaff
      : isProviderView
        ? (providerLevel === 2 ? fieldsFull : fieldsProviderView)
        : fieldsFull
    
    const dateFields: (keyof SheetRow)[] = ['appointment_date', 'submit_date', 'payment_date', 'ar_date']
    // Start from latest ref when same provider so rapid edits accumulate (parent state may not have updated yet).
    // Before using the ref, reconcile any temp ids (new-*, empty-*) that the parent has since promoted to real
    // UUIDs via save merge — otherwise stale new-* ids get re-sent as new INSERTs on every edit burst and
    // create duplicate provider_sheet_rows even after the row already has a UUID in the DB.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    let baseRows: SheetRow[]
    if (latestProviderRowsRef.current?.providerId === activeProvider.id) {
      const rawRows = latestProviderRowsRef.current.rows
      let anyIdPromoted = false
      // Use the ref (not the closure) so that even a stale HOT callback sees the most recently
      // rendered activeProviderRows — critical when the user types faster than React re-renders.
      const latestPropsRows = activeProviderRowsRef.current
      const reconciled = rawRows.map((row, i) => {
        const propsRow = latestPropsRows[i]
        if (propsRow && !UUID_RE.test(row.id) && UUID_RE.test(propsRow.id)) {
          anyIdPromoted = true
          return { ...row, id: propsRow.id, created_at: propsRow.created_at, updated_at: propsRow.updated_at }
        }
        return row
      })
      if (anyIdPromoted) {
        latestProviderRowsRef.current = { providerId: activeProvider.id, rows: reconciled }
      }
      baseRows = reconciled
    } else {
      baseRows = [...activeProviderRowsRef.current]
    }

    const updatedRows = [...baseRows]
    let idCounter = 0
    let hadPatientIdMerge = false
    let hadPatientIdClear = false
    let hadDateColumnEdit = false
    let hadTotalAutoUpdate = false
    const deleteRowIds: string[] = []
    const setDraftFromRow = (rowObj: SheetRow) => {
      const key = String(rowObj.patient_id ?? '').trim().toLowerCase()
      if (!key) return
      coPatientDraftByIdKeyRef.current.set(key, {
        patient_first_name: rowObj.patient_first_name ?? null,
        patient_insurance: rowObj.patient_insurance ?? null,
        patient_copay: rowObj.patient_copay ?? null,
        patient_coinsurance: rowObj.patient_coinsurance ?? null,
      })
    }
    const clearDraftByPid = (pid: string | null | undefined) => {
      const key = String(pid ?? '').trim().toLowerCase()
      if (!key) return
      coPatientDraftByIdKeyRef.current.delete(key)
    }
    /** Track (rowIndex, field) for each cell changed in this batch so we always notify parent (including when user clears a cell and stored value was already null) */
    const changedCells = new Set<string>()

    // Track 0-value highlight updates for Ins Pay / Collected from PT (and "00" in Collected from PT → yellow)
    const YELLOW_HIGHLIGHT = '#eab308'
    const zeroHighlightUpdates: { rowId: string; colKey: string; isZero: boolean; highlightColor: string }[] = []

    changes.forEach(([row, col, , newValue]) => {
      const field = fields[col as number]
      if (field) changedCells.add(`${row}:${field}`)
      // Ensure we have enough rows
      while (updatedRows.length <= row) {
        const createEmptyRow = (index: number): SheetRow => ({
          id: `empty-${activeProvider.id}-${index}`,
          patient_id: null,
          patient_first_name: null,
          patient_last_name: null,
          last_initial: null,
          patient_insurance: null,
          patient_copay: null,
          patient_coinsurance: null,
          appointment_date: null,
          appointment_time: null,
          visit_type: null,
          notes: null,
          billing_code: null,
          billing_code_color: null,
          appointment_status: null,
          appointment_status_color: null,
          claim_status: null,
          claim_status_color: null,
          submit_date: null,
          insurance_payment: null,
          insurance_adjustment: null,
          invoice_amount: null,
          collected_from_patient: null,
          patient_pay_status: null,
          patient_pay_status_color: null,
          payment_date: null,
          payment_date_color: null,
          ar_type: null,
          ar_amount: null,
          ar_date: null,
          ar_date_color: null,
          ar_notes: null,
          provider_payment_amount: null,
          provider_payment_date: null,
          provider_payment_notes: null,
          highlight_color: null,
          total: null,
          cpt_code: null,
          cpt_code_color: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        const existingEmptyCount = updatedRows.filter(r => r.id.startsWith('empty-')).length
        updatedRows.push(createEmptyRow(existingEmptyCount))
      }
      
      const sheetRow = updatedRows[row]
      if (sheetRow) {
        // Generate unique ID for empty rows
        const needsNewId = sheetRow.id.startsWith('empty-')
        const newId = needsNewId ? `new-${Date.now()}-${idCounter++}-${Math.random()}` : sheetRow.id
        
        if (field === 'patient_id') {
          // Extract patient_id from dropdown value (format: "patient_id - first_name last_name") or raw input
          const raw = String(newValue ?? '').trim()
          const patientIdOrNull = raw ? (raw.split(' - ')[0]?.trim() || raw) : null
          // When user clears patient ID: clear only patient-related fields; keep all other columns (appointment_date, cpt_code, etc.)
          if (patientIdOrNull == null || patientIdOrNull === '') {
            hadPatientIdClear = true
            clearDraftByPid(sheetRow.patient_id)
            const t = patientIdEditDebounceRef.current.get(row)
            if (t) clearTimeout(t)
            patientIdEditDebounceRef.current.delete(row)
            patientIdEditLatestPidRef.current.delete(row)
            updatedRows[row] = {
              ...sheetRow,
              id: newId,
              patient_id: null,
              patient_first_name: null,
              patient_last_name: null,
              last_initial: null,
              patient_insurance: null,
              patient_copay: null,
              patient_coinsurance: null,
              updated_at: new Date().toISOString(),
            } as SheetRow
            return
          }
          // Non-empty IDs must be validated against DB first (beforeChange defers + setDataAtCell(..., 'patientIdDbValidated')).
          if (String(source) === 'patientIdDbValidated') {
            const dbPatient = pendingPatientMergeByRowRef.current.get(row)
            pendingPatientMergeByRowRef.current.delete(row)
            if (dbPatient) hadPatientIdMerge = true
            updatedRows[row] = buildSheetRowWithPatientIdMerge(sheetRow, patientIdOrNull, dbPatient ?? null)
            setDraftFromRow(updatedRows[row] as SheetRow)
            return
          }
          // Internal refresh: optional merge from in-memory patients list only (no new user typing). (loadData is skipped at top of handler.)
          if (String(source) === 'updateSettings') {
            const patient = patients.find(
              (p) => String(p.patient_id ?? '').trim().toLowerCase() === patientIdOrNull.trim().toLowerCase()
            )
            const merged: Partial<SheetRow> = {
              ...sheetRow,
              id: newId,
              patient_id: patientIdOrNull,
              updated_at: new Date().toISOString(),
            }
            if (patient) {
              hadPatientIdMerge = true
              merged.patient_first_name = patient.first_name || null
              merged.last_initial = patient.last_name ? patient.last_name.charAt(0) : null
              merged.patient_insurance = patient.insurance || null
              merged.patient_copay = patient.copay ?? null
              merged.patient_coinsurance = patient.coinsurance ?? null
            }
            updatedRows[row] = merged as SheetRow
            setDraftFromRow(updatedRows[row] as SheetRow)
            return
          }
          // Normal typing / single-cell edit: keep patient_id in the row; debounce patient merge (batch paste uses beforeChange defer).
          patientIdEditLatestPidRef.current.set(row, patientIdOrNull)
          updatedRows[row] = {
            ...sheetRow,
            id: newId,
            patient_id: patientIdOrNull,
            updated_at: new Date().toISOString(),
          }
          setDraftFromRow(updatedRows[row] as SheetRow)
          const apIdForDebounce = activeProvider.id
          const prevDeb = patientIdEditDebounceRef.current.get(row)
          if (prevDeb) clearTimeout(prevDeb)
          patientIdEditDebounceRef.current.set(
            row,
            setTimeout(() => {
              patientIdEditDebounceRef.current.delete(row)
              const work = (async () => {
                const ap = activeProviderRef.current
                const clinic = clinicIdForValidationRef.current
                if (!ap || !clinic || ap.id !== apIdForDebounce || isViewingBackupRef.current) return
                const pidRaw = patientIdEditLatestPidRef.current.get(row)?.trim()
                if (!pidRaw) return
                const key = pidRaw.toLowerCase()

                const data = await resolvePatientsListForValidation()
                const rec =
                  data.find((p) => String(p.patient_id ?? '').trim().toLowerCase() === key) ?? null

                const cur = latestProviderRowsRef.current?.providerId === ap.id ? [...latestProviderRowsRef.current.rows] : null
                if (!cur || row >= cur.length) return
                const baseRow = cur[row]
                if (!baseRow || String(baseRow.patient_id ?? '').trim().toLowerCase() !== key) return

                const merged = buildSheetRowWithPatientIdMerge(baseRow, pidRaw, rec)
                cur[row] = merged
                const draftKey = String(merged.patient_id ?? '').trim().toLowerCase()
                if (draftKey) {
                  coPatientDraftByIdKeyRef.current.set(draftKey, {
                    patient_first_name: merged.patient_first_name ?? null,
                    patient_insurance: merged.patient_insurance ?? null,
                    patient_copay: merged.patient_copay ?? null,
                    patient_coinsurance: merged.patient_coinsurance ?? null,
                  })
                }
                latestProviderRowsRef.current = { providerId: ap.id, rows: cur }
                latestTableDataRef.current = getTableDataFromRows(cur)
                matrixSourceRevisionsRef.current = {
                  patientsRev: patientsDisplayRevisionForMatrixRef.current,
                  rowsVer: providerRowsVersionForMatrixRef.current,
                }
                pendingProviderSheetSaveRef.current = { providerId: ap.id, rows: cur }
                onSaveProviderSheetRowsDirectRef.current(ap.id, cur).catch((e) =>
                  console.error('[ProvidersTab] save after patient id merge (edit)', e)
                )
                setStructureVersion((v) => v + 1)
              })()
              patientIdAsyncTailRef.current = patientIdAsyncTailRef.current.then(() => work).catch(() => {})
            }, 350)
          )
          return
        } else if (field === 'patient_copay' || field === 'patient_coinsurance') {
          const strValue = (newValue === '' || newValue === null || newValue === 'null' || newValue === undefined) ? null : String(newValue)
          updatedRows[row] = { ...sheetRow, id: newId, [field]: strValue, updated_at: new Date().toISOString() } as SheetRow
          setDraftFromRow(updatedRows[row] as SheetRow)
        } else if (field === 'total') {
          // Accept pasted currency formats ("$300.00", "1,250", "  300 ") — strip $, commas, whitespace before parsing.
          const parseCurrency = (v: unknown): number | null => {
            if (v === '' || v === null || v === undefined || v === 'null') return null
            if (typeof v === 'number') return Number.isFinite(v) ? v : null
            const cleaned = String(v).replace(/[$,\s]/g, '')
            if (cleaned === '' || cleaned === '-') return null
            const n = parseFloat(cleaned)
            return Number.isFinite(n) ? n : null
          }
          const numValue = parseCurrency(newValue)
          updatedRows[row] = { ...sheetRow, id: newId, [field]: numValue, updated_at: new Date().toISOString() } as SheetRow
        } else if (field === 'insurance_payment' || field === 'collected_from_patient') {
          hadTotalAutoUpdate = true
          // Accept pasted currency formats ("$300.00", "1,250", "  300 ") — strip $, commas, whitespace before parsing.
          const parseCurrency = (v: unknown): number | null => {
            if (v === '' || v === null || v === undefined || v === 'null') return null
            if (typeof v === 'number') return Number.isFinite(v) ? v : null
            const cleaned = String(v).replace(/[$,\s]/g, '')
            if (cleaned === '' || cleaned === '-') return null
            const n = parseFloat(cleaned)
            return Number.isFinite(n) ? n : null
          }
          const numValue = parseCurrency(newValue)
          const insPay = field === 'insurance_payment' ? (numValue ?? NaN) : (parseCurrency(sheetRow.insurance_payment) ?? 0)
          const collected = field === 'collected_from_patient' ? (numValue ?? NaN) : (parseCurrency(sheetRow.collected_from_patient) ?? 0)
          const totalSum = (Number.isFinite(insPay) ? insPay : 0) + (Number.isFinite(collected) ? collected : 0)
          updatedRows[row] = {
            ...sheetRow,
            id: newId,
            [field]: numValue,
            total: String(totalSum),
            updated_at: new Date().toISOString(),
          } as SheetRow
        } else if (field === 'appointment_date') {
          hadDateColumnEdit = true
          const value = (newValue === '' || newValue === 'null') ? null : parseDateOfServiceInput(String(newValue))
          updatedRows[row] = { ...sheetRow, id: newId, [field]: value, updated_at: new Date().toISOString() } as SheetRow
        } else if (field === 'appointment_status') {
          // Reject only the Visit Type fill-down leakage (literal booleans). Trim/case-fold and canonicalize
          // to the official spelling so copy-paste from rows that picked up stray whitespace still lands.
          // Unknown strings are kept as-typed (color will be null) rather than silently dropped, which
          // previously caused "the value shows up then disappears" when pasted/duplicated values had a
          // trailing space or capitalization difference.
          const validStatuses = ['Complete', 'PP Complete', 'No Show', 'Rescheduled', 'Cancellation', 'Note Not Complete']
          if (newValue === true || newValue === false || newValue === 'true' || newValue === 'false') return
          let strVal: string | null
          if (newValue === '' || newValue === null || newValue === undefined || newValue === 'null') {
            strVal = null
          } else {
            const raw = String(newValue).trim()
            strVal = validStatuses.find((s) => s.toLowerCase() === raw.toLowerCase()) ?? raw
          }
          updatedRows[row] = { ...sheetRow, id: newId, [field]: strVal, updated_at: new Date().toISOString() } as SheetRow
        } else if (field === 'visit_type') {
          // Accept the value from any path: checkbox toggles deliver a boolean, fill-down / paste
          // may deliver the underlying string ('Telehealth' / 'In-person'), and clears come through
          // as null/''. Keep them all routed to the canonical stored value.
          let value: 'Telehealth' | 'In-person' | null
          if (newValue === true) value = 'Telehealth'
          else if (newValue === false) value = 'In-person'
          else if (newValue == null || newValue === '' || newValue === 'null') value = null
          else value = String(newValue).trim().toLowerCase() === 'telehealth' ? 'Telehealth' : 'In-person'
          updatedRows[row] = { ...sheetRow, id: newId, [field]: value, updated_at: new Date().toISOString() } as SheetRow
        } else if (field) {
          if (dateFields.includes(field)) hadDateColumnEdit = true
          let value = (newValue === '' || newValue === 'null') ? null : String(newValue)
          if (field === 'submit_date') {
            const s = (value ?? '').trim()
            if (s !== '' && /^-?\d*\.?\d*$/.test(s)) value = sheetRow.submit_date ?? null
          }
          updatedRows[row] = { ...sheetRow, id: newId, [field]: value, updated_at: new Date().toISOString() } as SheetRow
          if (field === 'patient_first_name' || field === 'patient_insurance') {
            setDraftFromRow(updatedRows[row] as SheetRow)
          }
        }
      }
      // Auto highlight when 0 or "00" is entered in Ins Pay or PT Paid (Collected from PT), or
      // when the user changes the Patient Pay Status while Collected from PT is already 0.
      // Rules:
      //   - Ins Pay = 0  → user highlight color (typically blue)
      //   - PT Paid = 0  AND Patient Pay Status = "Paid" → user highlight color (matches Ins Pay)
      //   - PT Paid = 0  otherwise → yellow (the original "needs attention" color)
      const parseForHighlight = (v: unknown): number | null => {
        if (v === '' || v === null || v === undefined) return null
        if (typeof v === 'number') return Number.isFinite(v) ? v : null
        const cleaned = String(v).replace(/[$,\s]/g, '')
        if (cleaned === '' || cleaned === '-') return null
        const n = parseFloat(cleaned)
        return Number.isFinite(n) ? n : null
      }
      const highlightColor = (userHighlightColor || '').trim() || YELLOW_HIGHLIGHT
      if (field === 'insurance_payment' || field === 'collected_from_patient') {
        const finalRow = updatedRows[row]
        const rowId = finalRow?.id ?? sheetRow?.id ?? `row-${row}`
        const colKey = field === 'insurance_payment' ? 'ins_pay' : 'collected_from_pt'
        const num = parseForHighlight(newValue)
        const isZero = num === 0
        const ptStatus = String(finalRow?.patient_pay_status ?? '').trim().toLowerCase()
        const ptStatusIsPaid = ptStatus === 'paid'
        const useYellow = field === 'collected_from_patient' && isZero && !ptStatusIsPaid
        const colorToUse = isZero ? (useYellow ? YELLOW_HIGHLIGHT : highlightColor) : highlightColor
        zeroHighlightUpdates.push({ rowId, colKey, isZero, highlightColor: colorToUse })
      } else if (field === 'patient_pay_status') {
        // Status flipped — recompute the PT Paid highlight if the cell is currently 0 so it
        // tracks the new status without the user having to re-enter the 0.
        const finalRow = updatedRows[row]
        const rowId = finalRow?.id ?? sheetRow?.id ?? `row-${row}`
        const ptPaidNum = parseForHighlight(finalRow?.collected_from_patient)
        if (ptPaidNum === 0) {
          const nextStatus = String(newValue ?? '').trim().toLowerCase()
          const isPaid = nextStatus === 'paid'
          const colorToUse = isPaid ? highlightColor : YELLOW_HIGHLIGHT
          zeroHighlightUpdates.push({ rowId, colKey: 'collected_from_pt', isZero: true, highlightColor: colorToUse })
        }
      }
    })

    // Remove rows whose patient_id was cleared and notify parent.
    // Bulk-call so all knownDeletedIds reach the server in one save (the per-row loop used to lose
    // them on the save-serialization queue, leaving deleted rows in the DB).
    const uniqueDeleteIds = [...new Set(deleteRowIds)]
    if (uniqueDeleteIds.length > 0 && onDeleteRows) {
      const idsToNotify: string[] = []
      for (let i = updatedRows.length - 1; i >= 0; i--) {
        if (uniqueDeleteIds.includes(updatedRows[i].id)) {
          idsToNotify.push(updatedRows[i].id)
          updatedRows.splice(i, 1)
        }
      }
      if (idsToNotify.length > 0) {
        runWithDeleteToast(onDeleteRows(activeProvider.id, idsToNotify))
      }
    }

    // Only pad to target when under target (allow more than target rows). Target = 200 + any extra
    // rows the user requested via the "Add 50 rows" button below the table.
    if (updatedRows.length < padTargetRows) {
      const emptyRowsNeeded = padTargetRows - updatedRows.length
      const existingEmptyCount = updatedRows.filter(r => r.id.startsWith('empty-')).length
      const createEmptyRow = (index: number): SheetRow => ({
        id: `empty-${activeProvider.id}-${index}`,
        patient_id: null,
        patient_first_name: null,
        patient_last_name: null,
        last_initial: null,
        patient_insurance: null,
        patient_copay: null,
        patient_coinsurance: null,
        appointment_date: null,
        appointment_time: null,
        visit_type: null,
        notes: null,
        billing_code: null,
        billing_code_color: null,
        appointment_status: null,
        appointment_status_color: null,
        claim_status: null,
        claim_status_color: null,
        submit_date: null,
        insurance_payment: null,
        insurance_adjustment: null,
        invoice_amount: null,
        collected_from_patient: null,
        patient_pay_status: null,
        patient_pay_status_color: null,
        payment_date: null,
        payment_date_color: null,
        ar_type: null,
        ar_amount: null,
        ar_date: null,
        ar_date_color: null,
        ar_notes: null,
        provider_payment_amount: null,
        provider_payment_date: null,
        provider_payment_notes: null,
        highlight_color: null,
        total: null,
        cpt_code: null,
        cpt_code_color: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
        createEmptyRow(existingEmptyCount + i)
      )
      updatedRows.push(...newEmptyRows)
    }

    // Store latest table data and rows so next render and flush-on-unmount have current data (like PatientsTab setPatients)
    latestTableDataRef.current = getTableDataFromRows(updatedRows)
    matrixSourceRevisionsRef.current = {
      patientsRev: patientsDisplayRevisionForMatrixRef.current,
      rowsVer: providerRowsVersionForMatrixRef.current,
    }
    latestProviderRowsRef.current = { providerId: activeProvider.id, rows: updatedRows }

    // Auto add/remove highlight when Ins Pay or Collected from PT is set to 0 / "00" or changed
    if (zeroHighlightUpdates.length > 0 && clinicId) {
      const userId = userProfile?.id ?? null
      ;(async () => {
        for (const { rowId, colKey, isZero, highlightColor } of zeroHighlightUpdates) {
          const key = `${rowId}:${colKey}`
          if (isZero) {
            await apiClient.from('cell_highlights').upsert(
              {
                clinic_id: clinicId,
                sheet_type: 'providers',
                row_id: rowId,
                column_key: colKey,
                user_id: userId,
                highlight_color: highlightColor,
              },
              { onConflict: 'clinic_id,sheet_type,row_id,column_key' }
            )
            setHighlightedCells((prev) => new Set(prev).add(key))
            setHighlightColorByKey((prev) => new Map(prev).set(key, highlightColor))
          } else {
            await apiClient
              .from('cell_highlights')
              .delete()
              .eq('clinic_id', clinicId)
              .eq('sheet_type', 'providers')
              .eq('row_id', rowId)
              .eq('column_key', colKey)
            setHighlightedCells((prev) => {
              const next = new Set(prev)
              next.delete(key)
              return next
            })
            setHighlightColorByKey((prev) => {
              const next = new Map(prev)
              next.delete(key)
              return next
            })
          }
        }
      })()
    }
    
    // Apply all changes to parent state atomically to prevent row-id races (empty-* -> new-*)
    // when multiple cells are edited quickly on the same row.
    if (onReplaceProviderSheetRows) {
      onReplaceProviderSheetRows(activeProvider.id, updatedRows)
    } else {
      // Backward compatibility fallback for legacy parent integrations.
      updatedRows.forEach((row, index) => {
        const originalRow = activeProviderRows[index]
        if (!originalRow) return
        const fieldsToCheck: Array<keyof SheetRow> = [
          'patient_id', 'patient_first_name', 'last_initial', 'patient_insurance', 'patient_copay', 'patient_coinsurance',
          'appointment_date', 'cpt_code', 'appointment_status', 'claim_status', 'submit_date', 'insurance_payment',
          'payment_date', 'insurance_adjustment', 'collected_from_patient', 'patient_pay_status', 'ar_date', 'total', 'notes'
        ]
        fieldsToCheck.forEach(field => {
          const cellKey = `${index}:${field}`
          const valueChanged = row[field] !== originalRow[field]
          const wasExplicitlyEdited = changedCells.has(cellKey)
          if (valueChanged || wasExplicitlyEdited) {
            onUpdateProviderSheetRow(activeProvider.id, originalRow.id, field, row[field] as any)
          }
        })
      })
    }
    
    // Debounce save and flush on unmount so data isn't lost when switching tabs
    pendingProviderSheetSaveRef.current = { providerId: activeProvider.id, rows: updatedRows }
    providersDebugTab('pending save scheduled', {
      providerId: activeProvider.id,
      rows: updatedRows.length,
      source,
      changedCells: changes.length,
    })
    // Immediately back up to localStorage so a hard browser close (no React unmount, no time for the
    // debounced server save) is still recoverable. The pagehide handler in ClinicDetail / ProviderSheetPage
    // replays this key after a freshness + clinic-match check. Without this, every typed cell sat
    // in memory only for the 400ms debounce window — a real client lost work this way.
    try {
      const cid = clinicIdForPendingRef.current
      const mk = selectedMonthKeyForPendingRef.current
      if (cid && mk) {
        const payload = JSON.stringify({
          rows: updatedRows,
          savedAt: Date.now(),
          clinicId: cid,
          providerId: activeProvider.id,
          selectedMonthKey: mk,
        })
        if (payload.length <= PENDING_ROWS_MAX_SIZE) {
          const key = `${PENDING_ROWS_KEY_PREFIX}${cid}_${activeProvider.id}_${mk}`
          localStorage.setItem(key, payload)
        }
      }
    } catch (e) {
      // Quota exceeded / private mode: swallow; the debounced server save is still the primary persistence.
      console.warn('[ProvidersTab] per-edit localStorage backup failed:', e)
    }
    if (saveProviderSheetTimeoutRef.current) clearTimeout(saveProviderSheetTimeoutRef.current)
    // 400ms: patient_id merge from DB runs at 350ms; saving sooner could persist rows before demographics are merged on the row object.
    saveProviderSheetTimeoutRef.current = setTimeout(() => {
      saveProviderSheetTimeoutRef.current = null
      const pending = pendingProviderSheetSaveRef.current
      if (pending) {
        pendingProviderSheetSaveRef.current = null
        providersDebugTab('debounced save firing', {
          providerId: pending.providerId,
          rows: pending.rows.length,
        })
        const startedAt = bulkSaveStartedAtRef.current
        bulkSaveStartedAtRef.current = null
        const savePromise = onSaveProviderSheetRowsDirect(pending.providerId, pending.rows)
        savePromise.catch(err => {
          console.error('[handleProviderRowsHandsontableChange] Error in saveProviderSheetRowsDirect:', err)
        })
        // Clear the bulk-saving toast once the save completes, respecting a minimum visible duration
        // so a fast network doesn't flash the indicator off before the user can register it.
        if (startedAt != null) {
          savePromise.finally(() => {
            const elapsed = Date.now() - startedAt
            const remaining = Math.max(0, BULK_SAVE_TOAST_MIN_MS - elapsed)
            if (remaining === 0) {
              setIsBulkSaving(false)
            } else {
              setTimeout(() => setIsBulkSaving(false), remaining)
            }
          })
        }
      } else if (bulkSaveStartedAtRef.current != null) {
        // No pending save (e.g. row was emptied) — clear the toast right away.
        bulkSaveStartedAtRef.current = null
        setIsBulkSaving(false)
      }
    }, 400)

    // When patient_id was merged or cleared, a date column was edited, total was auto-calculated, or a row was deleted,
    // bump so HandsontableWrapper pushes the ref data to the grid (wrapper only updates on dataVersion/length change).
    if (hadPatientIdMerge || hadPatientIdClear || hadDateColumnEdit || hadTotalAutoUpdate || uniqueDeleteIds.length > 0) {
      setStructureVersion((v) => v + 1)
    }
  }, [activeProvider, activeProviderRows, onUpdateProviderSheetRow, onReplaceProviderSheetRows, onSaveProviderSheetRowsDirect, onDeleteRows, runWithDeleteToast, isProviderView, providerLevel, officeStaffView, showCondenseButton, isCondensed, isMinimal, minimalVisualIndices, showVisitTypeColumn, patients, getTableDataFromRows, clinicId, userHighlightColor, userProfile?.id, resolvePatientsListForValidation])

  const createEmptySheetRowForSync = useCallback(
    (providerId: string, emptySuffix: number): SheetRow => ({
      id: `empty-${providerId}-${emptySuffix}`,
      patient_id: null,
      patient_first_name: null,
      patient_last_name: null,
      last_initial: null,
      patient_insurance: null,
      patient_copay: null,
      patient_coinsurance: null,
      appointment_date: null,
      appointment_time: null,
      visit_type: null,
      notes: null,
      billing_code: null,
      billing_code_color: null,
      appointment_status: null,
      appointment_status_color: null,
      claim_status: null,
      claim_status_color: null,
      submit_date: null,
      insurance_payment: null,
      insurance_adjustment: null,
      invoice_amount: null,
      collected_from_patient: null,
      patient_pay_status: null,
      patient_pay_status_color: null,
      payment_date: null,
      payment_date_color: null,
      ar_type: null,
      ar_amount: null,
      ar_date: null,
      ar_date_color: null,
      ar_notes: null,
      provider_payment_amount: null,
      provider_payment_date: null,
      provider_payment_notes: null,
      highlight_color: null,
      total: null,
      cpt_code: null,
      cpt_code_color: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
    []
  )

  /** Pending/latest change-handler refs only (no HOT snapshot) — avoids a second save after tab flush with stale temp ids.
   *  Also reconciles any leftover new-* ids with the current props UUIDs so the flush doesn't re-INSERT already-saved rows. */
  const resolveRowsForTabLeaveFlushRef = useRef<() => { providerId: string; rows: SheetRow[] } | null>(() => null)
  resolveRowsForTabLeaveFlushRef.current = () => {
    const pending = pendingProviderSheetSaveRef.current
    const latest = latestProviderRowsRef.current
    const providerIdFromRefs = pending?.providerId ?? latest?.providerId
    const rowsFromRefs =
      latest?.providerId === providerIdFromRefs && latest?.rows?.length ? latest.rows : pending?.rows
    if (!providerIdFromRefs || !rowsFromRefs?.length) return null
    // Reconcile stale temp ids: if props row i has a UUID and ref row i has a non-UUID, use the UUID.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const propsRows = activeProviderRowsRef.current
    let anyPromoted = false
    const reconciled = rowsFromRefs.map((row, i) => {
      const propsRow = propsRows[i]
      if (propsRow && !UUID_RE.test(row.id) && UUID_RE.test(propsRow.id)) {
        anyPromoted = true
        return { ...row, id: propsRow.id, created_at: propsRow.created_at, updated_at: propsRow.updated_at }
      }
      return row
    })
    return { providerId: providerIdFromRefs, rows: anyPromoted ? reconciled : rowsFromRefs }
  }

  const handleProviderAfterCreateRow = useCallback(
    (index: number, amount: number, source?: string) => {
      if (!canEdit || !activeProvider) return
      if (source === 'loadData' || source === 'updateData') return
      if (isHandsontableUndoRedoSource(source)) return
      if (amount !== 1) return
      const ref = latestProviderRowsRef.current
      const rows = ref?.providerId === activeProvider.id ? ref.rows : activeProviderRows
      if (source === 'ContextMenu.rowAbove' && onAddRowAbove) {
        const beforeId = rows[index]?.id
        if (beforeId) {
          onAddRowAbove(activeProvider.id, beforeId)
          latestTableDataRef.current = null
          matrixSourceRevisionsRef.current = null
          latestProviderRowsRef.current = null
          setStructureVersion((v) => v + 1)
        }
      } else if (source === 'ContextMenu.rowBelow' && onAddRowBelow) {
        const afterIdx = index - 1
        const afterId = afterIdx >= 0 ? rows[afterIdx]?.id : undefined
        if (afterId) {
          onAddRowBelow(activeProvider.id, afterId)
          latestTableDataRef.current = null
          matrixSourceRevisionsRef.current = null
          latestProviderRowsRef.current = null
          setStructureVersion((v) => v + 1)
        }
      }
    },
    [canEdit, activeProvider, activeProviderRows, onAddRowAbove, onAddRowBelow]
  )

  const handleProviderAfterRemoveRow = useCallback(
    (_index: number, _amount: number, physicalRows: number[], source?: string) => {
      if (!canEdit || !activeProvider) return
      if (source === 'loadData' || source === 'updateData') return
      if (isHandsontableUndoRedoSource(source)) return
      const ref = latestProviderRowsRef.current
      const snap =
        ref?.providerId === activeProvider.id ? [...ref.rows] : [...activeProviderRows]
      const removed = physicalRows.map((i) => snap[i]).filter(Boolean)
      // Collect all persisted ids into one batch — Handsontable's afterRemoveRow fires once for a
      // multi-row delete, but the old per-row notifier serialized through the save queue and dropped
      // knownDeletedIds on every save after the first, so only one row actually disappeared from the DB.
      const idsToDelete = removed
        .filter((r) => !r.id.startsWith('empty-') && !r.id.startsWith('new-'))
        .map((r) => r.id)
      if (idsToDelete.length > 0 && onDeleteRows) {
        runWithDeleteToast(onDeleteRows(activeProvider.id, idsToDelete))
      }
      latestTableDataRef.current = null
      matrixSourceRevisionsRef.current = null
      latestProviderRowsRef.current = null
      setStructureVersion((v) => v + 1)
    },
    [canEdit, activeProvider, activeProviderRows, onDeleteRows, runWithDeleteToast]
  )

  const syncProvidersFromHotAfterUndoRedo = useCallback((direction?: 'undo' | 'redo') => {
    const hot = hotInstanceRef.current as (Handsontable & { isDestroyed?: boolean; undo?: () => void; redo?: () => void }) | null
    if (!hot || hot.isDestroyed) return
    if (!canEdit || !activeProvider || isViewingBackup) return
    try {
      const grid = hot.getData() as (string | number | boolean | null | undefined)[][]
      const fields = providerSheetColumnFieldsForSync
      const ref = latestProviderRowsRef.current
      const prevRows =
        ref?.providerId === activeProvider.id ? ref.rows : activeProviderRows
      const merged: SheetRow[] = []
      for (let i = 0; i < grid.length; i++) {
        const row = grid[i]
        const p = prevRows[i] ?? createEmptySheetRowForSync(activeProvider.id, i)
        merged.push(mergeProviderRowFromGridRowForSync(p, row, fields))
      }
      if (merged.length < padTargetRows) {
        const emptyRowsNeeded = padTargetRows - merged.length
        const existingEmptyCount = merged.filter((r) => r.id.startsWith('empty-')).length
        for (let i = 0; i < emptyRowsNeeded; i++) {
          merged.push(createEmptySheetRowForSync(activeProvider.id, existingEmptyCount + i))
        }
      }

      // Guardrail: a single Cmd+Z can wipe an entire pasted block, and this handler used to save that
      // empty state to the DB before the user could react. Count non-empty cells that were cleared by
      // the undo/redo and, if it's a large change, ask before persisting it.
      const isEmptyVal = (v: unknown) => v === null || v === undefined || v === ''
      let cellsCleared = 0
      const rowsToCompare = Math.min(prevRows.length, merged.length)
      for (let i = 0; i < rowsToCompare; i++) {
        const a = prevRows[i]
        const b = merged[i]
        if (!a || !b) continue
        for (const f of fields) {
          if (!f) continue
          const av = (a as unknown as Record<string, unknown>)[f as string]
          const bv = (b as unknown as Record<string, unknown>)[f as string]
          if (!isEmptyVal(av) && isEmptyVal(bv)) cellsCleared++
        }
      }
      const UNDO_CONFIRM_THRESHOLD = 20
      if (cellsCleared > UNDO_CONFIRM_THRESHOLD) {
        // Snapshot pre-change rows to localStorage as a safety net before we even prompt — if the browser
        // crashes mid-confirm or the user closes the tab, the data is still recoverable.
        try {
          const cid = clinicIdForPendingRef.current
          const mk = selectedMonthKeyForPendingRef.current
          if (cid && mk) {
            const snapshotKey = `provider_sheet_undo_snapshot_${cid}_${activeProvider.id}_${mk}`
            localStorage.setItem(
              snapshotKey,
              JSON.stringify({ rows: prevRows, savedAt: Date.now(), direction: direction ?? 'unknown', cellsCleared })
            )
          }
        } catch (e) {
          console.warn('[ProvidersTab] undo snapshot localStorage write failed:', e)
        }
        const proceed = window.confirm(
          `This ${direction === 'redo' ? 'redo' : 'undo'} will clear ${cellsCleared} cells of data. Continue?\n\nClick Cancel to keep your data and reverse this action.`
        )
        if (!proceed) {
          // Reverse the action: after a cancelled undo we redo, after a cancelled redo we undo.
          try {
            if (direction === 'redo') {
              hot.undo?.()
            } else {
              hot.redo?.()
            }
          } catch (e) {
            console.error('[ProvidersTab] failed to reverse undo/redo after cancel', e)
          }
          return
        }
      }

      latestProviderRowsRef.current = { providerId: activeProvider.id, rows: merged }
      latestTableDataRef.current = getTableDataFromRows(merged)
      matrixSourceRevisionsRef.current = {
        patientsRev: patientsDisplayRevisionForMatrixRef.current,
        rowsVer: providerRowsVersionForMatrixRef.current,
      }
      pendingProviderSheetSaveRef.current = { providerId: activeProvider.id, rows: merged }
      providersDebugTab('undo/redo immediate save', {
        providerId: activeProvider.id,
        rows: merged.length,
      })
      void onSaveProviderSheetRowsDirect(activeProvider.id, merged).catch((err) =>
        console.error('saveProviders after HOT undo/redo sync', err)
      )
      setStructureVersion((v) => v + 1)
    } catch (e) {
      console.error('syncProvidersFromHotAfterUndoRedo', e)
    }
  }, [
    canEdit,
    activeProvider,
    isViewingBackup,
    providerSheetColumnFieldsForSync,
    activeProviderRows,
    createEmptySheetRowForSync,
    getTableDataFromRows,
    onSaveProviderSheetRowsDirect,
  ])

  // Flush pending save when tab is left so data isn't lost on switch (prefer latest ref like PatientsTab flush).
  // On page refresh the browser aborts in-flight requests (AbortError) so we also backup to localStorage;
  // ClinicDetail restores and saves on next load.
  const PENDING_ROWS_KEY_PREFIX = 'provider_sheet_pending_'
  const PENDING_ROWS_MAX_SIZE = 1024 * 1024 // 1MB

  // Flush only when ProvidersTab actually unmounts (e.g. user switches tab). Do NOT list onSave/clinicId/monthKey as deps —
  // parent recreates save callback when providerSheets changes, which would run this cleanup while still on the tab and duplicate saves / corrupt ids.
  useEffect(() => {
    return () => {
      const hotUnmount = hotInstanceRef.current as
        | (Handsontable & { isDestroyed?: boolean; deselectCell?: () => void })
        | null
      if (hotUnmount && !hotUnmount.isDestroyed) {
        try {
          hotUnmount.getActiveEditor?.()?.finishEditing?.(false)
        } catch {
          /* ignore */
        }
        try {
          hotUnmount.deselectCell?.()
        } catch {
          /* ignore */
        }
      }
      if (saveProviderSheetTimeoutRef.current) {
        clearTimeout(saveProviderSheetTimeoutRef.current)
        saveProviderSheetTimeoutRef.current = null
      }
      if (tabLeaveFlushPersistedRef.current) {
        tabLeaveFlushPersistedRef.current = false
        return
      }
      const resolved = resolveRowsForTabLeaveFlushRef.current()
      const providerIdToSave = resolved?.providerId
      const rowsToSave = resolved?.rows
      if (providerIdToSave && rowsToSave?.length) {
        pendingProviderSheetSaveRef.current = null
        latestProviderRowsRef.current = null
        latestTableDataRef.current = null
        matrixSourceRevisionsRef.current = null
        providersDebugTab('unmount flush save', {
          providerId: providerIdToSave,
          rows: rowsToSave.length,
        })

        const cid = clinicIdForPendingRef.current
        const mk = selectedMonthKeyForPendingRef.current
        if (cid && mk) {
          try {
            const payload = JSON.stringify({
              rows: rowsToSave,
              savedAt: Date.now(),
              clinicId: cid,
              providerId: providerIdToSave,
              selectedMonthKey: mk,
            })
            if (payload.length <= PENDING_ROWS_MAX_SIZE) {
              const key = `${PENDING_ROWS_KEY_PREFIX}${cid}_${providerIdToSave}_${mk}`
              localStorage.setItem(key, payload)
            }
          } catch (e) {
            console.warn('[ProvidersTab] localStorage backup failed:', e)
          }
        }

        onSaveProviderSheetRowsDirectRef.current(providerIdToSave, rowsToSave).catch(err => {
          console.error('[ProvidersTab unmount] Error flushing save:', err)
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: unmount-only flush; refs hold latest callback/ids
  }, [])

  // Expose flush so parent can persist provider rows before switching away from Providers tab.
  useEffect(() => {
    if (!onRegisterFlushBeforeTabLeave) return
    const flush = async () => {
      await commitProviderHandsontableBeforePersist()
      await patientIdAsyncTailRef.current.catch(() => {})
      if (saveProviderSheetTimeoutRef.current) {
        clearTimeout(saveProviderSheetTimeoutRef.current)
        saveProviderSheetTimeoutRef.current = null
      }
      const resolved = resolveRowsForTabLeaveFlushRef.current()
      const providerIdToSave = resolved?.providerId
      const rowsToSave = resolved?.rows
      if (!providerIdToSave || !rowsToSave?.length) {
        return
      }
      pendingProviderSheetSaveRef.current = null
      await onSaveProviderSheetRowsDirectRef.current(providerIdToSave, rowsToSave)
      tabLeaveFlushPersistedRef.current = true
      latestProviderRowsRef.current = null
      latestTableDataRef.current = null
      matrixSourceRevisionsRef.current = null
    }
    onRegisterFlushBeforeTabLeave(flush)
  }, [onRegisterFlushBeforeTabLeave, commitProviderHandsontableBeforePersist])

  // Apply custom header colors after table renders
  useEffect(() => {
    if (hotInstanceRef.current) {
      const hotInstance = hotInstanceRef.current
      const fullHeaderColors = [
        '#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', // Patient info columns
        '#fce5cd', '#fce5cd', // CPT and Appointment status
        '#ead1dd', '#ead1dd', // Claim status columns
        '#d9d2e9', '#d9d2e9', '#d9d2e9', // Insurance payment columns
        '#b191cd', '#b191cd', '#b191cd', // Patient payment columns
        '#d9d2e9', // Total
        '#5d9f5d' // Notes
      ]
      const headerColors = officeStaffView
        ? ['#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#fce5cd', '#fce5cd', '#ead1dd', '#b191cd', '#b191cd', '#b191cd'] // Patient through Appt/Note Status, then PT payment columns
        : isProviderView
          ? ['#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#f5cbcc', '#fce5cd', '#fce5cd', '#ead1dd'] // Patient info (pink), Date/CPT (orange/beige), Appt/Note Status (purple/pink)
          : showCondenseButton && isMinimal
            // Minimal: First Name, LI, DOS (all pink), then claim status onward (pulled from fullHeaderColors at indices 9..18).
            ? [fullHeaderColors[0], '#f5cbcc', '#f5cbcc', '#f5cbcc', ...fullHeaderColors.slice(9)]
            : (showCondenseButton && isCondensed ? [fullHeaderColors[0], ...fullHeaderColors.slice(0, 9)] : [fullHeaderColors[0], ...fullHeaderColors])
      
      // Apply header colors
      setTimeout(() => {
        if (!hotInstance || (hotInstance as any).isDestroyed) return
        const root = hotInstance.rootElement
        if (!root) return
        const headerCells = root.querySelectorAll('.ht_clone_top th, table.htCore thead th')
        headerCells.forEach((th, index) => {
          const el = th as HTMLElement
          if (headerColors[index]) {
            el.style.backgroundColor = headerColors[index]
            el.style.color = '#000000'
          }
        })
      }, 100)
    }
  }, [activeProvider, providerColumnsWithLocks, isProviderView, officeStaffView, showCondenseButton, isCondensed, isMinimal])

  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState(isInSplitScreen ? 400 : 600)
  // Drive the table height from the viewport in non-split mode (was pinned at 600px, leaving a grey
  // backplate on taller monitors). Split-screen mode still measures the container via ResizeObserver
  // because its flex parent already constrains height.
  useEffect(() => {
    const PAGE_CHROME_OFFSET = 320  // header + month tabs + condense row + sums/buttons row + padding
    const FULL_PAGE_MIN_HEIGHT = 520
    const computeHeight = (): number => {
      if (isInSplitScreen) return tableContainerRef.current?.clientHeight ?? 400
      return Math.max(FULL_PAGE_MIN_HEIGHT, window.innerHeight - PAGE_CHROME_OFFSET)
    }
    setTableHeight(computeHeight())
    const onResize = () => setTableHeight(computeHeight())
    window.addEventListener('resize', onResize)
    let ro: ResizeObserver | null = null
    if (isInSplitScreen) {
      const el = tableContainerRef.current
      if (el) {
        ro = new ResizeObserver(() => setTableHeight(el.clientHeight))
        ro.observe(el)
      }
    }
    return () => {
      window.removeEventListener('resize', onResize)
      ro?.disconnect()
    }
  }, [isInSplitScreen])

  if (providersToShow.length === 0) {
    return (
      <div className="p-6">
        <div className="text-center text-white/70 py-8">
          {providerId ? 'Provider not found' : 'No providers found for this clinic'}
        </div>
      </div>
    )
  }

  return (
    <div className={isInSplitScreen ? 'p-6 split-pane-tab' : 'p-6'}>
      {/* Top-of-viewport toast for row deletion. Portaled to body so it escapes the table's stacking
        context (Handsontable headers use high z-indexes that occluded the in-table indicator). */}
      {isDeletingRows && createPortal(
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 20px',
            borderRadius: 8,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.15)',
            pointerEvents: 'none',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 18,
              height: 18,
              border: '3px solid rgba(255,255,255,0.25)',
              borderTopColor: '#fff',
              borderRadius: '50%',
              animation: 'providers-tab-spin 0.7s linear infinite',
              display: 'inline-block',
            }}
          />
          Deleting row(s)…
          <style>{`@keyframes providers-tab-spin { to { transform: rotate(360deg); } }`}</style>
        </div>,
        document.body,
      )}
      {/* Bulk-save toast for paste / drag-fill. Same portal + styling treatment as the delete toast,
        offset slightly so the two don't visually collide if the user did both in quick succession. */}
      {isBulkSaving && createPortal(
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 20px',
            borderRadius: 8,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.15)',
            pointerEvents: 'none',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 18,
              height: 18,
              border: '3px solid rgba(255,255,255,0.25)',
              borderTopColor: '#fff',
              borderRadius: '50%',
              animation: 'providers-tab-spin 0.7s linear infinite',
              display: 'inline-block',
            }}
          />
          Saving…
        </div>,
        document.body,
      )}
      {/* <h1 className="text-3xl font-bold text-white">{activeProvider?.first_name} {activeProvider?.last_name}</h1> */}
      <MonthYearTabs
        selectedMonth={selectedMonth}
        selectedPayroll={selectedPayroll ?? 1}
        clinicPayroll={clinicPayroll}
        statusColors={statusColors}
        label="Billing sheet for"
        isInSplitScreen={isInSplitScreen}
        labelRightSlot={labelRightSlot}
        belowTitleSlot={belowTitleSlot}
        onChange={(date, payroll) => {
          if (onSelectMonth) {
            onSelectMonth(date, payroll)
          }
        }}
      />

      {showCondenseButton && (() => {
        const nextMode: CondenseMode = condenseMode === 'full' ? 'condensed' : condenseMode === 'condensed' ? 'minimal' : 'full'
        const titleByMode: Record<CondenseMode, string> = {
          full: 'Condense (hide Claim Status through Notes)',
          condensed: 'Show only First Name, LI, Date of Service + Claim Status onward',
          minimal: 'Show all columns',
        }
        const labelByMode: Record<CondenseMode, string> = {
          full: '−',
          condensed: '⇥',
          minimal: '+',
        }
        return (
          <div className="flex justify-end -mt-6">
            <button
              type="button"
              onClick={() => setCondenseMode(nextMode)}
              className="w-7 h-6 flex items-center justify-center rounded border border-white/30 bg-white/10 text-white hover:bg-white/20 font-bold text-sm"
              title={titleByMode[condenseMode]}
              aria-label={titleByMode[condenseMode]}
            >
              {labelByMode[condenseMode]}
            </button>
          </div>
        )
      })()}

      <div
        ref={tableContainerRef}
        className="table-container dark-theme"
        style={{
          // Removed the hardcoded `maxHeight: 600px` cap and the opaque grey backplate so the table
          // owns its visible bounds (height now comes from the viewport calculation above).
          flex: isInSplitScreen ? 1 : undefined,
          minHeight: isInSplitScreen ? 0 : undefined,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          width: '100%',
          maxWidth: '100%',
          backgroundColor: 'transparent',
        }}
      >
        {activeProvider && (
          <HandsontableWrapper
            key={`providers-${activeProvider?.id ?? ''}`}
            data={getProviderRowsHandsontableData()}
            dataVersion={(providerRowsVersion ?? 0) + structureVersion + selectedMonth.getTime() + patientsDisplayRevision + extraEmptyRows + (isViewingBackup ? 1000000 + backupVersionKey : 0)}
            columns={providerColumnsWithLocks}
            colHeaders={columnTitles}
            colHeaderRefreshKey={providerLocksKey}
            afterGetColHeader={afterGetProviderColHeader}
            rowHeaders={true}
            width="100%"
            height={tableHeight}
            stretchH={isInSplitScreen ? "none" : "all"}
            beforeChangeCorrect={beforeChangeCorrectProviderRows}
            afterChange={handleProviderRowsHandsontableChange}
            onAfterRowMove={handleProviderRowMove}
            afterCreateRow={handleProviderAfterCreateRow}
            afterRemoveRow={handleProviderAfterRemoveRow}
            onAfterUndoRedoSync={syncProvidersFromHotAfterUndoRedo}
            contextMenuWithNativeRows
            onCellHighlight={handleCellHighlight}
            getCellIsHighlighted={getCellIsHighlighted}
            onCellSeeComment={clinicId && canEditComment ? handleCellSeeComment : undefined}
            hotInstanceRef={hotInstanceRef}
            getCellTitle={getCellTitle}
            cells={providerCellsCallback}
            enableFormula={true}
            readOnly={!canEdit}
            style={{ backgroundColor: '#d2dbe5' }}
            className="handsontable-custom providers-handsontable"
          />
        )}
      </div>

      {/* Sums box + Download/Add buttons share one row. The sums box grows to fill the available
       *  width (flex-1) so the buttons hug the right edge instead of getting their own full row
       *  above the sums. flex-wrap kicks in on narrow viewports (split-screen, mobile) so the
       *  buttons drop below the sums box rather than overflow horizontally. */}
      {activeProvider && (
        ((isProviderView && providerLevel === 2) || !isProviderView || (canEdit && !isViewingBackup)) && (
          <div className="mt-3 flex items-stretch flex-wrap gap-3">
            {/* Sum tally for provider with full access (level 2) only */}
            {isProviderView && providerLevel === 2 && (
              <div
                className={`flex-1 min-w-0 flex flex-col rounded-lg border border-white/20 bg-slate-800/80 text-white ${
                  isInSplitScreen ? 'gap-1 px-3 py-2 text-sm' : 'gap-2 px-4 py-3'
                }`}
              >
                <div className={`flex items-center flex-wrap ${isInSplitScreen ? 'gap-x-3 gap-y-1' : 'gap-6'}`}>
                  <span className="font-medium text-red-500">Sums:</span>
                  <span><strong>Insurance Pay Total:</strong> {formatCurrency(providerSums.insPay)}</span>
                  <span><strong>Patient Payment Total:</strong> {formatCurrency(providerSums.collectedFromPt)}</span>
                  <span><strong>AR Total:</strong> {arSumFromDb === null ? '—' : formatCurrency(arSumFromDb)}</span>
                </div>
              </div>
            )}

            {!isProviderView && (
              <div
                className={`flex-1 min-w-0 flex flex-col rounded-lg border border-white/20 bg-slate-800/80 text-white ${
                  isInSplitScreen ? 'gap-1 px-3 py-2 text-sm' : 'gap-2 px-4 py-3'
                }`}
              >
                {officeStaffView ? (
                  <div className={`flex items-center flex-wrap text-sm ${isInSplitScreen ? 'gap-x-3 gap-y-1' : 'gap-4'}`}>
                    <span className="font-medium text-red-500/90">CC Declines:</span>
                    <span><strong>{billingMetrics?.ccDeclines ?? 0}</strong></span>
                  </div>
                ) : (
                  <>
                    <div className={`flex items-center flex-wrap ${isInSplitScreen ? 'gap-x-3 gap-y-1' : 'gap-6'}`}>
                      <span className="font-medium text-red-500">Sums:</span>
                      <span><strong>Ins Pay:</strong> {formatCurrency(providerSums.insPay)}</span>
                      <span><strong>Collected from PT:</strong> {formatCurrency(providerSums.collectedFromPt)}</span>
                      <span><strong>Total:</strong> {formatCurrency(providerSums.total)}</span>
                      <span><strong>AR Total:</strong> {arSumFromDb === null ? '—' : formatCurrency(arSumFromDb)}</span>
                    </div>
                    {billingMetrics && (
                      <div className={`flex items-center flex-wrap text-sm border-t border-white/20 ${
                        isInSplitScreen ? 'gap-x-3 gap-y-1 pt-1' : 'gap-4 pt-2'
                      }`}>
                        <span className="font-medium text-red-500/90">Metrics:</span>
                        <span>Visits: <strong>{billingMetrics.visits}</strong></span>
                        <span>No Shows: <strong>{billingMetrics.noShows}</strong></span>
                        <span>Cancel/Resched: <strong>{billingMetrics.cancellationsReschedulings}</strong></span>
                        <span>Paid claims: <strong>{billingMetrics.paidClaims}</strong></span>
                        <span>Private Pay: <strong>{billingMetrics.privatePay}</strong></span>
                        <span>Secondary: <strong>{billingMetrics.secondary}</strong></span>
                        <span>CC Declines: <strong>{billingMetrics.ccDeclines}</strong></span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {canEdit && !isViewingBackup && (
              <div className="shrink-0 self-center flex items-center gap-3">
                <button
                  type="button"
                  onClick={exportCurrentSheetAsCsv}
                  disabled={isExportingCurrentSheet}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Download this sheet's current rows as a CSV — use this to take a manual backup before risky changes."
                >
                  {isExportingCurrentSheet ? 'Exporting…' : 'Download CSV'}
                </button>
                <button
                  type="button"
                  onClick={() => setExtraEmptyRows((n) => n + BILLING_SHEET_ROWS_STEP)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-medium"
                >
                  <span aria-hidden="true">+</span> Add {BILLING_SHEET_ROWS_STEP} rows
                </button>
              </div>
            )}
          </div>
        )
      )}

      {commentModal != null && createPortal(
        <div
          ref={commentModalContainerRef}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100]"
          onClick={(e) => e.target === e.currentTarget && commentTextareaRef.current?.focus()}
          onKeyDownCapture={(e) => e.stopPropagation()}
          onKeyUpCapture={(e) => e.stopPropagation()}
          onKeyPressCapture={(e) => e.stopPropagation()}
        >
          <div className="bg-slate-800/95 backdrop-blur-md rounded-lg p-6 w-full max-w-md border border-white/20 relative">
            <button
              type="button"
              onClick={() => { setCommentModal(null); setCommentText('') }}
              className="absolute top-4 right-4 p-1 rounded text-white/70 hover:text-white hover:bg-white/10"
              aria-label="Close"
            >
              <X size={20} />
            </button>
            <h2 className="text-xl font-bold text-white mb-2 pr-8">Comment</h2>
            <p className="text-sm text-white/70 mb-4">Cell: row {commentModal.row + 1}, column &quot;{commentModal.colKey}&quot;</p>
            {commentModalLoading ? (
              <p className="text-white/80">Loading...</p>
            ) : (
              <>
                <textarea
                  key={`comment-${commentModal.rowId}-${commentModal.colKey}-${commentModalLoading}`}
                  ref={commentTextareaRef}
                  defaultValue={commentText}
                  placeholder={canEditComment ? 'Enter your comment...' : 'No comment'}
                  readOnly={!canEditComment}
                  className={`w-full px-3 py-2 border border-white/20 rounded-md placeholder-white/50 min-h-[100px] ${canEditComment ? 'bg-white/10 text-white' : 'bg-white/5 text-white/90 cursor-default'}`}
                  rows={4}
                />
                <div className="mt-4 flex gap-3 justify-end">
                  {canEditComment && (
                    <>
                      <button
                        type="button"
                        disabled={!commentsMap.has(`${commentModal.rowId}:${commentModal.colKey}`)}
                        onClick={async () => {
                          await handleCellRemoveComment(commentModal.row, commentModal.col)
                          setCommentModal(null)
                          setCommentText('')
                        }}
                        className="px-4 py-2 text-red-400 border border-red-400/50 hover:bg-red-400/20 rounded-md disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveComment()}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResolveComment()}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700"
                      >
                        Resolve
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
