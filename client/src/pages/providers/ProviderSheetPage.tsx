import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '@/lib/apiClient'
import { fetchSheetRows, saveSheetRows, isUuid } from '@/lib/providerSheetRows'
import { enrichSheetRowsFromPatients, applyCoPatientSnapshotToSheetRows } from '@/lib/enrichProviderSheetRowsFromPatients'
import { dedupeProvidersByUser, fetchActiveProviderUserEmails } from '@/lib/providerUserFilter'
import { useAuth } from '@/contexts/AuthContext'
import {
  Clinic,
  Provider,
  SheetRow,
  ProviderSheet,
  Patient,
  BillingCode,
  StatusColor,
  IsLockProviders,
} from '@/types'
import ProvidersTab from '@/components/tabs/ProvidersTab'
import AccountsReceivableTab from '@/components/tabs/AccountsReceivableTab'
import ProviderPayTab from '@/components/tabs/ProviderPayTab'

export default function ProviderSheetPage() {
  const { user, userProfile, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { clinicId: urlClinicId } = useParams<{ clinicId: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [providerLevel, setProviderLevel] = useState<1 | 2>(1)
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [providerSheetRows, setProviderSheetRows] = useState<Record<string, SheetRow[]>>({})
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientAssignmentRevision, setPatientAssignmentRevision] = useState(0)
  const [billingCodes, setBillingCodes] = useState<BillingCode[]>([])
  const [statusColors, setStatusColors] = useState<StatusColor[]>([])
  // Persist selectedMonth per (clinic, provider) so navigating between My Sheet / AR / Provider Pay
  // (and back from outside routes) restores the same month instead of resetting to the current month.
  const monthStorageKey = urlClinicId ? `provider-sheet-month-${urlClinicId}` : null
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => {
    if (!monthStorageKey) return new Date()
    try {
      const raw = sessionStorage.getItem(monthStorageKey)
      if (raw) return new Date(raw)
    } catch {
      // ignore
    }
    return new Date()
  })
  useEffect(() => {
    if (!monthStorageKey) return
    try {
      sessionStorage.setItem(monthStorageKey, selectedMonth.toISOString())
    } catch {
      // sessionStorage may be unavailable; picker still works in-memory.
    }
  }, [monthStorageKey, selectedMonth])
  /** For bimonthly clinics (clinic.payroll === 2), each month has two sheets: payroll=1 (first half)
   * and payroll=2 (second half). The previous code hard-coded payroll=2 on the fetch but payroll=1
   * on the selectedMonthKey, so fetch and save targeted different sheets — providers saw an empty
   * sheet (Jenali had entered the data into the first-half sheet) and any save failed with "sheet
   * not found" server-side. Mirror ClinicDetail's pattern: track a selectedPayroll state and use it
   * for BOTH the fetch and the save. Persists alongside selectedMonth so navigation preserves it. */
  const payrollStorageKey = urlClinicId ? `provider-sheet-payroll-${urlClinicId}` : null
  const [selectedPayroll, setSelectedPayroll] = useState<1 | 2>(() => {
    if (!payrollStorageKey) return 1
    try {
      const raw = sessionStorage.getItem(payrollStorageKey)
      if (raw === '2') return 2
    } catch {
      // ignore
    }
    return 1
  })
  useEffect(() => {
    if (!payrollStorageKey) return
    try {
      sessionStorage.setItem(payrollStorageKey, String(selectedPayroll))
    } catch {
      // ignore
    }
  }, [payrollStorageKey, selectedPayroll])
  const providerSheetRowsRef = useRef<Record<string, SheetRow[]>>({})
  const saveProviderSheetInProgressRef = useRef<Set<string>>(new Set())
  /** Pending queued save (see ClinicDetail for full notes). Mirrors that shape so deletes that race
   * against in-flight saves don't lose their knownDeletedIds. */
  type PendingProviderSheetSave = {
    rows: SheetRow[]
    deletedDbIds: string[]
    resolvers: Array<{ resolve: (persisted: boolean) => void; reject: (err: unknown) => void }>
  }
  const pendingProviderSheetSaveRef = useRef<Record<string, PendingProviderSheetSave>>({})
  /** Deferred save when guards fail (currentSheet=null during refetch, or month mismatch). The previous
   * behavior was a silent `return` which dropped any save triggered during the brief refetch window —
   * the provider would type a cell, click away within 400ms, the debounced save would fire while
   * `setCurrentSheet(null)` was still in effect, and the data would never reach the server. We hold
   * the latest request here and let a useEffect retry once `currentSheet` / `provider` are ready. */
  type DeferredProviderSheetSave = {
    providerId: string
    rowsToSave: SheetRow[]
    knownDeletedIds?: string[]
    targetMonth: number
    targetYear: number
  }
  const deferredSaveRef = useRef<DeferredProviderSheetSave | null>(null)
  /** ProvidersTab registers a flush callback here via onRegisterFlushBeforeTabLeave. We call it BEFORE
   * setSelectedMonth / setSelectedPayroll so any pending debounced save fires against the CURRENT
   * (old) month — without this, a save scheduled while the user was on month X but firing after they
   * navigated to month Y would dump month X's data into month Y's sheet. That's exactly the
   * "her June data is in May" symptom Jenali reported. */
  const providersTabFlushRef = useRef<(() => Promise<void>) | null>(null)
  /** Most recent save error surfaced to the user as a top-of-page banner. Silent catches were
   * previously hiding the cause of "data not saving" reports; making the failure visible lets the
   * user (and us) see whether the server is rejecting saves vs. saves never being attempted. */
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null)
  const providerSheetFetchVersionRef = useRef(0)
  const [currentSheet, setCurrentSheet] = useState<ProviderSheet | null>(null)
  /** Bumps whenever providerSheetRows changes via fetch / save / patient enrichment. Passed to
   * ProvidersTab and folded into HandsontableWrapper's `dataVersion` so the grid actually pushes the
   * new data to HOT. Without this bump, navigating between months changed `selectedMonth.getTime()`
   * in dataVersion BEFORE the async fetch finished — HOT got updated with the STALE state under the
   * NEW dataVersion, then the fetch resolved and updated React state but dataVersion didn't move
   * again, so HOT stayed showing the previous month's data. ClinicDetail has the same state for the
   * same reason. */
  const [providerRowsVersion, setProviderRowsVersion] = useState(0)
  const [isLockProviders, setIsLockProviders] = useState<IsLockProviders | null>(null)
  /** When provider level is 2: 'sheet' | 'accounts_receivable' | 'provider_pay' */
  const [providerViewTab, setProviderViewTab] = useState<'sheet' | 'accounts_receivable' | 'provider_pay'>('sheet')

  // Redirect non-providers; redirect to dashboard if no clinic in URL
  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    if (userProfile?.role !== 'provider') {
      navigate('/dashboard', { replace: true })
      return
    }
    if (!urlClinicId) {
      navigate('/providers', { replace: true })
    }
  }, [user, userProfile, authLoading, navigate, urlClinicId])

  // Resolve provider by user email — must pick the EXACT SAME canonical record that ClinicDetail
  // picks via dedupeProvidersByUser, otherwise this view fetches sheets against a different
  // provider_id than the one Jenali sees, and the provider sees an empty sheet (or creates a brand
  // new empty one because the lookup misses, while Jenali's data sits on the canonical record).
  //
  // Strategy: run ClinicDetail's exact query (all active providers in the clinic, ordered by
  // last_name → first_name), call dedupeProvidersByUser with the active provider-user emails set,
  // then find the displayed (canonical) entry whose email matches the logged-in user. That entry's
  // provider_id is what ClinicDetail uses as the FK for sheet rows.
  useEffect(() => {
    if (!user?.email || userProfile?.role !== 'provider') return
    if (!urlClinicId) return

    const resolveProvider = async () => {
      setLoading(true)
      setError(null)
      try {
        // ClinicDetail.fetchProviders shape — same filters, same order.
        const [providersRes, userEmails] = await Promise.all([
          apiClient
            .from('providers')
            .select('*')
            .eq('active', true)
            .contains('clinic_ids', [urlClinicId])
            .order('last_name')
            .order('first_name'),
          fetchActiveProviderUserEmails(),
        ])

        if (providersRes.error) throw providersRes.error

        const { displayedProviders } = dedupeProvidersByUser(
          (providersRes.data || []) as Provider[],
          userEmails,
        )

        const normalizedEmail = user.email!.trim().toLowerCase()
        const data = displayedProviders.find(
          (p) => (p.email ?? '').trim().toLowerCase() === normalizedEmail,
        ) ?? null

        if (!data) {
          setError('Your account is not linked to a provider. Please contact your administrator.')
          setProvider(null)
          setLoading(false)
          return
        }
        setProvider(data)
        setProviderLevel(data.level === 2 ? 2 : 1)
      } catch (e) {
        console.error('Error resolving provider:', e)
        setError('Failed to load your provider profile.')
        setProvider(null)
      } finally {
        setLoading(false)
      }
    }

    resolveProvider()
  }, [user?.email, userProfile?.role, urlClinicId])

  // Use clinic from URL; must be one of the provider's clinics
  const clinicId = urlClinicId && provider?.clinic_ids?.includes(urlClinicId) ? urlClinicId : undefined

  // Redirect if URL clinic is invalid for this provider (after provider has loaded)
  useEffect(() => {
    if (!provider || !urlClinicId) return
    if (!provider.clinic_ids?.includes(urlClinicId)) {
      navigate('/providers', { replace: true })
    }
  }, [provider, urlClinicId, navigate])

  const refetchPatients = useCallback(async (): Promise<Patient[] | undefined> => {
    if (!clinicId) return undefined
    const { data, error: err } = await apiClient
      .from('patients')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('patient_id')
    if (err) return undefined

    const fetchedPatients = data || []
    setPatients(fetchedPatients)
    setPatientAssignmentRevision((r) => r + 1)
    return fetchedPatients
  }, [clinicId])

  // Fetch clinic, patients, billing codes, status colors, and sheet when provider is set
  useEffect(() => {
    if (!provider || !clinicId) return

    const fetchClinic = async () => {
      const { data } = await apiClient.from('clinics').select('*').eq('id', clinicId).maybeSingle()
      setClinic(data || null)
    }

    const fetchBillingCodes = async () => {
      const { data, error: err } = await apiClient.from('billing_codes').select('*').order('code')
      if (!err) setBillingCodes(data || [])
    }

    const fetchStatusColors = async () => {
      const { data } = await apiClient.from('status_colors').select('*')
      if (data?.length) setStatusColors(data)
      else
        setStatusColors([
          { id: '1', status: 'Complete', color: '#5d9f5d', text_color: '#000', type: 'appointment', created_at: '', updated_at: '' },
          { id: '2', status: 'Note Not Complete', color: '#e06666', text_color: '#000', type: 'appointment', created_at: '', updated_at: '' },
        ])
    }

    fetchClinic()
    void refetchPatients()
    fetchBillingCodes()
    fetchStatusColors()
  }, [provider, clinicId, refetchPatients])

  // Fetch provider sheet for selected month
  const fetchProviderSheetData = useCallback(async () => {
    if (!provider || !clinic || !clinicId) return

    const providerId = provider.id
    const month = selectedMonth.getMonth() + 1
    const year = selectedMonth.getFullYear()
    // Bimonthly clinics have two sheets per month (payroll=1 first half, payroll=2 second half);
    // use the user-selected half. Monthly clinics only ever have payroll=1 — clamp.
    const payroll: 1 | 2 = clinic?.payroll === 2 ? selectedPayroll : 1
    const fetchVersion = ++providerSheetFetchVersionRef.current

    // Always show rows for the currently selected month from DB, not stale rows from prior month.
    setCurrentSheet(null)
    setProviderSheetRows(prev => ({ ...prev, [providerId]: [] }))
    setLoading(true)
    try {
      let { data: sheetList, error: sheetsError } = await apiClient
        .from('provider_sheets')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('provider_id', providerId)
        .eq('month', month)
        .eq('year', year)
        .eq('payroll', payroll)
        .order('created_at', { ascending: true })
        .limit(1)

      if (sheetsError) throw sheetsError

      let sheet = sheetList?.[0] ?? null

      if (!sheet) {
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
            const { data: refetchList, error: refetchErr } = await apiClient
              .from('provider_sheets')
              .select('*')
              .eq('clinic_id', clinicId)
              .eq('provider_id', providerId)
              .eq('month', month)
              .eq('year', year)
              .eq('payroll', payroll)
              .order('created_at', { ascending: true })
              .limit(1)
            if (!refetchErr && refetchList?.[0]) sheet = refetchList[0]
          }
          if (!sheet) throw createError
        } else if (newSheet) {
          sheet = newSheet
        }
        if (!sheet) return
      }

      if (providerSheetFetchVersionRef.current !== fetchVersion) return
      setCurrentSheet(sheet)

      let sheetRows = await fetchSheetRows(apiClient, sheet.id)
      const { data: clinicPatientsForRows } = await apiClient.from('patients').select('*').eq('clinic_id', clinicId)
      sheetRows = enrichSheetRowsFromPatients(sheetRows, (clinicPatientsForRows || []) as Patient[])
      const createEmptyRow = (index: number): SheetRow => ({
        id: `empty-${providerId}-${index}`,
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
      const emptyCount = Math.max(0, 200 - sheetRows.length)
      const emptyRows = Array.from({ length: emptyCount }, (_, i) => createEmptyRow(i))
      const allRows = [...sheetRows, ...emptyRows]

      if (providerSheetFetchVersionRef.current !== fetchVersion) return
      setProviderSheetRows(prev => ({ ...prev, [providerId]: allRows }))
      // Bump so HandsontableWrapper's dataVersion advances and HOT picks up the newly fetched rows.
      // Without this, the grid stays showing whatever was in state when the user clicked the new
      // month (the previous month's data).
      setProviderRowsVersion((v) => v + 1)
    } catch (e) {
      if (providerSheetFetchVersionRef.current === fetchVersion) {
        console.error('Error fetching provider sheet:', e)
      }
    } finally {
      if (providerSheetFetchVersionRef.current === fetchVersion) {
        setLoading(false)
      }
    }
  }, [provider, clinic, clinicId, selectedMonth, selectedPayroll])

  useEffect(() => {
    providerSheetRowsRef.current = providerSheetRows
  }, [providerSheetRows])

  // Matches the key format ProvidersTab/ClinicDetail use for the localStorage pending-rows backup so
  // restore-on-mount and the pagehide keepalive POST line up with what the unmount cleanup writes.
  // Uses selectedPayroll so the server's parseMonthKey resolves to the SAME sheet that fetch loaded —
  // previously selectedMonthKey hard-coded `-1` while fetch used clinic.payroll (=2 for bimonthly),
  // so saves targeted a different sheet than the one being displayed and failed.
  const selectedMonthKey = useMemo(() => {
    if (!clinic) return null
    const y = selectedMonth.getFullYear()
    const m = selectedMonth.getMonth() + 1
    const payroll = clinic.payroll === 2 ? selectedPayroll : 1
    return `${y}-${m}-${payroll}`
  }, [clinic, selectedMonth, selectedPayroll])

  useEffect(() => {
    if (!clinicId || !provider || !selectedMonthKey) {
      setIsLockProviders(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const { data, error } = await apiClient
        .from('is_lock_providers')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('month_key', selectedMonthKey)
        .eq('provider_id', provider.id)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        setIsLockProviders(null)
        return
      }
      setIsLockProviders((data as IsLockProviders) ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [clinicId, provider?.id, selectedMonthKey])

  useEffect(() => {
    if (provider && clinic) fetchProviderSheetData()
  }, [provider, clinic, selectedMonth, fetchProviderSheetData])

  const handleUpdateProviderSheetRow = useCallback(
    (providerId: string, rowId: string, field: string, value: any) => {
      setProviderSheetRows(prev => {
        const rows = prev[providerId] || []
        const updatedRows = rows.map(row => {
          if (row.id !== rowId) return row
          if (row.id.startsWith('empty-')) {
            const newId = `new-${Date.now()}-${Math.random()}`
            const updated: SheetRow = {
              ...row,
              id: newId,
              [field]: value,
              updated_at: new Date().toISOString(),
            } as SheetRow
            if (field === 'cpt_code' && value) {
              const code = billingCodes.find(c => c.code === value)
              ;(updated as any).cpt_code_color = code?.color ?? null
            } else if (field === 'appointment_status' && value) {
              const status = statusColors.find(s => s.status === value && s.type === 'appointment')
              ;(updated as any).appointment_status_color = status?.color ?? null
            }
            return updated
          }
          const updated = {
            ...row,
            [field]: value,
            updated_at: new Date().toISOString(),
          } as SheetRow
          if (field === 'cpt_code' && value) {
            const code = billingCodes.find(c => c.code === value)
            ;(updated as any).cpt_code_color = code?.color ?? null
          } else if (field === 'appointment_status' && value) {
            const status = statusColors.find(s => s.status === value && s.type === 'appointment')
            ;(updated as any).appointment_status_color = status?.color ?? null
          }
          return updated
        })
        return { ...prev, [providerId]: updatedRows }
      })
    },
    [billingCodes, statusColors]
  )

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
    if (updated.cpt_code) {
      const code = billingCodes.find(c => c.code === updated.cpt_code)
      updated.cpt_code_color = code?.color ?? null
    } else {
      updated.cpt_code_color = null
    }
    if (updated.appointment_status) {
      const status = statusColors.find(s => s.status === updated.appointment_status && s.type === 'appointment')
      updated.appointment_status_color = status?.color ?? null
    } else {
      updated.appointment_status_color = null
    }
    return updated
  }, [billingCodes, statusColors])

  const handleReplaceProviderSheetRows = useCallback((providerId: string, rows: SheetRow[]) => {
    setProviderSheetRows(prev => {
      const normalized = rows.map((row) => {
        const rowId = row.id.startsWith('empty-') && (
          row.patient_id || row.patient_first_name || row.last_initial || row.patient_insurance ||
          row.patient_copay != null || row.patient_coinsurance != null || row.appointment_date ||
          row.cpt_code || row.appointment_status || row.claim_status || row.submit_date ||
          row.insurance_payment || row.payment_date || row.insurance_adjustment ||
          row.collected_from_patient || row.patient_pay_status || row.ar_date ||
          row.total !== null || row.notes
        ) ? `new-${Date.now()}-${Math.random()}` : row.id
        return applyProviderRowDerivedFields({
          ...row,
          id: rowId,
          updated_at: new Date().toISOString(),
        })
      })
      return { ...prev, [providerId]: normalized }
    })
  }, [applyProviderRowDerivedFields])

  const saveProviderSheetRows = useCallback(
    async (providerId: string, rowsToSave: SheetRow[], knownDeletedIds?: string[]): Promise<boolean> => {
      const targetMonth = selectedMonth.getMonth() + 1
      const targetYear = selectedMonth.getFullYear()
      // Guard checks (analogous to ClinicDetail's `if (!sheet) return` + hydration guard) — but instead
      // of silently dropping, we defer so a save fired during the brief setCurrentSheet(null)→fetch
      // window after a month change isn't permanently lost. The drain-effect below replays it.
      // Returns `false` from any guard so the localStorage restore path can tell the difference between
      // a real save and a deferred/skipped one and keep its backup until persistence is confirmed.
      if (!provider || provider.id !== providerId || !clinicId) {
        if (clinicId && providerId) {
          deferredSaveRef.current = { providerId, rowsToSave, knownDeletedIds, targetMonth, targetYear }
        }
        console.warn('[ProviderSheetPage.saveProviderSheetRows] deferred — provider mismatch or missing clinicId', { providerId, currentProviderId: provider?.id, hasClinicId: !!clinicId })
        return false
      }
      if (!currentSheet || currentSheet.month !== targetMonth || currentSheet.year !== targetYear) {
        deferredSaveRef.current = { providerId, rowsToSave, knownDeletedIds, targetMonth, targetYear }
        console.warn('[ProviderSheetPage.saveProviderSheetRows] deferred — currentSheet missing or month mismatch', { providerId, targetMonth, targetYear, sheetMonth: currentSheet?.month, sheetYear: currentSheet?.year })
        return false
      }

      // Step 1 — Filter empty-* placeholder rows with no data (mirrors ClinicDetail line 2462).
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

      // Step 2 — Serialize: only one save per provider at a time. If busy, queue and return a promise
      // that resolves when the eventual save completes. Mirrors ClinicDetail line 2478.
      if (saveProviderSheetInProgressRef.current.has(providerId)) {
        const incomingDeletes = (knownDeletedIds ?? []).filter((id) => isUuid(id))
        return new Promise<boolean>((resolve, reject) => {
          const existing = pendingProviderSheetSaveRef.current[providerId]
          if (existing) {
            existing.rows = rowsToSave
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
              rows: rowsToSave,
              deletedDbIds: incomingDeletes,
              resolvers: [{ resolve, reject }],
            }
          }
        })
      }
      saveProviderSheetInProgressRef.current.add(providerId)

      // Built synchronously from savedRows right after saveSheetRows returns — no React batching delay.
      // Maps every temp id (new-*, empty-* with data) that was sent as an INSERT to the real UUID
      // the DB assigned. Used in finally to reconcile any queued pending before replay so we UPDATE
      // instead of INSERT again (creating duplicate provider_sheet_rows).
      let savedTempIdToUuidMap: Map<string, string> | null = null

      // Step 3 — Optimistic state update so the row appears immediately (mirrors ClinicDetail line 2512).
      setProviderSheetRows(prev => ({ ...prev, [providerId]: rowsToSave }))

      // Tracks whether saveSheetRows actually persisted to the DB. Returned to the caller so the
      // localStorage restore effect can tell the difference between a real save and a swallowed error.
      let didPersist = false
      try {
        // Step 4 — API save call.
        const savedRows = await saveSheetRows(apiClient, currentSheet.id, rowsToProcess, knownDeletedIds, {
          clinicId,
          providerId,
          selectedMonthKey: selectedMonthKey ?? `${targetYear}-${targetMonth}`,
        })
        didPersist = true

        // Step 5 — Fetch fresh patients BEFORE the state merge (mirrors ClinicDetail line 2523).
        const freshPatients = (await refetchPatients()) ?? []

        // Step 6 — Clean up localStorage pending key.
        try {
          const pendingKey = `provider_sheet_pending_${clinicId}_${providerId}_${selectedMonthKey}`
          localStorage.removeItem(pendingKey)
        } catch (_) {}

        // Step 7 — Build savedRowsByOldId AND savedRowsByAnyId so the merge survives the case where
        // a row's id was already promoted to its UUID in state by a concurrent code path (mirrors
        // ClinicDetail line 2532). Also populate savedTempIdToUuidMap for queue replay.
        savedTempIdToUuidMap = new Map<string, string>()
        const savedRowsByOldId = new Map<string, SheetRow>()
        const savedRowsByAnyId = new Map<string, SheetRow>()
        rowsToProcess.forEach((row, i) => {
          const saved = savedRows[i]
          if (!saved) return
          savedRowsByOldId.set(row.id, saved)
          savedRowsByAnyId.set(row.id, saved)
          savedRowsByAnyId.set(saved.id, saved)
          if (!isUuid(row.id) && isUuid(saved.id)) {
            savedTempIdToUuidMap!.set(row.id, saved.id)
          }
        })

        // Step 8 — Single state update that combines: id promotion + padding-back-to-base + co-patient
        // snapshot. Done atomically (in one setState callback) so React only re-renders once, mirroring
        // ClinicDetail line 2548. The previous implementation split this into 3 separate setState calls
        // which caused intermediate states the grid could render in between.
        setProviderSheetRows((prev) => {
          const currentRows = prev[providerId] || []
          // 8a — Promote temp ids to UUIDs, preserve user's latest editable values
          // (savedRowsByAnyId fallback handles concurrent id promotions).
          let updatedRows = currentRows.map((row) => {
            const savedRow = savedRowsByOldId.get(row.id) ?? savedRowsByAnyId.get(row.id)
            if (savedRow) {
              return {
                ...row,
                id: savedRow.id,
                created_at: savedRow.created_at,
                updated_at: savedRow.updated_at,
              }
            }
            return row
          })

          // 8b — Pad back to base row count if a row was deleted (mirrors ClinicDetail line 2566).
          // Without this, post-delete state could fall below the display minimum.
          const baseRows = 200
          const nonEmptyRows = updatedRows.filter((r) => !r.id.startsWith('empty-'))
          const emptyRowsNeeded = Math.max(0, baseRows - nonEmptyRows.length)
          const existingEmptyCount = updatedRows.filter((r) => r.id.startsWith('empty-')).length
          if (emptyRowsNeeded > existingEmptyCount) {
            const iso = new Date().toISOString()
            const extras: SheetRow[] = Array.from({ length: emptyRowsNeeded - existingEmptyCount }, (_, i) => ({
              id: `empty-${providerId}-${existingEmptyCount + i}`,
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
            updatedRows = [...updatedRows, ...extras]
          }

          // 8c — Apply co-patient demographics from the fresh patient list (mirrors ClinicDetail
          // line 2621 — they apply to all providers in the month; we only have one).
          const finalRows = freshPatients.length > 0
            ? applyCoPatientSnapshotToSheetRows(updatedRows, freshPatients)
            : updatedRows

          return { ...prev, [providerId]: finalRows }
        })
        // Bump so HOT updateSettings runs with the merged row IDs + co-patient snapshot rather than
        // stale data from the moment dataVersion last changed (e.g. a month-click).
        setProviderRowsVersion((v) => v + 1)

        // Step 9 — Successful save: clear error banner.
        setSaveErrorMessage(null)
      } catch (e) {
        // Step 10 — Surface the error so the user knows what went wrong (silent catches hide bugs).
        console.error('[ProviderSheetPage] saveProviderSheetRows failed:', e)
        const detail = e instanceof Error ? e.message : 'Unknown error'
        setSaveErrorMessage(`Save failed: ${detail}. Your changes are backed up locally; refresh after the issue is fixed to retry.`)
      } finally {
        saveProviderSheetInProgressRef.current.delete(providerId)
        const pending = pendingProviderSheetSaveRef.current[providerId]
        if (pending) {
          delete pendingProviderSheetSaveRef.current[providerId]
          const idMap = savedTempIdToUuidMap
          let toSave = pending.rows
          if (idMap && idMap.size > 0) {
            toSave = pending.rows.map((row) => {
              if (!isUuid(row.id)) {
                const newId = idMap.get(row.id)
                if (newId) {
                  return { ...row, id: newId, updated_at: new Date().toISOString() }
                }
              }
              return row
            })
          }
          const pendingDeletes = pending.deletedDbIds.length > 0 ? pending.deletedDbIds : undefined
          // Forward queued knownDeletedIds + settle the promises that every queued caller awaits.
          // Propagate the eventual `persisted` boolean so the localStorage restore path can tell
          // whether its replay actually reached the DB (silent guard hits would otherwise look like success).
          saveProviderSheetRows(providerId, toSave, pendingDeletes)
            .then((persisted) => pending.resolvers.forEach((r) => r.resolve(persisted)))
            .catch((err) => pending.resolvers.forEach((r) => r.reject(err)))
        }
      }
      return didPersist
    },
    [currentSheet, provider, selectedMonth, clinicId, selectedMonthKey, refetchPatients]
  )

  const saveProviderSheetRowsDirect = useCallback(
    async (providerId: string, rows: SheetRow[]) => {
      await saveProviderSheetRows(providerId, rows)
    },
    [saveProviderSheetRows]
  )

  // Drain a deferred save once the guards line up. Without this, a save scheduled during the brief
  // setCurrentSheet(null)→fetch window (e.g. when the user types and clicks away around the same time
  // a month-fetch is running) would have been silently dropped — exactly the "still missing most current
  // data" report from the provider users. By the time this effect runs, the in-flight fetch has set
  // currentSheet and selectedMonth, so the deferred save can replay against the right sheet.
  useEffect(() => {
    const deferred = deferredSaveRef.current
    if (!deferred) return
    if (!provider || !clinicId || !currentSheet) return
    if (provider.id !== deferred.providerId) return
    if (currentSheet.month !== deferred.targetMonth || currentSheet.year !== deferred.targetYear) return
    deferredSaveRef.current = null
    console.log('[ProviderSheetPage] draining deferred save', {
      providerId: deferred.providerId,
      rows: deferred.rowsToSave.length,
    })
    // Intentionally NOT restoring deferredSaveRef on error — a persistent error would otherwise loop.
    saveProviderSheetRows(deferred.providerId, deferred.rowsToSave, deferred.knownDeletedIds).catch((err) => {
      console.error('[ProviderSheetPage] deferred save failed:', err)
    })
  }, [currentSheet, provider, clinicId, saveProviderSheetRows])

  // Restore provider sheet rows from localStorage after refresh: ProvidersTab writes a per-edit backup
  // and the unmount cleanup also writes one if a save was in flight. We replay them so a hard close
  // mid-typing isn't a data loss. Two staleness guards prevent this from CLOBBERING valid DB data:
  //   1. Age guard: skip entries older than 10 min (a previous session's leftovers).
  //   2. DB-vs-localStorage freshness guard: skip if any fetched DB row has updated_at newer than
  //      localStorage.savedAt — that means the user already saved successfully and localStorage is
  //      just stale. Replaying it would overwrite the fresh DB data with the older typing (which is
  //      the bug the user is seeing: API returns 5 rows, restore replays 18 stale rows, screen now
  //      shows 18 rows that DON'T match the DB).
  const PENDING_ROWS_KEY_PREFIX = 'provider_sheet_pending_'
  const PENDING_ROWS_MAX_AGE_MS = 10 * 60 * 1000
  const restoredPendingKeysRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!clinicId || !provider || !currentSheet || !selectedMonthKey) return
    const key = `${PENDING_ROWS_KEY_PREFIX}${clinicId}_${provider.id}_${selectedMonthKey}`
    if (restoredPendingKeysRef.current.has(key)) return
    const now = Date.now()
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return
      const data = JSON.parse(raw) as { rows: SheetRow[]; savedAt: number }
      if (!data.rows?.length || !data.savedAt) return
      if (now - data.savedAt > PENDING_ROWS_MAX_AGE_MS) {
        localStorage.removeItem(key)
        return
      }
      // DB-vs-localStorage freshness: compare the localStorage savedAt against the freshest
      // updated_at among rows currently in React state for this provider. providerSheetRowsRef tracks
      // the state set by the most recent fetch / save. If the DB has rows that are newer than the
      // localStorage backup, the user already saved successfully — don't clobber the DB data.
      // Only consider rows with UUID ids (real DB rows). `empty-*` placeholders are minted on every
      // fetch with `updated_at: new Date().toISOString()`, so including them made mostRecentDbUpdate
      // ≈ "now" and falsely deleted every legitimate localStorage backup without saving it.
      const currentRows = providerSheetRowsRef.current[provider.id] ?? []
      let mostRecentDbUpdate = 0
      for (const row of currentRows) {
        if (!isUuid(row.id)) continue
        if (row.updated_at && typeof row.updated_at === 'string') {
          const t = new Date(row.updated_at).getTime()
          if (Number.isFinite(t) && t > mostRecentDbUpdate) mostRecentDbUpdate = t
        }
      }
      if (mostRecentDbUpdate > data.savedAt) {
        // DB is newer than the localStorage backup — the user already saved this work. Drop the
        // stale entry so the next mount doesn't loop on it.
        localStorage.removeItem(key)
        return
      }
      restoredPendingKeysRef.current.add(key)
      // Only delete the localStorage backup if saveProviderSheetRows actually persisted to DB.
      // A deferred or guard-dropped save resolves to `false`; keeping the key gives the deferred-save
      // drain effect (or the next mount / pagehide keepalive) another chance to land the data.
      saveProviderSheetRows(provider.id, data.rows)
        .then((persisted) => {
          if (persisted) {
            try { localStorage.removeItem(key) } catch (_) {}
          } else {
            console.warn('[ProviderSheetPage] restore pending save not persisted; keeping localStorage backup', { key, providerId: provider.id, monthKey: selectedMonthKey })
            restoredPendingKeysRef.current.delete(key)
          }
        })
        .catch(err => {
          console.error('[ProviderSheetPage] restore pending save failed:', err)
          restoredPendingKeysRef.current.delete(key)
        })
    } catch (_) {
      try { localStorage.removeItem(key) } catch (__) {}
    }
  }, [clinicId, provider, currentSheet, selectedMonthKey, saveProviderSheetRows])

  // On page unload (refresh/close), send any pending provider sheet rows via keepalive fetch so the save
  // can complete after the page is gone. Mirrors the handler on ClinicDetail for the super admin path.
  // Only replays entries that match the currently open clinic+provider, are <10 min old, and contain at
  // least one meaningful row — without these guards a stale localStorage backup from a prior session
  // could POST partial rows against the wrong sheet context.
  useEffect(() => {
    const PREFIX = 'provider_sheet_pending_'
    const PAGEHIDE_MAX_AGE_MS = 10 * 60 * 1000
    const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
    const savePendingUrl = apiBase ? `${apiBase}/api/save-provider-sheet-rows` : '/api/save-provider-sheet-rows'
    const currentClinicId = clinicId
    const currentProviderId = provider?.id

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
      if (!currentClinicId || !currentProviderId) return

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
          const cid = data.clinicId
          const pid = data.providerId
          const mk = data.selectedMonthKey
          const rows = data.rows
          if (!cid || !pid || !mk || !Array.isArray(rows) || rows.length === 0) return
          // Only replay for the clinic+provider currently open in this tab.
          if (cid !== currentClinicId || pid !== currentProviderId) return
          if (!data.savedAt || now - data.savedAt > PAGEHIDE_MAX_AGE_MS) return
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

          const body = JSON.stringify({ clinicId: cid, providerId: pid, selectedMonthKey: mk, rows })
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

    // visibilitychange catches tab-switch / window-minimize where pagehide doesn't fire — flushes the
    // per-edit localStorage backup to the server so the data is durable before any potential close.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') onPageHide()
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [clinicId, provider?.id])

  const handleDeleteProviderSheetRows = useCallback(
    async (providerId: string, rowIds: string[]) => {
      if (rowIds.length === 0) return
      const idSet = new Set(rowIds)
      let rowsAfterDelete: SheetRow[] = []
      setProviderSheetRows(prev => {
        const rows = prev[providerId] || []
        rowsAfterDelete = rows.filter(r => !idSet.has(r.id))
        return { ...prev, [providerId]: rowsAfterDelete }
      })
      // All deleted UUIDs in one batch — orphan sweep is gone, so omitting these would leave the rows
      // in the DB and they would resurrect on next load.
      const deletedDbIds = rowIds.filter((id) => isUuid(id))
      await saveProviderSheetRows(providerId, rowsAfterDelete, deletedDbIds)
    },
    [saveProviderSheetRows]
  )

  const handleAddProviderRowAbove = useCallback(
    (providerId: string, beforeRowId: string) => {
      const rows = providerSheetRows[providerId] || []
      const idx = rows.findIndex(r => r.id === beforeRowId)
      if (idx < 0) return
      const createEmptyRow = (): SheetRow => ({
        id: `empty-${providerId}-${Date.now()}`,
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
      const newRow = createEmptyRow()
      const newRows = [...rows.slice(0, idx), newRow, ...rows.slice(idx)]
      setProviderSheetRows(prev => ({ ...prev, [providerId]: newRows }))
      saveProviderSheetRows(providerId, newRows).catch(err =>
        console.error('Failed to save after add row', err)
      )
    },
    [providerSheetRows, saveProviderSheetRows]
  )

  const handleAddProviderRowBelow = useCallback(
    (providerId: string, afterRowId: string) => {
      const rows = providerSheetRows[providerId] || []
      const idx = rows.findIndex(r => r.id === afterRowId)
      if (idx < 0) return
      const createEmptyRow = (): SheetRow => ({
        id: `empty-${providerId}-${Date.now()}`,
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
      const newRow = createEmptyRow()
      const newRows = [...rows.slice(0, idx + 1), newRow, ...rows.slice(idx + 1)]
      setProviderSheetRows(prev => ({ ...prev, [providerId]: newRows }))
      saveProviderSheetRows(providerId, newRows).catch(err =>
        console.error('Failed to save after add row', err)
      )
    },
    [providerSheetRows, saveProviderSheetRows]
  )

  const filterRowsByMonth = (rows: SheetRow[]) => rows
  // MonthYearTabs.onChange delivers (date, payroll). The payroll comes from the user clicking the
  // 1st/2nd Half pill when clinic.payroll === 2; for monthly clinics it is always 1.
  // Flushes any pending debounced save BEFORE the month changes so the save uses the OLD selectedMonth
  // (otherwise the closure inside saveProviderSheetRows would capture the new month and dump the old
  // month's typed data into the new month's sheet — the "her June data is in May" bug).
  const handleSelectMonth = async (date: Date, payroll: 1 | 2 = 1) => {
    if (providersTabFlushRef.current) {
      try {
        await providersTabFlushRef.current()
      } catch (e) {
        console.error('[ProviderSheetPage] flush before month change failed:', e)
      }
    }
    setSelectedMonth(new Date(date.getFullYear(), date.getMonth(), 1))
    if (clinic?.payroll === 2) setSelectedPayroll(payroll)
  }
  if (authLoading || (userProfile?.role === 'provider' && loading && !provider)) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400" />
      </div>
    )
  }

  if (userProfile?.role !== 'provider') return null

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-amber-900/30 border border-amber-600/50 text-amber-200 p-4">
          {error}
        </div>
      </div>
    )
  }

  if (!provider || !clinicId) return null

  const showARTab = providerLevel === 2
  const showProviderPayTab = providerLevel === 2

  return (
    <div>
      {/* Top-of-viewport toast that fires when the user switches months. The full-page spinner only
        shows during the initial auth+provider resolve; subsequent fetches (month change) need their
        own indicator so the user understands the grid is reloading rather than just stuck. Portaled
        to body so it escapes the table's stacking context (same approach as the delete toast). */}
      {loading && provider && createPortal(
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
              animation: 'provider-sheet-page-spin 0.7s linear infinite',
              display: 'inline-block',
            }}
          />
          Loading sheet…
          <style>{`@keyframes provider-sheet-page-spin { to { transform: rotate(360deg); } }`}</style>
        </div>,
        document.body,
      )}
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
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">
          {showARTab || showProviderPayTab ? (providerViewTab === 'sheet' ? 'My Sheet' : providerViewTab === 'accounts_receivable' ? 'Accounts Receivable' : 'Provider Pay') : 'My Sheet'}
        </h1>
        {clinic && <p className="text-white/70">{clinic.name}</p>}
      </div>

      {(showARTab || showProviderPayTab) && (
        <div className="flex gap-1 mb-4 border-b border-white/20 pb-2">
          <button
            type="button"
            onClick={() => setProviderViewTab('sheet')}
            className={`px-4 py-2 rounded-t font-medium transition-colors ${
              providerViewTab === 'sheet' ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
          >
            My Sheet
          </button>
          <button
            type="button"
            onClick={() => setProviderViewTab('accounts_receivable')}
            className={`px-4 py-2 rounded-t font-medium transition-colors ${
              providerViewTab === 'accounts_receivable' ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
          >
            Accounts Receivable
          </button>
          <button
            type="button"
            onClick={() => setProviderViewTab('provider_pay')}
            className={`px-4 py-2 rounded-t font-medium transition-colors ${
              providerViewTab === 'provider_pay' ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
          >
            Provider Pay
          </button>
        </div>
      )}

      {providerViewTab === 'sheet' && (
        <ProvidersTab
          clinicId={clinicId}
          clinicPayroll={clinic?.payroll ?? 1}
          userHighlightColor={userProfile?.highlight_color ?? '#eab308'}
          providers={[provider]}
          canEditComment={false}
          providerSheetRows={providerSheetRows}
          billingCodes={billingCodes}
          statusColors={statusColors}
          patients={patients}
          selectedMonth={selectedMonth}
          selectedMonthKey={selectedMonthKey ?? undefined}
          providerId={provider.id}
          currentProvider={provider}
          canEdit={true}
          isInSplitScreen={false}
          isProviderView={true}
          providerLevel={providerLevel}
          showVisitTypeColumn={provider?.show_visit_type_column ?? false}
          showCopayCoinsuranceColumns={clinic?.show_copay_coinsurance_columns ?? true}
          patientAssignmentRevision={patientAssignmentRevision}
          onUpdateProviderSheetRow={handleUpdateProviderSheetRow}
          onReplaceProviderSheetRows={handleReplaceProviderSheetRows}
          onSaveProviderSheetRowsDirect={saveProviderSheetRowsDirect}
          onDeleteRows={handleDeleteProviderSheetRows}
          onAddRowBelow={handleAddProviderRowBelow}
          onAddRowAbove={handleAddProviderRowAbove}
          onSelectMonth={handleSelectMonth}
          selectedPayroll={clinic?.payroll === 2 ? selectedPayroll : undefined}
          filterRowsByMonth={filterRowsByMonth}
          isLockProviders={isLockProviders}
          providerRowsVersion={providerRowsVersion}
          onRegisterFlushBeforeTabLeave={(flush) => { providersTabFlushRef.current = flush }}
        />
      )}

      {providerViewTab === 'accounts_receivable' && showARTab && clinicId && (
        <AccountsReceivableTab
          clinicId={clinicId}
          clinicPayroll={clinic?.payroll ?? 1}
          // Scope the provider's own A-R view to their own provider record so they only see their
          // rows (plus legacy NULL-provider rows for backward compatibility).
          providerId={provider?.id ?? null}
          patients={patients}
          canEdit={false}
          isInSplitScreen={false}
        />
      )}

      {providerViewTab === 'provider_pay' && showProviderPayTab && clinicId && provider && (
        <ProviderPayTab
          clinicId={clinicId}
          clinicPayroll={clinic?.payroll ?? 1}
          providerId={provider.id}
          providers={[provider]}
          canEdit={false}
          isInSplitScreen={false}
          selectedMonth={selectedMonth}
          selectedPayroll={clinic?.payroll === 2 ? selectedPayroll : undefined}
          onSelectMonth={handleSelectMonth}
          statusColors={statusColors}
        />
      )}
    </div>
  )
}
