import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '@/lib/apiClient'
import { fetchSheetRows, saveSheetRows, isUuid } from '@/lib/providerSheetRows'
import { enrichSheetRowsFromPatients, applyCoPatientSnapshotToSheetRows } from '@/lib/enrichProviderSheetRowsFromPatients'
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
  const providerSheetRowsRef = useRef<Record<string, SheetRow[]>>({})
  const saveProviderSheetInProgressRef = useRef<Set<string>>(new Set())
  /** Pending queued save (see ClinicDetail for full notes). Mirrors that shape so deletes that race
   * against in-flight saves don't lose their knownDeletedIds. */
  type PendingProviderSheetSave = {
    rows: SheetRow[]
    deletedDbIds: string[]
    resolvers: Array<{ resolve: () => void; reject: (err: unknown) => void }>
  }
  const pendingProviderSheetSaveRef = useRef<Record<string, PendingProviderSheetSave>>({})
  const providerSheetFetchVersionRef = useRef(0)
  const [currentSheet, setCurrentSheet] = useState<ProviderSheet | null>(null)
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

  // Resolve provider by user email (and optional clinic_ids)
  useEffect(() => {
    if (!user?.email || userProfile?.role !== 'provider') return

    const resolveProvider = async () => {
      setLoading(true)
      setError(null)
      try {
        let query = apiClient
          .from('providers')
          .select('*')
          .eq('email', user.email!)

        if (userProfile?.clinic_ids?.length) {
          query = query.overlaps('clinic_ids', userProfile.clinic_ids)
        }
        query = query.limit(1)

        const { data, error: err } = await query.maybeSingle()

        if (err) throw err
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
  }, [user?.email, userProfile?.role, userProfile?.clinic_ids])

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
    const payroll = (clinic?.payroll ?? 1) as 1 | 2
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
    } catch (e) {
      if (providerSheetFetchVersionRef.current === fetchVersion) {
        console.error('Error fetching provider sheet:', e)
      }
    } finally {
      if (providerSheetFetchVersionRef.current === fetchVersion) {
        setLoading(false)
      }
    }
  }, [provider, clinic, clinicId, selectedMonth])

  useEffect(() => {
    providerSheetRowsRef.current = providerSheetRows
  }, [providerSheetRows])

  // Matches the key format ProvidersTab/ClinicDetail use for the localStorage pending-rows backup so
  // restore-on-mount and the pagehide keepalive POST line up with what the unmount cleanup writes.
  const selectedMonthKey = useMemo(() => {
    if (!clinic) return null
    const y = selectedMonth.getFullYear()
    const m = selectedMonth.getMonth() + 1
    return (clinic.payroll ?? 1) === 2 ? `${y}-${m}-1` : `${y}-${m}`
  }, [clinic, selectedMonth])

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
    async (providerId: string, rowsToSave: SheetRow[], knownDeletedIds?: string[]) => {
      if (!currentSheet || !provider || provider.id !== providerId || !clinicId) return
      const month = selectedMonth.getMonth() + 1
      const year = selectedMonth.getFullYear()
      if (currentSheet.month !== month || currentSheet.year !== year) return
      if (saveProviderSheetInProgressRef.current.has(providerId)) {
        const incomingDeletes = (knownDeletedIds ?? []).filter((id) => isUuid(id))
        console.log('[ProviderSheetPage:ProvidersSave] queued while in-progress', {
          providerId,
          rows: rowsToSave.length,
          deletes: incomingDeletes.length,
        })
        return new Promise<void>((resolve, reject) => {
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

      const rowsToProcess = rowsToSave.filter(r => {
        if (r.id.startsWith('empty-')) {
          const hasData =
            r.patient_id ||
            r.patient_first_name ||
            r.last_initial ||
            r.patient_insurance ||
            r.patient_copay != null ||
            r.patient_coinsurance != null ||
            r.appointment_date ||
            r.cpt_code ||
            r.appointment_status ||
            r.claim_status ||
            r.submit_date ||
            r.insurance_payment ||
            r.payment_date ||
            r.insurance_adjustment ||
            r.collected_from_patient ||
            r.patient_pay_status ||
            r.ar_date ||
            r.total !== null ||
            r.notes
          return hasData
        }
        return true
      })

      // Built synchronously after saveSheetRows returns so pending-save replay can rewrite stale temp ids
      // to the real UUIDs before re-sending — otherwise the replay re-INSERTS the same row and the orphan
      // sweep deletes the previous version.
      let savedTempIdToUuidMap: Map<string, string> | null = null

      try {
        console.log('[ProviderSheetPage:ProvidersSave] start', {
          providerId,
          rows: rowsToSave.length,
          processRows: rowsToProcess.length,
        })
        const savedRows = await saveSheetRows(apiClient, currentSheet.id, rowsToProcess, knownDeletedIds, clinicId && selectedMonthKey ? { clinicId, providerId, selectedMonthKey } : undefined)
        console.log('[ProviderSheetPage:ProvidersSave] db save done', {
          providerId,
          processRows: rowsToProcess.length,
        })
        try {
          const pendingKey = `provider_sheet_pending_${clinicId}_${providerId}_${selectedMonthKey}`
          localStorage.removeItem(pendingKey)
        } catch (_) {}

        savedTempIdToUuidMap = new Map<string, string>()
        const savedRowsByOldId = new Map<string, SheetRow>()
        rowsToProcess.forEach((row, i) => {
          const saved = savedRows[i]
          if (!saved) return
          savedRowsByOldId.set(row.id, saved)
          if (!isUuid(row.id) && isUuid(saved.id)) {
            savedTempIdToUuidMap!.set(row.id, saved.id)
          }
        })

        // Promote temp ids (new-*/empty-*) to real UUIDs in state so subsequent edits hit UPDATE not INSERT.
        setProviderSheetRows((prev) => {
          const currentRows = prev[providerId] || []
          const updatedRows = currentRows.map((row) => {
            const savedRow = savedRowsByOldId.get(row.id)
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
          return { ...prev, [providerId]: updatedRows }
        })

        const fresh = await refetchPatients()
        if (fresh && provider) {
          setProviderSheetRows((prev) => ({
            ...prev,
            [provider.id]: applyCoPatientSnapshotToSheetRows(prev[provider.id] || [], fresh),
          }))
        }
      } catch (e) {
        console.error('Error saving provider sheet:', e)
      } finally {
        saveProviderSheetInProgressRef.current.delete(providerId)
        const pending = pendingProviderSheetSaveRef.current[providerId]
        console.log('[ProviderSheetPage:ProvidersSave] finish', {
          providerId,
          hasPending: Boolean(pending),
        })
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
          console.log('[ProviderSheetPage:ProvidersSave] replay pending', {
            providerId,
            rows: toSave.length,
            deletes: pending.deletedDbIds.length,
          })
          saveProviderSheetRows(providerId, toSave, pendingDeletes)
            .then(() => pending.resolvers.forEach((r) => r.resolve()))
            .catch((err) => {
              console.error('[ProviderSheetPage] pending save retry failed:', err)
              pending.resolvers.forEach((r) => r.reject(err))
            })
        }
      }
    },
    [currentSheet, provider, selectedMonth, clinicId, selectedMonthKey, refetchPatients]
  )

  const saveProviderSheetRowsDirect = useCallback(
    async (providerId: string, rows: SheetRow[]) => {
      await saveProviderSheetRows(providerId, rows)
    },
    [saveProviderSheetRows]
  )

  // Restore provider sheet rows from localStorage after refresh: ProvidersTab.unmount writes a backup
  // when a save is in flight, but the browser may abort the actual fetch. On next mount we replay it.
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
      restoredPendingKeysRef.current.add(key)
      saveProviderSheetRows(provider.id, data.rows)
        .then(() => {
          try { localStorage.removeItem(key) } catch (_) {}
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

    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
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
  const handleSelectMonth = (date: Date) =>
    setSelectedMonth(new Date(date.getFullYear(), date.getMonth(), 1))
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
          filterRowsByMonth={filterRowsByMonth}
          isLockProviders={isLockProviders}
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
          onSelectMonth={handleSelectMonth}
          statusColors={statusColors}
        />
      )}
    </div>
  )
}
