import { Provider, SheetRow, BillingCode, StatusColor, Patient, IsLockProviders } from '@/types'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { createBubbleDropdownRenderer, createMultiBubbleDropdownRenderer, MultiSelectCptEditor, DateOfServiceEditor, currencyCellRenderer, copayTextCellRenderer, coinsuranceTextCellRenderer } from '@/lib/handsontableCustomRenderers'
import { useCallback, useMemo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiClient } from '@/lib/apiClient'
import { useAuth } from '@/contexts/AuthContext'
import { toDisplayValue, toDisplayDate, parseDateOfServiceInput, toStoredString } from '@/lib/utils'
import { computeBillingMetrics } from '@/lib/billingMetrics'

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

function logProvidersTab(event: string, payload?: Record<string, unknown>) {
  if (payload) console.log(`[ProvidersTab] ${event}`, payload)
  else console.log(`[ProvidersTab] ${event}`)
}

const PROVIDER_GRID_DATE_FIELDS: (keyof SheetRow)[] = ['appointment_date', 'submit_date', 'payment_date', 'ar_date']

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
      else if (field === 'submit_date') next.submit_date = d
      else if (field === 'payment_date') next.payment_date = d
      else if (field === 'ar_date') next.ar_date = d
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

/** Clear patient ID + related columns after invalid “other provider” validation; `newId` is the row id (promote empty- → new- when needed). */
function sheetRowAfterInvalidOtherProviderPatient(baseRow: SheetRow, newId: string): SheetRow {
  return {
    ...baseRow,
    id: newId,
    patient_id: null,
    patient_first_name: null,
    patient_last_name: null,
    last_initial: null,
    patient_insurance: null,
    patient_copay: null,
    patient_coinsurance: null,
    updated_at: new Date().toISOString(),
  }
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
  onDeleteRow?: (providerId: string, rowId: string) => void
  onAddRowBelow?: (providerId: string, afterRowId: string) => void
  onAddRowAbove?: (providerId: string, beforeRowId: string) => void
  onPreviousMonth: () => void
  onNextMonth: () => void
  /** When clinicPayroll=2, second arg shows "January 1st Half" / "January 2nd Half". */
  formatMonthYear: (date: Date, payroll?: 1 | 2) => string
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
  /** When true, parent is showing backup override rows; always use props and do not prefer ref (so backup data displays after edits). */
  isViewingBackup?: boolean
  /** When viewing backup, a value that changes when the user selects a different version (e.g. version number), so the grid refreshes. */
  backupVersionKey?: number
  /** Bumped when patient table data changes; keeps Providers tab display in sync. */
  patientAssignmentRevision?: number
  /** Register a flush function to run before leaving Providers tab. */
  onRegisterFlushBeforeTabLeave?: (flush: () => Promise<void>) => void
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
  onDeleteRow,
  onAddRowBelow,
  onAddRowAbove,
  onPreviousMonth,
  onNextMonth,
  formatMonthYear,
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
  isViewingBackup = false,
  backupVersionKey = 0,
  patientAssignmentRevision = 0,
  onRegisterFlushBeforeTabLeave,
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
  const [isCondensed, setIsCondensed] = useState(false)
  const [arSumFromDb, setArSumFromDb] = useState<number | null>(null)
  /** Bumped to force Handsontable to resync from props (e.g. reject invalid patient_id for this provider). */
  const [structureVersion, setStructureVersion] = useState(0)
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null)
  const commentModalContainerRef = useRef<HTMLDivElement>(null)
  const hotInstanceRef = useRef<Handsontable | null>(null)

  const showCondenseButton = !officeStaffView && !isProviderView

  const providersToShow = providerId 
    ? providers.filter(p => p.id === providerId)
    : providers

  // Get rows for the first provider (or selected provider) to display in Handsontable
  const activeProvider = providersToShow.length > 0 ? providersToShow[0] : null
  const activeProviderRows = activeProvider ? filterRowsByMonth(providerSheetRows[activeProvider.id] || []) : []

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

  const handleProviderRowMove = useCallback((movedRows: number[], finalIndex: number) => {
    if (!activeProvider || !onReorderProviderRows) return
    onReorderProviderRows(activeProvider.id, movedRows, finalIndex)
  }, [activeProvider, onReorderProviderRows])

  // Ref for latest table data from change handler so we don't pass stale data when parent re-renders before state updates
  const latestTableDataRef = useRef<any[][] | null>(null)
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
  /** Snapshot before single-cell Patient ID edit; used to revert row if DB says ID belongs to another provider. */
  const pendingInvalidPatientRowRef = useRef<Map<number, SheetRow>>(new Map())
  /** Latest non-empty patient_id per row while typing (debounced validation). */
  const patientIdEditLatestPidRef = useRef<Map<number, string>>(new Map())
  const patientIdEditDebounceRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const patientIdDeferredQueueRef = useRef<Array<{ row: number; col: number | string; newVal: string }>>([])
  const patientIdFlushScheduledRef = useRef(false)
  const activeProviderRef = useRef(activeProvider)
  const clinicIdForValidationRef = useRef(clinicId)
  const isViewingBackupRef = useRef(isViewingBackup)
  activeProviderRef.current = activeProvider
  clinicIdForValidationRef.current = clinicId
  isViewingBackupRef.current = isViewingBackup

  const localRowsProviderKeyRef = useRef<string | null>(null)

  /** Column `data` for Patient ID is always 0 in this grid. */
  const isPatientIdSheetColumnProp = (prop: string | number): boolean =>
    prop === 0 || prop === '0' || Number(prop) === 0

  // Clear refs when provider/month changes, when parent refetched, or when viewing backup (so backup rows from props are used)
  useEffect(() => {
    latestTableDataRef.current = null
    latestProviderRowsRef.current = null
    localRowsProviderKeyRef.current = null
    coPatientDraftByIdKeyRef.current.clear()
    patientIdDeferredQueueRef.current = []
    patientIdFlushScheduledRef.current = false
    pendingPatientMergeByRowRef.current.clear()
    pendingInvalidPatientRowRef.current.clear()
    patientIdEditLatestPidRef.current.clear()
    for (const t of patientIdEditDebounceRef.current.values()) clearTimeout(t)
    patientIdEditDebounceRef.current.clear()
  }, [activeProvider?.id, selectedMonth.getTime(), providerRowsVersion, isViewingBackup])

  // Keep ref in sync for provider/month/backup so change handler and flush-on-unmount have correct key
  useEffect(() => {
    if (!activeProvider) return
    localRowsProviderKeyRef.current = `${activeProvider.id}-${selectedMonth.getTime()}`
  }, [activeProvider?.id, selectedMonth.getTime(), isViewingBackup])

  // Load persisted highlights and comments for this clinic (so they survive reload and show for providers)
  useEffect(() => {
    if (!clinicId) return
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

  const coPatientByIdKey = useMemo(() => {
    const m = new Map<string, Patient>()
    for (const p of patients) {
      const k = String(p.patient_id ?? '').trim().toLowerCase()
      if (k) m.set(k, p)
    }
    return m
  }, [patients])

  const isPatientAssignedToDifferentProvider = useCallback(
    (patientId: string, currentProviderId: string): boolean => {
      const key = String(patientId ?? '').trim().toLowerCase()
      if (!key) return false
      for (const [providerIdForRows, rows] of Object.entries(providerSheetRows)) {
        if (providerIdForRows === currentProviderId) continue
        const matchRow = (rows || []).find((row) => String(row.patient_id ?? '').trim().toLowerCase() === key)
        if (matchRow) {
          return true
        }
      }
      return false
    },
    [providerSheetRows]
  )

  const isPatientAssignedToDifferentProviderDb = useCallback(
    async (patientId: string, currentProviderId: string): Promise<boolean> => {
      const key = String(patientId ?? '').trim()
      if (!key || !clinicId) return false
      const month = selectedMonth.getMonth() + 1
      const year = selectedMonth.getFullYear()
      const payroll = clinicPayroll === 2 ? (selectedPayroll ?? 1) : 1

      const { data: otherSheets, error: otherSheetsError } = await apiClient
        .from('provider_sheets')
        .select('id, provider_id')
        .eq('clinic_id', clinicId)
        .eq('month', month)
        .eq('year', year)
        .eq('payroll', payroll)
        .neq('provider_id', currentProviderId)

      if (otherSheetsError) return isPatientAssignedToDifferentProvider(patientId, currentProviderId)

      const otherSheetIds = (otherSheets || []).map((s: { id: string }) => s.id)
      if (otherSheetIds.length === 0) return false

      const { data: duplicateRows, error: duplicateRowsError } = await apiClient
        .from('provider_sheet_rows')
        .select('id, sheet_id, patient_id')
        .in('sheet_id', otherSheetIds)
        .eq('patient_id', key)
        .limit(1)

      if (duplicateRowsError) return isPatientAssignedToDifferentProvider(patientId, currentProviderId)

      const hasDuplicate = Boolean(duplicateRows && duplicateRows.length > 0)
      return hasDuplicate
    },
    [clinicId, selectedMonth, clinicPayroll, selectedPayroll, isPatientAssignedToDifferentProvider]
  )

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

  // Map rows to Handsontable 2D array format (shared by getProviderRowsHandsontableData and change handler); never show "null"
  // When isProviderView and providerLevel 2, show full columns; when providerLevel 1, show only up to Appt/Note Status
  // When officeStaffView, show ID through Appt/Note Status (0-8) and Collected from PT through PT Payment AR Ref Date (14-16)
  const getTableDataFromRows = useCallback((rows: SheetRow[]) => {
    return rows.map(row => {
      const patientDisplay = toDisplayValue(row.patient_id)
      // Patient demographics on provider rows are sourced from `patients` by patient_id.
      const pidKey = String(row.patient_id ?? '').trim().toLowerCase()
      const coPatient = pidKey ? coPatientByIdKey.get(pidKey) : undefined
      const firstNameDisplay = toDisplayValue(
        coPatient ? coPatient.first_name : row.patient_first_name
      )
      const lastNameSource = coPatient ? coPatient.last_name : row.patient_last_name
      const lastInitialDisplay = toDisplayValue(
        lastNameSource ? String(lastNameSource).charAt(0) : row.last_initial
      )
      const insuranceDisplay = toDisplayValue(
        coPatient ? coPatient.insurance : row.patient_insurance
      )
      const copayDisplay = toDisplayValue(
        coPatient ? coPatient.copay : row.patient_copay
      )
      const coinsuranceDisplay = toDisplayValue(
        coPatient ? coPatient.coinsurance : row.patient_coinsurance
      )
      const visitTypeVal = () => row.visit_type === 'Telehealth'
      const insertVisitType = (arr: (string | number)[]) => showVisitTypeColumn ? [...arr.slice(0, 9), visitTypeVal(), ...arr.slice(9)] : arr
      if (officeStaffView) {
        const base = [
          patientDisplay,
          firstNameDisplay,
          lastInitialDisplay,
          insuranceDisplay,
          copayDisplay,
          coinsuranceDisplay,
          toDisplayDate(row.appointment_date),
          toDisplayValue(row.cpt_code),
          toDisplayValue(row.appointment_status),
          toDisplayValue(row.collected_from_patient),
          toDisplayValue(row.patient_pay_status),
          toDisplayValue(row.ar_date),
        ]
        return insertVisitType(base) as (string | number)[]
      }
      if (isProviderView && providerLevel !== 2) {
        const base = [
          patientDisplay,
          firstNameDisplay,
          lastInitialDisplay,
          insuranceDisplay,
          copayDisplay,
          coinsuranceDisplay,
          toDisplayDate(row.appointment_date),
          toDisplayValue(row.cpt_code),
          toDisplayValue(row.appointment_status),
        ]
        return insertVisitType(base) as (string | number)[]
      }
      if (isProviderView && providerLevel === 2) {
        const base = [
          patientDisplay,
          firstNameDisplay,
          lastInitialDisplay,
          insuranceDisplay,
          copayDisplay,
          coinsuranceDisplay,
          toDisplayDate(row.appointment_date),
          toDisplayValue(row.cpt_code),
          toDisplayValue(row.appointment_status),
          toDisplayValue(row.claim_status),
          toDisplayValue(row.submit_date),
          toDisplayValue(row.insurance_payment),
          toDisplayValue(row.payment_date),
          toDisplayValue(row.insurance_adjustment),
          toDisplayValue(row.collected_from_patient),
          toDisplayValue(row.patient_pay_status),
          toDisplayValue(row.ar_date),
          toDisplayValue(row.total),
          toDisplayValue(row.notes),
        ]
        return insertVisitType(base) as (string | number)[]
      }
      const fullRow = [
        patientDisplay,
        firstNameDisplay,
        lastInitialDisplay,
        insuranceDisplay,
        copayDisplay,
        coinsuranceDisplay,
        toDisplayDate(row.appointment_date),
        toDisplayValue(row.cpt_code),
        toDisplayValue(row.appointment_status),
        toDisplayValue(row.claim_status),
        toDisplayValue(row.submit_date),
        toDisplayValue(row.insurance_payment),
        toDisplayValue(row.payment_date),
        toDisplayValue(row.insurance_adjustment),
        toDisplayValue(row.collected_from_patient),
        toDisplayValue(row.patient_pay_status),
        toDisplayValue(row.ar_date),
        toDisplayValue(row.total),
        toDisplayValue(row.notes),
      ]
      const withVisitType = insertVisitType(fullRow) as (string | number)[]
      if (showCondenseButton && isCondensed) return withVisitType.slice(0, showVisitTypeColumn ? 10 : 9)
      return withVisitType
    })
  }, [isProviderView, providerLevel, officeStaffView, showCondenseButton, isCondensed, showVisitTypeColumn, coPatientByIdKey])

  // Convert rows to Handsontable data format; prefer latest from change handler, then props, to avoid losing typed data when parent re-renders after load (like PatientsTab).
  // When viewing backup, always use backup rows from props. When not viewing backup and ref is null, use props (activeProviderRows) so "Back to current" shows current data immediately instead of stale local state.
  const getProviderRowsHandsontableData = useCallback(() => {
    if (!activeProvider) return []
    if (isViewingBackup) return getTableDataFromRows(activeProviderRows)
    if (latestTableDataRef.current != null) return latestTableDataRef.current
    return getTableDataFromRows(activeProviderRows)
  }, [activeProvider, activeProviderRows, getTableDataFromRows, isViewingBackup])

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
    if (showCondenseButton && isCondensed) return fieldsFull.slice(0, showVisitTypeColumn ? 10 : 9) as Array<keyof SheetRow>
    return fieldsFull
  }, [officeStaffView, isProviderView, providerLevel, showCondenseButton, isCondensed, showVisitTypeColumn])

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

  // Accounts receivable total from accounts_receivables table for the selected month (clinic-level)
  useEffect(() => {
    if (!clinicId) {
      setArSumFromDb(null)
      return
    }
    const y = selectedMonth.getFullYear()
    const m = selectedMonth.getMonth()
    const firstDay = `${y}-${String(m + 1).padStart(2, '0')}-01`
    const lastDay = new Date(y, m + 1, 0)
    const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`

    let cancelled = false
    setArSumFromDb(null)
    apiClient
      .from('accounts_receivables')
      .select('amount')
      .eq('clinic_id', clinicId)
      .gte('date_recorded', firstDay)
      .lte('date_recorded', lastDayStr)
      .then(({ data, error }) => {
        if (cancelled || error) {
          if (!cancelled && error) console.error('Fetch accounts_receivables sum:', error)
          return
        }
        const sum = (data || []).reduce((acc, row) => acc + (Number(row?.amount) || 0), 0)
        if (!cancelled) setArSumFromDb(sum)
      })
    return () => { cancelled = true }
  }, [clinicId, selectedMonth])

  // Billing metrics (visits, no shows, paid claims, etc.) for the selected month – admin/billing only
  const billingMetrics = useMemo(() => {
    if (isProviderView) return null
    return computeBillingMetrics(activeProviderRows)
  }, [activeProviderRows, isProviderView])

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

  // Column field names mapping to is_lock_providers table columns (visit_type is optional, not in IsLockProviders)
  const columnFieldsFullBase: Array<keyof IsLockProviders> = [
    'patient_id', 'first_name', 'last_initial', 'insurance', 'copay', 'coinsurance',
    'date_of_service', 'cpt_code', 'appointment_note_status', 'claim_status',
    'most_recent_submit_date', 'ins_pay', 'ins_pay_date', 'pt_res', 'collected_from_pt',
    'pt_pay_status', 'pt_payment_ar_ref_date', 'total', 'notes'
  ]
  const columnTitlesFullBase = [
    'ID', 'First Name', 'LI', 'Insurance', 'Co-pay', 'Co-Ins',
    'Date of Service', 'CPT Code', 'Appt/Note Status', 'Claim Status', 'Most Recent Submit Date',
    'Ins Pay', 'Ins Pay Date', 'PT RES', 'Collected from PT', 'PT Pay Status',
    'PT Payment AR Ref Date', 'Total', 'Notes'
  ]
  const columnFieldsFull = showVisitTypeColumn
    ? ([...columnFieldsFullBase.slice(0, 9), 'visit_type', ...columnFieldsFullBase.slice(9)] as string[])
    : columnFieldsFullBase
  const columnTitlesFull = showVisitTypeColumn
    ? [...columnTitlesFullBase.slice(0, 9), 'Visit Type', ...columnTitlesFullBase.slice(9)]
    : columnTitlesFullBase
  const columnFieldsProviderView = showVisitTypeColumn
    ? (['patient_id', 'first_name', 'last_initial', 'insurance', 'copay', 'coinsurance', 'date_of_service', 'cpt_code', 'appointment_note_status', 'visit_type'] as const)
    : (['patient_id', 'first_name', 'last_initial', 'insurance', 'copay', 'coinsurance', 'date_of_service', 'cpt_code', 'appointment_note_status'] as const)
  const columnTitlesProviderView = showVisitTypeColumn
    ? ['ID', 'First Name', 'LI', 'Insurance', 'Co-pay', 'Co-Ins', 'Date of Service', 'CPT Code', 'Appt/Note Status', 'Visit Type']
    : ['ID', 'First Name', 'LI', 'Insurance', 'Co-pay', 'Co-Ins', 'Date of Service', 'CPT Code', 'Appt/Note Status']
  const columnFieldsOfficeStaffBase: Array<keyof IsLockProviders> = [
    'patient_id', 'first_name', 'last_initial', 'insurance', 'copay', 'coinsurance',
    'date_of_service', 'cpt_code', 'appointment_note_status',
    'collected_from_pt', 'pt_pay_status', 'pt_payment_ar_ref_date'
  ]
  const columnFieldsOfficeStaff = showVisitTypeColumn
    ? ([...columnFieldsOfficeStaffBase.slice(0, 9), 'visit_type', ...columnFieldsOfficeStaffBase.slice(9)] as string[])
    : columnFieldsOfficeStaffBase
  const columnTitlesOfficeStaffBase = [
    'ID', 'First Name', 'LI', 'Insurance', 'Co-pay', 'Co-Ins',
    'Date of Service', 'CPT Code', 'Appt/Note Status',
    'Collected from PT', 'PT Pay Status', 'PT Payment AR Ref Date'
  ]
  const columnTitlesOfficeStaff = showVisitTypeColumn
    ? [...columnTitlesOfficeStaffBase.slice(0, 9), 'Visit Type', ...columnTitlesOfficeStaffBase.slice(9)]
    : columnTitlesOfficeStaffBase
  const columnFields = officeStaffView
    ? columnFieldsOfficeStaff
    : isProviderView
      ? (providerLevel === 2 ? columnFieldsFull : columnFieldsProviderView)
      : (showCondenseButton && isCondensed ? columnFieldsFull.slice(0, 9) : columnFieldsFull)
  const columnTitles = officeStaffView
    ? columnTitlesOfficeStaff
    : isProviderView
      ? (providerLevel === 2 ? columnTitlesFull : columnTitlesProviderView)
      : (showCondenseButton && isCondensed ? columnTitlesFull.slice(0, 9) : columnTitlesFull)

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

  const afterGetProviderColHeader = useCallback(
    (col: number, TH: HTMLTableCellElement, headerLevel?: number) => {
      if (headerLevel != null && headerLevel !== 0) return
      TH.querySelector('.providers-col-header-lock-wrap')?.remove()
      if (col < 0) return
      const field = columnFields[col] as string | undefined
      if (!field || field === 'visit_type') return
      if (!lockData || !lockData[field as keyof IsLockProviders]) return
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
    [columnFields, lockData, lockIconSrc]
  )

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

    let timeoutId: NodeJS.Timeout | null = null
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
      const colKey = columnFields[col]
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
    [activeProviderRows, columnFields, highlightedCells, highlightColorByKey, commentsMap, resolvedCells, userHighlightColor]
  )

  // Tooltip for cells with comments (e.g. on provider side when hovering)
  const getCellTitle = useCallback(
    (row: number, col: number) => {
      const sheetRow = activeProviderRows[row]
      const colKey = columnFields[col]
      if (!colKey) return undefined
      const key = `${sheetRow?.id ?? `row-${row}`}:${colKey}`
      return commentsMap.get(key) ?? undefined
    },
    [activeProviderRows, columnFields, commentsMap]
  )

  const handleCellRemoveComment = useCallback(
    async (row: number, col: number) => {
      if (!clinicId) return
      const sheetRow = activeProviderRows[row]
      const colKey = columnFields[col]
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
    [activeProviderRows, columnFields, clinicId]
  )

  const getCellIsHighlighted = useCallback(
    (row: number, col: number) => {
      const sheetRow = activeProviderRows[row]
      const colKey = columnFields[col]
      if (!colKey) return false
      const key = `${sheetRow?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key)
    },
    [activeProviderRows, columnFields, highlightedCells]
  )

  const handleCellHighlight = useCallback(async (row: number, col: number) => {
    if (!clinicId) return
    const sheetRow = activeProviderRows[row]
    const colKey = columnFields[col]
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
  }, [activeProviderRows, columnFields, clinicId, highlightedCells, userHighlightColor, userProfile?.id])

  const handleCellSeeComment = useCallback((row: number, col: number) => {
    if (!clinicId) return
    const sheetRow = activeProviderRows[row]
    const colKey = columnFields[col]
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
  }, [activeProviderRows, columnFields, commentsMap, clinicId])

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
        { data: 7, title: 'CPT Code', type: 'dropdown' as const, width: 160, editor: MultiSelectCptEditor, selectOptions: billingCodes.map(c => c.code), renderer: createMultiBubbleDropdownRenderer((val) => getCPTColor(val)) as any, readOnly: getReadOnlyForColumn(7, !canEdit || getReadOnly('cpt_code')) },
        ...(visitTypeCol ? [visitTypeCol(getReadOnlyForColumn(9, !canEdit))] : []),
        { data: 8, title: 'Appt/Note Status', type: 'dropdown' as const, width: 90, selectOptions: ['Complete', 'PP Complete', 'NS/LC - Charge', 'NS/LC/RS - No Charge', 'NS/LC - No Charge', 'Note Not Complete'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'appointment')) as any, readOnly: getReadOnlyForColumn(8, !canEdit || getReadOnly('appointment_note_status')) },
        { data: 9 + officeStaffColOffset, title: 'Collected from PT', type: 'numeric' as const, width: 120, renderer: currencyCellRenderer, readOnly: getReadOnlyForColumn(9 + officeStaffColOffset, !canEdit || getReadOnly('collected_from_pt')) },
        { data: 10 + officeStaffColOffset, title: 'PT Pay Status', type: 'dropdown' as const, width: 120, selectOptions: ['Paid', 'CC declined', 'Secondary', 'Refunded', 'Payment Plan', 'Waiting on Claim', 'Collections'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'patient_pay')) as any, readOnly: getReadOnlyForColumn(10 + officeStaffColOffset, !canEdit || getReadOnly('pt_pay_status')) },
        { data: 11 + officeStaffColOffset, title: 'PT Payment AR Ref Date', type: 'dropdown' as const, width: 120, selectOptions: months, renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any, readOnly: getReadOnlyForColumn(11 + officeStaffColOffset, !canEdit || getReadOnly('pt_payment_ar_ref_date')) },
      ]
      return base
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
        { data: 6, title: 'Date of Service', type: 'text' as const, width: 90, editor: DateOfServiceEditor, readOnly: getReadOnlyProviderView(6) },
        { data: 7, title: 'CPT Code', type: 'dropdown' as const, width: 160, editor: MultiSelectCptEditor, selectOptions: billingCodes.map(c => c.code), renderer: createMultiBubbleDropdownRenderer((val) => getCPTColor(val)) as any, readOnly: getReadOnlyProviderView(7) },
        ...(visitTypeCol ? [visitTypeCol(getReadOnlyProviderView(9))] : []),
        { data: 8, title: 'Appt/Note Status', type: 'dropdown' as const, width: 90, selectOptions: ['Complete', 'PP Complete', 'NS/LC - Charge', 'NS/LC/RS - No Charge', 'NS/LC - No Charge', 'Note Not Complete'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'appointment')) as any, readOnly: getReadOnlyProviderView(8) },
      ]
      return base
    }
    if (isProviderView && providerLevel === 2) {
      return [
        { data: 0, title: 'ID', type: 'text' as const, width: 60, readOnly: getReadOnlyProviderView(0) || getReadOnly('patient_id') },
        { data: 1, title: 'First Name', type: 'text' as const, width: 90, readOnly: true },
        { data: 2, title: 'LI', type: 'text' as const, width: 40, readOnly: true },
        { data: 3, title: 'Ins', type: 'text' as const, width: 90, readOnly: true },
        { data: 4, title: 'Co-pay', type: 'text' as const, width: 80, renderer: copayTextCellRenderer, readOnly: true },
        { data: 5, title: 'Co-Ins', type: 'text' as const, width: 80, renderer: coinsuranceTextCellRenderer, readOnly: true },
        { data: 6, title: 'Date of Service', type: 'text' as const, width: 90, editor: DateOfServiceEditor, readOnly: getReadOnlyProviderView(6) },
        { data: 7, title: 'CPT Code', type: 'dropdown' as const, width: 160, editor: MultiSelectCptEditor, selectOptions: billingCodes.map(c => c.code), renderer: createMultiBubbleDropdownRenderer((val) => getCPTColor(val)) as any, readOnly: getReadOnlyProviderView(7) },
        ...(visitTypeCol ? [visitTypeCol(getReadOnlyProviderView(9))] : []),
        { data: 8, title: 'Appt/Note Status', type: 'dropdown' as const, width: 90, selectOptions: ['Complete', 'PP Complete', 'NS/LC - Charge', 'NS/LC/RS - No Charge', 'NS/LC - No Charge', 'Note Not Complete'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'appointment')) as any, readOnly: getReadOnlyProviderView(8) },
        { data: 9 + pvOffset, title: 'Claim Status', type: 'dropdown' as const, width: 90, selectOptions: ['Claim Sent', 'RS', 'IP', 'Pending Pay', 'Paid', 'Deductible', 'N/A', 'PP', 'Denial', 'Rejected', 'No Coverage'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'claim')) as any, readOnly: getReadOnlyProviderView(9) },
        { data: 10 + pvOffset, title: 'Most Recent Submit Date', type: 'text' as const, width: 120, editor: 'text', readOnly: getReadOnlyProviderView(10) },
        { data: 11 + pvOffset, title: 'Ins Pay', type: 'numeric' as const, width: 100, renderer: currencyCellRenderer, readOnly: getReadOnlyProviderView(11) },
        { data: 12 + pvOffset, title: 'Ins Pay Date', type: 'dropdown' as const, width: 100, selectOptions: months, renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any, readOnly: getReadOnlyProviderView(12) },
        { data: 13 + pvOffset, title: 'PT RES', type: 'numeric' as const, width: 100, renderer: currencyCellRenderer, readOnly: getReadOnlyProviderView(13) },
        { data: 14 + pvOffset, title: 'Collected from PT', type: 'numeric' as const, width: 120, renderer: currencyCellRenderer, readOnly: getReadOnlyProviderView(14) },
        { data: 15 + pvOffset, title: 'PT Pay Status', type: 'dropdown' as const, width: 120, selectOptions: ['Paid', 'CC declined', 'Secondary', 'Refunded', 'Payment Plan', 'Waiting on Claim', 'Collections'], renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'patient_pay')) as any, readOnly: getReadOnlyProviderView(15) },
        { data: 16 + pvOffset, title: 'PT Payment AR Ref Date', type: 'dropdown' as const, width: 120, selectOptions: months, renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any, readOnly: getReadOnlyProviderView(16) },
        { data: 17 + pvOffset, title: 'Total', type: 'numeric' as const, width: 100, renderer: currencyCellRenderer, readOnly: getReadOnlyProviderView(17) },
        { data: 18 + pvOffset, title: 'Notes', type: 'text' as const, width: 150, readOnly: getReadOnlyProviderView(18) },
      ]
    }
    
    const fullProviderColumns = [
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
        renderer: createMultiBubbleDropdownRenderer((val) => getCPTColor(val)) as any,
        readOnly: getReadOnlyForColumn(7, !canEdit || getReadOnly('cpt_code'))
      },
      ...(visitTypeCol ? [visitTypeCol(getReadOnlyForColumn(9, !canEdit))] : []),
      { 
        data: 8, 
        title: 'Appt/Note Status', 
        type: 'dropdown' as const, 
        width: 90,
        selectOptions: ['Complete', 'PP Complete', 'NS/LC - Charge', 'NS/LC/RS - No Charge', 'NS/LC - No Charge', 'Note Not Complete'],
        renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'appointment')) as any,
        readOnly: getReadOnlyForColumn(8, !canEdit || getReadOnly('appointment_note_status'))
      },
      { 
        data: 9 + (showVisitTypeColumn ? 1 : 0), 
        title: 'Claim Status', 
        type: 'dropdown' as const, 
        width: 90,
        selectOptions: ['Claim Sent', 'RS', 'IP', 'Pending Pay', 'Paid', 'Deductible', 'N/A', 'PP', 'Denial', 'Rejected', 'No Coverage'],
        renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'claim')) as any,
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
        type: 'numeric' as const, 
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
        renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any,
        readOnly: getReadOnlyForColumn(12 + (showVisitTypeColumn ? 1 : 0), !canEdit || getReadOnly('ins_pay_date'))
      },
      { 
        data: 13 + (showVisitTypeColumn ? 1 : 0), 
        title: 'PT RES', 
        type: 'numeric' as const, 
        width: 100,
        renderer: currencyCellRenderer,
        readOnly: getReadOnlyForColumn(13 + (showVisitTypeColumn ? 1 : 0), !canEdit || getReadOnly('pt_res'))
      },
      { 
        data: 14 + (showVisitTypeColumn ? 1 : 0), 
        title: 'PT Paid', 
        type: 'numeric' as const, 
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
        renderer: createBubbleDropdownRenderer((val) => getStatusColor(val, 'patient_pay')) as any,
        readOnly: getReadOnlyForColumn(15 + (showVisitTypeColumn ? 1 : 0), !canEdit || getReadOnly('pt_pay_status'))
      },
      { 
        data: 16 + (showVisitTypeColumn ? 1 : 0), 
        title: 'PT Payment AR Ref Date', 
        type: 'dropdown' as const, 
        width: 120,
        selectOptions: months,
        renderer: createBubbleDropdownRenderer((val) => getMonthColor(val)) as any,
        readOnly: getReadOnlyForColumn(16 + (showVisitTypeColumn ? 1 : 0), !canEdit || getReadOnly('pt_payment_ar_ref_date'))
      },
      { 
        data: 17 + (showVisitTypeColumn ? 1 : 0), 
        title: 'Total', 
        type: 'numeric' as const, 
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
    ]
    return (showCondenseButton && isCondensed) ? fullProviderColumns.slice(0, showVisitTypeColumn ? 10 : 9) : fullProviderColumns
  }, [activeProvider, clinicPayroll, billingCodes, statusColors, getCPTColor, getStatusColor, getMonthColor, patients, canEdit, lockData, getReadOnly, isProviderView, providerLevel, officeStaffView, showCondenseButton, isCondensed, showVisitTypeColumn, restrictEditToSchedulingColumns])

  // Before Handsontable applies edits: non-empty patient_id values are deferred — we revert the cell in this hook,
  // then validate against the patients table in DB and only then setDataAtCell(..., 'patientIdDbValidated').
  // This prevents any patient demographics from appearing when the ID belongs to another provider.
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
                void (async () => {
                  const { data, error } = await apiClient.from('patients').select('*').eq('clinic_id', cid)
                  if (error) {
                    console.error('[ProvidersTab] patient ID validation (DB) failed', error)
                    return
                  }
                  const byKey = new Map<string, Patient>()
                  for (const p of data || []) {
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
                    const duplicateInOtherProvider = await isPatientAssignedToDifferentProviderDb(newVal, ap.id)
                    if (duplicateInOtherProvider) {
                      pendingPatientMergeByRowRef.current.set(row, null)
                      try {
                        hot.setDataAtCell(row, col as number, null, 'revertInvalidPatientId')
                        window.alert('This patient is already assigned to another provider')
                      } catch (e) {
                        console.error('[ProvidersTab] setDataAtCell after patient assignment validation failed', e)
                      }
                      continue
                    }
                    pendingPatientMergeByRowRef.current.set(row, rec ?? null)
                    try {
                      hot.setDataAtCell(row, col as number, newVal, 'patientIdDbValidated')
                    } catch (e) {
                      console.error('[ProvidersTab] setDataAtCell after patient ID validation failed', e)
                    }
                  }
                })()
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
  }, [showVisitTypeColumn, isViewingBackup, isPatientAssignedToDifferentProviderDb])

  const handleProviderRowsHandsontableChange = useCallback((changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes || source === 'loadData' || !activeProvider) return

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
    const fields: Array<keyof SheetRow> = officeStaffView
      ? fieldsOfficeStaff
      : isProviderView
        ? (providerLevel === 2 ? fieldsFull : fieldsProviderView)
        : (showCondenseButton && isCondensed ? fieldsFull.slice(0, showVisitTypeColumn ? 10 : 9) : fieldsFull)
    
    const dateFields: (keyof SheetRow)[] = ['appointment_date', 'submit_date', 'payment_date', 'ar_date']
    // Start from latest ref when same provider so rapid edits accumulate (parent state may not have updated yet)
    const baseRows = (latestProviderRowsRef.current?.providerId === activeProvider.id)
      ? latestProviderRowsRef.current.rows
      : activeProviderRows

    const updatedRows = [...baseRows]
    let idCounter = 0
    let hadPatientIdMerge = false
    let hadPatientIdClear = false
    let hadRejectedPatientId = false
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
            pendingInvalidPatientRowRef.current.delete(row)
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
          if (String(source) === 'revertInvalidPatientId') {
            pendingInvalidPatientRowRef.current.delete(row)
            hadRejectedPatientId = true
            hadPatientIdClear = true
            updatedRows[row] = sheetRowAfterInvalidOtherProviderPatient(sheetRow, newId)
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
          // Normal typing / single-cell edit: keep patient_id in the row; debounce async DB validation (batch paste uses beforeChange defer).
          patientIdEditLatestPidRef.current.set(row, patientIdOrNull)
          if (!pendingInvalidPatientRowRef.current.has(row)) {
            pendingInvalidPatientRowRef.current.set(row, JSON.parse(JSON.stringify(sheetRow)) as SheetRow)
          }
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
              void (async () => {
                const ap = activeProviderRef.current
                const clinic = clinicIdForValidationRef.current
                if (!ap || !clinic || ap.id !== apIdForDebounce || isViewingBackupRef.current) return
                const pidRaw = patientIdEditLatestPidRef.current.get(row)?.trim()
                if (!pidRaw) return
                const key = pidRaw.toLowerCase()

                const { data, error } = await apiClient.from('patients').select('*').eq('clinic_id', clinic)
                if (error) {
                  console.error('[ProvidersTab] patient ID validation (edit) failed', error)
                  return
                }
                const duplicateInOtherProvider = await isPatientAssignedToDifferentProviderDb(pidRaw, ap.id)
                if (duplicateInOtherProvider) {
                  try {
                    hotInstanceRef.current?.setDataAtCell(row, 0, null, 'revertInvalidPatientId')
                  } catch (e) {
                    console.error('[ProvidersTab] failed to revert duplicate patient id after DB check', e)
                  }
                  window.alert('This patient is already assigned to another provider')
                  return
                }
                const rec =
                  (data || []).find((p) => String(p.patient_id ?? '').trim().toLowerCase() === key) ?? null

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
                pendingProviderSheetSaveRef.current = { providerId: ap.id, rows: cur }
                pendingInvalidPatientRowRef.current.delete(row)
                onSaveProviderSheetRowsDirectRef.current(ap.id, cur).catch((e) =>
                  console.error('[ProvidersTab] save after patient id merge (edit)', e)
                )
                setStructureVersion((v) => v + 1)
              })()
            }, 350)
          )
          return
        } else if (field === 'patient_copay' || field === 'patient_coinsurance') {
          const strValue = (newValue === '' || newValue === null || newValue === 'null' || newValue === undefined) ? null : String(newValue)
          updatedRows[row] = { ...sheetRow, id: newId, [field]: strValue, updated_at: new Date().toISOString() } as SheetRow
          setDraftFromRow(updatedRows[row] as SheetRow)
        } else if (field === 'total') {
          const numValue = (newValue === '' || newValue === null || newValue === 'null') ? null : (typeof newValue === 'number' ? newValue : parseFloat(String(newValue)) || null)
          updatedRows[row] = { ...sheetRow, id: newId, [field]: numValue, updated_at: new Date().toISOString() } as SheetRow
        } else if (field === 'insurance_payment' || field === 'collected_from_patient') {
          hadTotalAutoUpdate = true
          const numValue = (newValue === '' || newValue === null || newValue === 'null' || newValue === undefined) ? null : (typeof newValue === 'number' ? newValue : parseFloat(String(newValue)))
          const insPay = field === 'insurance_payment' ? (numValue ?? NaN) : parseFloat(String(sheetRow.insurance_payment ?? '')) || 0
          const collected = field === 'collected_from_patient' ? (numValue ?? NaN) : parseFloat(String(sheetRow.collected_from_patient ?? '')) || 0
          const totalSum = (Number.isFinite(insPay) ? insPay : 0) + (Number.isFinite(collected) ? collected : 0)
          updatedRows[row] = {
            ...sheetRow,
            id: newId,
            [field]: numValue ?? null,
            total: String(totalSum),
            updated_at: new Date().toISOString(),
          } as SheetRow
        } else if (field === 'appointment_date') {
          hadDateColumnEdit = true
          const value = (newValue === '' || newValue === 'null') ? null : parseDateOfServiceInput(String(newValue))
          updatedRows[row] = { ...sheetRow, id: newId, [field]: value, updated_at: new Date().toISOString() } as SheetRow
        } else if (field === 'appointment_status') {
          // Only accept valid dropdown options; reject boolean/"true"/"false" (can appear when fill/drag copies from Visit Type column)
          const validStatuses = ['Complete', 'PP Complete', 'NS/LC - Charge', 'NS/LC/RS - No Charge', 'NS/LC - No Charge', 'Note Not Complete']
          if (newValue === true || newValue === false || newValue === 'true' || newValue === 'false') return
          const strVal = (newValue === '' || newValue === 'null') ? null : String(newValue)
          if (strVal !== null && !validStatuses.includes(strVal)) return
          updatedRows[row] = { ...sheetRow, id: newId, [field]: strVal, updated_at: new Date().toISOString() } as SheetRow
        } else if (field === 'visit_type') {
          const value = newValue === true ? 'Telehealth' : 'In-person'
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
      // Auto highlight when 0 or "00" is entered in Ins Pay or PT Paid (Collected from PT). PT Paid: any 0 → yellow. Ins Pay: 0 → user color.
      if (field === 'insurance_payment' || field === 'collected_from_patient') {
        const finalRow = updatedRows[row]
        const rowId = finalRow?.id ?? sheetRow?.id ?? `row-${row}`
        const colKey = field === 'insurance_payment' ? 'ins_pay' : 'collected_from_pt'
        const num = (newValue === '' || newValue === null || newValue === undefined) ? null : (typeof newValue === 'number' ? newValue : parseFloat(String(newValue)))
        const isZero = num === 0
        const highlightColor = (userHighlightColor || '').trim() || YELLOW_HIGHLIGHT
        // PT Paid (collected_from_patient): 0 or "0" or "00" → yellow. Ins Pay: 0 → user color.
        const useYellow = field === 'collected_from_patient' && isZero
        const colorToUse = isZero ? (useYellow ? YELLOW_HIGHLIGHT : highlightColor) : highlightColor
        zeroHighlightUpdates.push({ rowId, colKey, isZero, highlightColor: colorToUse })
      }
    })

    // Remove rows whose patient_id was cleared and notify parent
    const uniqueDeleteIds = [...new Set(deleteRowIds)]
    if (uniqueDeleteIds.length > 0 && onDeleteRow) {
      for (let i = updatedRows.length - 1; i >= 0; i--) {
        if (uniqueDeleteIds.includes(updatedRows[i].id)) {
          onDeleteRow(activeProvider.id, updatedRows[i].id)
          updatedRows.splice(i, 1)
        }
      }
    }

    // Only pad to 200 when under 200 (allow more than 200 rows)
    if (updatedRows.length < 200) {
      const emptyRowsNeeded = 200 - updatedRows.length
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
    latestProviderRowsRef.current = { providerId: activeProvider.id, rows: updatedRows }
    if (hadRejectedPatientId) {
      // Ensure grid redraw uses reverted data immediately (without waiting for any save path).
      latestTableDataRef.current = null
    }

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
    logProvidersTab('pending save scheduled', {
      providerId: activeProvider.id,
      rows: updatedRows.length,
      source,
      changedCells: changes.length,
    })
    if (saveProviderSheetTimeoutRef.current) clearTimeout(saveProviderSheetTimeoutRef.current)
    // 400ms: patient_id merge from DB runs at 350ms; saving sooner could persist rows before demographics are merged on the row object.
    saveProviderSheetTimeoutRef.current = setTimeout(() => {
      saveProviderSheetTimeoutRef.current = null
      const pending = pendingProviderSheetSaveRef.current
      if (pending) {
        pendingProviderSheetSaveRef.current = null
        logProvidersTab('debounced save firing', {
          providerId: pending.providerId,
          rows: pending.rows.length,
        })
        onSaveProviderSheetRowsDirect(pending.providerId, pending.rows).catch(err => {
          console.error('[handleProviderRowsHandsontableChange] Error in saveProviderSheetRowsDirect:', err)
        })
      }
    }, 400)

    // When patient_id was merged or cleared, a date column was edited, total was auto-calculated, or a row was deleted,
    // bump so HandsontableWrapper pushes the ref data to the grid (wrapper only updates on dataVersion/length change).
    if (hadPatientIdMerge || hadPatientIdClear || hadDateColumnEdit || hadTotalAutoUpdate || uniqueDeleteIds.length > 0) {
      setStructureVersion((v) => v + 1)
    }
  }, [activeProvider, activeProviderRows, onUpdateProviderSheetRow, onReplaceProviderSheetRows, onSaveProviderSheetRowsDirect, onDeleteRow, isProviderView, providerLevel, officeStaffView, showCondenseButton, isCondensed, showVisitTypeColumn, patients, getTableDataFromRows, clinicId, userHighlightColor, userProfile?.id, isPatientAssignedToDifferentProviderDb])

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
          latestProviderRowsRef.current = null
          setStructureVersion((v) => v + 1)
        }
      } else if (source === 'ContextMenu.rowBelow' && onAddRowBelow) {
        const afterIdx = index - 1
        const afterId = afterIdx >= 0 ? rows[afterIdx]?.id : undefined
        if (afterId) {
          onAddRowBelow(activeProvider.id, afterId)
          latestTableDataRef.current = null
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
      removed.forEach((r) => {
        if (r.id.startsWith('empty-') || r.id.startsWith('new-')) return
        if (onDeleteRow) onDeleteRow(activeProvider.id, r.id)
      })
      latestTableDataRef.current = null
      latestProviderRowsRef.current = null
      setStructureVersion((v) => v + 1)
    },
    [canEdit, activeProvider, activeProviderRows, onDeleteRow]
  )

  const syncProvidersFromHotAfterUndoRedo = useCallback(() => {
    const hot = hotInstanceRef.current as (Handsontable & { isDestroyed?: boolean }) | null
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
      if (merged.length < 200) {
        const emptyRowsNeeded = 200 - merged.length
        const existingEmptyCount = merged.filter((r) => r.id.startsWith('empty-')).length
        for (let i = 0; i < emptyRowsNeeded; i++) {
          merged.push(createEmptySheetRowForSync(activeProvider.id, existingEmptyCount + i))
        }
      }
      latestProviderRowsRef.current = { providerId: activeProvider.id, rows: merged }
      latestTableDataRef.current = getTableDataFromRows(merged)
      pendingProviderSheetSaveRef.current = { providerId: activeProvider.id, rows: merged }
      logProvidersTab('undo/redo immediate save', {
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
      if (saveProviderSheetTimeoutRef.current) {
        clearTimeout(saveProviderSheetTimeoutRef.current)
        saveProviderSheetTimeoutRef.current = null
      }
      const pending = pendingProviderSheetSaveRef.current
      const latest = latestProviderRowsRef.current
      const providerIdToSave = pending?.providerId ?? latest?.providerId
      const rowsToSave = (latest?.providerId === providerIdToSave && latest?.rows?.length)
        ? latest.rows
        : pending?.rows
      if (providerIdToSave && rowsToSave?.length) {
        pendingProviderSheetSaveRef.current = null
        latestProviderRowsRef.current = null
        logProvidersTab('unmount flush save', {
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
      if (saveProviderSheetTimeoutRef.current) {
        clearTimeout(saveProviderSheetTimeoutRef.current)
        saveProviderSheetTimeoutRef.current = null
      }
      const pending = pendingProviderSheetSaveRef.current
      const latest = latestProviderRowsRef.current
      const providerIdToSave = pending?.providerId ?? latest?.providerId
      const rowsToSave = (latest?.providerId === providerIdToSave && latest?.rows?.length)
        ? latest.rows
        : pending?.rows
      if (!providerIdToSave || !rowsToSave?.length) return
      pendingProviderSheetSaveRef.current = null
      await onSaveProviderSheetRowsDirectRef.current(providerIdToSave, rowsToSave)
    }
    onRegisterFlushBeforeTabLeave(flush)
  }, [onRegisterFlushBeforeTabLeave])

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
  }, [activeProvider, providerColumnsWithLocks, isProviderView, officeStaffView, showCondenseButton, isCondensed])

  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState(isInSplitScreen ? 400 : 600)
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
    <div 
      className="p-6" 
      style={isInSplitScreen ? { width: '100%', overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } : {}}
    >
      {/* <h1 className="text-3xl font-bold text-white">{activeProvider?.first_name} {activeProvider?.last_name}</h1> */}
      {/* month selector - background color from status_colors (month type), like Ins Pay Date column */}
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
              onClick={onPreviousMonth}
              className="absolute left-0 p-2 hover:opacity-80 rounded-lg transition-opacity"
              style={{ color: textColor }}
              title="Previous month"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="text-lg font-semibold min-w-[200px] text-center">
              {formatMonthYear(selectedMonth, clinicPayroll === 2 ? selectedPayroll : undefined)}
            </div>
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

      {showCondenseButton && (
        <div className="flex justify-end -mt-6">
          <button
            type="button"
            onClick={() => setIsCondensed(prev => !prev)}
            className="w-7 h-6 flex items-center justify-center rounded border border-white/30 bg-white/10 text-white hover:bg-white/20 font-bold text-sm"
            title={isCondensed ? 'Show all columns' : 'Condense (hide Claim Status through Notes)'}
            aria-label={isCondensed ? 'Show all columns' : 'Condense columns'}
          >
            {isCondensed ? '+' : '−'}
          </button>
        </div>
      )}

      <div 
        ref={tableContainerRef}
        className="table-container dark-theme" 
        style={{ 
          maxHeight: isInSplitScreen ? undefined : '600px',
          flex: isInSplitScreen ? 1 : undefined,
          minHeight: isInSplitScreen ? 0 : undefined,
          overflow: 'hidden',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          width: '100%',
          maxWidth: '100%',
          backgroundColor: '#d2dbe5'
        }}
      >
        {activeProvider && (
          <HandsontableWrapper
            key={`providers-${activeProvider?.id ?? ''}`}
            data={getProviderRowsHandsontableData()}
            dataVersion={(providerRowsVersion ?? 0) + structureVersion + selectedMonth.getTime() + patientsDisplayRevision + (isViewingBackup ? 1000000 + backupVersionKey : 0)}
            columns={providerColumnsWithLocks}
            colHeaders={columnTitles}
            colHeaderRefreshKey={providerLocksKey}
            afterGetColHeader={afterGetProviderColHeader}
            rowHeaders={true}
            width="100%"
            height={isInSplitScreen ? tableHeight : 600}
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

      {/* Sum tally for provider with full access (level 2) only */}
      {activeProvider && isProviderView && providerLevel === 2 && (
        <div
          className="mt-3 flex flex-col gap-2 px-4 py-3 rounded-lg border border-white/20 bg-slate-800/80 text-white"
          style={{ width: '100%', maxWidth: '100%' }}
        >
          <div className="flex items-center gap-6 flex-wrap">
            <span className="font-medium text-red-500">Sums:</span>
            <span className="ml-2"><strong>Insurance Pay Total:</strong> {formatCurrency(providerSums.insPay)}</span>
            <span className="ml-2"><strong>Patient Payment Total:</strong> {formatCurrency(providerSums.collectedFromPt)}</span>
            <span className="ml-2"><strong>AR Total:</strong> {arSumFromDb === null ? '—' : formatCurrency(arSumFromDb)}</span>
            {/* <span className="ml-2"><strong>Total:</strong> {formatCurrency(providerSums.total)}</span> */}
          </div>
        </div>
      )}

      {activeProvider && !isProviderView && (
        <div
          className="mt-3 flex flex-col gap-2 px-4 py-3 rounded-lg border border-white/20 bg-slate-800/80 text-white"
          style={{ width: '100%', maxWidth: '100%' }}
        >
          {officeStaffView ? (
            <div className="flex items-center gap-4 flex-wrap text-sm">
              <span className="font-medium text-red-500/90">CC Declines:</span>
              <span><strong>{billingMetrics?.ccDeclines ?? 0}</strong></span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-6 flex-wrap">
                <span className="font-medium text-red-500">Sums:</span>
                <span className="ml-2"><strong>Ins Pay:</strong> {formatCurrency(providerSums.insPay)}</span>
                <span className="ml-2"><strong>Collected from PT:</strong> {formatCurrency(providerSums.collectedFromPt)}</span>
                <span className="ml-2"><strong>Total:</strong> {formatCurrency(providerSums.total)}</span>
                <span className="ml-2"><strong>AR Total:</strong> {arSumFromDb === null ? '—' : formatCurrency(arSumFromDb)}</span>
              </div>
              {billingMetrics && (
                <div className="flex items-center gap-4 flex-wrap text-sm border-t border-white/20 pt-2">
                  <span className="font-medium text-red-500/90">Metrics:</span>
                  <span>Visits: <strong>{billingMetrics.visits}</strong></span>
                  <span>No Shows: <strong>{billingMetrics.noShows}</strong></span>
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
