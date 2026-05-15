import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { apiClient } from '@/lib/apiClient'
import { fetchSheetRows, fetchSheetRowsForSheetIds, saveSheetRows, isUuid } from '@/lib/providerSheetRows'
import { enrichSheetRowsFromPatients, applyCoPatientSnapshotToSheetRows } from '@/lib/enrichProviderSheetRowsFromPatients'
import { fetchBackupCsvAsSheetRows, padSheetRowsTo200 } from '@/lib/providerSheetBackups'
import { sheetRowsToUiCsv, type ProviderSheetUiExportLayout } from '@/lib/providerSheetBackupUiExport'
import BackupVersionsBar, { type BackupVersionMeta } from '@/components/BackupVersionsBar'
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
import PatientsTab from '@/components/tabs/PatientsTab'
import BillingTodoTab from '@/components/tabs/BillingTodoTab'
import ProvidersTab from '@/components/tabs/ProvidersTab'
import AccountsReceivableTab from '@/components/tabs/AccountsReceivableTab'
import ProviderPayTab, { type IsLockProviderPay } from '@/components/tabs/ProviderPayTab'

type TabType = 'patients' | 'todo' | 'providers' | 'accounts_receivable' | 'provider_pay'

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
    if (pathname === base) return 'providers'
  }
  if (clinicId && pathname.startsWith(`/clinic/${clinicId}/providers`) && !providerIdFromRoute) {
    return 'providers'
  }
  if (tabParam && ['patients', 'todo', 'providers', 'accounts_receivable', 'provider_pay'].includes(tabParam)) {
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

  // Month filter for provider tab (and pay-period half when clinic has payroll=2)
  const [selectedMonth, setSelectedMonth] = useState<Date>(new Date())
  const [selectedPayroll, setSelectedPayroll] = useState<1 | 2>(1)
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
  const [selectedMonthProviderPay, setSelectedMonthProviderPay] = useState<Date>(new Date())
  const [selectedPayrollProviderPay, setSelectedPayrollProviderPay] = useState<1 | 2>(1)
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
  const pendingProviderSheetSaveRef = useRef<Record<string, SheetRow[]>>({})
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
    const onSingleProviderBilling = !!(scopedBase && location.pathname === scopedBase)

    if (isBillingStaff && clinicId && (onProviderFinanceAR || onProviderFinancePP)) {
      navigate(`/clinic/${clinicId}/todo`, { replace: true })
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
    if (providerId && isProvidersRoute && onSingleProviderBilling) {
      setActiveTab('providers')
      return
    }
    if (!providerId && isProvidersRoute) {
      setActiveTab('providers')
      return
    }
    if (tab && ['patients', 'todo', 'providers', 'accounts_receivable', 'provider_pay'].includes(tab)) {
      if (isOfficialStaff && tab !== 'todo' && tab !== 'providers') {
        navigate(`/clinic/${clinicId}/todo`, { replace: true })
      } else if (tab === 'todo' && userProfile?.role === 'admin') {
        navigate(`/clinic/${clinicId}/providers`, { replace: true })
      } else if (isBillingStaff && (tab === 'accounts_receivable' || tab === 'provider_pay')) {
        navigate(`/clinic/${clinicId}/todo`, { replace: true })
      } else {
        setActiveTab(tab as TabType)
      }
    } else if (!tab && clinicId && !isProvidersRoute) {
      if (isBillingStaff || isOfficialStaff) {
        navigate(`/clinic/${clinicId}/todo`, { replace: true })
      } else if (userProfile?.role === 'admin') {
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
    const headerHydrateTabs: TabType[] = ['patients', 'todo', 'accounts_receivable', 'provider_pay']
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
      // Provider sheet data for current month is fetched by the selectedMonth effect below
      if (activeTab === 'providers') {
        void fetchPatients()
        void fetchBillingCodes()
        void fetchStatusColors()
        void fetchColumnLocks()
        // fetchProviders() is intentionally omitted on the single-provider route: fetchProviderSheetData
        // (triggered by the month effect) loads the one provider we need and syncs it into providers state.
      } else if (activeTab === 'provider_pay') {
        void fetchStatusColors()
        void fetchProviders()
      } else if (activeTab === 'accounts_receivable' && selectedMonthKey) {
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
          if (activeTab === 'providers' || activeTab === 'provider_pay') setLoading(false)
          return
        }
      } else {
        // Clinic view: skip only if cache is for this clinic
        if (contextMatches && hasCached) {
          if (activeTab === 'providers' && monthKey) void fetchIsLockProviders(monthKey)
          if (activeTab === 'providers' || activeTab === 'provider_pay') setLoading(false)
          return
        }
      }
    }

    const isMonthChangeOnly = monthChanged && !isInitialLoad
    if (providerId && clinicId && (activeTab === 'providers' || activeTab === 'provider_pay')) {
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
    if (clinicId && !providerId && (activeTab === 'providers' || activeTab === 'provider_pay')) {
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
    if (activeTab !== 'providers' && activeTab !== 'provider_pay') {
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
      if (activeTab === 'providers') {
        await fetchPatients() // Need patients for displaying patient info in provider sheets
        await fetchBillingCodes()
        await fetchStatusColors()
        await fetchColumnLocks()
        await fetchProviders()
        const mk = monthKeyForProviderSheets ?? selectedMonthKey
        if (mk) await fetchLock(`providers:${mk}`, () => fetchIsLockProviders(mk))
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
      if (activeTab !== 'providers' && activeTab !== 'provider_pay') {
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
      if (data && data.length > 0) {
        setStatusColors(data)
      } else {
        setStatusColors(getDefaultStatusColors())
      }
    } catch {
      console.error('Error fetching status colors')
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
          console.error('Error creating is_lock_patients record:', insertError)
          setIsLockPatients(null)
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
          
          if (retryError) throw retryError
        } else if (error) {
          throw error
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

  // Month navigation functions
  const handlePreviousMonth = () => {
    if (clinic?.payroll === 2) {
      if (selectedPayroll === 2) {
        setSelectedPayroll(1)
      } else {
        setSelectedPayroll(2)
        setSelectedMonth((prev) => {
          const d = new Date(prev)
          d.setMonth(d.getMonth() - 1)
          return d
        })
      }
    } else {
      setSelectedMonth((prev) => {
        const d = new Date(prev)
        d.setMonth(d.getMonth() - 1)
        return d
      })
    }
  }

  const handleNextMonth = () => {
    if (clinic?.payroll === 2) {
      if (selectedPayroll === 1) {
        setSelectedPayroll(2)
      } else {
        setSelectedPayroll(1)
        setSelectedMonth((prev) => {
          const d = new Date(prev)
          d.setMonth(d.getMonth() + 1)
          return d
        })
      }
    } else {
      setSelectedMonth((prev) => {
        const d = new Date(prev)
        d.setMonth(d.getMonth() + 1)
        return d
      })
    }
  }

  /** Format month/year for display; when payroll=2 and payroll half is passed, show "January 1st Half 2025". */
  const formatMonthYear = (date: Date, payroll?: 1 | 2) => {
    if (clinic?.payroll === 2 && payroll != null) {
      const monthName = date.toLocaleDateString('en-US', { month: 'long' })
      const half = payroll === 1 ? '1st' : '2nd'
      return `${monthName} ${half} Half ${date.getFullYear()}`
    }
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  const handlePreviousMonthProviderPay = () => {
    if (clinic?.payroll === 2) {
      if (selectedPayrollProviderPay === 2) {
        setSelectedPayrollProviderPay(1)
      } else {
        setSelectedPayrollProviderPay(2)
        setSelectedMonthProviderPay((prev) => {
          const d = new Date(prev)
          d.setMonth(d.getMonth() - 1)
          return d
        })
      }
    } else {
      setSelectedMonthProviderPay((prev) => {
        const d = new Date(prev)
        d.setMonth(d.getMonth() - 1)
        return d
      })
    }
  }

  const handleNextMonthProviderPay = () => {
    if (clinic?.payroll === 2) {
      if (selectedPayrollProviderPay === 1) {
        setSelectedPayrollProviderPay(2)
      } else {
        setSelectedPayrollProviderPay(1)
        setSelectedMonthProviderPay((prev) => {
          const d = new Date(prev)
          d.setMonth(d.getMonth() + 1)
          return d
        })
      }
    } else {
      setSelectedMonthProviderPay((prev) => {
        const d = new Date(prev)
        d.setMonth(d.getMonth() + 1)
        return d
      })
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
      { id: '3', status: 'Charge NS/LC', color: '#f59e0b', text_color: '#000000', type: 'appointment', created_at: '', updated_at: '' },
      { id: '4', status: 'RS No Charge', color: '#ef4444', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      { id: '5', status: 'NS No Charge', color: '#6b7280', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      { id: '6', status: 'Note not complete', color: '#dc2626', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
      
      // Claim Status Colors
      { id: '7', status: 'Claim Sent', color: '#3b82f6', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '8', status: 'RS', color: '#f59e0b', text_color: '#000000', type: 'claim', created_at: '', updated_at: '' },
      { id: '9', status: 'IP', color: '#eab308', text_color: '#000000', type: 'claim', created_at: '', updated_at: '' },
      { id: '10', status: 'Paid', color: '#22c55e', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '11', status: 'Deductible', color: '#a855f7', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '12', status: 'N/A', color: '#6b7280', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '13', status: 'PP', color: '#06b6d4', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '14', status: 'Denial', color: '#ef4444', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
      { id: '15', status: 'Rejection', color: '#dc2626', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
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

      // Create empty rows for providers table (200 rows per provider)
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

      const emptyRowsNeeded = Math.max(0, 200 - sheetRows.length)
      const emptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => 
        createEmptyProviderSheetRow(i)
      )
      const allRows = [...sheetRows, ...emptyRows]
      if (!isStillCurrent()) return
      setProviderSheetRowsByMonth(prev => ({ ...prev, [selectedMonthKey]: { ...(prev[selectedMonthKey] ?? {}), [providerId]: allRows } }))
      setProviderSheetsByMonth(prev => ({ ...prev, [selectedMonthKey]: { ...(prev[selectedMonthKey] ?? {}), [providerId]: sheet } }))
      lastProviderSheetContextRef.current = { clinicId: clinicId!, providerId, monthKey: selectedMonthKey }
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

      await saveSheetRows(apiClient, currentSheet.id, updatedRowData)
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
        const { data, error } = await apiClient
          .from('providers')
          .select('*')
          .eq('active', true)
          .contains('clinic_ids', [clinicId])
          .order('last_name')
          .order('first_name')

        if (error) throw error
        const fetchedProviders = data || []
        // Preserve any unsaved providers (with 'new-' prefix)
        setProviders((currentProviders) => {
          const unsavedProviders = currentProviders.filter((p) => p.id.startsWith('new-'))
          const next = [...unsavedProviders, ...fetchedProviders]
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

        const emptyRowsNeeded = Math.max(0, 200 - sheetRows.length)
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
        setProviderSheetsByMonth(prev => ({ ...prev, [monthKey]: sheetsMap }))
        setProviderSheetRowsByMonth(prev => ({ ...prev, [monthKey]: rowsMap }))
        lastProviderSheetContextRef.current = { clinicId, providerId: null, monthKey }
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



  const saveProviderSheetRows = useCallback(async (providerId: string, rowsToSave: SheetRow[], knownDeletedIds?: string[]) => {
    if (!clinicId || !userProfile) {
      return
    }

    const sheet = providerSheets[providerId]
    if (!sheet) {
      return
    }

    // Filter out only truly empty rows (empty- rows with no data)
    const rowsToProcess = rowsToSave.filter(r => {
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

    // Serialize: only one save per provider at a time so an older save cannot overwrite a newer one in the DB
    if (saveProviderSheetInProgressRef.current.has(providerId)) {
      pendingProviderSheetSaveRef.current[providerId] = rowsToSave
      return
    }
    saveProviderSheetInProgressRef.current.add(providerId)

    // Built synchronously from savedRows right after saveSheetRows returns — no React batching delay.
    // Maps every temp id (new-*, empty-* with data) that was sent as an INSERT to the real UUID
    // the DB assigned. Used in finally to reconcile any queued pending before replay so we UPDATE
    // instead of INSERT again (which creates duplicate provider_sheet_rows).
    let savedTempIdToUuidMap: Map<string, string> | null = null

    // Optimistic update: apply full rows to state immediately so the row (e.g. patient fill) appears right away
    setProviderSheetRowsByMonth(prev => ({ ...prev, [selectedMonthKey]: { ...(prev[selectedMonthKey] ?? {}), [providerId]: rowsToSave } }))

    try {
      // Do not coerce omitted arg to [] — [] skips deletes and skips orphan SELECT (saveSheetRows treats [] as explicit).
      // Pending replays omit knownDeletedIds so orphans are cleaned via SELECT path.
      const savedRows = await saveSheetRows(apiClient, sheet.id, rowsToProcess, knownDeletedIds)
      // Patient demographics are owned by `patients` (Patients tab / API), not pushed from provider sheets.
      const freshPatients =
        patientsRef.current.length > 0
          ? patientsRef.current
          : (await fetchPatients()) ?? []
      try {
        const pendingKey = `provider_sheet_pending_${clinicId}_${providerId}_${selectedMonthKey}`
        localStorage.removeItem(pendingKey)
      } catch (_) {}
      // Populate the synchronous id map right after the network response — before any React state update.
      savedTempIdToUuidMap = new Map<string, string>()
      const savedRowsByOldId = new Map<string, SheetRow>()
      const savedRowsByAnyId = new Map<string, SheetRow>()
      rowsToProcess.forEach((row, i) => {
        const saved = savedRows[i]
        if (!saved) return
        savedRowsByOldId.set(row.id, saved)
        savedRowsByAnyId.set(row.id, saved)
        savedRowsByAnyId.set(saved.id, saved)
        // Track temp→UUID promotions for the queued pending reconciliation
        if (!isUuid(row.id) && isUuid(saved.id)) {
          savedTempIdToUuidMap!.set(row.id, saved.id)
        }
      })

      // Merge saved row ids, then apply co-patient demographics to all providers for this month (last-write-wins from DB).
      setProviderSheetRowsByMonth((prev) => {
        const current = prev[selectedMonthKey] ?? {}
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
        const emptyRowsNeeded = Math.max(0, 200 - nonEmptyRows.length)
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
        return { ...prev, [selectedMonthKey]: nextMonthRows } as Record<string, Record<string, SheetRow[]>>
      })
      if (freshPatients.length > 0) {
        setProviderRowsVersion((v) => v + 1)
      }
    } catch (error) {
      console.error('[ClinicDetail] saveProviderSheetRows failed: providerId=', providerId, error)
    } finally {
      saveProviderSheetInProgressRef.current.delete(providerId)
      const pending = pendingProviderSheetSaveRef.current[providerId]
      if (pending) {
        delete pendingProviderSheetSaveRef.current[providerId]
        const idMap = savedTempIdToUuidMap
        let toSave = pending
        if (idMap && idMap.size > 0) {
          toSave = pending.map((row) => {
            if (!isUuid(row.id)) {
              const newId = idMap.get(row.id)
              if (newId) {
                return { ...row, id: newId, updated_at: new Date().toISOString() }
              }
            }
            return row
          })
        }
        void saveProviderSheetRows(providerId, toSave)
      }
    }
  }, [clinicId, userProfile, providerSheets, selectedMonthKey, fetchPatients])

  // Restore provider sheet rows from localStorage after refresh (browser aborts in-flight save; data was backed up on unload)
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
        restoredPendingKeysRef.current.add(key)
        // Intentionally silent: avoid noisy runtime logs in normal tab usage.
        saveProviderSheetRows(providerId, data.rows).then(() => {
          try { localStorage.removeItem(key) } catch (_) {}
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

  // On page unload (refresh/close), send pending provider sheet rows via keepalive fetch so the save can complete even after the page is gone
  useEffect(() => {
    const PREFIX = 'provider_sheet_pending_'
    const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
    const savePendingUrl = apiBase ? `${apiBase}/api/save-pending-provider-sheet` : '/api/save-pending-provider-sheet'

    const onPageHide = () => {
      let token: string | null = null
      try {
        const raw = localStorage.getItem('health-billing-auth')
        if (raw) {
          const data = JSON.parse(raw) as { currentSession?: { access_token?: string }; access_token?: string }
          token = data?.currentSession?.access_token ?? data?.access_token ?? null
        }
      } catch (_) {}
      if (!token) return

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
          }
          const clinicId = data.clinicId
          const providerId = data.providerId
          const selectedMonthKey = data.selectedMonthKey
          const rows = data.rows
          if (!clinicId || !providerId || !selectedMonthKey || !Array.isArray(rows) || rows.length === 0) return

          const body = JSON.stringify({ clinicId, providerId, selectedMonthKey, rows })
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

    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [])

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
      // Ensure we maintain 200 rows total per provider
      const nonEmptyRows = updatedRows.filter(r => !r.id.startsWith('empty-'))
      const emptyRowsNeeded = Math.max(0, 200 - nonEmptyRows.length)
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


  const handleDeleteProviderSheetRow = useCallback(async (providerId: string, rowId: string) => {
    const rows = providerSheetRows[providerId] || []
    const deletedRow = rows.find(r => r.id === rowId)
    const insertIndex = deletedRow ? rows.findIndex(r => r.id === rowId) : -1
    // Only pass the deleted UUID to saveSheetRows so it can DELETE directly without a SELECT.
    // Non-UUID ids (empty-*, new-*) were never persisted so need no DB delete.
    const deletedDbIds = isUuid(rowId) ? [rowId] : []
    let rowsAfterDelete: SheetRow[] = []
    // Context menu removes several rows quickly; without flushSync, React defers batched updates
    // and `rowsAfterDelete` can still be empty when save runs, so only one row persists as deleted.
    flushSync(() => {
      setProviderSheetRowsByMonth(prev => {
        const current = prev[selectedMonthKey] ?? {}
        const list = current[providerId] || []
        rowsAfterDelete = list.filter(r => r.id !== rowId)
        return { ...prev, [selectedMonthKey]: { ...current, [providerId]: rowsAfterDelete } }
      })
    })
    await saveProviderSheetRows(providerId, rowsAfterDelete, deletedDbIds)
    if (deletedRow != null && insertIndex >= 0) {
      lastUndoRef.current = () => {
        setProviderSheetRowsByMonth(prev => {
          const current = prev[selectedMonthKey] ?? {}
          const list = current[providerId] || []
          const next = [...list.slice(0, insertIndex), deletedRow, ...list.slice(insertIndex)]
          saveProviderSheetRows(providerId, next).catch(err => console.error('Undo provider row: save failed', err))
          return { ...prev, [selectedMonthKey]: { ...current, [providerId]: next } }
        })
      }
    }
  }, [providerSheetRows, saveProviderSheetRows, selectedMonthKey])

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
    saveProviderSheetRows(providerId, newRows).catch(err => console.error('Failed to save after add row', err))
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
    saveProviderSheetRows(providerId, newRows).catch(err => console.error('Failed to save after add row', err))
  }, [providerSheetRows, saveProviderSheetRows, selectedMonthKey])

  // Direct save function that accepts providerId and rows - for use when we have computed updated data
  const saveProviderSheetRowsDirect = useCallback(async (providerId: string, rowsToSave: SheetRow[]) => {
    await saveProviderSheetRows(providerId, rowsToSave)
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
    saveProviderSheetRows(providerId, newRows).catch(err => console.error('Failed to persist provider row order', err))
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
          setActiveTab(tab)
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
      case 'accounts_receivable':
        return (
          <>
            {userProfile?.role === 'super_admin' && clinicId && (
              <div className="mb-4">
                <BackupVersionsBar
                  backupType="ar"
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
              </div>
            )}
            <AccountsReceivableTab
              clinicId={clinicId!}
              clinicPayroll={clinic?.payroll ?? 1}
              patients={patients}
              canEdit={canEdit && !backupOverrideAR}
              canTogglePastMonthWholeSheetLock={canLockColumns}
              wholeSheetLocked={Boolean(isLockAccountsReceivable?.whole_sheet_locked)}
              onTogglePastMonthWholeSheetLock={handleToggleARWholeSheetLock}
              isInSplitScreen={!!splitScreen}
              onLocksMonthKeyChange={setArLocksMonthKey}
              isLockAccountsReceivable={isLockAccountsReceivable}
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
          </>
        )
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
        return (
          <>
            {userProfile?.role === 'super_admin' && clinicId && (
              <div className="mb-4">
                <BackupVersionsBar
                  backupType="provider_pay"
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
                    const csv = header + '\n' + dataRows.join('\n')
                    return new Blob([csv], { type: 'text/csv' })
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
              </div>
            )}
            <ProviderPayTab
              clinicId={clinicId!}
              clinicPayroll={clinic?.payroll ?? 1}
              providerId={providerId ?? undefined}
              providers={providers}
              canEdit={canEdit && !backupOverrideProviderPayByKey}
              canTogglePastMonthWholeSheetLock={canLockColumns}
              isInSplitScreen={!!splitScreen}
              selectedMonth={selectedMonthProviderPay}
              onPreviousMonth={handlePreviousMonthProviderPay}
              onNextMonth={handleNextMonthProviderPay}
              formatMonthYear={formatMonthYear}
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
          </>
        )
      }
      case 'providers': {
        const providerSheetRowsWithOverride =
          providerId && backupOverrideRows
            ? { ...providerSheetRows, [providerId]: backupOverrideRows }
            : providerSheetRows
        const canEditProviders = canEdit && !backupOverrideRows
        const currentSheetForBackup = providerId ? providerSheets[providerId] : null
        return (
          <>
            {userProfile?.role === 'super_admin' && currentSheetForBackup?.id && (
              <div className="mb-4">
                <BackupVersionsBar
                  backupType="providers"
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
                    const padded = padSheetRowsTo200(raw)
                    const layout =
                      providerSheetExportLayoutRef.current ?? {
                        showVisitTypeColumn: providersTabShowVisitTypeColumn,
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
                    setBackupOverrideRows(padSheetRowsTo200(rows))
                    setSelectedBackupVersion(version)
                    setBackupViewKey((k) => k + 1)
                  }}
                  onBackToCurrent={() => {
                    setBackupOverrideRows(null)
                    setSelectedBackupVersion(null)
                  }}
                />
              </div>
            )}
            <ProvidersTab
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
              onDeleteRow={handleDeleteProviderSheetRow}
              onAddRowBelow={handleAddProviderRowBelow}
              onAddRowAbove={handleAddProviderRowAbove}
              onPreviousMonth={handlePreviousMonth}
              onNextMonth={handleNextMonth}
              formatMonthYear={formatMonthYear}
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
  const showBillingTodoTab = userProfile?.role !== 'admin'
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
  const showProvidersTab = !hideFinanceTabsForTopLevel
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
  ]
  const getNextTab = (current: TabType, skip?: TabType): TabType => {
    if (current === 'patients') return 'patients' // Never switch away from Patients when clicking Switch
    const i = SPLIT_SCREEN_TAB_ORDER.indexOf(current)
    if (i === -1) return current
    let next = SPLIT_SCREEN_TAB_ORDER[(i + 1) % SPLIT_SCREEN_TAB_ORDER.length]
    if (skip && next === skip) next = SPLIT_SCREEN_TAB_ORDER[(i + 2) % SPLIT_SCREEN_TAB_ORDER.length]
    return next
  }
  const getTabLabel = (tab: TabType) =>
    // tab === 'patients'
    //   ? 'Patient Info'
    //   : tab === 'todo'
    tab === 'todo'
        ? 'Billing To-Do'
        : tab === 'providers'
          ? 'Providers'
          : tab === 'provider_pay'
            ? 'Provider Pay'
            : 'Accounts Receivable'

  /** Tabs available in split-screen pane dropdowns (finance tabs always listed in split view). */
  const getSplitScreenSelectableTabs = (): TabType[] => [
    ...(showPatientTab ? (['patients'] as const) : []),
    ...(showBillingTodoTab ? (['todo'] as const) : []),
    ...(!isBillingStaff && !isOfficeStaff
      ? ([
          'providers',
          ...(showAccountsReceivableTab || splitScreen != null ? (['accounts_receivable'] as const) : []),
          ...(showProviderPayTab || splitScreen != null ? (['provider_pay'] as const) : []),
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
          const tabs: TabType[] = ['patients', 'todo', 'providers', 'accounts_receivable', 'provider_pay']
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

  const isProvidersOrPayTab = activeTab === 'providers' || activeTab === 'provider_pay'
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
            style={{ height: 'calc(100vh - 110px)', minHeight: '650px', width: '100%', overflow: 'hidden', position: 'relative' }}
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