import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { apiClient } from '@/lib/apiClient'
import {
  fetchSheetRows,
  fetchSheetRowsForSheetIds,
  saveSheetRows,
  isUuid,
  applyTempIdPromotions,
  collectTempIdPromotions,
  getTempIdPromotions,
  mergeTempIdPromotions,
  sheetTempIdPromotionKey,
} from '@/lib/providerSheetRows'
import { enrichSheetRowsFromPatients, applyCoPatientSnapshotToSheetRows } from '@/lib/enrichProviderSheetRowsFromPatients'
import { fetchBackupCsvAsSheetRows, padSheetRowsToBase, ROWS_PER_PROVIDER } from '@/lib/providerSheetBackups'
import { sheetRowsToUiCsv, type ProviderSheetUiExportLayout } from '@/lib/providerSheetBackupUiExport'
import BackupVersionsBar, { type BackupVersionMeta } from '@/components/BackupVersionsBar'
import AutoBackupsBar from '@/components/AutoBackupsBar'
import { createAutoBackup, getAutoBackup } from '@/lib/autoBackupsApi'
import {
  fetchBackupCsvAsAR,
  fetchBackupCsvAsPatients,
  fetchBackupCsvAsProviderPay,
  padARTo200,
  padPatientsTo500,
} from '@/lib/tabBackups'
import { Patient, ProviderSheet, SheetRow, Clinic, Provider, BillingCode, StatusColor, ColumnLock, IsLockPatients, IsLockBillingTodo, IsLockProviders, IsLockAccountsReceivable, AccountsReceivable } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Users, CheckSquare, FileText, Trash2, Lock, Unlock, Download, Columns, DollarSign } from 'lucide-react'
import { useDebouncedSave } from '@/lib/useDebouncedSave'
import { dedupeProvidersByUser, fetchActiveProviderUserEmails } from '@/lib/providerUserFilter'
import PatientsTab from '@/components/tabs/PatientsTab'
import BillingTodoTab from '@/components/tabs/BillingTodoTab'
import ProvidersTab from '@/components/tabs/ProvidersTab'
import AccountsReceivableTab from '@/components/tabs/AccountsReceivableTab'
import ProviderPayTab, { type IsLockProviderPay } from '@/components/tabs/ProviderPayTab'
import AdminTrackingTab from '@/components/tabs/AdminTrackingTab'

type TabType = 'patients' | 'todo' | 'providers' | 'accounts_receivable' | 'provider_pay' | 'admin_tracking'

function initialTabFromPath(
  clinicId: string | undefined,
  providerIdFromRoute: string | undefined,
  tabParam: string | undefined,
  pathname: string,
): TabType {
  if (clinicId && providerIdFromRoute) {
    const base = `/clinic/${clinicId}/providers/${providerIdFromRoute}`
    if (pathname === `${base}/accounts_receivable`) return 'accounts_receivable'
    if (pathname === `${base}/provider_pay`) return 'provider_pay'
    if (pathname === `${base}/admin_tracking`) return 'admin_tracking'
    if (pathname === base) return 'providers'
  }
  if (clinicId && pathname.startsWith(`/clinic/${clinicId}/providers`) && !providerIdFromRoute) {
    return 'providers'
  }
  if (tabParam && ['patients', 'todo', 'providers', 'accounts_receivable', 'provider_pay', 'admin_tracking'].includes(tabParam)) {
    return tabParam as TabType
  }
  return 'patients'
}

/** True when the browser URL is the Accounts Receivable screen (provider-scoped or /clinic/:id/accounts_receivable). */
function pathnameIsAccountsReceivableRoute(
  pathname: string,
  clinicId: string | undefined,
  providerIdFromRoute: string | undefined,
): boolean {
  if (!clinicId) return false
  if (providerIdFromRoute) {
    const base = `/clinic/${clinicId}/providers/${providerIdFromRoute}`
    if (pathname === `${base}/accounts_receivable`) return true
  }
  return pathname === `/clinic/${clinicId}/accounts_receivable`
}

/** Pre-migration `is_lock_providers` rows use this month_key; first open of a calendar month clones them into that month. */
const IS_LOCK_PROVIDERS_LEGACY_MONTH_KEY = 'legacy'

function providersDebugClinic(event: string, detail?: Record<string, unknown>) {
  void event
  void detail
}

/** Pre-migration `is_lock_accounts_receivable` rows use this month_key; first open of a month clones them into that month. */
const IS_LOCK_AR_LEGACY_MONTH_KEY = 'legacy'

function newARLockRowPayload(clinicId: string, monthKey: string) {
  return {
    clinic_id: clinicId,
    month_key: monthKey,
    ar_id: false,
    name: false,
    date_of_service: false,
    amount: false,
    date_recorded: false,
    type: false,
    notes: false,
    whole_sheet_locked: false,
  }
}

/** Merge Patient Info saves into the clinic patient list for provider co-patient sync without a full-table refetch. */
function mergeClinicPatientsWithUpdates(prev: Patient[], changes: Patient[]): Patient[] {
  if (changes.length === 0) return prev
  const byId = new Map<string, Patient>()
  for (const p of prev) byId.set(p.id, p)
  for (const c of changes) byId.set(c.id, c)
  return Array.from(byId.values())
}

function newProviderLockRowPayload(clinicId: string, monthKey: string, providerId: string) {
  return {
    clinic_id: clinicId,
    month_key: monthKey,
    provider_id: providerId,
    patient_id: false,
    first_name: false,
    last_initial: false,
    insurance: false,
    copay: false,
    coinsurance: false,
    date_of_service: false,
    cpt_code: false,
    appointment_note_status: false,
    claim_status: false,
    most_recent_submit_date: false,
    ins_pay: false,
    ins_pay_date: false,
    pt_res: false,
    collected_from_pt: false,
    pt_pay_status: false,
    pt_payment_ar_ref_date: false,
    total: false,
    notes: false,
  }
}

export default function ClinicDetail() {
  const { clinicId, tab, providerId } = useParams<{ clinicId: string; tab?: string; providerId?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { userProfile } = useAuth()
  const [activeTab, setActiveTab] = useState<TabType>(() =>
    initialTabFromPath(clinicId, providerId, tab, location.pathname),
  )
  const [loading, setLoading] = useState(true)
  const [clinic, setClinic] = useState<Clinic | null>(null)

  const fetchClinic = useCallback(async () => {
    if (!clinicId) return
    try {
      const { data, error } = await apiClient
        .from('clinics')
        .select('*')
        .eq('id', clinicId)
        .maybeSingle()

      if (error) throw error
      setClinic(data || null)
    } catch (error) {
      console.error('Error fetching clinic:', error)
    }
  }, [clinicId])

  // Patients data - still needed for Providers tab (patient dropdown)
  const [patients, setPatients] = useState<Patient[]>([])
  const patientsRef = useRef<Patient[]>([])

  // Providers data - editable provider records from providers table
  const [providers, setProviders] = useState<Provider[]>([])
  const [providerSheetsByMonth, setProviderSheetsByMonth] = useState<Record<string, Record<string, ProviderSheet>>>({})
  const [providerSheetRowsByMonth, setProviderSheetRowsByMonth] = useState<Record<string, Record<string, SheetRow[]>>>({})
  const [providerRowsVersion, setProviderRowsVersion] = useState(0)
  /** Bumped when patients table changes so Providers tab refreshes patient display. */
  const [patientAssignmentRevision, setPatientAssignmentRevision] = useState(0)
  const [billingCodes, setBillingCodes] = useState<BillingCode[]>([])
  const [statusColors, setStatusColors] = useState<StatusColor[]>([])
  const [columnLocks, setColumnLocks] = useState<ColumnLock[]>([])
  const [isLockPatients, setIsLockPatients] = useState<IsLockPatients | null>(null)
  const [isLockBillingTodo, setIsLockBillingTodo] = useState<IsLockBillingTodo | null>(null)
  const [isLockProviders, setIsLockProviders] = useState<IsLockProviders | null>(null)
  const [isLockAccountsReceivable, setIsLockAccountsReceivable] = useState<IsLockAccountsReceivable | null>(null)
  /** Month key for AR column locks — driven by AccountsReceivableTab’s month/payroll (not provider toolbar). */
  const [arLocksMonthKey, setArLocksMonthKey] = useState<string | null>(null)
  const [isLockProviderPay, setIsLockProviderPay] = useState<IsLockProviderPay | null>(null)
  const [showLockDialog, setShowLockDialog] = useState(false)
  const [selectedLockColumn, setSelectedLockColumn] = useState<{ columnName: string; providerId: string | null; isPatientColumn?: boolean; isBillingTodoColumn?: boolean; isProviderColumn?: boolean; isARColumn?: boolean; isProviderPayColumn?: boolean } | null>(null)
  const [lockComment, setLockComment] = useState('')
  
  // Split screen state
  const [splitScreen, setSplitScreen] = useState<{ left: TabType; right: TabType } | null>(null)
  // Default split: left 67%, right 33%
  const [splitScreenLeftWidth, setSplitScreenLeftWidth] = useState<number>(67) // Percentage
  const [isResizing, setIsResizing] = useState(false)
  const splitScreenContainerRef = useRef<HTMLDivElement>(null)
  /** Snapshot when entering split view so closing split restores the same URL and tab (no forced redirect to Billing To-Do). */
  const splitScreenExitRestoreRef = useRef<{ pathname: string; tab: TabType } | null>(null)
  const billingTodoExportRef = useRef<{ exportToCSV: () => void } | null>(null)
  /** Remember last selected provider so clicking Billing tab returns to that provider's sheet */
  const lastSelectedProviderIdRef = useRef<string | null>(null)
  const lastProviderStorageKey = clinicId ? `clinic_${clinicId}_lastProviderId` : null
  const getLastSelectedProviderId = () =>
    lastSelectedProviderIdRef.current ?? (lastProviderStorageKey ? sessionStorage.getItem(lastProviderStorageKey) : null)
  useEffect(() => {
    if (providerId && clinicId) {
      lastSelectedProviderIdRef.current = providerId
      try {
        sessionStorage.setItem(`clinic_${clinicId}_lastProviderId`, providerId)
      } catch (_) {}
    }
  }, [providerId, clinicId])
  /** Id of the row last updated in handleUpdateProviderSheetRow (used to set patient_id after creating a new patient) */
  const providerSheetUpdatedRowIdRef = useRef<string | null>(null)
  const [fullName, setFullName] = useState<string>('')

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ 
    x: number; 
    y: number; 
    type: 'patient' | 'todo' | 'providerRow' | 'ar';
    id: string;
    providerId?: string;
  } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  /** Last undo callback (e.g. provider sheet row restore). Cleared after Ctrl+Z or when another delete registers. */
  const lastUndoRef = useRef<(() => void) | null>(null)
  /** Flush Patient Info save before switching tab; registered by PatientsTab */
  const patientsTabFlushRef = useRef<(() => Promise<void>) | null>(null)
  /** Flush Billing To-Do save before switching tab; registered by BillingTodoTab */
  const billingTodoTabFlushRef = useRef<(() => Promise<void>) | null>(null)
  /** Flush Providers save before switching tab; registered by ProvidersTab */
  const providersTabFlushRef = useRef<(() => Promise<void>) | null>(null)
  /** Flush Accounts Receivable save before switching tab; registered by AccountsReceivableTab */
  const accountsReceivableTabFlushRef = useRef<(() => Promise<void>) | null>(null)
  /** Previous pathname — used to detect leaving AR via URL (sidebar / browser) without handleTabChange flush. */
  const prevPathnameForArFlushRef = useRef<string>(location.pathname)
  useEffect(() => {
    prevPathnameForArFlushRef.current = location.pathname
  }, [clinicId])
  /**
   * When leaving AR via URL change, we flush save while pathname is already the next route.
   * Block the URL→activeTab sync effect until flush finishes so AR (and Handsontable) stay mounted.
   * Never use global `loading` for this: `pageReady` is `!loading`, so setLoading(true) would unmount
   * all tab content and destroy HOT before finishEditing / rAF — Patient Info / To-Do looked fine because
   * refs were often already synced; AR’s flush merges from HOT after rAF and was losing edits + DB writes.
   */
  const blockUrlTabSyncDuringFlushRef = useRef(false)
  const [urlSyncRetryNonce, setUrlSyncRetryNonce] = useState(0)

  // Month filter for provider tab (and pay-period half when clinic has payroll=2).
  // Read initial state from sessionStorage so navigating away to Patient Info (or other
  // routes that remount ClinicDetail) and back restores the previously selected sheet.
  const monthStateStorageKey = clinicId ? `clinic-detail-month-state-${clinicId}` : null
  const initialMonthState = useMemo(() => {
    if (!monthStateStorageKey) return null
    try {
      const raw = sessionStorage.getItem(monthStateStorageKey)
      if (!raw) return null
      return JSON.parse(raw) as {
        selectedMonth?: string
        selectedPayroll?: 1 | 2
        selectedMonthProviderPay?: string
        selectedPayrollProviderPay?: 1 | 2
      }
    } catch {
      return null
    }
    // Run once per clinicId; we don't want this to re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStateStorageKey])

  const [selectedMonth, setSelectedMonth] = useState<Date>(() =>
    initialMonthState?.selectedMonth ? new Date(initialMonthState.selectedMonth) : new Date()
  )
  const [selectedPayroll, setSelectedPayroll] = useState<1 | 2>(initialMonthState?.selectedPayroll ?? 1)
  const selectedMonthKey =
    clinic?.payroll === 2
      ? `${selectedMonth.getFullYear()}-${selectedMonth.getMonth() + 1}-${selectedPayroll}`
      : `${selectedMonth.getFullYear()}-${selectedMonth.getMonth() + 1}`
  /** First clinic provider (same ordering as ProvidersTab) when URL has no :providerId — used for column lock scope. */
  const firstListedProviderId = useMemo(
    () => providers.find((p) => !p.id.startsWith('new-'))?.id ?? null,
    [providers]
  )
  const providerSheets = providerSheetsByMonth[selectedMonthKey] ?? {}
  const providerSheetRows = providerSheetRowsByMonth[selectedMonthKey] ?? {}

  // Provider Pay tab has its own month (payout month often lags: January work pays in February)
  const [selectedMonthProviderPay, setSelectedMonthProviderPay] = useState<Date>(() =>
    initialMonthState?.selectedMonthProviderPay
      ? new Date(initialMonthState.selectedMonthProviderPay)
      : new Date()
  )
  const [selectedPayrollProviderPay, setSelectedPayrollProviderPay] = useState<1 | 2>(
    initialMonthState?.selectedPayrollProviderPay ?? 1
  )

  // Persist month/payroll selections per clinic so returning to this clinic restores the same sheet.
  useEffect(() => {
    if (!monthStateStorageKey) return
    try {
      sessionStorage.setItem(
        monthStateStorageKey,
        JSON.stringify({
          selectedMonth: selectedMonth.toISOString(),
          selectedPayroll,
          selectedMonthProviderPay: selectedMonthProviderPay.toISOString(),
          selectedPayrollProviderPay,
        })
      )
    } catch {
      // sessionStorage may be unavailable (e.g. private mode quota); ignore — picker still works in-memory.
    }
  }, [monthStateStorageKey, selectedMonth, selectedPayroll, selectedMonthProviderPay, selectedPayrollProviderPay])
  const providersRef = useRef<Provider[]>([])
  // Provider sheet rows for editable view (when viewing a specific provider's sheet via providerId param)
  type ProviderCptRowSnapshot = {
    id: string
    cpt_code: string
    appointment_status: string
    sheetId: string
    rowId: string
  }
  const [providerRows, setProviderRows] = useState<ProviderCptRowSnapshot[]>([])
  /** Keeps useDebouncedSave baseline in sync after server hydrate / clears so initial load does not schedule saveProviderRows. */
  const updateLastSavedProviderRowsRef = useRef<((rows: ProviderCptRowSnapshot[]) => void) | null>(null)
  const [currentProvider, setCurrentProvider] = useState<Provider | null>(null)
  useEffect(() => {
    // Prefer currentProvider (set by fetchProviderSheetData on single-provider route) so the title
    // updates without waiting for the full providers list to load. Include session fallback so the name
    // survives navigating to Patient Info / Billing To-Do / AR / Provider Pay on generic /clinic/:id/:tab routes.
    const id = providerId ?? getLastSelectedProviderId()
    const target = currentProvider ?? (id ? providers.find((p) => p.id === id) : null)
    if (target) setFullName(`${target.first_name} ${target.last_name}`)
  }, [providers, currentProvider, providerId, clinicId, activeTab])

  /** Prefer currentProvider; fall back to providers list so Visit Type column matches DB if currentProvider was cleared mid-fetch. */
  const providersTabShowVisitTypeColumn = useMemo(() => {
    if (!providerId) return providers.some((p) => p.show_visit_type_column)
    return (
      currentProvider?.show_visit_type_column ??
      providers.find((p) => p.id === providerId)?.show_visit_type_column ??
      false
    )
  }, [providerId, currentProvider, providers])

  const [currentSheet, setCurrentSheet] = useState<ProviderSheet | null>(null)
  const providerRowsRef = useRef<ProviderCptRowSnapshot[]>([])
  /** Serialize provider sheet saves per provider so an older save (e.g. 59 rows) cannot overwrite a newer one (67 rows) in the DB. */
  const saveProviderSheetInProgressRef = useRef<Set<string>>(new Set())
  /** Pending queued save when one is already in flight.
   *  - `rows` is the LATEST snapshot to persist (later calls overwrite earlier rows).
   *  - `deletedDbIds` accumulates UUIDs from every queued call so a delete that happens while a save
   *    is in flight is not lost. Earlier code only stored `rows` and dropped knownDeletedIds, which
   *    meant the row visually disappeared but never left the DB and came back on refresh.
   *  - `resolvers` holds the resolve/reject pairs of every queued caller so the returned Promise
   *    actually resolves when the replayed save completes (toast + awaits stay accurate). */
  type PendingProviderSheetSave = {
    rows: SheetRow[]
    deletedDbIds: string[]
    resolvers: Array<{ resolve: (persisted: boolean) => void; reject: (err: unknown) => void }>
    /** monthKey of the latest queued call, so the replay in the in-progress save's finally block targets
     *  the right sheet even if the user has since navigated to a different month. */
    monthKey: string
  }
  const pendingProviderSheetSaveRef = useRef<Record<string, PendingProviderSheetSave>>({})
  /** Saves that hit a transient guard (sheet not yet in `providerSheetsByMonth`, or hydration not yet
   *  recorded in `hydratedSheetKeysRef`) get queued here instead of being silently dropped. The drain
   *  effect below retries each entry once the guards line up. Keyed by `providerId|monthKey` so a
   *  later edit on the same row overwrites the queued snapshot rather than queuing twice (the older
   *  snapshot is by definition a subset of the newer one, since `latestProviderRowsRef` accumulates).
   *  Reason this exists: the hydration guard used to `return false` silently when the user typed
   *  before the initial fetch completed. Their typing was never retried — that's the "I filled it in
   *  and it disappeared" report Jenali kept seeing on the current-month sheet (the only month where
   *  default mount + immediate typing puts edits inside the hydration window). */
  type DeferredProviderSheetSave = {
    providerId: string
    rowsToSave: SheetRow[]
    knownDeletedIds?: string[]
    monthKey: string
    queuedAt: number
  }
  const deferredSavesRef = useRef<Map<string, DeferredProviderSheetSave>>(new Map())
  /** Per-(provider, monthKey) timestamp of the last save that actually persisted (didPersist === true).
   *  The drain consults this to skip any queued entry whose `queuedAt` predates a more recent successful
   *  save for the same target. Without this, a deferred snapshot taken at T0 could replay AFTER a
   *  successful save at T2 and overwrite T2's data with T0's older (sparser) rows. */
  const lastSuccessfulSaveAtRef = useRef<Map<string, number>>(new Map())
  /** Most recent save-failure message surfaced to the user as a top-of-page banner. Mirrors the same
   *  state in ProviderSheetPage. Critical for the labeled "Billing" tab route — without this, save
   *  failures from `saveProviderSheetRows` were swallowed into `console.error` only. That's how
   *  Jenali's "data was there, then gone hours later" pattern happens: the optimistic state update
   *  paints the row as saved, the actual network save throws (token expired, transient 5xx, etc.),
   *  she sees nothing wrong, and later a normal re-fetch overwrites her optimistic state with the
   *  still-stale DB row. By the time she notices, the in-memory copy is gone too. */
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null)
  /** Per-sheet timestamp of the most recent auto-backup. The trigger helper skips a backup if the
   *  same sheet was already snapshotted within `AUTO_BACKUP_MIN_INTERVAL_MS`. Prevents the
   *  accidental-double-click case (Billing → Patients → Billing → Patients in 2 seconds) from
   *  creating four backups when one is plenty. */
  const lastAutoBackupAtRef = useRef<Map<string, number>>(new Map())
  /** Toast surfaced after a restore so the user knows the explicit Undo button can revert the
   *  restore. Auto-hides after the window expires. (We intentionally do NOT bind Ctrl+Z to restore-
   *  undo — Ctrl+Z must keep its standard cell-edit meaning so muscle memory stays intact.) */
  const [restoreToast, setRestoreToast] = useState<{ message: string; expiresAt: number } | null>(null)
  /** Pre-restore snapshot held only as long as the undo window is open. Cleared once consumed by
   *  an Undo click or by window expiry. Stored per (providerId, monthKey) so navigating around within
   *  the window doesn't lose the snapshot for the sheet that was restored. */
  type RestoreSnapshot = { providerId: string; monthKey: string; rows: SheetRow[]; restoredAt: number; expiresAt: number }
  const restoreSnapshotRef = useRef<RestoreSnapshot | null>(null)
  /** When viewing a backup version, override rows for the current provider (super_admin only). */
  const [backupOverrideRows, setBackupOverrideRows] = useState<SheetRow[] | null>(null)
  const [selectedBackupVersion, setSelectedBackupVersion] = useState<BackupVersionMeta | null>(null)
  /** Increments each time user selects a backup version (so grid dataVersion changes and UI refreshes). */
  const [backupViewKey, setBackupViewKey] = useState(0)
  /** Tracks which version fetch is current; ignore stale completions (race when user selects 1, 2, 3 quickly). */
  const lastRequestedBackupIdRef = useRef<string | null>(null)
  /** Latest Providers tab grid layout so backup CSV export matches visible columns (incl. condensed). */
  const providerSheetExportLayoutRef = useRef<ProviderSheetUiExportLayout | null>(null)
  const onProviderSheetExportLayoutChange = useCallback((layout: ProviderSheetUiExportLayout) => {
    providerSheetExportLayoutRef.current = layout
  }, [])
  /** AR tab backup override (full list from backup CSV). */
  const [backupOverrideAR, setBackupOverrideAR] = useState<AccountsReceivable[] | null>(null)
  const [selectedBackupVersionAR, setSelectedBackupVersionAR] = useState<BackupVersionMeta | null>(null)
  const [backupViewKeyAR, setBackupViewKeyAR] = useState(0)
  const lastRequestedBackupIdARRef = useRef<string | null>(null)
  /** Patient Info tab backup override. */
  const [backupOverridePatients, setBackupOverridePatients] = useState<Patient[] | null>(null)
  const [selectedBackupVersionPatients, setSelectedBackupVersionPatients] = useState<BackupVersionMeta | null>(null)
  const [backupViewKeyPatients, setBackupViewKeyPatients] = useState(0)
  const lastRequestedBackupIdPatientsRef = useRef<string | null>(null)
  /** Provider Pay tab backup override (byKey from backup; we pass table for current provider+month). */
  const [backupOverrideProviderPayByKey, setBackupOverrideProviderPayByKey] = useState<Record<string, string[][]> | null>(null)
  const [selectedBackupVersionProviderPay, setSelectedBackupVersionProviderPay] = useState<BackupVersionMeta | null>(null)
  const [backupViewKeyProviderPay, setBackupViewKeyProviderPay] = useState(0)
  const lastRequestedBackupIdProviderPayRef = useRef<string | null>(null)
  /** Provider Pay tab dropdown selection (so backup download filename uses the selected provider name). */
  const providerPaySelectedIdRef = useRef<string | null>(null)

  // Clear backup view when switching provider or month (providers only)
  useEffect(() => {
    setBackupOverrideRows(null)
    setSelectedBackupVersion(null)
  }, [providerId, selectedMonthKey])

  useEffect(() => {
    setArLocksMonthKey(null)
  }, [clinicId])

  // Billing staff and official staff may only access clinics permitted by super admin / admin
  const isBillingStaff = userProfile?.role === 'billing_staff'
  const isOfficialStaff = userProfile?.role === 'official_staff'
  const isOfficeStaff = userProfile?.role === 'office_staff'
  useEffect(() => {
    if (!clinicId || !userProfile || (!isBillingStaff && !isOfficialStaff)) return
    const allowed = userProfile.clinic_ids?.length ? userProfile.clinic_ids.includes(clinicId) : false
    if (!allowed) {
      navigate('/dashboard', { replace: true })
    }
  }, [clinicId, userProfile, isBillingStaff, isOfficialStaff, navigate])

  // Flush AR when the URL leaves the AR route (sidebar / browser / deep link) — must run BEFORE the tab-sync effect
  // below, which would otherwise switch activeTab and unmount AR before we persist.
  const isProvidersRoute = !!(clinicId && location.pathname.startsWith(`/clinic/${clinicId}/providers`))
  useEffect(() => {
    const prev = prevPathnameForArFlushRef.current
    prevPathnameForArFlushRef.current = location.pathname
    if (loading) return
    const wasAr = pathnameIsAccountsReceivableRoute(prev, clinicId, providerId)
    const nowAr = pathnameIsAccountsReceivableRoute(location.pathname, clinicId, providerId)
    if (!wasAr || nowAr) return
    const flush = accountsReceivableTabFlushRef.current
    if (!flush) return
    blockUrlTabSyncDuringFlushRef.current = true
    void flush()
      .catch((err) => console.error('[ClinicDetail] URL-leave AR flush failed:', err))
      .finally(() => {
        blockUrlTabSyncDuringFlushRef.current = false
        setUrlSyncRetryNonce((n) => n + 1)
      })
  }, [location.pathname, loading, clinicId, providerId])

  // Sync activeTab with URL parameter
  // When URL is /clinic/:clinicId/providers (or nested /providers/:id/…), match providers routes; "tab" param is undefined — derive tab from pathname.
  useEffect(() => {
    // Don't sync tab from URL while initial clinic load (loading) or while AR URL-leave flush runs
    // (blockUrlTabSyncDuringFlushRef), so we don't unmount AR before persist. See blockUrlTabSyncDuringFlushRef.
    if (loading || blockUrlTabSyncDuringFlushRef.current) return
    const scopedBase =
      clinicId && providerId ? `/clinic/${clinicId}/providers/${providerId}` : null
    const onProviderFinanceAR = scopedBase && location.pathname === `${scopedBase}/accounts_receivable`
    const onProviderFinancePP = scopedBase && location.pathname === `${scopedBase}/provider_pay`
    const onProviderAdminTracking = scopedBase && location.pathname === `${scopedBase}/admin_tracking`
    const onSingleProviderBilling = !!(scopedBase && location.pathname === scopedBase)

    if (isBillingStaff && clinicId && (onProviderFinanceAR || onProviderFinancePP || onProviderAdminTracking)) {
      navigate(`/clinic/${clinicId}/todo`, { replace: true })
      return
    }

    // Admin Tracking is super-admin only. If anyone else deep-links here, bounce them to the same
    // fallback the tab-sync uses for other unauthorized routes rather than silently rendering nothing.
    if (onProviderAdminTracking && userProfile?.role !== 'super_admin') {
      navigate(`/clinic/${clinicId}/providers/${providerId}`, { replace: true })
      return
    }

    if (onProviderFinanceAR) {
      setActiveTab('accounts_receivable')
      return
    }
    if (onProviderFinancePP) {
      setActiveTab('provider_pay')
      return
    }
    if (onProviderAdminTracking) {
      setActiveTab('admin_tracking')
      return
    }
    if (providerId && isProvidersRoute && onSingleProviderBilling) {
      setActiveTab('providers')
      return
    }
    if (!providerId && isProvidersRoute) {
      setActiveTab('providers')
      return
    }
    if (tab && ['patients', 'todo', 'providers', 'accounts_receivable', 'provider_pay', 'admin_tracking'].includes(tab)) {
      if (isOfficialStaff && tab !== 'todo' && tab !== 'providers') {
        navigate(`/clinic/${clinicId}/todo`, { replace: true })
      } else if (isBillingStaff && (tab === 'accounts_receivable' || tab === 'provider_pay' || tab === 'admin_tracking')) {
        navigate(`/clinic/${clinicId}/todo`, { replace: true })
      } else if (tab === 'admin_tracking' && userProfile?.role !== 'super_admin') {
        navigate(`/clinic/${clinicId}/providers`, { replace: true })
      } else {
        // Admin used to be force-redirected away from `/todo` to `/providers`; that redirect was
        // removed so admins can now view and edit the Billing To-Do list directly.
        setActiveTab(tab as TabType)
      }
    } else if (!tab && clinicId && !isProvidersRoute) {
      if (isBillingStaff || isOfficialStaff) {
        navigate(`/clinic/${clinicId}/todo`, { replace: true })
      } else if (userProfile?.role === 'admin') {
        // Admin still defaults to the providers (billing sheet) view on no-tab clinic URLs —
        // that's their primary workspace. The Billing To-Do tab is now selectable from the tab
        // bar; we just don't auto-land them there.
        navigate(`/clinic/${clinicId}/providers`, { replace: true })
      } else {
        navigate(`/clinic/${clinicId}/todo`, { replace: true })
      }
    }
  }, [
    tab,
    clinicId,
    navigate,
    providerId,
    isProvidersRoute,
    location.pathname,
    userProfile?.role,
    isBillingStaff,
    isOfficialStaff,
    loading,
    urlSyncRetryNonce,
  ])

  // Hydrate header when Patient Info / Billing To-Do / AR / Provider Pay have no provider-scoped billing fetch
  // (patients & todo never call fetchProviders(); AR/PP may be on generic URL). Uses URL providerId or session last sheet.
  useEffect(() => {
    if (!clinicId) return
    const headerHydrateTabs: TabType[] = ['patients', 'todo', 'accounts_receivable', 'provider_pay', 'admin_tracking']
    if (!headerHydrateTabs.includes(activeTab)) return
    const scopePid = providerId ?? getLastSelectedProviderId()
    if (!scopePid) return
    if (currentProvider?.id === scopePid) return
    let cancelled = false
    void apiClient
      .from('providers')
      .select('*')
      .eq('id', scopePid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        setCurrentProvider(data as Provider)
        setProviders((curr) => {
          const idx = curr.findIndex((p) => p.id === scopePid)
          if (idx < 0) {
            const next = [...curr, data as Provider]
            providersRef.current = next
            return next
          }
          const next = [...curr]
          next[idx] = data as Provider
          providersRef.current = next
          return next
        })
      })
    return () => {
      cancelled = true
    }
  }, [clinicId, providerId, activeTab, currentProvider?.id])

  useEffect(() => {
    patientsRef.current = patients
  }, [patients])

  useEffect(() => {
    providerRowsRef.current = providerRows
  }, [providerRows])

  useEffect(() => {
    providersRef.current = providers
  }, [providers])

  // Clinic row: only when clinic changes (not on every tab/month/split change) to avoid duplicate "clinics" queries.
  useEffect(() => {
    if (!clinicId) return
    void fetchClinic()
  }, [clinicId, fetchClinic])

  useEffect(() => {
    if (!clinicId) return
    if (providerId) {
      // In split-screen the visible panes can include `providers` or `provider_pay` even when the
      // primary `activeTab` is something else (e.g. `todo` on the right). Treat those panes as needing
      // the same data so MonthYearTabs (in the providers pane) gets `statusColors` populated —
      // otherwise the month buttons fall back to the slate-grey default and lose their colors.
      // Admin Tracking is a mirror of the Billing sheet and renders MonthYearTabs the same way, so it
      // needs identical fetches (patients for name/LI/Ins join, statusColors for month coloring).
      const panes = new Set<TabType>([activeTab])
      if (splitScreen) {
        panes.add(splitScreen.left)
        panes.add(splitScreen.right)
      }
      const needsProvidersData = panes.has('providers') || panes.has('admin_tracking')
      const needsProviderPayData = panes.has('provider_pay')
      if (needsProvidersData) {
        void fetchPatients()
        void fetchBillingCodes()
        void fetchStatusColors()
        void fetchColumnLocks()
        // fetchProviders() is intentionally omitted on the single-provider route: fetchProviderSheetData
        // (triggered by the month effect) loads the one provider we need and syncs it into providers state.
      }
      if (needsProviderPayData) {
        void fetchStatusColors()
        void fetchProviders()
      }
      if (panes.has('accounts_receivable') && selectedMonthKey) {
        void fetchIsLockAccountsReceivable(selectedMonthKey)
      }
    } else {
      void fetchData(selectedMonthKey)
    }
  }, [clinicId, activeTab, providerId, selectedMonthKey, splitScreen])

  const prevMonthKeyRef = useRef<string | null>(null)
  /** Tracks (clinicId, providerId, monthKey) so we only skip fetch when cache is for this clinic (fixes same content across clinics). */
  const lastProviderSheetContextRef = useRef<{ clinicId: string; providerId: string | null; monthKey: string } | null>(null)
  /** Latest provider sheet rows (ref only) — do not put providerSheetRowsByMonth in the fetch effect deps or every edit retriggers fetch/races. */
  const providerSheetRowsByMonthRef = useRef(providerSheetRowsByMonth)
  useEffect(() => {
    providerSheetRowsByMonthRef.current = providerSheetRowsByMonth
  }, [providerSheetRowsByMonth])
  /** Month key for the provider-sheets fetch in progress; we only set loading false when this fetch completes so we don't reveal content from an outdated fetch. */
  const lastProviderSheetsFetchMonthKeyRef = useRef<string | null>(null)
  /** Set of `${clinicId}|${providerId}|${monthKey}` tuples that have completed hydration from the DB.
   * Saves are blocked until hydration is done — without this, a save fired while React state is still
   * empty would persist an empty row set on top of months of real data. */
  const hydratedSheetKeysRef = useRef<Set<string>>(new Set())
  /** (providerId, monthKey) for the single-provider sheet fetch; only set loading false when that fetch completes. */
  const lastProviderSheetDataFetchRef = useRef<{ providerId: string; monthKey: string } | null>(null)
  /** After the latest single-provider billing sheet fetch attempt finishes (success or error), matches "providerId|monthKey" so pageReady can pass even if rows were never written (stale fetch, missing provider). */
  const singleProviderBillingSheetFetchFinishedKeyRef = useRef<string | null>(null)
  /** Deduplicate concurrent clinic-wide provider sheet loads (e.g. fetchData + month effect racing). */
  const providerSheetsInFlightRef = useRef<Map<string, Promise<unknown>>>(new Map())
  /** Deduplicate concurrent single-provider sheet loads. */
  const providerSheetDataInFlightRef = useRef<Map<string, Promise<unknown>>>(new Map())
  /** Deduplicate concurrent is_lock_providers loads (tab effect + month effect often fire together). */
  const fetchIsLockProvidersInFlightRef = useRef<Map<string, Promise<void>>>(new Map())
  /** Deduplicate concurrent fetchProviders calls (tab effect + fetchData can race). */
  const fetchProvidersInFlightRef = useRef<Promise<void> | null>(null)
  /** Deduplicate concurrent fetchColumnLocks calls. */
  const fetchColumnLocksInFlightRef = useRef<Promise<void> | null>(null)
  // When month (or pay-period half when payroll=2) changes: use cached data if available, otherwise fetch
  useEffect(() => {
    const monthKey = selectedMonthKey
    const isInitialLoad = prevMonthKeyRef.current === null
    const monthChanged = prevMonthKeyRef.current !== null && prevMonthKeyRef.current !== monthKey
    prevMonthKeyRef.current = monthKey

    const cacheForMonth = providerSheetRowsByMonthRef.current[monthKey]
    const hasCached = cacheForMonth != null && Object.keys(cacheForMonth).length > 0
    const ref = lastProviderSheetContextRef.current
    const contextMatches = ref && ref.clinicId === clinicId && ref.monthKey === monthKey && ref.providerId === (providerId ?? null)
    // When month didn't change and not initial load: only skip fetch if we have data for this exact (clinic, provider, month)
    // When month changed: always fetch so the selected month reloads (no cache skip).
    if (!monthChanged && !isInitialLoad) {
      if (providerId) {
        // Single-provider view: skip only if cache is for this clinic and this provider
        if (contextMatches && cacheForMonth?.[providerId]?.length) {
          if (activeTab === 'providers' && monthKey) void fetchIsLockProviders(monthKey)
          // Month effect often set loading true before cache skip; clear so pageReady can pass.
          if (activeTab === 'providers' || activeTab === 'provider_pay' || activeTab === 'admin_tracking') setLoading(false)
          return
        }
      } else {
        // Clinic view: skip only if cache is for this clinic
        if (contextMatches && hasCached) {
          if (activeTab === 'providers' && monthKey) void fetchIsLockProviders(monthKey)
          if (activeTab === 'providers' || activeTab === 'provider_pay' || activeTab === 'admin_tracking') setLoading(false)
          return
        }
      }
    }

    const isMonthChangeOnly = monthChanged && !isInitialLoad
    if (providerId && clinicId && (activeTab === 'providers' || activeTab === 'provider_pay' || activeTab === 'admin_tracking')) {
      const prevContext = lastProviderSheetContextRef.current
      const providerChanged = prevContext?.providerId !== providerId
      const monthChangedForProvider = prevContext?.monthKey !== monthKey
      const clinicChangedForProvider = prevContext != null && prevContext.clinicId !== clinicId
      if (providerChanged || monthChangedForProvider || clinicChangedForProvider) {
        setCurrentProvider(null)
        setCurrentSheet(null)
        updateLastSavedProviderRowsRef.current?.([])
        setProviderRows([])
      }
      setLoading(true)
      lastProviderSheetDataFetchRef.current = { providerId, monthKey: selectedMonthKey }
      // Mark target context immediately so a second effect run (e.g. providers list filling in)
      // does not treat clinic-wide { providerId: null } or a null ref as a "provider change" and
      // clear currentProvider while fetchProviderSheetData is still in flight.
      lastProviderSheetContextRef.current = { clinicId, providerId, monthKey }
      const capture = { providerId, monthKey: selectedMonthKey }
      ;(async () => {
        try {
          await fetchProviderSheetData(isMonthChangeOnly, false)
          if (activeTab === 'providers' && selectedMonthKey) await fetchIsLockProviders(selectedMonthKey)
        } finally {
          // Only record completion for the fetch this run started (avoids stale async clearing loading / pageReady for a newer navigation).
          if (
            lastProviderSheetDataFetchRef.current?.providerId === capture.providerId &&
            lastProviderSheetDataFetchRef.current?.monthKey === capture.monthKey
          ) {
            singleProviderBillingSheetFetchFinishedKeyRef.current = `${capture.providerId}|${capture.monthKey}`
          }
          // fetchProviderSheetData(..., false) intentionally skips setLoading in its own finally so locks can load first
          setLoading(false)
        }
      })()
      return
    }
    if (clinicId && !providerId && (activeTab === 'providers' || activeTab === 'provider_pay' || activeTab === 'admin_tracking')) {
      setLoading(true)
      lastProviderSheetsFetchMonthKeyRef.current = selectedMonthKey
      ;(async () => {
        try {
          providersDebugClinic('month effect → fetchProviderSheets + fetchIsLockProviders', {
            selectedMonthKey,
            activeTab,
            isMonthChangeOnly,
          })
          await fetchProviderSheets(selectedMonthKey, isMonthChangeOnly, false)
          if (activeTab === 'providers' && selectedMonthKey) await fetchIsLockProviders(selectedMonthKey)
        } finally {
          setLoading(false)
        }
      })()
    }
    // firstListedProviderId intentionally omitted: it is not used in this effect; including it
    // re-ran the effect when fetchProviderSheetData merged the provider into `providers`, which
    // cleared currentProvider mid-flight and broke props like show_visit_type_column.
  }, [selectedMonthKey, activeTab, clinicId, providerId])

  const fetchData = async (monthKeyForProviderSheets?: string) => {
    if (!clinicId) return

    // For providers/provider_pay, only the provider-sheets fetch controls loading (avoids double spinner when selectedMonthKey changes after clinic loads)
    if (activeTab !== 'providers' && activeTab !== 'provider_pay' && activeTab !== 'admin_tracking') {
      setLoading(true)
    }
    try {
      // Dedupe lock fetches when primary tab + split panes both need the same row (e.g. providers + split).
      const lockOnce = new Set<string>()
      const fetchLock = async (key: string, fn: () => Promise<void>) => {
        if (lockOnce.has(key)) return
        lockOnce.add(key)
        await fn()
      }

      // Patients, todos, and accounts_receivable tabs now handle their own data fetching
      if (activeTab === 'providers' || activeTab === 'admin_tracking') {
        // Admin Tracking joins patient First Name/LI/Ins onto sheet rows, so it needs the same
        // patient + billing_code + status_color / column-lock fetches as the Billing (providers) tab.
        await fetchPatients() // Need patients for displaying patient info in provider sheets
        await fetchBillingCodes()
        await fetchStatusColors()
        await fetchColumnLocks()
        await fetchProviders()
        const mk = monthKeyForProviderSheets ?? selectedMonthKey
        if (mk && activeTab === 'providers') await fetchLock(`providers:${mk}`, () => fetchIsLockProviders(mk))
      } else if (activeTab === 'provider_pay') {
        await fetchStatusColors()
        await fetchProviders()
        if (monthKeyForProviderSheets) {
          lastProviderSheetsFetchMonthKeyRef.current = monthKeyForProviderSheets
          await fetchProviderSheets(monthKeyForProviderSheets, false)
        }
      } else if (activeTab === 'patients') {
        // Patient Info only needs patient column locks — other tabs fetch their own locks when opened.
        await fetchLock('patients', fetchIsLockPatients)
      } else if (activeTab === 'todo') {
        await fetchLock('billing_todo', fetchIsLockBillingTodo)
      } else if (activeTab === 'accounts_receivable') {
        if (selectedMonthKey) await fetchLock(`ar:${selectedMonthKey}`, () => fetchIsLockAccountsReceivable(selectedMonthKey))
      }

      // Split view: load locks only for panes that are actually visible (avoids prefetching Billing/Providers/AR locks on Patient Info).
      if (splitScreen && selectedMonthKey) {
        const panes = new Set<TabType>([splitScreen.left, splitScreen.right])
        if (panes.has('patients')) await fetchLock('patients', fetchIsLockPatients)
        if (panes.has('todo')) await fetchLock('billing_todo', fetchIsLockBillingTodo)
        if (panes.has('providers') || panes.has('provider_pay')) {
          await fetchLock(`providers:${selectedMonthKey}`, () => fetchIsLockProviders(selectedMonthKey))
        }
        if (panes.has('accounts_receivable')) {
          await fetchLock(`ar:${selectedMonthKey}`, () => fetchIsLockAccountsReceivable(selectedMonthKey))
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      // Keep loading true for providers/provider_pay until provider sheets fetch completes (single loading state)
      if (activeTab !== 'providers' && activeTab !== 'provider_pay' && activeTab !== 'admin_tracking') {
        setLoading(false)
      }
    }
  }

  const fetchBillingCodes = async () => {
    try {
      const { data, error } = await apiClient
        .from('billing_codes')
        .select('*')
        .order('code')
      
      if (error) throw error
      setBillingCodes(data || [])
    } catch (error) {
      console.error('Error fetching billing codes:', error)
    }
  }

  const fetchStatusColors = async () => {
    try {
      const { data } = await apiClient
        .from('status_colors')
        .select('*')
      // Merge fetched rows with the built-in defaults so every type/status pair we look up
      // (`claim:Paid`, `month:June`, `patient_pay:Refunded`, …) is guaranteed to have a color.
      // Previously when the DB had only a partial seed (e.g. appointment rows but no claim or
      // month rows), the dropdown bubbles for the missing types rendered in default grey — the
      // user perceived this as "selected a value but the dropdown bubble still looks blank".
      const defaults = getDefaultStatusColors()
      const fetched = data ?? []
      const fetchedKeys = new Set(fetched.map((s) => `${s.type}:${s.status}`))
      const missing = defaults.filter((d) => !fetchedKeys.has(`${d.type}:${d.status}`))
      setStatusColors(fetched.length ? [...fetched, ...missing] : defaults)
    } catch (error) {
      // Fall back to the built-in defaults so MonthYearTabs (and all type='month' / 'appointment' /
      // 'claim' consumers) still render with colors instead of slate-grey when the API is down.
      console.error('Error fetching status colors; using defaults', error)
      setStatusColors(getDefaultStatusColors())
    }
  }


  const fetchColumnLocks = async () => {
    if (!clinicId) return
    if (fetchColumnLocksInFlightRef.current) {
      await fetchColumnLocksInFlightRef.current
      return
    }
    const run = (async () => {
      try {
        const { data, error } = await apiClient
          .from('column_locks')
          .select('*')
          .eq('clinic_id', clinicId)
        if (error) { setColumnLocks([]); return }
        setColumnLocks(data || [])
      } catch (error) {
        console.error('Error fetching column locks:', error)
        setColumnLocks([])
      } finally {
        fetchColumnLocksInFlightRef.current = null
      }
    })()
    fetchColumnLocksInFlightRef.current = run
    await run
  }

  const fetchIsLockPatients = async () => {
    if (!clinicId) return
    
    try {
      const { data, error } = await apiClient
        .from('is_lock_patients')
        .select('*')
        .eq('clinic_id', clinicId)
        .maybeSingle()
      
      if (error) {
        setIsLockPatients(null)
        return
      }
      
      if (data) {
        setIsLockPatients(data)
      } else {
        // Create default record if it doesn't exist
        const { data: newData, error: insertError } = await apiClient
          .from('is_lock_patients')
          .insert({
            clinic_id: clinicId,
            patient_id: false,
            first_name: false,
            last_name: false,
            insurance: false,
            copay: false,
            coinsurance: false,
          })
          .select()
          .single()

        if (insertError) {
          // Race: a concurrent caller (split-screen pane mount, rapid tab switch, dev StrictMode
          // double-effect) already inserted the row between our SELECT and INSERT, hitting the
          // clinic_id unique constraint. Re-fetch and use the existing row instead of failing.
          if (insertError.code === '23505') {
            const { data: refetched } = await apiClient
              .from('is_lock_patients')
              .select('*')
              .eq('clinic_id', clinicId)
              .maybeSingle()
            setIsLockPatients(refetched ?? null)
          } else {
            console.error('Error creating is_lock_patients record:', insertError)
            setIsLockPatients(null)
          }
        } else {
          setIsLockPatients(newData)
        }
      }
    } catch (error) {
      console.error('Error fetching is_lock_patients:', error)
      setIsLockPatients(null)
    }
  }

  const handleTogglePatientColumnLock = async (columnName: keyof IsLockPatients, isLocked: boolean, comment?: string) => {
    if (!clinicId || !userProfile?.id) return

    try {
      const currentLock = isLockPatients
      const commentField = `${columnName}_comment` as keyof IsLockPatients

      if (currentLock) {
        // Update existing record
        // First, try with comment if provided
        const updateData: any = {
          [columnName]: isLocked,
          updated_at: new Date().toISOString()
        }
        
        // Only include comment if provided
        if (comment !== undefined && comment !== null && comment !== '') {
          updateData[commentField] = comment
        }

        let { error } = await apiClient
          .from('is_lock_patients')
          .update(updateData)
          .eq('id', currentLock.id)

        // If error is about missing comment column, retry without comment
        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Updating without comment. Please run the migration: database migration for patient lock comments`)
          const updateDataWithoutComment: any = {
            [columnName]: isLocked,
            updated_at: new Date().toISOString()
          }
          const { error: retryError } = await apiClient
            .from('is_lock_patients')
            .update(updateDataWithoutComment)
            .eq('id', currentLock.id)
          
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      } else {
        // Create new record
        const insertData: any = {
          clinic_id: clinicId,
          patient_id: columnName === 'patient_id' ? isLocked : false,
          first_name: columnName === 'first_name' ? isLocked : false,
          last_name: columnName === 'last_name' ? isLocked : false,
          insurance: columnName === 'insurance' ? isLocked : false,
          copay: columnName === 'copay' ? isLocked : false,
          coinsurance: columnName === 'coinsurance' ? isLocked : false,
        }
        
        // Only include comment if provided
        if (comment !== undefined && comment !== null && comment !== '') {
          insertData[commentField] = comment
        }

        let { error } = await apiClient
          .from('is_lock_patients')
          .insert(insertData)

        // If error is about missing comment column, retry without comment
        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Creating without comment. Please run the migration: database migration for patient lock comments`)
          delete insertData[commentField]
          const { error: retryError } = await apiClient
            .from('is_lock_patients')
            .insert(insertData)

          if (retryError) {
            if (retryError.code === '23505') {
              // Row already exists (created between our null check and this INSERT). Update it instead.
              await apiClient
                .from('is_lock_patients')
                .update({ [columnName]: isLocked, updated_at: new Date().toISOString() })
                .eq('clinic_id', clinicId)
            } else {
              throw retryError
            }
          }
        } else if (error) {
          if (error.code === '23505') {
            // Row already exists (created between our null check and this INSERT) — update it instead.
            const updateData: any = {
              [columnName]: isLocked,
              updated_at: new Date().toISOString(),
            }
            if (comment !== undefined && comment !== null && comment !== '') {
              updateData[commentField] = comment
            }
            const { error: updateError } = await apiClient
              .from('is_lock_patients')
              .update(updateData)
              .eq('clinic_id', clinicId)
            if (updateError) throw updateError
          } else {
            throw error
          }
        }
      }

      // Refresh lock status immediately
      await fetchIsLockPatients()
      
      // Close dialog
      setShowLockDialog(false)
      setSelectedLockColumn(null)
      setLockComment('')
    } catch (error) {
      console.error('Error toggling patient column lock:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('column') || errorMessage.includes('not found') || (error as any)?.code === 'PGRST204') {
        alert('Comment columns are missing. The column was locked/unlocked, but comments are not available. Please run the database migration for patient lock comments.')
      } else {
        alert('Failed to update column lock. Please try again.')
      }
    }
  }

  const fetchIsLockBillingTodo = async () => {
    if (!clinicId) return
    
    try {
      const { data, error } = await apiClient
        .from('is_lock_billing_todo')
        .select('*')
        .eq('clinic_id', clinicId)
        .maybeSingle()
      
      if (error) {
        setIsLockBillingTodo(null)
        return
      }
      
      if (data) {
        setIsLockBillingTodo(data)
      } else {
        // Create default record if it doesn't exist
        const { data: newData, error: insertError } = await apiClient
          .from('is_lock_billing_todo')
          .insert({
            clinic_id: clinicId,
            id_column: false,
            status: false,
            issue: false,
            notes: false,
            followup_notes: false,
          })
          .select()
          .maybeSingle()
        
        if (insertError) {
          setIsLockBillingTodo(null)
        } else if (newData) {
          setIsLockBillingTodo(newData)
        }
      }
    } catch (error) {
      console.error('Error fetching is_lock_billing_todo:', error)
      setIsLockBillingTodo(null)
    }
  }

  const isPatientColumnLocked = (columnName: keyof IsLockPatients): boolean => {
    if (!isLockPatients) return false
    return isLockPatients[columnName] === true
  }

  const handleToggleBillingTodoColumnLock = async (columnName: keyof IsLockBillingTodo, isLocked: boolean, comment?: string) => {
    if (!clinicId || !userProfile?.id) return

    try {
      const currentLock = isLockBillingTodo
      const commentField = `${columnName}_comment` as keyof IsLockBillingTodo

      if (currentLock) {
        // Update existing record
        // First, try with comment if provided
        const updateData: any = {
          [columnName]: isLocked,
          updated_at: new Date().toISOString()
        }
        
        // Only include comment if provided
        if (comment !== undefined && comment !== null && comment !== '') {
          updateData[commentField] = comment
        }

        let { error } = await apiClient
          .from('is_lock_billing_todo')
          .update(updateData)
          .eq('id', currentLock.id)

        // If error is about missing comment column, retry without comment
        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Updating without comment.`)
          const updateDataWithoutComment: any = {
            [columnName]: isLocked,
            updated_at: new Date().toISOString()
          }
          const { error: retryError } = await apiClient
            .from('is_lock_billing_todo')
            .update(updateDataWithoutComment)
            .eq('id', currentLock.id)
          
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      } else {
        // Create new record
        const insertData: any = {
          clinic_id: clinicId,
          id_column: columnName === 'id_column' ? isLocked : false,
          status: columnName === 'status' ? isLocked : false,
          issue: columnName === 'issue' ? isLocked : false,
          notes: columnName === 'notes' ? isLocked : false,
          followup_notes: columnName === 'followup_notes' ? isLocked : false,
        }
        
        // Only include comment if provided
        if (comment !== undefined && comment !== null && comment !== '') {
          insertData[commentField] = comment
        }

        let { error } = await apiClient
          .from('is_lock_billing_todo')
          .insert(insertData)

        // If error is about missing comment column, retry without comment
        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Creating without comment.`)
          delete insertData[commentField]
          const { error: retryError } = await apiClient
            .from('is_lock_billing_todo')
            .insert(insertData)
          
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      }

      // Refresh lock status immediately
      await fetchIsLockBillingTodo()
      
      // Close dialog
      setShowLockDialog(false)
      setSelectedLockColumn(null)
      setLockComment('')
    } catch (error) {
      console.error('Error toggling billing todo column lock:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('column') || errorMessage.includes('not found') || (error as any)?.code === 'PGRST204') {
        alert('Comment columns are missing. The column was locked/unlocked, but comments are not available.')
      } else {
        alert('Failed to update column lock. Please try again.')
      }
    }
  }

  const fetchIsLockProviders = async (monthKeyForLocks?: string) => {
    if (!clinicId) return
    const monthKey = monthKeyForLocks ?? selectedMonthKey
    if (!monthKey) return

    const lockPid = providerId ?? firstListedProviderId
    if (!lockPid) {
      setIsLockProviders(null)
      return
    }

    const inflightKey = `${clinicId}|${monthKey}|${lockPid}`
    const existing = fetchIsLockProvidersInFlightRef.current.get(inflightKey)
    if (existing) {
      await existing
      return
    }

    const run = (async (): Promise<void> => {
      providersDebugClinic('fetchIsLockProviders (may run multiple selects/inserts)', { clinicId, monthKey, lockPid })

      try {
        const { data, error } = await apiClient
          .from('is_lock_providers')
          .select('*')
          .eq('clinic_id', clinicId)
          .eq('month_key', monthKey)
          .eq('provider_id', lockPid)
          .maybeSingle()

        if (error) {
          setIsLockProviders(null)
          return
        }

        if (data) {
          setIsLockProviders(data as IsLockProviders)
          return
        }

        const { data: legacy } = await apiClient
          .from('is_lock_providers')
          .select('*')
          .eq('clinic_id', clinicId)
          .eq('month_key', IS_LOCK_PROVIDERS_LEGACY_MONTH_KEY)
          .eq('provider_id', lockPid)
          .maybeSingle()

        if (legacy) {
          const {
            id: _id,
            created_at: _c,
            updated_at: _u,
            month_key: _mk,
            provider_id: _pid,
            ...cloneFields
          } = legacy as IsLockProviders
          const { data: inserted, error: insertError } = await apiClient
            .from('is_lock_providers')
            .insert({
              ...cloneFields,
              clinic_id: clinicId,
              month_key: monthKey,
              provider_id: lockPid,
            })
            .select()
            .maybeSingle()

          if (!insertError && inserted) {
            setIsLockProviders(inserted as IsLockProviders)
            return
          }
          const { data: again } = await apiClient
            .from('is_lock_providers')
            .select('*')
            .eq('clinic_id', clinicId)
            .eq('month_key', monthKey)
            .eq('provider_id', lockPid)
            .maybeSingle()
          setIsLockProviders((again as IsLockProviders) ?? null)
          return
        }

        const { data: newData, error: insertError } = await apiClient
          .from('is_lock_providers')
          .insert(newProviderLockRowPayload(clinicId, monthKey, lockPid))
          .select()
          .maybeSingle()

        if (insertError) {
          const { data: again } = await apiClient
            .from('is_lock_providers')
            .select('*')
            .eq('clinic_id', clinicId)
            .eq('month_key', monthKey)
            .eq('provider_id', lockPid)
            .maybeSingle()
          setIsLockProviders((again as IsLockProviders) ?? null)
        } else if (newData) {
          setIsLockProviders(newData as IsLockProviders)
        }
      } catch (error) {
        console.error('Error fetching is_lock_providers:', error)
        setIsLockProviders(null)
      }
    })()

    fetchIsLockProvidersInFlightRef.current.set(inflightKey, run)
    try {
      await run
    } finally {
      fetchIsLockProvidersInFlightRef.current.delete(inflightKey)
    }
  }

  const handleToggleProviderColumnLock = async (columnName: keyof IsLockProviders, isLocked: boolean, comment?: string) => {
    if (!clinicId || !userProfile?.id) return
    if (!selectedMonthKey) {
      alert('Select a month before changing provider column locks.')
      return
    }

    const lockPid =
      (selectedLockColumn?.isProviderColumn ? selectedLockColumn.providerId : null) ??
      providerId ??
      firstListedProviderId
    if (!lockPid) {
      alert('Select a provider sheet before changing column locks.')
      return
    }

    try {
      const currentLock = isLockProviders
      const commentField = `${columnName}_comment` as keyof IsLockProviders

      if (currentLock) {
        // Update existing record
        const updateData: any = {
          [columnName]: isLocked,
          updated_at: new Date().toISOString()
        }
        
        // Only include comment if provided
        if (comment !== undefined && comment !== null && comment !== '') {
          updateData[commentField] = comment
        }

        let { error } = await apiClient
          .from('is_lock_providers')
          .update(updateData)
          .eq('id', currentLock.id)

        // If error is about missing comment column, retry without comment
        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Updating without comment.`)
          const updateDataWithoutComment: any = {
            [columnName]: isLocked,
            updated_at: new Date().toISOString()
          }
          const { error: retryError } = await apiClient
            .from('is_lock_providers')
            .update(updateDataWithoutComment)
            .eq('id', currentLock.id)
          
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      } else {
        // No row in state: upsert so we create or update (avoids 409 when row exists in DB but not in state)
        const upsertData: any = {
          clinic_id: clinicId,
          month_key: selectedMonthKey,
          provider_id: lockPid,
          patient_id: columnName === 'patient_id' ? isLocked : false,
          first_name: columnName === 'first_name' ? isLocked : false,
          last_initial: columnName === 'last_initial' ? isLocked : false,
          insurance: columnName === 'insurance' ? isLocked : false,
          copay: columnName === 'copay' ? isLocked : false,
          coinsurance: columnName === 'coinsurance' ? isLocked : false,
          date_of_service: columnName === 'date_of_service' ? isLocked : false,
          cpt_code: columnName === 'cpt_code' ? isLocked : false,
          appointment_note_status: columnName === 'appointment_note_status' ? isLocked : false,
          claim_status: columnName === 'claim_status' ? isLocked : false,
          most_recent_submit_date: columnName === 'most_recent_submit_date' ? isLocked : false,
          ins_pay: columnName === 'ins_pay' ? isLocked : false,
          ins_pay_date: columnName === 'ins_pay_date' ? isLocked : false,
          pt_res: columnName === 'pt_res' ? isLocked : false,
          collected_from_pt: columnName === 'collected_from_pt' ? isLocked : false,
          pt_pay_status: columnName === 'pt_pay_status' ? isLocked : false,
          pt_payment_ar_ref_date: columnName === 'pt_payment_ar_ref_date' ? isLocked : false,
          total: columnName === 'total' ? isLocked : false,
          notes: columnName === 'notes' ? isLocked : false,
          updated_at: new Date().toISOString(),
        }
        if (comment !== undefined && comment !== null && comment !== '') {
          upsertData[commentField] = comment
        }

        let { error } = await apiClient
          .from('is_lock_providers')
          .upsert(upsertData, { onConflict: 'clinic_id,month_key,provider_id' })

        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Upserting without comment.`)
          delete upsertData[commentField]
          const { error: retryError } = await apiClient
            .from('is_lock_providers')
            .upsert(upsertData, { onConflict: 'clinic_id,month_key,provider_id' })
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      }

      // Refresh lock status immediately
      if (selectedMonthKey) await fetchIsLockProviders(selectedMonthKey)

      // Close dialog
      setShowLockDialog(false)
      setSelectedLockColumn(null)
      setLockComment('')
    } catch (error) {
      console.error('Error toggling provider column lock:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('column') || errorMessage.includes('not found') || (error as any)?.code === 'PGRST204') {
        alert('Comment columns are missing. The column was locked/unlocked, but comments are not available.')
      } else {
        alert('Failed to update column lock. Please try again.')
      }
    }
  }

  const isBillingTodoColumnLocked = (columnName: keyof IsLockBillingTodo): boolean => {
    if (!isLockBillingTodo) return false
    return isLockBillingTodo[columnName] === true
  }

  const fetchIsLockAccountsReceivable = async (monthKeyForLocks?: string) => {
    if (!clinicId) return
    const monthKey = monthKeyForLocks ?? selectedMonthKey
    if (!monthKey) return

    try {
      const { data, error } = await apiClient
        .from('is_lock_accounts_receivable')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('month_key', monthKey)
        .maybeSingle()

      if (error) {
        setIsLockAccountsReceivable(null)
        return
      }

      if (data) {
        setIsLockAccountsReceivable(data as IsLockAccountsReceivable)
        return
      }

      const { data: legacy } = await apiClient
        .from('is_lock_accounts_receivable')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('month_key', IS_LOCK_AR_LEGACY_MONTH_KEY)
        .maybeSingle()

      if (legacy) {
        const { id: _id, created_at: _c, updated_at: _u, month_key: _mk, ...cloneFields } = legacy as IsLockAccountsReceivable
        const { data: inserted, error: insertError } = await apiClient
          .from('is_lock_accounts_receivable')
          .insert({
            ...cloneFields,
            clinic_id: clinicId,
            month_key: monthKey,
          })
          .select()
          .maybeSingle()

        if (!insertError && inserted) {
          setIsLockAccountsReceivable(inserted as IsLockAccountsReceivable)
          return
        }
        const { data: again } = await apiClient
          .from('is_lock_accounts_receivable')
          .select('*')
          .eq('clinic_id', clinicId)
          .eq('month_key', monthKey)
          .maybeSingle()
        setIsLockAccountsReceivable((again as IsLockAccountsReceivable) ?? null)
        return
      }

      const { data: newData, error: insertError } = await apiClient
        .from('is_lock_accounts_receivable')
        .insert(newARLockRowPayload(clinicId, monthKey))
        .select()
        .maybeSingle()

      if (insertError) {
        const { data: again } = await apiClient
          .from('is_lock_accounts_receivable')
          .select('*')
          .eq('clinic_id', clinicId)
          .eq('month_key', monthKey)
          .maybeSingle()
        setIsLockAccountsReceivable((again as IsLockAccountsReceivable) ?? null)
      } else if (newData) {
        setIsLockAccountsReceivable(newData as IsLockAccountsReceivable)
      }
    } catch (error) {
      console.error('Error fetching is_lock_accounts_receivable:', error)
      setIsLockAccountsReceivable(null)
    }
  }

  useEffect(() => {
    if (!clinicId || !arLocksMonthKey) return
    const arPaneVisible =
      activeTab === 'accounts_receivable' ||
      (splitScreen != null &&
        (splitScreen.left === 'accounts_receivable' || splitScreen.right === 'accounts_receivable'))
    if (!arPaneVisible) return
    void fetchIsLockAccountsReceivable(arLocksMonthKey)
  }, [arLocksMonthKey, activeTab, splitScreen, clinicId])

  const handleToggleARWholeSheetLock = async () => {
    if (!clinicId || !arLocksMonthKey) return
    const monthKey = arLocksMonthKey
    const nextLocked = !Boolean(isLockAccountsReceivable?.whole_sheet_locked)
    try {
      if (isLockAccountsReceivable?.id) {
        const { error } = await apiClient
          .from('is_lock_accounts_receivable')
          .update({ whole_sheet_locked: nextLocked, updated_at: new Date().toISOString() })
          .eq('id', isLockAccountsReceivable.id)
        if (error) throw error
      } else {
        const { error } = await apiClient
          .from('is_lock_accounts_receivable')
          .insert({ ...newARLockRowPayload(clinicId, monthKey), whole_sheet_locked: nextLocked })
        if (error) throw error
      }
      await fetchIsLockAccountsReceivable(monthKey)
    } catch (error) {
      console.error('Error toggling AR whole-sheet lock:', error)
      alert('Failed to update sheet lock. Ensure the database migration for whole_sheet_locked has been applied.')
    }
  }

  const handleToggleARColumnLock = async (columnName: keyof IsLockAccountsReceivable, isLocked: boolean, comment?: string) => {
    if (!clinicId || !userProfile?.id) return
    const effectiveArLockMonthKey = arLocksMonthKey ?? selectedMonthKey
    if (!effectiveArLockMonthKey) {
      alert('Select a month in Accounts Receivable (or the clinic month) before changing column locks.')
      return
    }

    try {
      const currentLock = isLockAccountsReceivable
      const commentField = `${columnName}_comment` as keyof IsLockAccountsReceivable

      if (currentLock) {
        // Update existing record
        const updateData: any = {
          [columnName]: isLocked,
          updated_at: new Date().toISOString()
        }
        
        // Only include comment if provided
        if (comment !== undefined && comment !== null && comment !== '') {
          updateData[commentField] = comment
        }

        let { error } = await apiClient
          .from('is_lock_accounts_receivable')
          .update(updateData)
          .eq('id', currentLock.id)

        // If error is about missing comment column, retry without comment
        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Updating without comment.`)
          const updateDataWithoutComment: any = {
            [columnName]: isLocked,
            updated_at: new Date().toISOString()
          }
          const { error: retryError } = await apiClient
            .from('is_lock_accounts_receivable')
            .update(updateDataWithoutComment)
            .eq('id', currentLock.id)
          
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      } else {
        const upsertData: any = {
          clinic_id: clinicId,
          month_key: effectiveArLockMonthKey,
          ar_id: columnName === 'ar_id' ? isLocked : false,
          name: columnName === 'name' ? isLocked : false,
          date_of_service: columnName === 'date_of_service' ? isLocked : false,
          amount: columnName === 'amount' ? isLocked : false,
          date_recorded: columnName === 'date_recorded' ? isLocked : false,
          type: columnName === 'type' ? isLocked : false,
          notes: columnName === 'notes' ? isLocked : false,
          whole_sheet_locked: false,
          updated_at: new Date().toISOString(),
        }
        if (comment !== undefined && comment !== null && comment !== '') {
          upsertData[commentField] = comment
        }

        let { error } = await apiClient
          .from('is_lock_accounts_receivable')
          .upsert(upsertData, { onConflict: 'clinic_id,month_key' })

        if (error && (error.message?.includes('column') || error.message?.includes('not found') || error.code === 'PGRST204')) {
          console.warn(`Comment column ${commentField} does not exist. Upserting without comment.`)
          delete upsertData[commentField]
          const { error: retryError } = await apiClient
            .from('is_lock_accounts_receivable')
            .upsert(upsertData, { onConflict: 'clinic_id,month_key' })
          if (retryError) throw retryError
        } else if (error) {
          throw error
        }
      }

      // Refresh lock status immediately
      await fetchIsLockAccountsReceivable(effectiveArLockMonthKey)

      // Close dialog
      setShowLockDialog(false)
      setSelectedLockColumn(null)
      setLockComment('')
    } catch (error) {
      console.error('Error toggling AR column lock:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('column') || errorMessage.includes('not found') || (error as any)?.code === 'PGRST204') {
        alert('Comment columns are missing. The column was locked/unlocked, but comments are not available.')
      } else {
        alert('Failed to update column lock. Please try again.')
      }
    }
  }

  const isProviderColumnLocked = (columnName: keyof IsLockProviders): boolean => {
    if (!isLockProviders) return false
    return isLockProviders[columnName] === true
  }

  const isProviderPayColumnLocked = (columnName: keyof IsLockProviderPay): boolean => {
    if (!isLockProviderPay) return false
    return isLockProviderPay[columnName] === true
  }

  const handleToggleProviderPayColumnLock = (columnName: keyof IsLockProviderPay, isLocked: boolean, comment?: string) => {
    setShowLockDialog(false)
    setSelectedLockColumn(null)
    setLockComment('')
    setIsLockProviderPay(prev => ({
      ...(prev || {}),
      [columnName]: isLocked,
      ...(comment != null && comment !== '' ? { [`${columnName}_comment`]: comment } : {}),
    }))
  }

  const isARColumnLocked = (columnName: keyof IsLockAccountsReceivable): boolean => {
    if (!isLockAccountsReceivable) return false
    return isLockAccountsReceivable[columnName] === true
  }

  const isColumnLocked = (columnName: string, providerId?: string | null): ColumnLock | null => {
    return columnLocks.find(lock => 
      lock.column_name === columnName && 
      lock.is_locked &&
      (lock.provider_id === (providerId || null))
    ) || null
  }

  const handleToggleColumnLock = async (columnName: string, providerId: string | null, isLocked: boolean, comment?: string) => {
    if (!clinicId || !userProfile?.id) return

    try {
      const existing = columnLocks.find(lock => 
        lock.column_name === columnName && 
        lock.provider_id === (providerId || null)
      )

      if (existing) {
        // Update existing lock
        const { error } = await apiClient
          .from('column_locks')
          .update({
            is_locked: isLocked,
            comment: comment || existing.comment,
            locked_by: userProfile?.id,
            locked_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        // Create new lock
        const { error } = await apiClient
          .from('column_locks')
          .insert({
            clinic_id: clinicId,
            column_name: columnName,
            is_locked: isLocked,
            comment: comment || null,
            locked_by: userProfile?.id,
            locked_at: new Date().toISOString()
          })

        if (error) throw error
      }

      // Refresh column locks
      await fetchColumnLocks()
      setShowLockDialog(false)
      setSelectedLockColumn(null)
      setLockComment('')
    } catch (error) {
      console.error('Error toggling column lock:', error)
      alert('Failed to update column lock')
    }
  }

  const filterRowsByMonth = (rows: SheetRow[]) => {
    // Since we're now fetching provider sheets by month/year from the database,
    // all rows already belong to the selected month. No filtering needed.
    // Just return all rows (including empty rows for data entry)
    return rows
  }

  // Default color mappings
  const getDefaultStatusColors = (): StatusColor[] => {
    return [
      // Appointment Status Colors
      { id: '1', status: 'Complete', color: '#22c55e', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      { id: '2', status: 'PP Complete', color: '#3b82f6', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      { id: '3', status: 'No Show', color: '#f59e0b', text_color: '#000000', type: 'appointment', created_at: '', updated_at: '' },
      { id: '4', status: 'Rescheduled', color: '#ef4444', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      { id: '5', status: 'Cancellation', color: '#6b7280', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      { id: '6', status: 'Note not complete', color: '#dc2626', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      
      // Claim Status Colors
      { id: '7', status: 'Claim Sent', color: '#3b82f6', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '8', status: 'RS', color: '#f59e0b', text_color: '#000000', type: 'claim', created_at: '', updated_at: '' },
      { id: '9', status: 'IP', color: '#eab308', text_color: '#000000', type: 'claim', created_at: '', updated_at: '' },
      { id: '10', status: 'Paid', color: '#22c55e', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '11', status: 'Deductible', color: '#a855f7', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '12', status: 'N/A', color: '#6b7280', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '13', status: 'Pending Pay', color: '#06b6d4', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '14', status: 'Denial', color: '#ef4444', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '15', status: 'Rejected', color: '#dc2626', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '16', status: 'No Coverage', color: '#991b1b', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      
      // Patient Pay Status Colors
      { id: '17', status: 'Paid', color: '#22c55e', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '18', status: 'CC declined', color: '#ef4444', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '19', status: 'Secondary', color: '#3b82f6', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '20', status: 'Refunded', color: '#f59e0b', text_color: '#000000', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '21', status: 'Payment Plan', color: '#a855f7', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      { id: '22', status: 'Waiting on Claims', color: '#6b7280', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
      
      // Month Colors
      { id: '23', status: 'January', color: '#dc2626', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '24', status: 'February', color: '#ec4899', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '25', status: 'March', color: '#f59e0b', text_color: '#000000', type: 'month', created_at: '', updated_at: '' },
      { id: '26', status: 'April', color: '#fde047', text_color: '#000000', type: 'month', created_at: '', updated_at: '' },
      { id: '27', status: 'May', color: '#84cc16', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '28', status: 'June', color: '#22c55e', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '29', status: 'July', color: '#06b6d4', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '30', status: 'August', color: '#0284c7', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '31', status: 'September', color: '#6366f1', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '32', status: 'October', color: '#f97316', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '33', status: 'November', color: '#a855f7', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
      { id: '34', status: 'December', color: '#0ea5e9', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
    ]
  }

  // Simplified fetchPatients - only needed for Providers tab patient dropdown
  const fetchPatients = useCallback(async (): Promise<Patient[] | undefined> => {
    if (!clinicId) return undefined
    providersDebugClinic('fetchPatients → patients select *', { clinicId })
    try {
      const { data, error } = await apiClient
        .from('patients')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('last_name', { ascending: true })

      if (error) throw error
      const fetchedPatients = data || []
      patientsRef.current = fetchedPatients
      setPatients(fetchedPatients)
      setPatientAssignmentRevision((r) => r + 1)
      return fetchedPatients
    } catch (error) {
      console.error('Error fetching patients:', error)
      return undefined
    }
  }, [clinicId])

  /** After Patient Info saves, refresh co-patient snapshot using merged local patient list (no full-table refetch). */
  const handlePatientsCreated = useCallback(
    (changedPatients: Patient[]) => {
      const merged = mergeClinicPatientsWithUpdates(patientsRef.current, changedPatients)
      patientsRef.current = merged
      setPatients(merged)
      setPatientAssignmentRevision((r) => r + 1)
      setProviderSheetRowsByMonth((prev) => {
        const month = prev[selectedMonthKey] ?? {}
        const next: Record<string, SheetRow[]> = {}
        for (const [pid, rows] of Object.entries(month)) {
          next[pid] = applyCoPatientSnapshotToSheetRows(rows, merged)
        }
        return { ...prev, [selectedMonthKey]: next }
      })
      setProviderRowsVersion((v) => v + 1)
    },
    [selectedMonthKey],
  )

  // Removed unused functions: savePatients, handleUpdatePatient, handleAddPatientRow, handleDeletePatient
  // These are now handled by PatientsTab component
  
  // Removed unused functions: createEmptyTodo, fetchTodos, saveTodos, handleUpdateTodo, handleAddTodoRow, handleDeleteTodo, handleSaveTodoNote
  // These are now handled by BillingTodoTab component
  
  // Removed unused functions: saveAccountsReceivable, handleUpdateAR, handleAddARRow, handleDeleteAR
  // These are now handled by AccountsReceivableTab component

  const fetchProviderSheetData = async (isMonthChange = false, clearLoadingWhenDone = true) => {
    if (!clinicId || !providerId) {
      // Clear current provider data if providerId is removed
      setCurrentProvider(null)
      setCurrentSheet(null)
      updateLastSavedProviderRowsRef.current?.([])
      setProviderRows([])
      return
    }

    const captureKey = { providerId, monthKey: selectedMonthKey }
    const dedupeKey = `${clinicId}|${providerId}|${selectedMonthKey}`
    const inflightSheet = providerSheetDataInFlightRef.current.get(dedupeKey)
    if (inflightSheet) {
      providersDebugClinic('fetchProviderSheetData await in-flight', { dedupeKey })
      await inflightSheet
      return
    }

    const runFetchProviderSheetData = async () => {
    try {
      providersDebugClinic('fetchProviderSheetData run', {
        dedupeKey,
        providerId,
        monthKey: selectedMonthKey,
        isMonthChange,
      })
      // Avoid second spinner: if we already have data for this provider (e.g. effect re-ran after restore/save), don't show loading again
      const alreadyHaveData = (providerSheetRows[providerId]?.length ?? 0) > 0
      if (!isMonthChange && !alreadyHaveData) setLoading(true)

      // Always load this provider from the DB. The ref can be stale (e.g. super admin toggled
      // show_visit_type_column after fetchProviders, or single-provider route skipped fetchProviders).
      const providerFromRef = providersRef.current.find((p) => p.id === providerId) ?? null
      const { data: fetchedProvider, error: providerError } = await apiClient
        .from('providers')
        .select('*')
        .eq('id', providerId)
        .maybeSingle()

      if (providerError && providerError.code !== 'PGRST116') throw providerError
      const providerData: Provider | null =
        (fetchedProvider as Provider | null) ?? providerFromRef

      if (!providerData) {
        if (
          lastProviderSheetDataFetchRef.current?.providerId === captureKey.providerId &&
          lastProviderSheetDataFetchRef.current?.monthKey === captureKey.monthKey
        ) {
          setCurrentProvider(null)
          setCurrentSheet(null)
          updateLastSavedProviderRowsRef.current?.([])
          setProviderRows([])
          setProviderSheetRowsByMonth(prev => {
            const cur = prev[selectedMonthKey] ?? {}
            const updated = { ...cur }
            delete updated[providerId]
            return { ...prev, [selectedMonthKey]: updated }
          })
          if (clearLoadingWhenDone) setLoading(false)
        }
        return
      }

      const isStillCurrent = () =>
        lastProviderSheetDataFetchRef.current?.providerId === captureKey.providerId &&
        lastProviderSheetDataFetchRef.current?.monthKey === captureKey.monthKey

      if (!isStillCurrent()) return
      setCurrentProvider(providerData)
      // Sync this provider into the list (replace stale row when id already present).
      setProviders(curr => {
        const idx = curr.findIndex(p => p.id === providerData.id)
        if (idx < 0) {
          const next = [...curr, providerData]
          providersRef.current = next
          return next
        }
        const next = [...curr]
        next[idx] = providerData
        providersRef.current = next
        return next
      })

      // Use selected month/year and pay-period half (when clinic has payroll=2)
      const month = selectedMonth.getMonth() + 1
      const year = selectedMonth.getFullYear()
      const payroll = (clinic?.payroll === 2 ? selectedPayroll : (clinic?.payroll ?? 1)) as 1 | 2

      // Fetch sheet for the selected month/year (and half). Order by id so we get the same sheet when duplicates exist (matches dashboard).
      const { data: existingSheet, error: sheetsError } = await apiClient
        .from('provider_sheets')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('provider_id', providerId)
        .eq('month', month)
        .eq('year', year)
        .eq('payroll', payroll)
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (sheetsError && sheetsError.code !== 'PGRST116') throw sheetsError

      let sheet = existingSheet

      if (!sheet) {
        // Create a new sheet
        const { data: newSheet, error: createError } = await apiClient
          .from('provider_sheets')
          .insert({
            clinic_id: clinicId,
            provider_id: providerId,
            month,
            year,
            payroll,
            locked: false,
            locked_columns: [],
          })
          .select()
          .maybeSingle()

        if (createError) {
          if (createError.code === '23505') {
            const { data: refetchSheet, error: refetchError } = await apiClient
              .from('provider_sheets')
              .select('*')
              .eq('clinic_id', clinicId)
              .eq('provider_id', providerId)
              .eq('month', month)
              .eq('year', year)
              .eq('payroll', payroll)
              .order('id', { ascending: true })
              .limit(1)
              .maybeSingle()
            if (refetchError) throw refetchError
            if (refetchSheet) {
              sheet = refetchSheet
            }
          } else {
            throw createError
          }
        }
        if (!newSheet) {
          if (sheet) {
            // sheet was set by duplicate-key refetch
          } else {
          console.error('Failed to create provider sheet - no data returned')
          if (
            clearLoadingWhenDone &&
            lastProviderSheetDataFetchRef.current?.providerId === captureKey.providerId &&
            lastProviderSheetDataFetchRef.current?.monthKey === captureKey.monthKey
          ) {
            setLoading(false)
          }
          return
          }
        }
        sheet = sheet ?? newSheet
      }

      if (!isStillCurrent()) return
      setCurrentSheet(sheet)

      // Extract rows with CPT codes and appointment statuses
      const rows: Array<{
        id: string
        cpt_code: string
        appointment_status: string
        sheetId: string
        rowId: string
      }> = []

      let sheetRows: SheetRow[] = []
      if (sheet) {
        sheetRows = await fetchSheetRows(apiClient, sheet.id)
        let clinicPatientsList: Patient[] =
          patientsRef.current.length > 0 ? [...patientsRef.current] : []
        if (clinicPatientsList.length === 0) {
          const { data: clinicPatients } = await apiClient.from('patients').select('*').eq('clinic_id', clinicId)
          clinicPatientsList = (clinicPatients || []) as Patient[]
        }
        sheetRows = enrichSheetRowsFromPatients(sheetRows, clinicPatientsList)

        sheetRows.forEach((row: SheetRow) => {
          rows.push({
            id: row.id,
            cpt_code: row.billing_code || '',
            appointment_status: row.appointment_status || '',
            sheetId: sheet.id,
            rowId: row.id,
          })
        })
      }

      if (!isStillCurrent()) return
      updateLastSavedProviderRowsRef.current?.(rows)
      setProviderRows(rows)

      // Create empty rows for providers table (ROWS_PER_PROVIDER per provider — see constant)
      const createEmptyProviderSheetRow = (index: number): SheetRow => ({
        id: `empty-${index}`,
        patient_id: null,
        patient_first_name: null,
        patient_last_name: null,
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
        last_initial: null,
        cpt_code: null,
        cpt_code_color: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      const emptyRowsNeeded = Math.max(0, ROWS_PER_PROVIDER - sheetRows.length)
      const emptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
        createEmptyProviderSheetRow(i)
      )
      const allRows = [...sheetRows, ...emptyRows]
      if (!isStillCurrent()) return
      setProviderSheetRowsByMonth(prev => ({ ...prev, [selectedMonthKey]: { ...(prev[selectedMonthKey] ?? {}), [providerId]: allRows } }))
      setProviderSheetsByMonth(prev => ({ ...prev, [selectedMonthKey]: { ...(prev[selectedMonthKey] ?? {}), [providerId]: sheet } }))
      // Single-provider URL (/clinic/:id/providers/:pid) loads via this path, not fetchProviderSheets.
      // Without marking hydration here, saveProviderSheetRows' hydration guard silently drops every save.
      hydratedSheetKeysRef.current.add(`${clinicId}|${providerId}|${selectedMonthKey}`)
      lastProviderSheetContextRef.current = { clinicId: clinicId!, providerId, monthKey: selectedMonthKey }
      // Invalidate ProvidersTab's matrix cache. Without this, the cache (keyed on providerRowsVersion)
      // keeps serving the matrix built from rows that were in state BEFORE this fetch — newly-arrived
      // DB columns like `submit_date` / `appointment_date` appear blank in the grid even though they're
      // present in providerSheetRowsByMonth. ProvidersTab's clear-refs effect intentionally does not
      // depend on providerRowsVersion, so bumping here is safe (doesn't wipe latestProviderRowsRef).
      setProviderRowsVersion((v) => v + 1)
    } catch (error) {
      console.error('Error fetching provider sheet data:', error)
    } finally {
      if (
        clearLoadingWhenDone &&
        lastProviderSheetDataFetchRef.current?.providerId === captureKey.providerId &&
        lastProviderSheetDataFetchRef.current?.monthKey === captureKey.monthKey
      ) {
        setLoading(false)
      }
    }
    }

    const sheetDataFlight = runFetchProviderSheetData()
    providerSheetDataInFlightRef.current.set(dedupeKey, sheetDataFlight)
    try {
      await sheetDataFlight
    } finally {
      providerSheetDataInFlightRef.current.delete(dedupeKey)
    }
  }

  const saveProviderRows = useCallback(async (rowsToSave: typeof providerRows) => {
    if (!currentSheet) return

    try {
      const existingRows = await fetchSheetRows(apiClient, currentSheet.id)
      const existingRowsMap = new Map(existingRows.map((r: SheetRow) => [r.id, r]))
      const updatedRowData: SheetRow[] = []

      rowsToSave.forEach(row => {
        const existingRow = existingRowsMap.get(row.rowId)
        if (existingRow) {
          updatedRowData.push({
            ...existingRow,
            billing_code: row.cpt_code || null,
            appointment_status: row.appointment_status as any || null,
            updated_at: new Date().toISOString(),
          })
          existingRowsMap.delete(row.rowId)
        } else if (row.id.startsWith('new-')) {
          const newRow: SheetRow = {
            id: `row-${Date.now()}-${Math.random()}`,
            patient_id: null,
            patient_first_name: null,
            patient_last_name: null,
            patient_insurance: null,
            patient_copay: null,
            patient_coinsurance: null,
            appointment_date: null,
            appointment_time: null,
            visit_type: null,
            notes: null,
            billing_code: row.cpt_code || null,
            billing_code_color: null,
            appointment_status: row.appointment_status as any || null,
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
            last_initial: null,
            cpt_code: null,
            cpt_code_color: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          updatedRowData.push(newRow)
        }
      })
      existingRowsMap.forEach(row => updatedRowData.push(row))

      await saveSheetRows(apiClient, currentSheet.id, updatedRowData, undefined, undefined, { source: 'sync-provider-rows-fromLegacyState' })
      await fetchProviderSheetData()
    } catch (error) {
      console.error('Error saving provider rows:', error)
    }
  }, [currentSheet, fetchProviderSheetData])

  const { saveImmediately: _saveProviderRowsImmediately, updateLastSaved: updateLastSavedProviderRows } =
    useDebouncedSave(saveProviderRows, providerRows, 1000)
  updateLastSavedProviderRowsRef.current = updateLastSavedProviderRows


  const fetchProviders = async () => {
    if (fetchProvidersInFlightRef.current) {
      await fetchProvidersInFlightRef.current
      return
    }
    const run = (async () => {
      try {
        providersDebugClinic('fetchProviders → providers select *', { clinicId })
        const [providersRes, userEmails] = await Promise.all([
          apiClient
            .from('providers')
            .select('*')
            .eq('active', true)
            .contains('clinic_ids', [clinicId])
            .order('last_name')
            .order('first_name'),
          fetchActiveProviderUserEmails(),
        ])

        if (providersRes.error) throw providersRes.error
        const { displayedProviders } = dedupeProvidersByUser(
          (providersRes.data || []) as Provider[],
          userEmails
        )
        // Preserve any unsaved providers (with 'new-' prefix)
        setProviders((currentProviders) => {
          const unsavedProviders = currentProviders.filter((p) => p.id.startsWith('new-'))
          const next = [...unsavedProviders, ...displayedProviders]
          providersRef.current = next
          return next
        })
      } catch (error) {
        console.error('Error fetching providers:', error)
      } finally {
        fetchProvidersInFlightRef.current = null
      }
    })()
    fetchProvidersInFlightRef.current = run
    await run
  }

  const fetchProviderSheets = async (monthKey: string, isMonthChange = false, clearLoadingWhenDone = true) => {
    if (!clinicId || !userProfile) return

    const dedupeKey = `${clinicId}|${monthKey}|clinic-sheets`
    const inflight = providerSheetsInFlightRef.current.get(dedupeKey)
    if (inflight) {
      providersDebugClinic('fetchProviderSheets await in-flight', { dedupeKey })
      await inflight
      return
    }

    const runFetchProviderSheets = async () => {
    try {
      providersDebugClinic('fetchProviderSheets run start', { dedupeKey, monthKey, isMonthChange })
      // Avoid second spinner: if we already have data for this month (e.g. effect re-ran after restore/save), don't show loading again
      const alreadyHaveData = monthKey === selectedMonthKey && Object.keys(providerSheets).length > 0
      if (!isMonthChange && !alreadyHaveData) setLoading(true)
      // Derive month/year/payroll from monthKey so we fetch the requested month even if user changes month mid-fetch
      const parts = monthKey.split('-').map(Number)
      const year = parts[0]!
      const month = parts[1]!
      const payroll = (clinic?.payroll === 2 && parts[2] != null ? (parts[2] as 1 | 2) : (clinic?.payroll ?? 1)) as 1 | 2

      const providerIdsFromRef = providersRef.current.filter((p) => !p.id.startsWith('new-')).map((p) => p.id)
      let providerIds: string[]
      if (providerIdsFromRef.length > 0) {
        providerIds = providerIdsFromRef
      } else {
        const { data: providersData } = await apiClient
          .from('providers')
          .select('id')
          .eq('active', true)
          .contains('clinic_ids', [clinicId])

        if (!providersData || providersData.length === 0) {
          if (lastProviderSheetsFetchMonthKeyRef.current === monthKey) {
            lastProviderSheetContextRef.current = { clinicId, providerId: null, monthKey }
            if (clearLoadingWhenDone) setLoading(false)
          }
          return
        }
        providerIds = providersData.map((p: { id: string }) => p.id)
      }

      providersDebugClinic('fetchProviderSheets providerIds', {
        count: providerIds.length,
        source: providerIdsFromRef.length > 0 ? 'providersRef' : 'providers table',
      })

      let clinicPatientsList: Patient[] =
        patientsRef.current.length > 0 ? [...patientsRef.current] : []
      if (clinicPatientsList.length === 0) {
        providersDebugClinic('fetchProviderSheets enrich → patients select (patientsRef empty)', { clinicId })
        const { data: clinicPatientsForEnrich } = await apiClient.from('patients').select('*').eq('clinic_id', clinicId)
        clinicPatientsList = (clinicPatientsForEnrich || []) as Patient[]
      }

      // Fetch or create provider sheets for all providers (1 query for sheets + 1 for all rows, not 2×N)
      const sheetsMap: Record<string, ProviderSheet> = {}
      const providerIdSet = new Set(providerIds)

      const { data: allMonthSheets, error: monthSheetsError } = await apiClient
        .from('provider_sheets')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('month', month)
        .eq('year', year)
        .eq('payroll', payroll)
        .in('provider_id', providerIds)

      if (monthSheetsError) throw monthSheetsError

      const sheetsPerProvider = new Map<string, ProviderSheet[]>()
      for (const row of (allMonthSheets || []) as ProviderSheet[]) {
        const pid = row.provider_id
        if (!providerIdSet.has(pid)) continue
        if (!sheetsPerProvider.has(pid)) sheetsPerProvider.set(pid, [])
        sheetsPerProvider.get(pid)!.push(row)
      }
      for (const pid of providerIds) {
        const arr = sheetsPerProvider.get(pid)
        if (arr && arr.length > 0) {
          arr.sort((a, b) => a.id.localeCompare(b.id))
          sheetsMap[pid] = arr[0]!
        }
      }

      const mergeSheetIntoMap = (row: ProviderSheet) => {
        const pid = row.provider_id
        if (!providerIdSet.has(pid)) return
        const existing = sheetsMap[pid]
        if (!existing || row.id.localeCompare(existing.id) < 0) {
          sheetsMap[pid] = row
        }
      }

      const missingForCreate = providerIds.filter((pid) => !sheetsMap[pid])
      if (missingForCreate.length > 0) {
        const insertPayload = missingForCreate.map((provider_id) => ({
          clinic_id: clinicId,
          provider_id,
          month,
          year,
          payroll,
          locked: false,
          locked_columns: [] as string[],
        }))

        const { data: batchInserted, error: batchInsertError } = await apiClient
          .from('provider_sheets')
          .insert(insertPayload as Record<string, unknown>[])
          .select()

        if (!batchInsertError && batchInserted?.length) {
          for (const row of batchInserted as ProviderSheet[]) {
            mergeSheetIntoMap(row)
          }
        }

        let stillMissing = missingForCreate.filter((pid) => !sheetsMap[pid])
        if (stillMissing.length > 0) {
          const { data: refetchedCreated, error: refetchCreatedErr } = await apiClient
            .from('provider_sheets')
            .select('*')
            .eq('clinic_id', clinicId)
            .eq('month', month)
            .eq('year', year)
            .eq('payroll', payroll)
            .in('provider_id', stillMissing)

          if (!refetchCreatedErr && refetchedCreated) {
            for (const row of refetchedCreated as ProviderSheet[]) {
              mergeSheetIntoMap(row)
            }
          }
        }

        stillMissing = missingForCreate.filter((pid) => !sheetsMap[pid])
        for (const providerId of stillMissing) {
          const { data: newSheet, error: createError } = await apiClient
            .from('provider_sheets')
            .insert({
              clinic_id: clinicId,
              provider_id: providerId,
              month,
              year,
              payroll,
              locked: false,
              locked_columns: [],
            })
            .select()
            .maybeSingle()

          if (createError) {
            if (createError.code === '23505') {
              const { data: refetchSheet, error: refetchError } = await apiClient
                .from('provider_sheets')
                .select('*')
                .eq('clinic_id', clinicId)
                .eq('provider_id', providerId)
                .eq('month', month)
                .eq('year', year)
                .eq('payroll', payroll)
                .order('id', { ascending: true })
                .limit(1)
                .maybeSingle()
              if (refetchError || !refetchSheet) {
                console.error('Error refetching provider sheet after duplicate:', refetchError ?? createError)
                continue
              }
              sheetsMap[providerId] = refetchSheet
            } else {
              console.error('Error creating provider sheet:', createError)
            }
          } else if (newSheet) {
            sheetsMap[providerId] = newSheet
          } else {
            console.error('Failed to create provider sheet - no data returned')
          }
        }
      }

      const sheetIds = providerIds.map((pid) => sheetsMap[pid]?.id).filter(Boolean) as string[]
      const rowsBySheetId = await fetchSheetRowsForSheetIds(apiClient, sheetIds)

      const rowsMap: Record<string, SheetRow[]> = {}
      for (const providerId of providerIds) {
        const sheet = sheetsMap[providerId]
        if (!sheet) continue

        let sheetRows = rowsBySheetId.get(sheet.id) ?? []
        sheetRows = enrichSheetRowsFromPatients(sheetRows, clinicPatientsList)

        const createEmptyProviderSheetRow = (index: number): SheetRow => ({
          id: `empty-${providerId}-${index}`,
          patient_id: null,
          patient_first_name: null,
          patient_last_name: null,
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
          last_initial: null,
          cpt_code: null,
          cpt_code_color: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })

        const emptyRowsNeeded = Math.max(0, ROWS_PER_PROVIDER - sheetRows.length)
        const emptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => createEmptyProviderSheetRow(i))
        rowsMap[providerId] = [...sheetRows, ...emptyRows]
      }

      const isStillCurrentMonth = lastProviderSheetsFetchMonthKeyRef.current === monthKey
      if (isStillCurrentMonth) {
        providersDebugClinic('fetchProviderSheets success', {
          monthKey,
          providersWithSheet: Object.keys(sheetsMap).length,
          batchedSheetIdsForRows: sheetIds.length,
        })
        // Mark each (clinic, provider, month) tuple as hydrated so saveProviderSheetRows will accept writes.
        for (const providerId of providerIds) {
          if (sheetsMap[providerId]) {
            hydratedSheetKeysRef.current.add(`${clinicId}|${providerId}|${monthKey}`)
          }
        }
        setProviderSheetsByMonth(prev => ({ ...prev, [monthKey]: sheetsMap }))
        setProviderSheetRowsByMonth(prev => ({ ...prev, [monthKey]: rowsMap }))
        lastProviderSheetContextRef.current = { clinicId, providerId: null, monthKey }
        // Invalidate ProvidersTab's matrix cache so newly-arrived columns (submit_date, appointment_date,
        // etc.) actually render — see the matching bump in fetchProviderSheetData for the rationale.
        setProviderRowsVersion((v) => v + 1)
        return { sheetsMap, rowsMap }
      }
    } catch (error) {
      console.error('Error fetching provider sheets:', error)
    } finally {
      if (clearLoadingWhenDone && lastProviderSheetsFetchMonthKeyRef.current === monthKey) {
        setLoading(false)
      }
    }
    }

    const sheetsFlight = runFetchProviderSheets()
    providerSheetsInFlightRef.current.set(dedupeKey, sheetsFlight)
    try {
      await sheetsFlight
    } finally {
      providerSheetsInFlightRef.current.delete(dedupeKey)
    }
  }



  const saveProviderSheetRows = useCallback(async (providerId: string, rowsToSave: SheetRow[], knownDeletedIds?: string[], monthKeyOverride?: string, source?: string): Promise<boolean> => {
    // monthKey is captured once at call entry. The drain effect passes the ORIGINAL monthKey from when
    // the save was queued — without that, a deferred save that fires after the user navigated to a
    // different month would persist the old month's rows under the new month's sheet (the "her June
    // data is in May" symptom we already eliminated for the synchronous path via the flush callback).
    const monthKey = monthKeyOverride ?? selectedMonthKey

    // clinicId comes from route params and is stable for the lifetime of this ClinicDetail mount. If it's
    // missing the whole page is in an unrecoverable state — no queue key we could build now would be
    // valid at replay time (drain uses `${clinicId}|providerId|monthKey` for hydration). Drop.
    if (!clinicId) {
      console.warn('[saveProviderSheetRows] dropped — missing clinicId (route not resolved)', { providerId })
      return false
    }
    if (!userProfile) {
      // Auth not yet hydrated (initial mount / session re-fetch). Queue instead of dropping so the drain
      // effect replays this once `userProfile` loads. Symmetric with the `!sheet` and hydration guards
      // below; the previous silent-drop here matched the "silent save guards" pattern that already bit
      // us once (edits vanish, optimistic UI hides the loss, DB fetch on remount reveals the gap).
      const queueKey = `${providerId}|${monthKey}`
      deferredSavesRef.current.set(queueKey, { providerId, rowsToSave, knownDeletedIds, monthKey, queuedAt: Date.now() })
      console.warn('[saveProviderSheetRows] DEFERRED — userProfile not yet loaded (will retry when auth completes)', { providerId, monthKey })
      return false
    }

    const sheetsForMonth = providerSheetsByMonth[monthKey] ?? {}
    const sheet = sheetsForMonth[providerId]
    if (!sheet) {
      // Queue rather than drop. The sheet entry may be loading right now (single-provider URL hits
      // `fetchProviderSheetData` which populates `providerSheetsByMonth[monthKey][providerId]` only
      // after the network round-trip). Dropping here is what made early-session typing vanish.
      const queueKey = `${providerId}|${monthKey}`
      deferredSavesRef.current.set(queueKey, { providerId, rowsToSave, knownDeletedIds, monthKey, queuedAt: Date.now() })
      console.warn('[saveProviderSheetRows] DEFERRED — providerSheets has no entry for this providerId (will retry when sheet loads)', { providerId, monthKey, knownProviderIds: Object.keys(sheetsForMonth) })
      return false
    }

    // Hydration guard: never persist rows for a (clinic, provider, month) tuple whose DB rows haven't
    // been loaded yet. Without this, a save triggered during initial mount (debounced edit, mount-restore,
    // patient-fill effect) would persist an empty/partial state. With the orphan sweep removed this is
    // belt-and-suspenders, but it also avoids overwriting freshly-saved rows with stale local state.
    const hydrationKey = `${clinicId}|${providerId}|${monthKey}`
    if (!hydratedSheetKeysRef.current.has(hydrationKey)) {
      // Queue rather than drop. This is the path Jenali kept hitting on Morgan's June sheet: the page
      // defaulted to current month, the user typed before the initial fetch completed, the hydration
      // guard returned false silently, and her edits were never retried. The drain effect below re-fires
      // this entry once `fetchProviderSheetData` marks the tuple hydrated.
      const queueKey = `${providerId}|${monthKey}`
      deferredSavesRef.current.set(queueKey, { providerId, rowsToSave, knownDeletedIds, monthKey, queuedAt: Date.now() })
      console.warn('[saveProviderSheetRows] DEFERRED — sheet not yet hydrated (will retry when hydration completes)', { providerId, monthKey, hydrationKey })
      return false
    }

    // Remap any temp ids this tab already promoted to UUIDs (prior save / queued replay /
    // remount). Without this, a second POST still carrying `new-*` INSERTs a duplicate row.
    const promotionKey = sheetTempIdPromotionKey(clinicId, providerId, monthKey)
    const rowsForThisSave = applyTempIdPromotions(rowsToSave, getTempIdPromotions(promotionKey))

    // Filter out only truly empty rows (empty- rows with no data)
    const rowsToProcess = rowsForThisSave.filter(r => {
      if (r.id.startsWith('empty-')) {
        const hasData = r.patient_id ||
                       r.patient_first_name || r.last_initial || r.patient_insurance ||
                       r.patient_copay != null || r.patient_coinsurance != null ||
                       r.appointment_date || r.cpt_code || r.appointment_status || r.claim_status ||
                       r.submit_date || r.insurance_payment || r.payment_date || r.insurance_adjustment ||
                       r.collected_from_patient || r.patient_pay_status || r.ar_date || r.total !== null || r.notes
        return hasData
      }
      return true
    })

    // Serialize: only one save per provider at a time so an older save cannot overwrite a newer one
    // in the DB. When busy, queue the call (accumulating knownDeletedIds across multiple queued saves
    // so deletes never get dropped) and return a promise that resolves when the eventual save completes.
    if (saveProviderSheetInProgressRef.current.has(providerId)) {
      const incomingDeletes = (knownDeletedIds ?? []).filter((id) => isUuid(id))
      return new Promise<boolean>((resolve, reject) => {
        const existing = pendingProviderSheetSaveRef.current[providerId]
        if (existing) {
          existing.rows = rowsForThisSave
          existing.monthKey = monthKey
          if (incomingDeletes.length > 0) {
            const seen = new Set(existing.deletedDbIds)
            for (const id of incomingDeletes) {
              if (!seen.has(id)) {
                existing.deletedDbIds.push(id)
                seen.add(id)
              }
            }
          }
          existing.resolvers.push({ resolve, reject })
        } else {
          pendingProviderSheetSaveRef.current[providerId] = {
            rows: rowsForThisSave,
            deletedDbIds: incomingDeletes,
            resolvers: [{ resolve, reject }],
            monthKey,
          }
        }
      })
    }
    saveProviderSheetInProgressRef.current.add(providerId)

    // Built synchronously from savedRows right after saveSheetRows returns — no React batching delay.
    // Maps every temp id (new-*, empty-* with data) that was sent as an INSERT to the real UUID
    // the DB assigned. Used in finally to reconcile any queued pending before replay so we UPDATE
    // instead of INSERT again (which creates duplicate provider_sheet_rows).
    let savedTempIdToUuidMap: Map<string, string> | null = null

    // Optimistic update: apply full rows to state immediately so the row (e.g. patient fill) appears right away.
    // Use the captured `monthKey` so a deferred save replayed for the original month writes to that month's
    // slot in state — never to whatever month the user happens to be viewing right now.
    setProviderSheetRowsByMonth(prev => ({ ...prev, [monthKey]: { ...(prev[monthKey] ?? {}), [providerId]: rowsForThisSave } }))

    // Tracks whether saveSheetRows actually persisted to the DB. Returned to the caller so the
    // localStorage restore effect can tell the difference between a real save and a swallowed error;
    // without this the restore .then() removed the last-resort backup even when the network call failed.
    let didPersist = false
    try {
      // Do not coerce omitted arg to [] — [] skips deletes and skips orphan SELECT (saveSheetRows treats [] as explicit).
      // Pending replays omit knownDeletedIds so orphans are cleaned via SELECT path.
      const savedRows = await saveSheetRows(apiClient, sheet.id, rowsToProcess, knownDeletedIds, {
        clinicId,
        providerId,
        selectedMonthKey: monthKey,
      }, {
        // Echoed into the server audit table only. Callers of saveProviderSheetRows pass a hint
        // (pagehide-drain / restore / delete / add-row / debounced / etc.) so the audit viewer
        // can filter "which client trigger caused this save?" without guessing from timing.
        source: source ?? 'unknown',
      })
      didPersist = true
      // Record the successful-save timestamp BEFORE any post-save state work so the drain effect's
      // "skip subsumed entries" check (see below) can rely on it the moment React commits the next batch.
      lastSuccessfulSaveAtRef.current.set(`${providerId}|${monthKey}`, Date.now())
      // Clear the error banner since a save just succeeded. Stale failures from minutes ago shouldn't
      // keep haunting the screen once writes are flowing again.
      setSaveErrorMessage(null)
      // Patient demographics are owned by `patients` (Patients tab / API), not pushed from provider sheets.
      const freshPatients =
        patientsRef.current.length > 0
          ? patientsRef.current
          : (await fetchPatients()) ?? []
      try {
        const pendingKey = `provider_sheet_pending_${clinicId}_${providerId}_${monthKey}`
        localStorage.removeItem(pendingKey)
      } catch (_) {}
      // Populate the synchronous id map right after the network response — before any React state update.
      savedTempIdToUuidMap = collectTempIdPromotions(rowsToProcess, savedRows)
      mergeTempIdPromotions(promotionKey, savedTempIdToUuidMap)
      const savedRowsByOldId = new Map<string, SheetRow>()
      const savedRowsByAnyId = new Map<string, SheetRow>()
      rowsToProcess.forEach((row, i) => {
        const saved = savedRows[i]
        if (!saved) return
        savedRowsByOldId.set(row.id, saved)
        savedRowsByAnyId.set(row.id, saved)
        savedRowsByAnyId.set(saved.id, saved)
      })

      // Merge saved row ids, then apply co-patient demographics to all providers for this month (last-write-wins from DB).
      setProviderSheetRowsByMonth((prev) => {
        const current = prev[monthKey] ?? {}
        const currentRows = current[providerId] || []
        const updatedRows = currentRows.map((row) => {
          const savedRow = savedRowsByOldId.get(row.id) ?? savedRowsByAnyId.get(row.id)
          if (savedRow) {
            // PatientsTab-style merge: preserve current editable values and only apply DB identity/timestamps
            // so an older save response can't clobber newer in-flight edits.
            return {
              ...row,
              id: savedRow.id,
              created_at: savedRow.created_at,
              updated_at: savedRow.updated_at,
            }
          }
          return row
        })

        const nonEmptyRows = updatedRows.filter((r) => !r.id.startsWith('empty-'))
        const emptyRowsNeeded = Math.max(0, ROWS_PER_PROVIDER - nonEmptyRows.length)
        const existingEmptyCount = updatedRows.filter((r) => r.id.startsWith('empty-')).length
        let nextForProvider = updatedRows
        if (emptyRowsNeeded > existingEmptyCount) {
          const createEmptyRow = (index: number): SheetRow => ({
            id: `empty-${providerId}-${index}`,
            patient_id: null,
            patient_first_name: null,
            patient_last_name: null,
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
            last_initial: null,
            cpt_code: null,
            cpt_code_color: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          const newEmptyRows = Array.from({ length: emptyRowsNeeded - existingEmptyCount }, (_, i) =>
            createEmptyRow(existingEmptyCount + i)
          )
          nextForProvider = [...updatedRows, ...newEmptyRows]
        }

        let nextMonthRows: Record<string, SheetRow[]> = { ...current, [providerId]: nextForProvider }
        if (freshPatients.length > 0) {
          const merged: Record<string, SheetRow[]> = {}
          for (const [pid, rws] of Object.entries(nextMonthRows)) {
            merged[pid] = applyCoPatientSnapshotToSheetRows(rws, freshPatients)
          }
          nextMonthRows = merged
        }
        return { ...prev, [monthKey]: nextMonthRows } as Record<string, Record<string, SheetRow[]>>
      })
      if (freshPatients.length > 0) {
        setProviderRowsVersion((v) => v + 1)
      }
    } catch (error) {
      console.error('[ClinicDetail] saveProviderSheetRows failed: providerId=', providerId, error)
      // Surface the failure as a top-of-page banner so the user knows their typing didn't persist.
      // Without this, the optimistic state update at line ~2581 makes the row LOOK saved on screen,
      // and the data only disappears later when something (her next refresh, a navigation that triggers
      // a fetch) overwrites the optimistic state with the still-stale DB. That gap between
      // "looks-saved-but-isn't" and "noticed-it's-gone" is what causes the hours-later data loss
      // report Jenali keeps making.
      const detail = error instanceof Error ? error.message : 'Unknown error'
      setSaveErrorMessage(`Save failed: ${detail}. Your changes are backed up locally; refresh after the issue is fixed to retry.`)
    } finally {
      saveProviderSheetInProgressRef.current.delete(providerId)
      const pending = pendingProviderSheetSaveRef.current[providerId]
      if (pending) {
        delete pendingProviderSheetSaveRef.current[providerId]
        const idMap = mergeTempIdPromotions(promotionKey, savedTempIdToUuidMap ?? new Map())
        const toSave = applyTempIdPromotions(pending.rows, idMap)
        const pendingDeletes = pending.deletedDbIds.length > 0 ? pending.deletedDbIds : undefined
        // Forward queued knownDeletedIds + settle the promises that every queued caller awaits.
        // Propagate the eventual `persisted` boolean so the localStorage restore path can tell whether
        // its replay actually reached the DB (silent guard hits would otherwise look like success).
        // Pass `pending.monthKey` so the replay targets the queuer's intended month, not whatever month
        // the user has navigated to since.
        saveProviderSheetRows(providerId, toSave, pendingDeletes, pending.monthKey, 'deferred-drain-queued')
          .then((persisted) => pending.resolvers.forEach((r) => r.resolve(persisted)))
          .catch((err) => pending.resolvers.forEach((r) => r.reject(err)))
      }
    }
    return didPersist
  }, [clinicId, userProfile, providerSheetsByMonth, selectedMonthKey, fetchPatients])

  /** Drain queued saves whose guard preconditions are now satisfied. Replaces the silent `return false`
   *  behavior that used to drop early-mount typing on the floor. Runs whenever the dataset that controls
   *  the guards changes — `providerSheetsByMonth` (sheet entry appearing), `clinicId` / `userProfile`
   *  (auth becoming ready). Both fetch sites perform `hydratedSheetKeysRef.current.add(...)` and
   *  `setProviderSheetsByMonth(...)` in the same synchronous task, so by the time React commits the
   *  state update and this effect fires, the hydration ref is already populated.
   *
   *  Critical correctness: we pass the ORIGINAL `monthKey` from the queued entry as the 4th arg, so the
   *  drained save persists to the month the user was actually typing in — not whatever month is currently
   *  selected. Without that, navigating away after a deferred queue would re-create the "her June data
   *  in May" symptom. */
  useEffect(() => {
    if (deferredSavesRef.current.size === 0) return
    if (!clinicId || !userProfile) return
    const toRetry: DeferredProviderSheetSave[] = []
    for (const [queueKey, entry] of deferredSavesRef.current) {
      const sheetsForMonth = providerSheetsByMonth[entry.monthKey] ?? {}
      const sheet = sheetsForMonth[entry.providerId]
      if (!sheet) continue
      const hydrationKey = `${clinicId}|${entry.providerId}|${entry.monthKey}`
      if (!hydratedSheetKeysRef.current.has(hydrationKey)) continue
      // Skip if a successful save for the same target has already landed AFTER this entry was queued.
      // Replaying the older (sparser) snapshot would clobber the newer DB state. The newer save's
      // payload was a strict superset (built from latestProviderRowsRef which had accumulated the
      // earlier edits too), so the queued entry is subsumed and safe to drop.
      const lastSaveAt = lastSuccessfulSaveAtRef.current.get(queueKey) ?? 0
      if (lastSaveAt > entry.queuedAt) {
        console.log('[ClinicDetail] dropping subsumed deferred save', { providerId: entry.providerId, monthKey: entry.monthKey, queuedAt: entry.queuedAt, lastSaveAt })
        deferredSavesRef.current.delete(queueKey)
        continue
      }
      toRetry.push(entry)
      deferredSavesRef.current.delete(queueKey)
    }
    for (const entry of toRetry) {
      console.log('[ClinicDetail] draining deferred save', { providerId: entry.providerId, monthKey: entry.monthKey, rows: entry.rowsToSave.length, queuedMsAgo: Date.now() - entry.queuedAt })
      saveProviderSheetRows(entry.providerId, entry.rowsToSave, entry.knownDeletedIds, entry.monthKey, 'deferred-replay')
        .catch((err) => console.error('[ClinicDetail] deferred save replay failed:', err))
    }
  }, [providerSheetsByMonth, clinicId, userProfile, saveProviderSheetRows])

  /** Restore the live sheet to the snapshot identified by `backupId`. Captures the current rows so
   *  Ctrl+Z (or the dismiss button on the restore toast) can revert. Window is 30 seconds; after
   *  that the snapshot is dropped — the restore is then permanent. */
  const handleAutoBackupRestore = useCallback(async (backupId: string) => {
    if (!providerId) throw new Error('No active provider')
    const targetMonthKey = selectedMonthKey
    const backup = await getAutoBackup(backupId)
    // Snapshot CURRENT rows before applying restore so Ctrl+Z has something to revert to.
    const currentRowsForProvider =
      (providerSheetRowsByMonthRef.current[targetMonthKey] ?? {})[providerId] ?? []
    const expiresAt = Date.now() + 30_000
    restoreSnapshotRef.current = {
      providerId,
      monthKey: targetMonthKey,
      rows: currentRowsForProvider,
      restoredAt: Date.now(),
      expiresAt,
    }
    // Restore is now "wipe and recreate": strip UUIDs from backup rows so the server INSERTs each
    // as a fresh row with a new UUID, and pass every current UUID as knownDeletedIds so old rows
    // (including any duplicates that accumulated since the backup) are wiped.
    //
    // Why this instead of matching UUIDs to UPDATE existing rows: the server treats UUID row ids as
    // UPDATE-only (serviceRoutes.ts:367-432) — an UPDATE that finds no row is a silent no-op, no
    // INSERT fallback. That's fine when the DB is in a healthy state, but Spencer's June/July got
    // knocked into partial/empty states by prior buggy restore attempts (before the current fix).
    // Once the DB is empty for a sheet, backup rows can't repopulate it: their UUIDs don't exist to
    // UPDATE, so the server silently does nothing, and the sheet stays blank across refreshes.
    // Stripping UUIDs makes the server route treat every backup row as INSERT — predictable
    // outcome regardless of DB state, sheet ends up equal to the backup no matter what.
    //
    // No foreign keys reference provider_sheet_rows.id from other tables (grep confirmed), so a
    // new UUID per row does not break any cross-table references.
    const restoredRows = padSheetRowsToBase(backup.rows as SheetRow[]).map((r) => {
      if (!isUuid(r.id)) return r
      // Non-UUID (empty-*, backup-*, new-*, empty string) already gets INSERTed by the server;
      // only UUIDs need re-labeling. Random suffix so multiple restore attempts don't collide on
      // the same `new-N` id within a single batch.
      const newId = `new-restore-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      return { ...r, id: newId }
    })
    const preExistingIds = currentRowsForProvider.map((r) => r.id).filter(isUuid)
    await saveProviderSheetRows(providerId, restoredRows, preExistingIds, targetMonthKey, 'auto-backup-restore')
    // Bump providerRowsVersion so HOT updateSettings runs with the merged row IDs — without this,
    // the grid keeps showing the pre-restore data even though state changed.
    setProviderRowsVersion((v) => v + 1)
    setRestoreToast({
      message: `Restored from ${new Date(backup.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}. Click Undo within 30 seconds if this was a mistake.`,
      expiresAt,
    })
    setAutoBackupsRefreshKey((k) => k + 1)
    // Expire the snapshot + toast after the window passes. Compare against the exact snapshot we
    // just set so a newer restore (overlapping windows) doesn't get its timer prematurely cleared.
    setTimeout(() => {
      const snap = restoreSnapshotRef.current
      if (snap && snap.expiresAt === expiresAt) restoreSnapshotRef.current = null
      setRestoreToast((t) => (t && t.expiresAt === expiresAt ? null : t))
    }, 30_000)
  }, [providerId, selectedMonthKey, saveProviderSheetRows])

  /** Revert the most recent restore (Ctrl+Z or toast dismiss) by re-applying the snapshot we kept.
   *  Same "wipe and recreate" shape as handleAutoBackupRestore: strip UUIDs from the snapshot rows
   *  so the server INSERTs each as a fresh row (works regardless of current DB state), and delete
   *  all current UUID rows. Turns undo into a predictable atomic swap. */
  const handleUndoLastRestore = useCallback(async () => {
    const snap = restoreSnapshotRef.current
    if (!snap) return
    restoreSnapshotRef.current = null
    setRestoreToast(null)
    if (!snap.rows.length) return
    try {
      const currentRows =
        (providerSheetRowsByMonthRef.current[snap.monthKey] ?? {})[snap.providerId] ?? []
      const rowsForUndo = snap.rows.map((r) => {
        if (!isUuid(r.id)) return r
        const newId = `new-undo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        return { ...r, id: newId }
      })
      const idsToDelete = currentRows.map((r) => r.id).filter(isUuid)
      await saveProviderSheetRows(snap.providerId, rowsForUndo, idsToDelete, snap.monthKey, 'auto-backup-restore-undo')
      setProviderRowsVersion((v) => v + 1)
    } catch (e) {
      console.error('[auto-backup] undo restore failed:', e)
    }
  }, [saveProviderSheetRows])

  /** Bumped when auto-backups list needs to refresh (e.g. after a manual trigger, after restore). */
  const [autoBackupsRefreshKey, setAutoBackupsRefreshKey] = useState(0)

  // Note: we intentionally do NOT install a global Ctrl+Z handler for "undo the last restore".
  // Per Jenali, Ctrl+Z must keep its standard meaning — undo the last cell edit, routed through
  // Handsontable's own undo stack. Mistaken restores are recoverable via the explicit "Undo" button
  // on the restore toast banner; that's the only undo path for restore actions.

  /** Fire-and-forget snapshot of the active Billing sheet's rows to the auto-backups table.
   *
   *  Called from the four tab-leave-shaped triggers: tab change, provider switch, month switch, and
   *  the unmount cleanup that fires when the user navigates away from the route entirely. The
   *  60-second cooldown per sheet keeps a rapid sequence (Billing → Patients → Billing → Patients
   *  → Billing) from creating four near-identical snapshots.
   *
   *  Errors are swallowed: this is a safety net, not a primary write path. If the auto-backup POST
   *  fails, the user's actual save is still going through the live `saveProviderSheetRows` path
   *  (and now surfaces failures via the saveErrorMessage banner). We log to console only.
   *
   *  Only fires when the labeled "Billing" tab (activeTab === 'providers') is the source. Other tabs
   *  do not auto-backup yet — see the design doc / chat history; we shipped Billing-only by choice. */
  const triggerAutoBackup = useCallback(async () => {
    if (activeTab !== 'providers') return
    if (!currentSheet?.id) return
    const sheetId = currentSheet.id
    // 60-second cooldown.
    const lastAt = lastAutoBackupAtRef.current.get(sheetId) ?? 0
    if (Date.now() - lastAt < 60_000) return
    // Use the latest rows in state for the active provider + monthKey. If state is empty (sheet
    // hasn't hydrated yet), there's nothing meaningful to back up — skip.
    const targetProviderId = providerId
    if (!targetProviderId) return
    const rows = providerSheetRowsByMonthRef.current[selectedMonthKey]?.[targetProviderId]
    if (!rows || rows.length === 0) return
    // Drop empty-* placeholder rows — they're padding, not data. The server's `rowHasData` filter
    // would do this anyway; we strip on the client to keep the payload small.
    const meaningfulRows = rows.filter((r) =>
      !r.id.startsWith('empty-') ||
      !!(r.patient_id || r.appointment_date || r.cpt_code || r.appointment_status || r.claim_status ||
         r.submit_date || r.insurance_payment || r.payment_date || r.insurance_adjustment ||
         r.collected_from_patient || r.patient_pay_status || r.ar_date || r.total !== null || r.notes),
    )
    if (meaningfulRows.length === 0) return
    lastAutoBackupAtRef.current.set(sheetId, Date.now())
    try {
      await createAutoBackup(sheetId, meaningfulRows)
    } catch (e) {
      // Swallow — the banner from the primary save is the user-facing failure signal.
      console.warn('[auto-backup] tab-leave snapshot failed:', e)
    }
  }, [activeTab, currentSheet, providerId, selectedMonthKey])

  /** Stable ref to the latest triggerAutoBackup so callers from places without it in scope (like the
   *  unmount cleanup useEffect that has no dependency on `triggerAutoBackup`) still fire the most
   *  recent version of the function. */
  const triggerAutoBackupRef = useRef(triggerAutoBackup)
  useEffect(() => { triggerAutoBackupRef.current = triggerAutoBackup }, [triggerAutoBackup])

  // Fire an auto-backup when the user navigates away from the Billing route entirely (sidebar click,
  // browser back, URL change to a non-clinic page). The cleanup runs on unmount of ClinicDetail; by
  // that point, the saved-rows state is still in memory (refs survive long enough to read), so the
  // snapshot is the user's intent at the moment of leaving.
  useEffect(() => {
    return () => {
      void triggerAutoBackupRef.current()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: unmount-only fire-and-forget
  }, [])

  // Fire an auto-backup when the active provider changes within the same ClinicDetail instance.
  // (Different from the unmount path: this fires on URL `/providers/:providerId` changes while the
  // component stays mounted via React Router. Captures the OLD providerId via a ref-tracked prev.)
  const prevProviderIdForBackupRef = useRef<string | null | undefined>(providerId)
  useEffect(() => {
    if (prevProviderIdForBackupRef.current && prevProviderIdForBackupRef.current !== providerId) {
      void triggerAutoBackupRef.current()
    }
    prevProviderIdForBackupRef.current = providerId
  }, [providerId])

  // Fire an auto-backup when the selected month changes. The flush-before-month-change callback at
  // the JSX site already guarantees pending saves are committed first, so by the time React commits
  // the new selectedMonth the rows in state reflect everything the user typed.
  const prevMonthKeyForBackupRef = useRef<string>(selectedMonthKey)
  useEffect(() => {
    if (prevMonthKeyForBackupRef.current && prevMonthKeyForBackupRef.current !== selectedMonthKey) {
      // We need to back up the OLD month's rows. Read them directly from the ref keyed by the prev
      // monthKey so the trigger doesn't accidentally snapshot the new month (which is what the
      // triggerAutoBackup closure would do since it reads selectedMonthKey).
      const prevMonthKey = prevMonthKeyForBackupRef.current
      ;(async () => {
        if (activeTab !== 'providers') return
        if (!providerId) return
        const cacheForPrev = providerSheetRowsByMonthRef.current[prevMonthKey]?.[providerId]
        if (!cacheForPrev || cacheForPrev.length === 0) return
        // Use the sheet id for the OLD month, not the current sheet.
        const sheetForPrev = providerSheetsByMonth[prevMonthKey]?.[providerId]
        if (!sheetForPrev?.id) return
        const lastAt = lastAutoBackupAtRef.current.get(sheetForPrev.id) ?? 0
        if (Date.now() - lastAt < 60_000) return
        const meaningfulRows = cacheForPrev.filter((r) =>
          !r.id.startsWith('empty-') ||
          !!(r.patient_id || r.appointment_date || r.cpt_code || r.appointment_status || r.claim_status ||
             r.submit_date || r.insurance_payment || r.payment_date || r.insurance_adjustment ||
             r.collected_from_patient || r.patient_pay_status || r.ar_date || r.total !== null || r.notes),
        )
        if (meaningfulRows.length === 0) return
        lastAutoBackupAtRef.current.set(sheetForPrev.id, Date.now())
        try {
          await createAutoBackup(sheetForPrev.id, meaningfulRows)
        } catch (e) {
          console.warn('[auto-backup] month-change snapshot failed:', e)
        }
      })()
    }
    prevMonthKeyForBackupRef.current = selectedMonthKey
  }, [selectedMonthKey, activeTab, providerId, providerSheetsByMonth])

  // Restore provider sheet rows from localStorage after refresh (browser aborts in-flight save; data
  // was backed up on unload). Two staleness guards prevent clobbering valid DB data:
  //   1. Age guard: skip entries older than 10 min.
  //   2. DB-vs-localStorage freshness guard: skip if any fetched DB row's updated_at is newer than
  //      localStorage.savedAt — the user already saved successfully and localStorage is just stale.
  //      Replaying would overwrite fresh DB data with the older typing.
  const PENDING_ROWS_KEY_PREFIX = 'provider_sheet_pending_'
  const PENDING_ROWS_MAX_AGE_MS = 10 * 60 * 1000
  const restoredPendingKeysRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!clinicId || !selectedMonthKey || !providerSheets || Object.keys(providerSheets).length === 0) return
    const now = Date.now()
    const providerIds = Object.keys(providerSheets)
    providerIds.forEach((providerId) => {
      const key = `${PENDING_ROWS_KEY_PREFIX}${clinicId}_${providerId}_${selectedMonthKey}`
      if (restoredPendingKeysRef.current.has(key)) return
      try {
        const raw = localStorage.getItem(key)
        if (!raw) return
        const data = JSON.parse(raw) as { rows: SheetRow[]; savedAt: number }
        if (!data.rows?.length || !data.savedAt) return
        if (now - data.savedAt > PENDING_ROWS_MAX_AGE_MS) {
          localStorage.removeItem(key)
          return
        }
        // DB-vs-localStorage freshness check (matches ProviderSheetPage). Only consider rows that
        // came from the DB (UUID ids). `empty-*` placeholders are minted on every fetch with
        // `updated_at: new Date().toISOString()`, so including them made mostRecentDbUpdate ≈ "now",
        // which falsely declared every localStorage backup stale and silently deleted it without
        // saving — the exact "data shown for days, never reached the DB" symptom Jenali reported.
        const currentRows =
          (providerSheetRowsByMonthRef.current[selectedMonthKey] ?? {})[providerId] ?? []
        let mostRecentDbUpdate = 0
        for (const row of currentRows) {
          if (!isUuid(row.id)) continue
          if (row.updated_at && typeof row.updated_at === 'string') {
            const t = new Date(row.updated_at).getTime()
            if (Number.isFinite(t) && t > mostRecentDbUpdate) mostRecentDbUpdate = t
          }
        }
        if (mostRecentDbUpdate > data.savedAt) {
          localStorage.removeItem(key)
          return
        }
        restoredPendingKeysRef.current.add(key)
        const promotedRows = applyTempIdPromotions(
          data.rows,
          getTempIdPromotions(sheetTempIdPromotionKey(clinicId, providerId, selectedMonthKey)),
        )
        // Only delete the localStorage backup if saveProviderSheetRows actually persisted to DB.
        // A silently-dropped save (guard fail, missing sheet, not yet hydrated) resolves to `false`;
        // keeping the key gives the next mount / pagehide keepalive another chance to land the data.
        saveProviderSheetRows(providerId, promotedRows, undefined, undefined, 'localstorage-restore-on-mount').then((persisted) => {
          if (persisted) {
            try { localStorage.removeItem(key) } catch (_) {}
          } else {
            console.warn('[ClinicDetail] Restore pending save not persisted; keeping localStorage backup', { key, providerId, monthKey: selectedMonthKey })
            restoredPendingKeysRef.current.delete(key)
          }
        }).catch(err => {
          console.error('[ClinicDetail] Restore pending save failed:', err)
          restoredPendingKeysRef.current.delete(key)
        })
      } catch (_) {
        try { localStorage.removeItem(key) } catch (__) {}
      }
    })
  // Do not depend on providerSheetRows — it changes every edit/save and would re-run restore (duplicate DB writes / races).
  }, [clinicId, selectedMonthKey, providerSheets, saveProviderSheetRows])

  // On page unload (refresh/close), send pending provider sheet rows via keepalive fetch so the save can complete even after the page is gone.
  // Only replays entries that (a) match the currently open clinic, (b) are <10 min old, and (c) have at least one meaningful row.
  // Without these guards a stale backup from a prior session could POST partial rows against the wrong sheet context.
  useEffect(() => {
    const PREFIX = 'provider_sheet_pending_'
    const PAGEHIDE_MAX_AGE_MS = 10 * 60 * 1000
    const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
    const savePendingUrl = apiBase ? `${apiBase}/api/save-provider-sheet-rows` : '/api/save-provider-sheet-rows'

    const onPageHide = (fromVisibility = false) => {
      let token: string | null = null
      try {
        const raw = localStorage.getItem('health-billing-auth')
        if (raw) {
          const data = JSON.parse(raw) as { currentSession?: { access_token?: string }; access_token?: string }
          token = data?.currentSession?.access_token ?? data?.access_token ?? null
        }
      } catch (_) {}
      if (!token) return
      if (!clinicId) return

      const now = Date.now()
      const keysToSend: string[] = []
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key?.startsWith(PREFIX)) keysToSend.push(key)
        }
      } catch (_) {}

      keysToSend.forEach((key) => {
        try {
          const raw = localStorage.getItem(key)
          if (!raw) return
          const data = JSON.parse(raw) as {
            rows?: SheetRow[]
            clinicId?: string
            providerId?: string
            selectedMonthKey?: string
            savedAt?: number
          }
          const entryClinicId = data.clinicId
          const entryProviderId = data.providerId
          const entryMonthKey = data.selectedMonthKey
          const rows = data.rows
          if (!entryClinicId || !entryProviderId || !entryMonthKey || !Array.isArray(rows) || rows.length === 0) return
          // Only replay for the clinic currently open in this tab — never POST stale rows for another clinic.
          if (entryClinicId !== clinicId) return
          // Freshness: skip entries older than 10 min (same window as restore-on-mount).
          if (!data.savedAt || now - data.savedAt > PAGEHIDE_MAX_AGE_MS) return
          // Require at least one row that would actually be persisted server-side; the server filters out
          // empty-* rows with no data, so a batch of only those would arrive as an empty saved set.
          const hasMeaningfulRow = rows.some((r) => {
            if (!r) return false
            if (typeof r.id === 'string' && r.id.startsWith('empty-')) {
              return !!(
                r.patient_id || r.appointment_date || r.cpt_code || r.appointment_status ||
                r.claim_status || r.submit_date || r.insurance_payment || r.payment_date ||
                r.insurance_adjustment || r.collected_from_patient || r.patient_pay_status ||
                r.ar_date || r.total !== null || r.notes
              )
            }
            return true
          })
          if (!hasMeaningfulRow) return

          // Tab-switch keepalive must not race an in-flight debounced save with the same `new-*`
          // ids. Real `pagehide` (unload) still sends so a closing tab can finish the write.
          if (fromVisibility && saveProviderSheetInProgressRef.current.has(entryProviderId)) return

          const rowsToSend = applyTempIdPromotions(
            rows,
            getTempIdPromotions(sheetTempIdPromotionKey(entryClinicId, entryProviderId, entryMonthKey)),
          )

          // correlationId + source populate the server audit table so the pagehide-keepalive path
          // shows up distinctly in the save-audit viewer. Every pagehide fire gets a fresh ID —
          // this POST is fire-and-forget with no matching debounced-save to correlate against.
          const correlationId =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `corr-pagehide-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
          const body = JSON.stringify({
            clinicId: entryClinicId,
            providerId: entryProviderId,
            selectedMonthKey: entryMonthKey,
            rows: rowsToSend,
            correlationId,
            source: 'pagehide-keepalive',
          })
          fetch(savePendingUrl, {
            method: 'POST',
            body,
            keepalive: true,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          }).catch(() => {})
        } catch (_) {}
      })
    }

    // visibilitychange fires when the user switches tabs, minimizes the window, or the OS hides the
    // page. Catches cases where the user moves away mid-edit without actually closing the tab —
    // pagehide doesn't fire then but the unsaved data could still be lost if the browser is killed.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') onPageHide(true)
    }
    const onUnload = () => onPageHide(false)
    window.addEventListener('pagehide', onUnload)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', onUnload)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [clinicId])

  const handleUpdateProviderSheetRow = useCallback((providerId: string, rowId: string, field: string, value: any) => {
    setProviderSheetRowsByMonth(prev => {
      const currentPrev = prev[selectedMonthKey] ?? {}
      const rowsPrev = currentPrev[providerId] || []
      const updatedRows = rowsPrev.map(row => {
        if (row.id === rowId) {
          // If updating an empty row, convert it to a new- prefixed row
          if (row.id.startsWith('empty-')) {
            const newId = `new-${Date.now()}-${Math.random()}`
            const updated: SheetRow = {
              ...row,
              id: newId,
              [field]: value,
              updated_at: new Date().toISOString()
            }
            if (field === 'patient_id' && (value == null || value === '')) {
              updated.patient_id = null
              updated.patient_first_name = null
              updated.patient_last_name = null
              updated.last_initial = null
              updated.patient_insurance = null
              updated.patient_copay = null
              updated.patient_coinsurance = null
            }
            providerSheetUpdatedRowIdRef.current = updated.id
            if (field === 'billing_code') {
              const code = billingCodes.find(c => c.code === value)
              updated.billing_code_color = code?.color || null
            } else if (field === 'cpt_code') {
              // Handle multiple CPT codes (comma-separated)
              if (value) {
                const codes = value.split(',').map((c: string) => c.trim())
                const colors = codes.map((c: string) => {
                  const code = billingCodes.find(bc => bc.code === c)
                  return code?.color || '#cccccc'
                })
                updated.cpt_code_color = colors.join(',')
              } else {
                updated.cpt_code_color = null
              }
            } else if (field === 'appointment_status') {
              const status = statusColors.find(s => s.status === value && s.type === 'appointment')
              updated.appointment_status_color = status?.color || null
            } else if (field === 'claim_status') {
              const status = statusColors.find(s => s.status === value && s.type === 'claim')
              updated.claim_status_color = status?.color || null
            } else if (field === 'patient_pay_status') {
              const status = statusColors.find(s => s.status === value && s.type === 'patient_pay')
              updated.patient_pay_status_color = status?.color || null
            } else if (field === 'payment_date') {
              const month = statusColors.find(s => s.status === value && s.type === 'month')
              updated.payment_date_color = month?.color || null
            } else if (field === 'ar_date') {
              const month = statusColors.find(s => s.status === value && s.type === 'month')
              updated.ar_date_color = month?.color || null
            }
            return updated
          }
          const updated = { ...row, [field]: value, updated_at: new Date().toISOString() }
          providerSheetUpdatedRowIdRef.current = updated.id
          // When clearing patient_id, clear all patient-related columns on this row (others stay)
          if (field === 'patient_id' && (value == null || value === '')) {
            updated.patient_id = null
            updated.patient_first_name = null
            updated.patient_last_name = null
            updated.last_initial = null
            updated.patient_insurance = null
            updated.patient_copay = null
            updated.patient_coinsurance = null
            // Tag as intentional clear so the server bypasses the patient-identity COALESCE guard
            // (added 2026-07-27; see serviceRoutes.ts saveProviderSheetRowsCore `_clearColumns`).
            // Without this, the null writes would be silently ignored — patient info would stick
            // around in the DB even though the user asked to clear it.
            ;(updated as unknown as { _clearColumns: string[] })._clearColumns = [
              'patient_id',
              'patient_first_name',
              'patient_last_name',
              'last_initial',
              'patient_insurance',
              'patient_copay',
              'patient_coinsurance',
            ]
          }
          if (field === 'billing_code') {
            const code = billingCodes.find(c => c.code === value)
            updated.billing_code_color = code?.color || null
          } else if (field === 'cpt_code') {
            // Handle multiple CPT codes (comma-separated)
            if (value) {
              const codes = value.split(',').map((c: string) => c.trim())
              const colors = codes.map((c: string) => {
                const code = billingCodes.find(bc => bc.code === c)
                return code?.color || '#cccccc'
              })
              updated.cpt_code_color = colors.join(',')
            } else {
              updated.cpt_code_color = null
            }
          } else if (field === 'appointment_status') {
            const status = statusColors.find(s => s.status === value && s.type === 'appointment')
            updated.appointment_status_color = status?.color || null
          } else if (field === 'claim_status') {
            const status = statusColors.find(s => s.status === value && s.type === 'claim')
            updated.claim_status_color = status?.color || null
          } else if (field === 'patient_pay_status') {
            const status = statusColors.find(s => s.status === value && s.type === 'patient_pay')
            updated.patient_pay_status_color = status?.color || null
          } else if (field === 'payment_date') {
            const month = statusColors.find(s => s.status === value && s.type === 'month')
            updated.payment_date_color = month?.color || null
          } else if (field === 'ar_date') {
            const month = statusColors.find(s => s.status === value && s.type === 'month')
            updated.ar_date_color = month?.color || null
          }
          return updated
        }
        return row
      })
      let nextMonthRows: Record<string, SheetRow[]> = { ...currentPrev, [providerId]: updatedRows }
      // Ensure we maintain ROWS_PER_PROVIDER rows total per provider (see shared constant)
      const nonEmptyRows = updatedRows.filter(r => !r.id.startsWith('empty-'))
      const emptyRowsNeeded = Math.max(0, ROWS_PER_PROVIDER - nonEmptyRows.length)
      const existingEmptyCount = updatedRows.filter(r => r.id.startsWith('empty-')).length
      if (emptyRowsNeeded > existingEmptyCount) {
        const createEmptyRow = (index: number): SheetRow => ({
          id: `empty-${providerId}-${index}`,
          patient_id: null,
          patient_first_name: null,
          patient_last_name: null,
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
          last_initial: null,
          cpt_code: null,
          cpt_code_color: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        const newEmptyRows = Array.from({ length: emptyRowsNeeded - existingEmptyCount }, (_, i) => 
          createEmptyRow(existingEmptyCount + i)
        )
        nextMonthRows = { ...currentPrev, [providerId]: [...updatedRows, ...newEmptyRows] }
      }
      return { ...prev, [selectedMonthKey]: nextMonthRows } as Record<string, Record<string, SheetRow[]>>
    })
  }, [billingCodes, statusColors, selectedMonthKey, providerSheetRowsByMonth])

  const applyProviderRowDerivedFields = useCallback((row: SheetRow): SheetRow => {
    const updated = { ...row }
    if (!updated.patient_id) {
      updated.patient_id = null
      updated.patient_first_name = null
      updated.patient_last_name = null
      updated.last_initial = null
      updated.patient_insurance = null
      updated.patient_copay = null
      updated.patient_coinsurance = null
    }

    if (updated.billing_code) {
      const code = billingCodes.find(c => c.code === updated.billing_code)
      updated.billing_code_color = code?.color || null
    } else {
      updated.billing_code_color = null
    }

    if (updated.cpt_code) {
      const codes = updated.cpt_code.split(',').map((c: string) => c.trim())
      const colors = codes.map((c: string) => {
        const code = billingCodes.find(bc => bc.code === c)
        return code?.color || '#cccccc'
      })
      updated.cpt_code_color = colors.join(',')
    } else {
      updated.cpt_code_color = null
    }

    if (updated.appointment_status) {
      const status = statusColors.find(s => s.status === updated.appointment_status && s.type === 'appointment')
      updated.appointment_status_color = status?.color || null
    } else {
      updated.appointment_status_color = null
    }

    if (updated.claim_status) {
      const status = statusColors.find(s => s.status === updated.claim_status && s.type === 'claim')
      updated.claim_status_color = status?.color || null
    } else {
      updated.claim_status_color = null
    }

    if (updated.patient_pay_status) {
      const status = statusColors.find(s => s.status === updated.patient_pay_status && s.type === 'patient_pay')
      updated.patient_pay_status_color = status?.color || null
    } else {
      updated.patient_pay_status_color = null
    }

    if (updated.payment_date) {
      const month = statusColors.find(s => s.status === updated.payment_date && s.type === 'month')
      updated.payment_date_color = month?.color || null
    } else {
      updated.payment_date_color = null
    }

    if (updated.ar_date) {
      const month = statusColors.find(s => s.status === updated.ar_date && s.type === 'month')
      updated.ar_date_color = month?.color || null
    } else {
      updated.ar_date_color = null
    }
    return updated
  }, [billingCodes, statusColors])

  const handleReplaceProviderSheetRows = useCallback((providerId: string, rows: SheetRow[]) => {
    setProviderSheetRowsByMonth(prev => {
      const currentPrev = prev[selectedMonthKey] ?? {}
      const normalizedRows = rows.map((row) => {
        const rowId = row.id.startsWith('empty-') && (
          row.patient_id || row.patient_first_name || row.last_initial || row.patient_insurance ||
          row.patient_copay != null || row.patient_coinsurance != null || row.appointment_date ||
          row.cpt_code || row.appointment_status || row.claim_status || row.submit_date ||
          row.insurance_payment || row.payment_date || row.insurance_adjustment ||
          row.collected_from_patient || row.patient_pay_status || row.ar_date ||
          row.total !== null || row.notes
        ) ? `new-${Date.now()}-${Math.random()}` : row.id
        const normalized = applyProviderRowDerivedFields({
          ...row,
          id: rowId,
          updated_at: new Date().toISOString(),
        })
        providerSheetUpdatedRowIdRef.current = normalized.id
        return normalized
      })
      return { ...prev, [selectedMonthKey]: { ...currentPrev, [providerId]: normalizedRows } } as Record<string, Record<string, SheetRow[]>>
    })
  }, [selectedMonthKey, applyProviderRowDerivedFields])


  const handleDeleteProviderSheetRows = useCallback(async (providerId: string, rowIds: string[]) => {
    if (rowIds.length === 0) return
    const idSet = new Set(rowIds)
    const rows = providerSheetRows[providerId] || []
    // Snapshot deleted rows + their original indices so undo can reinsert at the right positions.
    const deletedWithIndex = rows
      .map((r, i) => ({ row: r, index: i }))
      .filter((x) => idSet.has(x.row.id))
    // Only persisted (UUID) ids need a DB delete; empty-/new- ids were never written.
    const deletedDbIds = rowIds.filter((id) => isUuid(id))
    let rowsAfterDelete: SheetRow[] = []
    // flushSync ensures state is committed before save reads the filtered list — without it React
    // could batch the update and the save would see the pre-delete list (multi-row deletes lost rows).
    flushSync(() => {
      setProviderSheetRowsByMonth(prev => {
        const current = prev[selectedMonthKey] ?? {}
        const list = current[providerId] || []
        rowsAfterDelete = list.filter(r => !idSet.has(r.id))
        return { ...prev, [selectedMonthKey]: { ...current, [providerId]: rowsAfterDelete } }
      })
    })
    await saveProviderSheetRows(providerId, rowsAfterDelete, deletedDbIds, undefined, 'delete-rows')
    if (deletedWithIndex.length > 0) {
      lastUndoRef.current = () => {
        setProviderSheetRowsByMonth(prev => {
          const current = prev[selectedMonthKey] ?? {}
          const list = current[providerId] || []
          // Reinsert ascending so each insertIndex still refers to the position in the partially-rebuilt list.
          const ascending = [...deletedWithIndex].sort((a, b) => a.index - b.index)
          let next = [...list]
          for (const { row, index } of ascending) {
            const clamped = Math.min(index, next.length)
            next = [...next.slice(0, clamped), row, ...next.slice(clamped)]
          }
          saveProviderSheetRows(providerId, next, undefined, undefined, 'undo-delete-rows').catch(err => console.error('Undo provider row: save failed', err))
          return { ...prev, [selectedMonthKey]: { ...current, [providerId]: next } }
        })
      }
    }
  }, [providerSheetRows, saveProviderSheetRows, selectedMonthKey])

  // Thin singular wrapper for legacy callers (context menu) so we keep one delete code path.
  const handleDeleteProviderSheetRow = useCallback((providerId: string, rowId: string) => {
    return handleDeleteProviderSheetRows(providerId, [rowId])
  }, [handleDeleteProviderSheetRows])

  const handleAddProviderRowAbove = useCallback((providerId: string, beforeRowId: string) => {
    const rows = providerSheetRows[providerId] || []
    const idx = rows.findIndex(r => r.id === beforeRowId)
    if (idx < 0) return
    const createEmptyRow = (): SheetRow => ({
      id: `empty-${providerId}-${Date.now()}`,
      patient_id: null,
      patient_first_name: null,
      patient_last_name: null,
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
      last_initial: null,
      cpt_code: null,
      cpt_code_color: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    const newRow = createEmptyRow()
    const newRows = [...rows.slice(0, idx), newRow, ...rows.slice(idx)]
    setProviderSheetRowsByMonth(prev => ({ ...prev, [selectedMonthKey]: { ...(prev[selectedMonthKey] ?? {}), [providerId]: newRows } }))
    saveProviderSheetRows(providerId, newRows, undefined, undefined, 'add-row').catch(err => console.error('Failed to save after add row', err))
  }, [providerSheetRows, saveProviderSheetRows, selectedMonthKey])

  const handleAddProviderRowBelow = useCallback((providerId: string, afterRowId: string) => {
    const rows = providerSheetRows[providerId] || []
    const idx = rows.findIndex(r => r.id === afterRowId)
    if (idx < 0) return
    const createEmptyRow = (): SheetRow => ({
      id: `empty-${providerId}-${Date.now()}`,
      patient_id: null,
      patient_first_name: null,
      patient_last_name: null,
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
      last_initial: null,
      cpt_code: null,
      cpt_code_color: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    const newRow = createEmptyRow()
    const newRows = [...rows.slice(0, idx + 1), newRow, ...rows.slice(idx + 1)]
    setProviderSheetRowsByMonth(prev => ({ ...prev, [selectedMonthKey]: { ...(prev[selectedMonthKey] ?? {}), [providerId]: newRows } }))
    saveProviderSheetRows(providerId, newRows, undefined, undefined, 'add-row').catch(err => console.error('Failed to save after add row', err))
  }, [providerSheetRows, saveProviderSheetRows, selectedMonthKey])

  // Direct save function that accepts providerId and rows - for use when we have computed updated data.
  // Called by ProvidersTab from the typing/debounce path — that's the main "user is actively editing"
  // trigger, so we tag saves from it 'typing-debounced-or-direct' in the audit table.
  const saveProviderSheetRowsDirect = useCallback(async (providerId: string, rowsToSave: SheetRow[]) => {
    await saveProviderSheetRows(providerId, rowsToSave, undefined, undefined, 'typing-debounced-or-direct')
  }, [saveProviderSheetRows])

  const handleReorderProviderRows = useCallback((providerId: string, movedRows: number[], finalIndex: number) => {
    const rows = providerSheetRows[providerId] || []
    const arr = [...rows]
    const toMove = movedRows.map(i => arr[i])
    const sorted = [...movedRows].sort((a, b) => b - a)
    sorted.forEach(i => arr.splice(i, 1))
    const insertAt = Math.min(finalIndex, arr.length)
    toMove.forEach((item, i) => arr.splice(insertAt + i, 0, item))
    const newRows = arr
    setProviderSheetRowsByMonth(prev => ({ ...prev, [selectedMonthKey]: { ...(prev[selectedMonthKey] ?? {}), [providerId]: newRows } }))
    setProviderRowsVersion(v => v + 1)
    saveProviderSheetRows(providerId, newRows, undefined, undefined, 'reorder-rows').catch(err => console.error('Failed to persist provider row order', err))
  }, [providerSheetRows, saveProviderSheetRows, selectedMonthKey])

  const handleTabChange = (tab: TabType) => {
    if (splitScreen) {
      // In split screen mode, update the appropriate side
      if (splitScreen.right === 'accounts_receivable') {
        setSplitScreen({ left: tab, right: 'accounts_receivable' })
      } else {
        setSplitScreen({ left: splitScreen.left, right: tab })
      }
    } else {
      // Flush save (finish editor + persist) before switching away from tabs that support a pre-leave flush.
      const flushBeforeTabLeave =
        activeTab === 'patients' && tab !== 'patients'
          ? patientsTabFlushRef.current
          : activeTab === 'todo' && tab !== 'todo'
            ? billingTodoTabFlushRef.current
            : activeTab === 'providers' && tab !== 'providers'
              ? providersTabFlushRef.current
              : activeTab === 'accounts_receivable' && tab !== 'accounts_receivable'
                ? accountsReceivableTabFlushRef.current
                : null
      if (flushBeforeTabLeave) {
        // Do not setLoading(true) here: pageReady is !loading, so a full-page spinner would unmount the
        // tab being flushed and destroy Handsontable before finishEditing + save (especially AR).
        flushBeforeTabLeave().then(() => {
          // After the pending save commits, snapshot the Billing sheet so it's recoverable later.
          // No-op if activeTab isn't Billing or if we backed up within the last 60s.
          void triggerAutoBackupRef.current()
          setActiveTab(tab)
          const scopePid = providerId ?? getLastSelectedProviderId()
          const path =
            tab === 'providers' && scopePid
              ? `/clinic/${clinicId}/providers/${scopePid}`
              : tab === 'accounts_receivable' && scopePid
                ? `/clinic/${clinicId}/providers/${scopePid}/accounts_receivable`
                : tab === 'provider_pay' && scopePid
                  ? `/clinic/${clinicId}/providers/${scopePid}/provider_pay`
                  : tab === 'admin_tracking' && scopePid
                    ? `/clinic/${clinicId}/providers/${scopePid}/admin_tracking`
                    : `/clinic/${clinicId}/${tab}`
          navigate(path, { replace: true })
        }).catch(err => {
          console.error('[ClinicDetail] Flush before tab leave failed:', err)
          setActiveTab(tab)
          const scopePid = providerId ?? getLastSelectedProviderId()
          const path =
            tab === 'providers' && scopePid
              ? `/clinic/${clinicId}/providers/${scopePid}`
              : tab === 'accounts_receivable' && scopePid
                ? `/clinic/${clinicId}/providers/${scopePid}/accounts_receivable`
                : tab === 'provider_pay' && scopePid
                  ? `/clinic/${clinicId}/providers/${scopePid}/provider_pay`
                  : tab === 'admin_tracking' && scopePid
                    ? `/clinic/${clinicId}/providers/${scopePid}/admin_tracking`
                    : `/clinic/${clinicId}/${tab}`
          navigate(path, { replace: true })
        })
        return
      }
      setActiveTab(tab)
      // When switching to Billing (providers), go to last selected provider's sheet if we have one (use sessionStorage so it works after switching from another tab, which uses a different route instance)
      const scopePid = providerId ?? getLastSelectedProviderId()
      const path =
        tab === 'providers' && scopePid
          ? `/clinic/${clinicId}/providers/${scopePid}`
          : tab === 'accounts_receivable' && scopePid
            ? `/clinic/${clinicId}/providers/${scopePid}/accounts_receivable`
            : tab === 'provider_pay' && scopePid
              ? `/clinic/${clinicId}/providers/${scopePid}/provider_pay`
              : `/clinic/${clinicId}/${tab}`
      navigate(path, { replace: true })
    }
  }
  
  // Helper function to render tab content
  const renderTabContent = (tab: TabType) => {
    switch (tab) {
      case 'patients':
        return (
          <>
            {userProfile?.role === 'super_admin' && clinicId && (
              <div className="mb-4">
                <BackupVersionsBar
                  backupType="patients"
                  entityId={clinicId}
                  viewingVersion={selectedBackupVersionPatients}
                  getDownloadFilename={(v) => {
                    const clinicName = clinic
                      ? `${(clinic.name ?? 'Clinic').trim()}`.replace(/\s+/g, ' ').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'Clinic'
                      : 'Clinic'
                    const d = new Date(v.created_at)
                    const Y = d.getFullYear()
                    const M = String(d.getMonth() + 1).padStart(2, '0')
                    const D = String(d.getDate()).padStart(2, '0')
                    const h = String(d.getHours()).padStart(2, '0')
                    const m = String(d.getMinutes()).padStart(2, '0')
                    const dateTime = `${Y}-${M}-${D} ${h}.${m}`
                    return `${clinicName}_Patients_${dateTime}.csv`
                  }}
                  onSelectVersion={async (version) => {
                    const requestedId = version.id
                    lastRequestedBackupIdPatientsRef.current = requestedId
                    const list = await fetchBackupCsvAsPatients(apiClient, version.file_path, clinicId!)
                    if (lastRequestedBackupIdPatientsRef.current !== requestedId) return
                    setBackupOverridePatients(padPatientsTo500(list, clinicId!))
                    setSelectedBackupVersionPatients(version)
                    setBackupViewKeyPatients((k) => k + 1)
                  }}
                  onBackToCurrent={() => {
                    setBackupOverridePatients(null)
                    setSelectedBackupVersionPatients(null)
                  }}
                />
              </div>
            )}
            <PatientsTab
              clinicId={clinicId!}
              canEdit={canEdit && !backupOverridePatients}
              onPatientsCreated={handlePatientsCreated}
            isInSplitScreen={!!splitScreen}
            isLockPatients={isLockPatients}
            onLockColumn={canLockColumns ? (columnName: string) => {
              const existingComment = isLockPatients && isPatientColumnLocked(columnName as keyof IsLockPatients)
                ? (isLockPatients[`${columnName}_comment` as keyof IsLockPatients] as string | null) || ''
                : ''
              setSelectedLockColumn({ columnName, providerId: null, isPatientColumn: true })
              setLockComment(existingComment)
              setShowLockDialog(true)
            } : undefined}
            isColumnLocked={isPatientColumnLocked}
            onRegisterFlushBeforeTabLeave={(flush) => { patientsTabFlushRef.current = flush }}
            overridePatients={backupOverridePatients}
            isViewingBackup={!!selectedBackupVersionPatients}
            backupVersionKey={backupViewKeyPatients}
          />
          </>
        )
      case 'todo':
        if (!showBillingTodoTab) return null
        return (
          <BillingTodoTab
            clinicId={clinicId!}
            canEdit={canEdit}
            isLockBillingTodo={isLockBillingTodo}
            isInSplitScreen={!!splitScreen}
            exportRef={billingTodoExportRef}
            onRegisterFlushBeforeTabLeave={(flush) => { billingTodoTabFlushRef.current = flush }}
            onLockColumn={canLockColumns ? (columnName: string) => {
              const existingComment = isLockBillingTodo && isBillingTodoColumnLocked(columnName as keyof IsLockBillingTodo)
                ? (isLockBillingTodo[`${columnName}_comment` as keyof IsLockBillingTodo] as string | null) || ''
                : ''
              setSelectedLockColumn({ columnName, providerId: null, isBillingTodoColumn: true })
              setLockComment(existingComment)
              setShowLockDialog(true)
            } : undefined}
            isColumnLocked={isBillingTodoColumnLocked}
          />
        )
      case 'accounts_receivable': {
        const arBackupBar = userProfile?.role === 'super_admin' && clinicId ? (
          <BackupVersionsBar
            backupType="ar"
            display="button-only"
            entityId={clinicId}
            viewingVersion={selectedBackupVersionAR}
            getDownloadFilename={(v) => {
              const clinicName = clinic
                ? `${(clinic.name ?? 'Clinic').trim()}`.replace(/\s+/g, ' ').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'Clinic'
                : 'Clinic'
              const d = new Date(v.created_at)
              const Y = d.getFullYear()
              const M = String(d.getMonth() + 1).padStart(2, '0')
              const D = String(d.getDate()).padStart(2, '0')
              const h = String(d.getHours()).padStart(2, '0')
              const m = String(d.getMinutes()).padStart(2, '0')
              const dateTime = `${Y}-${M}-${D} ${h}.${m}`
              return `${clinicName}_AR_${dateTime}.csv`
            }}
            onSelectVersion={async (version) => {
              const requestedId = version.id
              lastRequestedBackupIdARRef.current = requestedId
              const list = await fetchBackupCsvAsAR(apiClient, version.file_path, clinicId!)
              if (lastRequestedBackupIdARRef.current !== requestedId) return
              setBackupOverrideAR(padARTo200(list, clinicId!))
              setSelectedBackupVersionAR(version)
              setBackupViewKeyAR((k) => k + 1)
            }}
            onBackToCurrent={() => {
              setBackupOverrideAR(null)
              setSelectedBackupVersionAR(null)
            }}
          />
        ) : null
        // Same visual treatment as the providers tab: the "Viewing backup from X" badge sits on its
        // own centered row directly under the colored title pill so it doesn't blend into the title.
        const arBackupViewingIndicator = selectedBackupVersionAR ? (
          <div className="inline-flex items-center gap-3 px-3 py-1 rounded bg-white/10 border border-white/30 text-white text-sm">
            <span>
              Viewing backup from{' '}
              {new Date(selectedBackupVersionAR.created_at).toLocaleString(undefined, {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </span>
            <button
              type="button"
              onClick={() => {
                setBackupOverrideAR(null)
                setSelectedBackupVersionAR(null)
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-primary-500/30 hover:bg-primary-500/50 text-white text-xs font-medium"
            >
              Back to current data
            </button>
          </div>
        ) : null
        return (
          <AccountsReceivableTab
            clinicId={clinicId!}
            clinicPayroll={clinic?.payroll ?? 1}
            // Scope the A-R sheet to the URL's provider (`/clinic/X/providers/Y/accounts_receivable`).
            // When the tab is rendered from the clinic-level route there's no providerId and the
            // sheet falls back to its clinic-wide ledger behavior, matching the pre-scoping flow.
            providerId={providerId ?? null}
            patients={patients}
            canEdit={canEdit && !backupOverrideAR}
            canTogglePastMonthWholeSheetLock={canLockColumns}
            wholeSheetLocked={Boolean(isLockAccountsReceivable?.whole_sheet_locked)}
            onTogglePastMonthWholeSheetLock={handleToggleARWholeSheetLock}
            isInSplitScreen={!!splitScreen}
            onLocksMonthKeyChange={setArLocksMonthKey}
            isLockAccountsReceivable={isLockAccountsReceivable}
            labelRightSlot={arBackupBar}
            belowTitleSlot={arBackupViewingIndicator}
            onLockColumn={canLockColumns ? (columnName: string) => {
              const existingComment = isLockAccountsReceivable && isARColumnLocked(columnName as keyof IsLockAccountsReceivable)
                ? (isLockAccountsReceivable[`${columnName}_comment` as keyof IsLockAccountsReceivable] as string | null) || ''
                : ''
              setSelectedLockColumn({ columnName, providerId: null, isARColumn: true })
              setLockComment(existingComment)
              setShowLockDialog(true)
            } : undefined}
            isColumnLocked={isARColumnLocked}
            overrideFullAR={backupOverrideAR}
            isViewingBackup={!!selectedBackupVersionAR}
            backupVersionKey={backupViewKeyAR}
            onRegisterFlushBeforeTabLeave={(flush) => { accountsReceivableTabFlushRef.current = flush }}
          />
        )
      }
      case 'admin_tracking': {
        // Super-admin-only view. Reads live from the same `provider_sheet_rows` state as the Billing
        // tab (`selectedMonth` / `selectedPayroll`, not the Provider-Pay clock) so new Billing data
        // shows up here immediately. Edits made inside Admin Tracking are held in a per-cell
        // localStorage overlay inside the tab component and never flow back to Billing — per
        // Jenali's ask, this is a one-way mirror.
        if (!showAdminTrackingTab) return null
        const scopePid = providerId ?? getLastSelectedProviderId() ?? undefined
        const rowsForProvider = scopePid ? providerSheetRows[scopePid] ?? [] : []
        return (
          <AdminTrackingTab
            clinicId={clinicId!}
            clinicPayroll={clinic?.payroll ?? 1}
            providerId={scopePid}
            providers={providers}
            patients={patients}
            statusColors={statusColors}
            rows={rowsForProvider}
            canEdit={canEdit}
            isInSplitScreen={!!splitScreen}
            selectedMonth={selectedMonth}
            onSelectMonth={(date, payroll) => {
              setSelectedMonth(new Date(date.getFullYear(), date.getMonth(), 1))
              if (clinic?.payroll === 2) setSelectedPayroll(payroll)
            }}
            selectedPayroll={clinic?.payroll === 2 ? selectedPayroll : undefined}
            onProviderChange={(pid) => {
              if (!clinicId || !pid) return
              // Navigate to the same provider's Admin Tracking URL so refreshes and back-nav stay scoped.
              navigate(`/clinic/${clinicId}/providers/${pid}/admin_tracking`, { replace: true })
            }}
          />
        )
      }
      case 'provider_pay': {
        const effectiveProviderPay =
          providerId ?? getLastSelectedProviderId() ?? providers.filter((p): p is Provider => p.level === 2)[0]?.id
        const year = selectedMonthProviderPay.getFullYear()
        const month = selectedMonthProviderPay.getMonth() + 1
        const payrollForBackup = clinic?.payroll === 2 ? selectedPayrollProviderPay : 1
        const providerPayBackupKey = effectiveProviderPay ? `${effectiveProviderPay}-${year}-${month}-${payrollForBackup}` : ''
        const overrideTableData = backupOverrideProviderPayByKey && providerPayBackupKey
          ? backupOverrideProviderPayByKey[providerPayBackupKey] ?? null
          : null
        const providerPayBackupBar = userProfile?.role === 'super_admin' && clinicId ? (
          <BackupVersionsBar
            backupType="provider_pay"
            display="button-only"
            entityId={clinicId}
            viewingVersion={selectedBackupVersionProviderPay}
            getDownloadFilename={(v) => {
              const providerIdForName = providerPaySelectedIdRef.current ?? effectiveProviderPay
              const payProvider = providerIdForName ? providers.find((p) => p.id === providerIdForName) : null
              const providerName = payProvider
                ? `${(payProvider.first_name ?? '').trim()} ${(payProvider.last_name ?? '').trim()}`.replace(/\s+/g, ' ').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'Provider'
                : 'Provider'
              const d = new Date(v.created_at)
              const Y = d.getFullYear()
              const M = String(d.getMonth() + 1).padStart(2, '0')
              const D = String(d.getDate()).padStart(2, '0')
              const h = String(d.getHours()).padStart(2, '0')
              const m = String(d.getMinutes()).padStart(2, '0')
              const dateTime = `${Y}-${M}-${D} ${h}.${m}`
              return `${providerName}_Pay_${dateTime}.csv`
            }}
            getDownloadBlob={async (version) => {
              const { byKey } = await fetchBackupCsvAsProviderPay(apiClient, version.file_path)
              const table = providerPayBackupKey ? (byKey[providerPayBackupKey] ?? []) : []
              const escapeCsv = (val: string) => {
                const s = String(val ?? '')
                if (s.includes('"') || s.includes(',') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
                return s
              }
              const header = 'Description,Amount,Notes'
              const dataRows = table.slice(1).map((r) => [escapeCsv(r[0]), escapeCsv(r[1]), escapeCsv(r[2])].join(','))
              // Prefix BOM (﻿) so Excel always opens as UTF-8 and never falls into SYLK-detection.
              const csv = '﻿' + header + '\n' + dataRows.join('\n')
              return new Blob([csv], { type: 'text/csv;charset=utf-8' })
            }}
            onSelectVersion={async (version) => {
              const requestedId = version.id
              lastRequestedBackupIdProviderPayRef.current = requestedId
              const { byKey } = await fetchBackupCsvAsProviderPay(apiClient, version.file_path)
              if (lastRequestedBackupIdProviderPayRef.current !== requestedId) return
              setBackupOverrideProviderPayByKey(byKey)
              setSelectedBackupVersionProviderPay(version)
              setBackupViewKeyProviderPay((k) => k + 1)
            }}
            onBackToCurrent={() => {
              setBackupOverrideProviderPayByKey(null)
              setSelectedBackupVersionProviderPay(null)
            }}
          />
        ) : null
        const providerPayBackupViewingIndicator = selectedBackupVersionProviderPay ? (
          <div className="inline-flex items-center gap-3 px-3 py-1 rounded bg-white/10 border border-white/30 text-white text-sm">
            <span>
              Viewing backup from{' '}
              {new Date(selectedBackupVersionProviderPay.created_at).toLocaleString(undefined, {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </span>
            <button
              type="button"
              onClick={() => {
                setBackupOverrideProviderPayByKey(null)
                setSelectedBackupVersionProviderPay(null)
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-primary-500/30 hover:bg-primary-500/50 text-white text-xs font-medium"
            >
              Back to current data
            </button>
          </div>
        ) : null
        return (
          <ProviderPayTab
            labelRightSlot={providerPayBackupBar}
            belowTitleSlot={providerPayBackupViewingIndicator}
              clinicId={clinicId!}
              clinicPayroll={clinic?.payroll ?? 1}
              providerId={providerId ?? undefined}
              providers={providers}
              canEdit={canEdit && !backupOverrideProviderPayByKey}
              canTogglePastMonthWholeSheetLock={canLockColumns}
              isInSplitScreen={!!splitScreen}
              selectedMonth={selectedMonthProviderPay}
              onSelectMonth={(date) => {
                setSelectedMonthProviderPay(new Date(date.getFullYear(), date.getMonth(), 1))
              }}
              selectedPayroll={clinic?.payroll === 2 ? selectedPayrollProviderPay : undefined}
              onPayrollChange={(p) => setSelectedPayrollProviderPay(p)}
              statusColors={statusColors}
              isLockProviderPay={isLockProviderPay}
              onLockColumn={canLockColumns ? (columnName: string) => {
                const existingComment = (isLockProviderPay?.[`${columnName}_comment` as keyof IsLockProviderPay] as string | null) ?? ''
                setSelectedLockColumn({ columnName, providerId: null, isProviderPayColumn: true })
                setLockComment(existingComment)
                setShowLockDialog(true)
              } : undefined}
              isColumnLocked={isProviderPayColumnLocked}
              overrideTableData={overrideTableData}
              isViewingBackup={!!selectedBackupVersionProviderPay}
              backupVersionKey={backupViewKeyProviderPay}
              onSelectedProviderIdChange={(id) => { providerPaySelectedIdRef.current = id }}
            />
        )
      }
      case 'providers': {
        const providerSheetRowsWithOverride =
          providerId && backupOverrideRows
            ? { ...providerSheetRows, [providerId]: backupOverrideRows }
            : providerSheetRows
        const canEditProviders = canEdit && !backupOverrideRows
        const currentSheetForBackup = providerId ? providerSheets[providerId] : null
        // Auto-backups bar visible to anyone with edit access on this sheet (super admin + office
        // staff). Hidden when actively viewing a cron backup version, since restoring an auto-backup
        // while viewing a different historical version would be confusing — exit backup view first.
        const showAutoBackupsBar =
          !backupOverrideRows &&
          !!currentSheetForBackup?.id &&
          (userProfile?.role === 'super_admin' || userProfile?.role === 'office_staff')
        const autoBackupsBarEl = showAutoBackupsBar ? (
          <AutoBackupsBar
            sheetId={currentSheetForBackup?.id ?? null}
            onRestore={handleAutoBackupRestore}
            refreshKey={autoBackupsRefreshKey}
          />
        ) : null
        const cronBackupsBarEl = userProfile?.role === 'super_admin' && currentSheetForBackup?.id ? (
          <BackupVersionsBar
            backupType="providers"
            display="button-only"
            entityId={currentSheetForBackup.id}
            viewingVersion={selectedBackupVersion}
            getDownloadFilename={(v) => {
              const providerName = currentProvider
                ? `${(currentProvider.first_name ?? '').trim()} ${(currentProvider.last_name ?? '').trim()}`.replace(/\s+/g, ' ').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'Provider'
                : 'Provider'
              const d = new Date(v.created_at)
              const Y = d.getFullYear()
              const M = String(d.getMonth() + 1).padStart(2, '0')
              const D = String(d.getDate()).padStart(2, '0')
              const h = String(d.getHours()).padStart(2, '0')
              const m = String(d.getMinutes()).padStart(2, '0')
              const dateTime = `${Y}-${M}-${D} ${h}.${m}`
              return `${providerName}_Billing_${dateTime}.csv`
            }}
            getDownloadBlob={async (version) => {
              const raw = await fetchBackupCsvAsSheetRows(apiClient, version.file_path)
              const padded = padSheetRowsToBase(raw)
              const layout =
                providerSheetExportLayoutRef.current ?? {
                  showVisitTypeColumn: providersTabShowVisitTypeColumn,
                  showCopayCoinsuranceColumns: clinic?.show_copay_coinsurance_columns ?? true,
                  officeStaffView: isOfficeStaff,
                  isProviderView: false,
                  providerLevel: 1,
                  isCondensed: false,
                }
              const csv = sheetRowsToUiCsv(padded, patients, layout)
              return new Blob([csv], { type: 'text/csv;charset=utf-8' })
            }}
            onSelectVersion={async (version) => {
              const requestedId = version.id
              lastRequestedBackupIdRef.current = requestedId
              const rows = await fetchBackupCsvAsSheetRows(apiClient, version.file_path)
              if (lastRequestedBackupIdRef.current !== requestedId) return
              setBackupOverrideRows(padSheetRowsToBase(rows))
              setSelectedBackupVersion(version)
              setBackupViewKey((k) => k + 1)
            }}
            onBackToCurrent={() => {
              setBackupOverrideRows(null)
              setSelectedBackupVersion(null)
            }}
          />
        ) : null
        // Render "Viewing backup from X" + "Back to current data" on its own row directly under
        // the colored title pill so it doesn't visually blend into the heading.
        const providersBackupViewingIndicator = selectedBackupVersion ? (
          <div className="inline-flex items-center gap-3 px-3 py-1 rounded bg-white/10 border border-white/30 text-white text-sm">
            <span>
              Viewing backup from{' '}
              {new Date(selectedBackupVersion.created_at).toLocaleString(undefined, {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </span>
            <button
              type="button"
              onClick={() => {
                setBackupOverrideRows(null)
                setSelectedBackupVersion(null)
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-primary-500/30 hover:bg-primary-500/50 text-white text-xs font-medium"
            >
              Back to current data
            </button>
          </div>
        ) : null
        // Combine the two bars into one slot so they sit side-by-side to the right of the title pill.
        const combinedBackupBars = (autoBackupsBarEl || cronBackupsBarEl) ? (
          <div className="inline-flex items-center gap-2">
            {autoBackupsBarEl}
            {cronBackupsBarEl}
          </div>
        ) : null
        return (
          <>
            <ProvidersTab
              labelRightSlot={combinedBackupBars}
              belowTitleSlot={providersBackupViewingIndicator}
              key={selectedMonthKey}
              clinicId={clinicId}
              clinicPayroll={clinic?.payroll ?? 1}
              canEditComment={userProfile?.role === 'super_admin' || userProfile?.role === 'office_staff'}
              userHighlightColor={userProfile?.role === 'super_admin' ? '#2d7e83' : (userProfile?.highlight_color ?? '#eab308')}
              providers={providers}
              providerSheetRows={providerSheetRowsWithOverride}
              providerRowsVersion={providerRowsVersion}
              billingCodes={billingCodes}
              statusColors={statusColors}
              patients={patients}
              selectedMonth={selectedMonth}
              selectedMonthKey={selectedMonthKey}
              selectedPayroll={clinic?.payroll === 2 ? selectedPayroll : undefined}
              providerId={providerId}
              currentProvider={currentProvider}
              canEdit={canEditProviders}
              isInSplitScreen={!!splitScreen}
              onUpdateProviderSheetRow={handleUpdateProviderSheetRow}
              onReplaceProviderSheetRows={handleReplaceProviderSheetRows}
              onSaveProviderSheetRowsDirect={saveProviderSheetRowsDirect}
              onDeleteRows={handleDeleteProviderSheetRows}
              onAddRowBelow={handleAddProviderRowBelow}
              onAddRowAbove={handleAddProviderRowAbove}
              onSelectMonth={async (date, payroll) => {
                // Flush any pending debounced save BEFORE the month changes so the save uses the
                // OLD selectedMonth — without this, a save scheduled while the user was on month X
                // but firing after navigation captures the NEW month in its closure and dumps
                // month X's typed data into month Y's sheet ("her June data is in May" symptom).
                if (providersTabFlushRef.current) {
                  try {
                    await providersTabFlushRef.current()
                  } catch (e) {
                    console.error('[ClinicDetail] flush before month change failed:', e)
                  }
                }
                setSelectedMonth(new Date(date.getFullYear(), date.getMonth(), 1))
                if (clinic?.payroll === 2) setSelectedPayroll(payroll)
              }}
              filterRowsByMonth={filterRowsByMonth}
              isLockProviders={isLockProviders}
              onLockProviderColumn={canLockColumns ? (columnName: string) => {
                const lockPid = providerId ?? firstListedProviderId
                if (!lockPid) return
                const existingComment = isLockProviders && isProviderColumnLocked(columnName as keyof IsLockProviders)
                  ? (isLockProviders[`${columnName}_comment` as keyof IsLockProviders] as string | null) || ''
                  : ''
                setSelectedLockColumn({ columnName, providerId: lockPid, isProviderColumn: true })
                setLockComment(existingComment)
                setShowLockDialog(true)
              } : undefined}
              isProviderColumnLocked={isProviderColumnLocked}
              onReorderProviderRows={handleReorderProviderRows}
              restrictEditToSchedulingColumns={restrictProviderSheetEditToScheduling}
              officeStaffView={isOfficeStaff}
              showVisitTypeColumn={providersTabShowVisitTypeColumn}
              showCopayCoinsuranceColumns={clinic?.show_copay_coinsurance_columns ?? true}
              isViewingBackup={!!selectedBackupVersion}
              backupVersionKey={backupViewKey}
              patientAssignmentRevision={patientAssignmentRevision}
              onRegisterFlushBeforeTabLeave={(flush) => { providersTabFlushRef.current = flush }}
              onExportLayoutChange={onProviderSheetExportLayoutChange}
            />
          </>
        )
      }
      default:
        return null
    }
  }
  


  const canEdit = userProfile?.role === 'super_admin' || userProfile?.role === 'admin' || userProfile?.role === 'billing_staff' || userProfile?.role === 'official_staff' || userProfile?.role === 'office_staff'
  const canUnlock = userProfile?.role === 'super_admin'
  // Billing To-Do tab is visible to every role that lands here. Admins were previously excluded
  // from the tab (and from the per-clinic Billing To-Do link in the sidebar), but Jenali needs
  // it in the admin view so she can read/edit the list alongside the billing staff.
  const showBillingTodoTab = true
  const canLockColumns = userProfile?.role === 'super_admin' || userProfile?.role === 'admin'
  const showPatientTab = true
  // const showProvidersTab = userProfile?.role !== 'billing_staff' && userProfile?.role !== 'office_staff'
  // const showProvidersTab = true
  // Hide AR and Provider Pay tabs when viewing Patient Info or Billing To-Do
  const hideFinanceTabsForTopLevel =
    activeTab === 'patients' || activeTab === 'todo'
  const showAccountsReceivableTab =
    !isBillingStaff && !isOfficeStaff && !hideFinanceTabsForTopLevel
  const showProviderPayTab =
    !isBillingStaff && !isOfficeStaff && !hideFinanceTabsForTopLevel
  // Super-admin-only "Admin Tracking" mirror of the Billing sheet with a slimmed column set.
  // Follows the same hideFinanceTabsForTopLevel rule as AR / Provider Pay: don't clutter the tab
  // strip when the user is on Patient Info or Billing To-Do.
  const showAdminTrackingTab =
    userProfile?.role === 'super_admin' && !hideFinanceTabsForTopLevel
  // Billing staff need the "Billing" (Providers) tab visible from every clinic view so they can
  // jump into a provider's billing sheet without going through the sidebar — they may land on
  // `/todo` by default but still need one-click access to provider sheets. For other roles, keep
  // the existing behavior of hiding the tab while on the top-level Patients / Billing To-Do views.
  const showProvidersTab = !hideFinanceTabsForTopLevel || isBillingStaff
  /** Official staff and office staff can edit only patient_id through date_of_service on the provider sheet; other columns read-only */
  const restrictProviderSheetEditToScheduling = isOfficialStaff || isOfficeStaff


  // Close context menu when clicking outside
  useEffect(() => {
    let openedAt = 0
    if (contextMenu) openedAt = Date.now()
    const handleClickOutside = (event: MouseEvent) => {
      if (Date.now() - openedAt < 120) return
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null)
      }
    }

    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [contextMenu])

  // Undo last provider-sheet row delete with Ctrl+Z / Cmd+Z (Handsontable tabs use built-in undo for grid edits)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        const undo = lastUndoRef.current
        if (undo) {
          e.preventDefault()
          undo()
          lastUndoRef.current = null
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  // Tab order for cycling when opening split screen — admin has no Billing To-Do
  const SPLIT_SCREEN_TAB_ORDER: TabType[] = [
    ...(showBillingTodoTab ? (['todo'] as const) : []),
    'providers',
    ...(showAccountsReceivableTab ? (['accounts_receivable'] as const) : []),
    ...(showProviderPayTab ? (['provider_pay'] as const) : []),
    ...(showAdminTrackingTab ? (['admin_tracking'] as const) : []),
  ]
  const getNextTab = (current: TabType, skip?: TabType): TabType => {
    if (current === 'patients') return 'patients' // Never switch away from Patients when clicking Switchnpm run bu
    const i = SPLIT_SCREEN_TAB_ORDER.indexOf(current)
    if (i === -1) return current
    let next = SPLIT_SCREEN_TAB_ORDER[(i + 1) % SPLIT_SCREEN_TAB_ORDER.length]
    if (skip && next === skip) next = SPLIT_SCREEN_TAB_ORDER[(i + 2) % SPLIT_SCREEN_TAB_ORDER.length]
    return next
  }
  const getTabLabel = (tab: TabType) =>
    tab === 'patients'
      ? 'Patient Info'
      : tab === 'todo'
        ? 'Billing To-Do'
        : tab === 'providers'
          ? 'Providers'
          : tab === 'provider_pay'
            ? 'Provider Pay'
            : tab === 'admin_tracking'
              ? 'Admin Tracking'
              : 'Accounts Receivable'

  /** Tabs available in split-screen pane dropdowns (finance tabs always listed in split view).
   *  Billing staff get `providers` (read/edit billing sheets) but still don't get AR or
   *  Provider Pay — those remain admin/super-admin scope. Office staff stay capped at
   *  patients + todo as before. */
  const getSplitScreenSelectableTabs = (): TabType[] => [
    ...(showPatientTab ? (['patients'] as const) : []),
    ...(showBillingTodoTab ? (['todo'] as const) : []),
    ...(!isOfficeStaff
      ? ([
          'providers',
          ...(!isBillingStaff
            ? ([
                ...(showAccountsReceivableTab || splitScreen != null ? (['accounts_receivable'] as const) : []),
                ...(showProviderPayTab || splitScreen != null ? (['provider_pay'] as const) : []),
                ...(showAdminTrackingTab || (splitScreen != null && userProfile?.role === 'super_admin')
                  ? (['admin_tracking'] as const)
                  : []),
              ] as const)
            : []),
        ] as const)
      : []),
  ]

  const getSplitScreenPaneTabOptions = (
    pane: 'left' | 'right',
    currentTab: TabType,
    otherPaneTab: TabType,
  ): TabType[] => {
    const options = getSplitScreenSelectableTabs().filter(tab => {
      if (pane === 'right' && tab === 'providers') return false
      if (tab === otherPaneTab) return false
      return true
    })
    if (!options.includes(currentTab)) {
      return [currentTab, ...options]
    }
    return options
  }

  const handleSplitPaneTabChange = (pane: 'left' | 'right', tab: TabType) => {
    if (!splitScreen) return
    if (pane === 'left') {
      if (tab === splitScreen.right) return
      setSplitScreen({ ...splitScreen, left: tab })
    } else {
      if (tab === 'providers' || tab === splitScreen.left) return
      setSplitScreen({ ...splitScreen, right: tab })
    }
  }

  const splitPaneTabSelectClassName =
    'px-2 py-1 rounded border border-white/20 bg-slate-800/80 text-white text-sm font-medium min-w-0 max-w-[11rem] truncate cursor-pointer hover:bg-slate-700/80 focus:outline-none focus:ring-1 focus:ring-primary-400'

  // Open split screen: provider billing sheet on the left, current tab (or next) on the right
  const openSplitScreen = () => {
    const snapshot = { pathname: location.pathname, tab: activeTab }
    splitScreenExitRestoreRef.current = snapshot
    if (clinicId) {
      try {
        sessionStorage.setItem(`clinic_${clinicId}_splitScreenExitRestore`, JSON.stringify(snapshot))
      } catch (_) {}
    }
    // Provider billing sheet should always be the left side in split view
    const leftTab: TabType = 'providers'
    // Prefer to keep the user's current context on the right when possible
    let rightTab: TabType
    if (activeTab && activeTab !== 'providers') {
      rightTab = activeTab
    } else {
      // Fallback: use the next non-provider tab
      rightTab = getNextTab('providers')
      if (rightTab === 'providers') {
        rightTab = showBillingTodoTab ? 'todo' : 'accounts_receivable'
      }
    }
    setSplitScreen({ left: leftTab, right: rightTab })
    // Default to 67% / 33% split
    setSplitScreenLeftWidth(67)
  }
  
  // Exit split screen
  const handleExitSplitScreen = async () => {
    if (splitScreen?.left === 'accounts_receivable' || splitScreen?.right === 'accounts_receivable') {
      const flush = accountsReceivableTabFlushRef.current
      if (flush) {
        try {
          await flush()
        } catch (err) {
          console.error('[ClinicDetail] split-exit AR flush failed:', err)
        }
      }
    }
    let restore = splitScreenExitRestoreRef.current
    splitScreenExitRestoreRef.current = null
    if (!restore && clinicId) {
      try {
        const raw = sessionStorage.getItem(`clinic_${clinicId}_splitScreenExitRestore`)
        if (raw) {
          const o = JSON.parse(raw) as { pathname?: string; tab?: string }
          const tabs: TabType[] = ['patients', 'todo', 'providers', 'accounts_receivable', 'provider_pay', 'admin_tracking']
          if (o.pathname && o.tab && tabs.includes(o.tab as TabType)) {
            restore = { pathname: o.pathname, tab: o.tab as TabType }
          }
        }
      } catch (_) {}
    }
    if (clinicId) {
      try {
        sessionStorage.removeItem(`clinic_${clinicId}_splitScreenExitRestore`)
      } catch (_) {}
    }
    setSplitScreen(null)
    if (restore && clinicId) {
      setActiveTab(restore.tab)
      navigate(restore.pathname, { replace: true })
      return
    }
    if (isBillingStaff || isOfficialStaff) {
      setActiveTab('todo')
      navigate(`/clinic/${clinicId}/todo`, { replace: true })
    } else {
      const defaultTab = showBillingTodoTab ? 'todo' : 'providers'
      setActiveTab(defaultTab)
      navigate(`/clinic/${clinicId}/${defaultTab}`, { replace: true })
    }
  }
  
  // Handle split screen resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !splitScreenContainerRef.current) return
      
      const container = splitScreenContainerRef.current
      const containerRect = container.getBoundingClientRect()
      const containerWidth = containerRect.width
      const mouseX = e.clientX - containerRect.left
      
      // Calculate percentage (with min/max constraints)
      const percentage = Math.max(20, Math.min(80, (mouseX / containerWidth) * 100))
      setSplitScreenLeftWidth(percentage)
    }
    
    const handleMouseUp = () => {
      setIsResizing(false)
    }
    
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [isResizing])

  // Handle delete from context menu (only for provider rows now)
  const handleContextMenuDelete = () => {
    if (!contextMenu) return
    
    if (contextMenu.type === 'providerRow' && contextMenu.providerId) {
      handleDeleteProviderSheetRow(contextMenu.providerId, contextMenu.id)
    }
    // Patients, todos, and AR tabs handle their own deletes internally
    setContextMenu(null)
  }

  const isProvidersOrPayTab = activeTab === 'providers' || activeTab === 'provider_pay' || activeTab === 'admin_tracking'
  /** Provider Pay loads its own data; requiring billing-sheet rows here caused infinite page spinner when that fetch skipped rows (races, early return). */
  const singleProviderRouteBillingFinished =
    !!providerId &&
    singleProviderBillingSheetFetchFinishedKeyRef.current === `${providerId}|${selectedMonthKey}`
  const hasProviderSheetData = !isProvidersOrPayTab || (
    activeTab === 'provider_pay'
      ? true
      : providerId
        ? (providerSheetRows[providerId]?.length ?? 0) > 0 || singleProviderRouteBillingFinished
        : Object.keys(providerSheets).length > 0 ||
          (lastProviderSheetContextRef.current?.monthKey === selectedMonthKey && lastProviderSheetContextRef.current?.clinicId === clinicId)
  )
  const pageReady = !loading && (!isProvidersOrPayTab || hasProviderSheetData)

  /** Patient Info and Billing To-Do are clinic-wide; omit provider name from the page title there. */
  const clinicPageTitle =
    !splitScreen && (activeTab === 'patients' || activeTab === 'todo')
      ? (clinic?.name ?? '')
      : fullName.trim()
        ? `${fullName} - ${clinic?.name ?? ''}`
        : (clinic?.name ?? '')

  if (!pageReady) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400"></div>
      </div>
    )
  }

  return (
    <div>
      {saveErrorMessage && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-400 bg-red-500/15 px-4 py-3 text-red-100 text-sm flex items-start justify-between gap-3"
        >
          <span className="flex-1">{saveErrorMessage}</span>
          <button
            type="button"
            onClick={() => setSaveErrorMessage(null)}
            className="px-2 py-0.5 text-xs rounded bg-red-500/40 hover:bg-red-500/60 text-white"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}
      {restoreToast && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 rounded-lg border border-amber-400 bg-amber-500/15 px-4 py-3 text-amber-100 text-sm flex items-start justify-between gap-3"
        >
          <span className="flex-1">{restoreToast.message}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => { void handleUndoLastRestore() }}
              className="px-4 py-1.5 text-sm font-semibold rounded bg-amber-500 hover:bg-amber-600 text-white"
            >
              Undo restore
            </button>
            <button
              type="button"
              onClick={() => { restoreSnapshotRef.current = null; setRestoreToast(null) }}
              className="px-3 py-1.5 text-xs rounded bg-white/10 hover:bg-white/20 text-white"
              aria-label="Dismiss"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white mb-2">{clinicPageTitle}</h1>
        </div>
        {((!providerId || userProfile?.role !== 'office_staff') || userProfile?.role === 'office_staff') && (showPatientTab || showBillingTodoTab || !splitScreen) && (
          <div className="flex items-center gap-2 shrink-0">
            {showPatientTab && (
              <button
                type="button"
                onClick={() => handleTabChange('patients')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                  (splitScreen
                    ? splitScreen.left === 'patients' || splitScreen.right === 'patients'
                    : activeTab === 'patients')
                    ? 'bg-primary-500/20 text-primary-400 border-primary-400'
                    : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                }`}
              >
                <Users size={18} />
                Patient Info
              </button>
            )}
            {showBillingTodoTab && userProfile?.role !== 'office_staff' && (
              <button
                type="button"
                onClick={() => handleTabChange('todo')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                  (splitScreen
                    ? splitScreen.left === 'todo' || splitScreen.right === 'todo'
                    : activeTab === 'todo')
                    ? 'bg-primary-500/20 text-primary-400 border-primary-400'
                    : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                }`}
              >
                <CheckSquare size={18} />
                Billing To-Do
              </button>
            )}
            <div className="flex items-center gap-2">
              {activeTab === 'todo' && !splitScreen && (
                <button
                  type="button"
                  onClick={() => billingTodoExportRef.current?.exportToCSV()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-colors mb-1"
                >
                  <Download size={18} />
                  Export CSV
                </button>
              )}
            </div>
            {!splitScreen && userProfile?.role !== 'office_staff' && (
              <button
                type="button"
                onClick={openSplitScreen}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-colors"
                title="Split screen"
              >
                <Columns size={18} />
                Split Screen
              </button>
            )}
          </div>
        )}
      </div>

      {(!providerId || userProfile?.role !== 'office_staff') &&  (
      <div className="flex gap-2 mb-6 border-b border-white/20 justify-between items-center">
        <div className="flex gap-2">
          {showProvidersTab && (
          <button
            onClick={() => handleTabChange('providers')}
            className={`px-6 py-3 font-medium transition-colors flex items-center gap-2 ${
              (splitScreen
                ? splitScreen.left === 'providers' || splitScreen.right === 'providers'
                : activeTab === 'providers')
                ? 'text-primary-400 border-b-2 border-primary-400'
                : 'text-white/70 hover:text-white'
            }`}
          >
            <FileText size={18} />
            Billing
          </button>
          )}
          {showAccountsReceivableTab && (
          <button
            onClick={() => handleTabChange('accounts_receivable')}
            className={`px-6 py-3 font-medium transition-colors flex items-center gap-2 ${
              (splitScreen
                ? splitScreen.left === 'accounts_receivable' || splitScreen.right === 'accounts_receivable'
                : activeTab === 'accounts_receivable')
                ? 'text-primary-400 border-b-2 border-primary-400'
                : 'text-white/70 hover:text-white'
            }`}
          >
            <FileText size={18} />
            Accounts Receivable
          </button>
          )}
          {showProviderPayTab && (
          <button
            onClick={() => handleTabChange('provider_pay')}
            className={`px-6 py-3 font-medium transition-colors flex items-center gap-2 ${
              (splitScreen
                ? splitScreen.left === 'provider_pay' || splitScreen.right === 'provider_pay'
                : activeTab === 'provider_pay')
                ? 'text-primary-400 border-b-2 border-primary-400'
                : 'text-white/70 hover:text-white'
            }`}
          >
            <DollarSign size={18} />
            Provider Pay
          </button>
          )}
          {showAdminTrackingTab && (
          <button
            onClick={() => handleTabChange('admin_tracking')}
            className={`px-6 py-3 font-medium transition-colors flex items-center gap-2 ${
              (splitScreen
                ? splitScreen.left === 'admin_tracking' || splitScreen.right === 'admin_tracking'
                : activeTab === 'admin_tracking')
                ? 'text-primary-400 border-b-2 border-primary-400'
                : 'text-white/70 hover:text-white'
            }`}
          >
            <FileText size={18} />
            Admin Tracking
          </button>
          )}
        </div>
        {/* <div className="flex items-center gap-2">
          {activeTab === 'todo' && !splitScreen && (
            <button
              type="button"
              onClick={() => billingTodoExportRef.current?.exportToCSV()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-colors mb-1"
            >
              <Download size={18} />
              Export CSV
            </button>
          )}
        </div> */}
      </div>
      )}

      <div
        className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20 relative"
        // style={
        //   !splitScreen && activeTab === 'provider_pay'
        //     ? { width: 'fit-content', maxWidth: '50vw', minWidth: '22rem' }
        //     : undefined
        // }
      >
        {splitScreen ? (
          <div
            ref={splitScreenContainerRef}
            className="flex"
            // No `minHeight` — when the viewport is shorter than 650+110px, the prior `minHeight: '650px'`
            // forced the split container taller than the available area, pushing the bottom of each pane
            // (and any in-pane buttons like BillingTodoTab's "+ Add 50 rows") below the visible fold.
            // With pure `calc(100vh - 110px)` the container always fits, panes scroll their own contents.
            style={{ height: 'calc(100vh - 110px)', width: '100%', overflow: 'hidden', position: 'relative' }}
          >
            {/* Left side */}
            <div 
              className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20 flex flex-col" 
              style={{ 
                width: `${splitScreenLeftWidth}%`,
                minWidth: 0, 
                overflow: 'hidden',
                transition: isResizing ? 'none' : 'width 0.1s ease',
                minHeight: 0
              }}
            >
              <div className="shrink-0 p-2 border-b border-white/20 flex justify-between items-center gap-2 min-h-[2.5rem]">
                <div className="flex items-center gap-3 min-w-0">
                  <select
                    value={splitScreen.left}
                    onChange={(e) => handleSplitPaneTabChange('left', e.target.value as TabType)}
                    className={splitPaneTabSelectClassName}
                    title="Select left pane tab"
                    aria-label="Select left pane tab"
                  >
                    {getSplitScreenPaneTabOptions('left', splitScreen.left, splitScreen.right).map(tab => (
                      <option key={tab} value={tab}>
                        {getTabLabel(tab)}
                      </option>
                    ))}
                  </select>
                  {splitScreen.left === 'providers' && currentProvider && (
                    <span className="text-white/90 text-sm text-[#ffd600] truncate">
                      {currentProvider.first_name} {currentProvider.last_name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {splitScreen.left === 'todo' && (
                    <button
                      type="button"
                      onClick={() => billingTodoExportRef.current?.exportToCSV()}
                      className="flex items-center gap-1.5 px-2 py-1 rounded text-sm text-white/90 hover:text-white border border-white/20 hover:bg-white/10 transition-colors"
                    >
                      <Download size={14} />
                      Export CSV
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden w-full">
                {renderTabContent(splitScreen.left)}
              </div>
            </div>
            
            {/* Resizable Divider */}
            <div 
              className="bg-white/20 hover:bg-white/30 cursor-col-resize flex items-center justify-center"
                                style={{ 
                width: '4px',
                minWidth: '4px',
                position: 'relative',
                zIndex: 10
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                setIsResizing(true)
              }}
            >
              <div 
                className="bg-white/40 rounded"
                                  style={{ 
                  width: '2px',
                  height: '100%'
                }}
              />
            </div>
            
            {/* Right side - any tab except Providers (provider billing sheet only appears on the left in split view) */}
            <div 
              className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20 flex flex-col" 
              style={{ 
                width: `${100 - splitScreenLeftWidth}%`,
                minWidth: 0, 
                overflow: 'hidden',
                transition: isResizing ? 'none' : 'width 0.1s ease',
                minHeight: 0
              }}
            >
              <div className="shrink-0 p-2 border-b border-white/20 flex justify-between items-center gap-2 min-h-[2.5rem]">
                <div className="flex items-center gap-3 min-w-0">
                  <select
                    value={splitScreen.right}
                    onChange={(e) => handleSplitPaneTabChange('right', e.target.value as TabType)}
                    className={splitPaneTabSelectClassName}
                    title="Select right pane tab"
                    aria-label="Select right pane tab"
                  >
                    {getSplitScreenPaneTabOptions('right', splitScreen.right, splitScreen.left).map(tab => (
                      <option key={tab} value={tab}>
                        {getTabLabel(tab)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {splitScreen.right === 'todo' && (
                    <button
                      type="button"
                      onClick={() => billingTodoExportRef.current?.exportToCSV()}
                      className="flex items-center gap-1.5 px-2 py-1 rounded text-sm text-white/90 hover:text-white border border-white/20 hover:bg-white/10 transition-colors"
                    >
                      <Download size={14} />
                      Export CSV
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleExitSplitScreen()}
                    className="text-white/70 hover:text-white text-sm px-2"
                    title="Exit split screen"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div 
                className="flex flex-col flex-1 min-h-0 overflow-hidden" 
                style={{ width: '100%' }}
              >
                {renderTabContent(splitScreen.right)}
              </div>
            </div>
                                </div>
                              ) : (
          renderTabContent(activeTab)
        )}
      </div>

      {/* Context Menu - portaled to body so position:fixed uses viewport coordinates */}
      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="fixed bg-slate-800 border border-white/20 rounded-lg shadow-xl z-50 py-1 min-w-[150px]"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
        >
          <button
            onClick={handleContextMenuDelete}
            className="w-full text-left px-4 py-2 text-red-400 hover:bg-white/10 flex items-center gap-2"
          >
            <Trash2 size={16} />
            Delete Row
          </button>
        </div>,
        document.body
      )}

      {/* Column Lock Dialog */}
      {showLockDialog && selectedLockColumn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border border-slate-700">
            <h3 className="text-xl font-semibold text-white mb-4">
              {selectedLockColumn.isPatientColumn 
                ? (isPatientColumnLocked(selectedLockColumn.columnName as keyof IsLockPatients) ? 'Unlock' : 'Lock')
                : selectedLockColumn.isBillingTodoColumn
                ? (isBillingTodoColumnLocked(selectedLockColumn.columnName as keyof IsLockBillingTodo) ? 'Unlock' : 'Lock')
                : selectedLockColumn.isProviderColumn
                ? (isProviderColumnLocked(selectedLockColumn.columnName as keyof IsLockProviders) ? 'Unlock' : 'Lock')
                : selectedLockColumn.isARColumn
                ? (isARColumnLocked(selectedLockColumn.columnName as keyof IsLockAccountsReceivable) ? 'Unlock' : 'Lock')
                : selectedLockColumn.isProviderPayColumn
                ? (isProviderPayColumnLocked(selectedLockColumn.columnName as keyof IsLockProviderPay) ? 'Unlock' : 'Lock')
                : (isColumnLocked(selectedLockColumn.columnName, selectedLockColumn.providerId) ? 'Unlock' : 'Lock')
              } Column
            </h3>
            
            <div className="mb-4">
              <p className="text-slate-300 mb-2">
                Column: <span className="font-semibold text-white">{selectedLockColumn.columnName}</span>
              </p>
              {selectedLockColumn.providerId && !selectedLockColumn.isPatientColumn && !selectedLockColumn.isBillingTodoColumn && !selectedLockColumn.isProviderColumn && !selectedLockColumn.isARColumn && !selectedLockColumn.isProviderPayColumn && (
                <p className="text-slate-300 text-sm">
                  Provider-specific lock
                </p>
              )}
              {selectedLockColumn.isPatientColumn && (
                <p className="text-slate-300 text-sm">
                  Patient table column
                </p>
              )}
              {selectedLockColumn.isBillingTodoColumn && (
                <p className="text-slate-300 text-sm">
                  Billing Todo table column
                </p>
              )}
              {selectedLockColumn.isProviderColumn && selectedLockColumn.providerId && (
                <p className="text-slate-300 text-sm">
                  Provider sheet:{' '}
                  <span className="font-medium text-white">
                    {(() => {
                      const p = providers.find((x) => x.id === selectedLockColumn.providerId)
                      return p ? `${p.first_name} ${p.last_name}`.trim() : selectedLockColumn.providerId
                    })()}
                  </span>
                </p>
              )}
              {selectedLockColumn.isARColumn && (
                <p className="text-slate-300 text-sm">
                  Accounts Receivable table column
                </p>
              )}
              {selectedLockColumn.isProviderPayColumn && (
                <p className="text-slate-300 text-sm">
                  Provider Pay table column
                </p>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-slate-300 mb-2">
                Comment (optional):
              </label>
              <textarea
                value={lockComment}
                onChange={(e) => setLockComment(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 text-white border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="Why is this column locked?"
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowLockDialog(false)
                  setSelectedLockColumn(null)
                  setLockComment('')
                }}
                className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              
              {selectedLockColumn.isPatientColumn ? (
                <>
                  {isPatientColumnLocked(selectedLockColumn.columnName as keyof IsLockPatients) && canUnlock && (
                    <button
                      onClick={() => handleTogglePatientColumnLock(selectedLockColumn.columnName as keyof IsLockPatients, false, lockComment)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2"
                    >
                      <Unlock size={16} />
                      Unlock
                    </button>
                  )}
                  {!isPatientColumnLocked(selectedLockColumn.columnName as keyof IsLockPatients) && (
                    <button
                      onClick={() => handleTogglePatientColumnLock(selectedLockColumn.columnName as keyof IsLockPatients, true, lockComment)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2"
                    >
                      <Lock size={16} />
                      Lock
                    </button>
                  )}
                </>
              ) : selectedLockColumn.isBillingTodoColumn ? (
                <>
                  {isBillingTodoColumnLocked(selectedLockColumn.columnName as keyof IsLockBillingTodo) && canUnlock && (
                    <button
                      onClick={() => handleToggleBillingTodoColumnLock(selectedLockColumn.columnName as keyof IsLockBillingTodo, false, lockComment)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2"
                    >
                      <Unlock size={16} />
                      Unlock
                    </button>
                  )}
                  {!isBillingTodoColumnLocked(selectedLockColumn.columnName as keyof IsLockBillingTodo) && (
                    <button
                      onClick={() => handleToggleBillingTodoColumnLock(selectedLockColumn.columnName as keyof IsLockBillingTodo, true, lockComment)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2"
                    >
                      <Lock size={16} />
                      Lock
                    </button>
                  )}
                </>
              ) : selectedLockColumn.isProviderColumn ? (
                <>
                  {isProviderColumnLocked(selectedLockColumn.columnName as keyof IsLockProviders) && canUnlock && (
                    <button
                      onClick={() => handleToggleProviderColumnLock(selectedLockColumn.columnName as keyof IsLockProviders, false, lockComment)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2"
                    >
                      <Unlock size={16} />
                      Unlock
                    </button>
                  )}
                  {!isProviderColumnLocked(selectedLockColumn.columnName as keyof IsLockProviders) && (
                    <button
                      onClick={() => handleToggleProviderColumnLock(selectedLockColumn.columnName as keyof IsLockProviders, true, lockComment)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2"
                    >
                      <Lock size={16} />
                      Lock
                    </button>
                  )}
                </>
              ) : selectedLockColumn.isARColumn ? (
                <>
                  {isARColumnLocked(selectedLockColumn.columnName as keyof IsLockAccountsReceivable) && canUnlock && (
                    <button
                      onClick={() => handleToggleARColumnLock(selectedLockColumn.columnName as keyof IsLockAccountsReceivable, false, lockComment)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2"
                    >
                      <Unlock size={16} />
                      Unlock
                    </button>
                  )}
                  {!isARColumnLocked(selectedLockColumn.columnName as keyof IsLockAccountsReceivable) && (
                    <button
                      onClick={() => handleToggleARColumnLock(selectedLockColumn.columnName as keyof IsLockAccountsReceivable, true, lockComment)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2"
                    >
                      <Lock size={16} />
                      Lock
                    </button>
                  )}
                </>
              ) : selectedLockColumn.isProviderPayColumn ? (
                <>
                  {isProviderPayColumnLocked(selectedLockColumn.columnName as keyof IsLockProviderPay) && canUnlock && (
                    <button
                      onClick={() => handleToggleProviderPayColumnLock(selectedLockColumn.columnName as keyof IsLockProviderPay, false, lockComment)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2"
                    >
                      <Unlock size={16} />
                      Unlock
                    </button>
                  )}
                  {!isProviderPayColumnLocked(selectedLockColumn.columnName as keyof IsLockProviderPay) && (
                    <button
                      onClick={() => handleToggleProviderPayColumnLock(selectedLockColumn.columnName as keyof IsLockProviderPay, true, lockComment)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2"
                    >
                      <Lock size={16} />
                      Lock
                    </button>
                  )}
                </>
              ) : (
                <>
                  {isColumnLocked(selectedLockColumn.columnName, selectedLockColumn.providerId) && canUnlock && (
                    <button
                      onClick={() => handleToggleColumnLock(selectedLockColumn.columnName, selectedLockColumn.providerId, false)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors flex items-center gap-2"
                    >
                      <Unlock size={16} />
                      Unlock
                    </button>
                  )}
                  {!isColumnLocked(selectedLockColumn.columnName, selectedLockColumn.providerId) && (
                    <button
                      onClick={() => handleToggleColumnLock(selectedLockColumn.columnName, selectedLockColumn.providerId, true, lockComment)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2"
                    >
                      <Lock size={16} />
                      Lock
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}